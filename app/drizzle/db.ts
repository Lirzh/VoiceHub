// ==========================================================================
// VoiceHub · PostgreSQL + Drizzle 连接层
//
// 核心设计：lazy schema 自动修复（mkdir -p 风格）
//   任何一次数据库查询，若 PostgreSQL 返回 schema 缺失类错误：
//     42P01  relation does not exist   缺表
//     42703  column does not exist     缺列
//     42704  type does not exist       缺枚举类型
//   当场分析缺少什么，生成并执行精确的 CREATE / ALTER SQL，
//   然后把失败的查询重试一次。
//
// 并发与冷却：
//   按"修复目标"细粒度控制（key = t:<table> / c:<table>:<col> / e:<enum>）
//   - 同一时刻 N 个请求缺同一个对象：只跑一次 DDL，其他人排队等 Promise
//   - 成功后 60s 内不再跑同一对象的 DDL（PostgreSQL DDL 同步可见）
//   - 修复失败时：不再自动重试，直接抛原始错误，避免死循环
//
// 默认值：
//   - .defaultNow() / .defaultRandom() → SQL 表达式 DEFAULT
//   - .default('str') / .default(n) / .default(true) → 字面量 DEFAULT
//   - .default(() => x) / .default(Math.random) → 应用层动态值，不在数据库层声明
// ==========================================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import { and, asc, count, desc, eq, exists, gt, gte, lt, lte, ne, or, sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.ts';
import { config } from 'dotenv';
import path from 'path';

// ── 环境配置 ──────────────────────────────────────────────────────────────

config({ path: path.resolve(process.cwd(), '.env') });
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const connectionString = process.env.DATABASE_URL;
const isNeon = connectionString.includes('neon.tech') || connectionString.includes('neon.database.com');

const getDatabaseConfig = () => ({
  max: isNeon ? 1 : (process.env.NODE_ENV === 'production' ? 10 : 5),
  idle_timeout: isNeon ? 0 : 20,
  connect_timeout: isNeon ? 10 : 30,
  max_lifetime: 3600,
  ssl: isNeon ? 'require' : (connectionString.includes('sslmode=require') || connectionString.includes('ssl=true') ? 'require' : false),
  prepare: false,
  transform: { undefined: null },
  connection: { application_name: 'voicehub-app' },
  onnotice: process.env.NODE_ENV === 'development' ? console.log : undefined,
  debug: process.env.NODE_ENV === 'development' && process.env.DEBUG_SQL === 'true'
});

const rawClient = postgres(connectionString, getDatabaseConfig());

// ── Schema 内省：从 Drizzle schema 对象提取列定义 ──────────────────
//
// Drizzle 列对象公开属性（足够我们生成 DDL）：
//   col.name          → 数据库列名（来自 pgTable('x', { col: text('col') })）
//   col.getSQLType()  → SQL 类型名（serial / integer / text / boolean / uuid / ...）
//   col.notNull       → 是否 NOT NULL
//   col.primary       → 是否主键列
//   col.hasDefault    → 是否声明了默认值
//   col.default       → 默认值（SQL 对象 / 字面量 / 函数 / undefined）
//
// pgEnum 导出对象：
//   enumObj.enumName  → 枚举类型名（如 'user_status'）
//   enumObj.values    → 枚举值数组（如 ['active', 'withdrawn', 'graduate']）
// ──────────────────────────────────────────────────────────────────────

type ColumnDef = {
  pgType: string;       // PostgreSQL 列类型
  notNull: boolean;     // 是否 NOT NULL
  isPrimary: boolean;   // 是否主键列
  default: string | null; // DEFAULT 子句（不含 DEFAULT 关键字），如 "now()" / "'USER'" / null
  isSerial: boolean;    // 是否 serial 类型（serial 自带隐式 nextval DEFAULT，我们不重复声明）
  isEnum: boolean;      // 是否枚举类型
};

// Drizzle 类型名 → PostgreSQL 类型名（大部分一致，少量规范化）
const TYPE_MAP: Record<string, string> = {
  serial: 'serial',
  integer: 'integer',
  int: 'integer',
  bigint: 'bigint',
  boolean: 'boolean',
  bool: 'boolean',
  text: 'text',
  uuid: 'uuid',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamptz',
  timestamp: 'timestamp',
  timestamptz: 'timestamptz',
  date: 'date',
  time: 'time',
  json: 'json',
  jsonb: 'jsonb',
  numeric: 'numeric',
  decimal: 'numeric',
  real: 'real',
  'double precision': 'double precision',
  inet: 'inet',
  bytea: 'bytea'
};

// 把 Drizzle 的 col.default 值转成 SQL 可直接使用的 DEFAULT 子句字符串
// 返回 null 表示 "该列没有数据库层的 DEFAULT"
function defaultToSql(col: any, d: any): string | null {
  if (d === undefined || d === null) return null;

  // 1) SQL 表达式对象（.defaultNow() → sql`now()`，.defaultRandom() → sql`gen_random_uuid()`）
  if (typeof d === 'object' && !Array.isArray(d)) {
    // 优先尝试 getSQL()（Drizzle 公开 API）
    if (typeof d.getSQL === 'function') {
      try { return d.getSQL(); } catch { /* ignore */ }
    }
    // queryChunks 形式
    if (Array.isArray(d.queryChunks)) {
      return d.queryChunks.map((c: any) => (c?.chunk ?? c?.sql ?? String(c))).join(' ');
    }
    // 简单 sql 属性
    if (typeof d.sql === 'string') return d.sql;
    // 兜底 toString
    const s = d.toString?.();
    if (s && s !== '[object Object]') return s;
    return null;
  }

  // 2) 字面量（字符串 / 布尔 / 数字）
  if (typeof d === 'string') return `'${d.replace(/'/g, "''")}'`;
  if (typeof d === 'boolean' || typeof d === 'number') return String(d);

  // 3) 函数（.default(() => 'x') / .default(Math.random) 等）
  //   → 应用层动态默认值，不在数据库层声明 DEFAULT，留给 Drizzle INSERT 时计算
  if (typeof d === 'function') return null;

  return null;
}

function resolveDefault(col: any): string | null {
  if (!col) return null;

  // Drizzle 明确标记 hasDefault = false 且 col.default 是 undefined → 无默认值
  if (col.hasDefault === false && col.default === undefined) return null;

  // serial 类型：PostgreSQL 会自动创建序列并绑定 DEFAULT nextval()，
  // 我们不在 CREATE TABLE 中重复声明，避免冲突
  const rawType = typeof col.getSQLType === 'function' ? col.getSQLType() : '';
  if (rawType === 'serial') return null;

  return defaultToSql(col, col.default);
}

function getColumnDef(col: any, enumNames: Set<string>): ColumnDef {
  const rawType = typeof col.getSQLType === 'function' ? col.getSQLType() : 'text';
  const pgType = TYPE_MAP[rawType] ?? (rawType.startsWith('character varying') ? rawType.replace('character varying', 'varchar') : rawType);
  const isSerial = rawType === 'serial';
  const isPrimary = !!col.primary;
  const notNull = !!col.notNull || isPrimary;
  const defaultStr = resolveDefault(col);
  const isEnum = enumNames.has(pgType);

  return { pgType, notNull, isPrimary, default: defaultStr, isSerial, isEnum };
}

// 从 schema.ts 中扫描表和枚举
// 两轮遍历：先收集所有枚举，再处理表（避免依赖定义顺序）
type TableInfo = { tableName: string; columns: { colName: string; def: ColumnDef; enumType: string | null }[] };
type EnumInfo = { name: string; values: string[] };

function buildSchemaMaps(): { tables: Map<string, TableInfo>; enums: Map<string, EnumInfo>; enumNames: Set<string> } {
  const enums = new Map<string, EnumInfo>();
  const tables = new Map<string, TableInfo>();
  const entries = Object.entries<any>(schema);

  // ── 第 1 轮：收集枚举 ────────────────────────────────────────
  for (const [, val] of entries) {
    if (!val || typeof val !== 'object') continue;
    if (typeof val.enumName === 'string' && Array.isArray(val.values)) {
      enums.set(val.enumName, { name: val.enumName, values: val.values });
    }
  }
  const enumNames = new Set(enums.keys());

  // ── 第 2 轮：处理表 ──────────────────────────────────────────
  const $skipKeys = new Set(['$inferSelect', '$inferInsert']);
  for (const [, val] of entries) {
    if (!val || typeof val !== 'object') continue;
    if (typeof val.enumName === 'string' && Array.isArray(val.values)) continue; // 已在第 1 轮处理

    const tableName: string | undefined =
      typeof val.dbName === 'string' ? val.dbName :
        typeof val.name === 'string' ? val.name : undefined;
    if (!tableName) continue;

    const cols: TableInfo['columns'] = [];
    for (const [key, col] of Object.entries<any>(val)) {
      if (!col || typeof col !== 'object') continue;
      if ($skipKeys.has(key) || key.startsWith('$')) continue;
      if (typeof col.getSQLType !== 'function') continue; // 过滤非列字段

      const def = getColumnDef(col, enumNames);
      const enumType = def.isEnum ? def.pgType : null;
      // col.name 是 Drizzle 的数据库列名；key 是 TS 字段名
      const colName: string = (col as any).name ?? (col as any).fieldName ?? key;
      cols.push({ colName, def, enumType });
    }
    if (cols.length > 0) tables.set(tableName, { tableName, columns: cols });
  }

  return { tables, enums, enumNames };
}

const { tables: schemaTables, enums: schemaEnums } = buildSchemaMaps();

// ── SQL 生成（全部幂等） ────────────────────────────────────────────────
//
// 设计原则：所有补表/补列/补枚举的 SQL 必须幂等，避免并发请求产生 42P07。
//   CREATE TABLE IF NOT EXISTS
//   ALTER TABLE ADD COLUMN IF NOT EXISTS
//   DO $$ BEGIN CREATE TYPE ... EXCEPTION WHEN duplicate_object THEN NULL END $$
//   （PostgreSQL 11 开始支持 CREATE TYPE ... AS ENUM IF NOT EXISTS，但为了
//    兼容性和不被数据库版本限制，用 DO block 写法最稳妥）
// ──────────────────────────────────────────────────────────────────────

function buildCreateTableSql(info: TableInfo): string {
  const colDefs = info.columns.map(({ colName, def, enumType }) => {
    const type = enumType ?? def.pgType;
    const parts = [`"${colName}"`, type];
    // serial 自带隐式 DEFAULT nextval，我们不重复声明
    if (def.default && !def.isSerial) parts.push(`DEFAULT ${def.default}`);
    if (def.notNull && !def.isSerial) parts.push('NOT NULL');
    return parts.join(' ');
  });

  // 主键：优先找 isPrimary=true 的列；如果没有显式 primary，退化找 serial 列
  let pkCol = info.columns.find((c) => c.def.isPrimary);
  if (!pkCol) pkCol = info.columns.find((c) => c.def.isSerial);
  if (pkCol) colDefs.push(`PRIMARY KEY ("${pkCol.colName}")`);

  return `CREATE TABLE IF NOT EXISTS "${info.tableName}" (${colDefs.join(', ')})`;
}

function buildAlterTableSql(tableName: string, colName: string, def: ColumnDef, enumType: string | null): string {
  const type = enumType ?? def.pgType;
  const stmts: string[] = [];

  // 1) 添加列（幂等）
  if (def.default) {
    // 有默认值：一条语句搞定（ADD COLUMN + DEFAULT + NOT NULL，PostgreSQL 会自动回填）
    const parts = [`ADD COLUMN IF NOT EXISTS "${colName}" ${type}`, `DEFAULT ${def.default}`];
    if (def.notNull) parts.push('NOT NULL');
    stmts.push(`ALTER TABLE "${tableName}" ${parts.join(' ')}`);
  } else {
    // 无默认值：只加列，不设 NOT NULL（否则已有行会因 NULL 导致 SET NOT NULL 失败）
    stmts.push(`ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${colName}" ${type}`);
  }

  return stmts.join('; ');
}

function buildCreateTypeSql(info: EnumInfo): string {
  const vals = info.values.map((v: string) => `'${v.replace(/'/g, "''")}'`).join(', ');
  // 用 $drizzle_enum$ 定界符（与 SQL 内部任何内容都不会冲突）
  // PostgreSQL < 11 不支持 CREATE TYPE IF NOT EXISTS，用 DO block 写法跨版本兼容
  const tag = 'drizzle_enum';
  return 'DO $' + tag + '$ BEGIN CREATE TYPE "' + info.name + '" AS ENUM (' + vals + '); EXCEPTION WHEN duplicate_object THEN NULL; END $' + tag + '$;';
}

// ── 错误 → 修复目标 key ─────────────────────────────────────────────

type TargetKey = { kind: 'table' | 'column' | 'type'; target: string };

function targetKeyFromError(err: any): TargetKey | null {
  const msg: string = err?.message ?? '';
  const code: string = err?.code ?? '';

  // relation "User" does not exist
  const tableMatch = msg.match(/relation\s+"([^"]+)"/i);
  if (code === '42P01' && tableMatch) return { kind: 'table', target: tableMatch[1] };

  // column "emailVerified" of relation "User" does not exist
  const colMatch = msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"([^"]+)"/i);
  if (code === '42703' && colMatch) return { kind: 'column', target: `${colMatch[2]}:${colMatch[1]}` };

  // type "user_status" does not exist
  const typeMatch = msg.match(/type\s+"([^"]+)"/i);
  if (code === '42704' && typeMatch) return { kind: 'type', target: typeMatch[1] };

  return null;
}

// ── 大小写不敏感查找 ─────────────────────────────────────────────────
// PostgreSQL 未引号包裹的标识符被规范化为小写（users），而 schema.ts 中
// pgTable('User', ...) 的 dbName 可能是混合大小写（User）。
// 先精确匹配，找不到再做大小写不敏感匹配。
function findTableKey(name: string): string | undefined {
  if (schemaTables.has(name)) return name;
  const lower = name.toLowerCase();
  return [...schemaTables.keys()].find((k) => k.toLowerCase() === lower);
}

function findColumnKey(tbl: TableInfo, colName: string): string | undefined {
  const found = tbl.columns.find((c) => c.colName === colName);
  if (found) return found.colName;
  const lower = colName.toLowerCase();
  return tbl.columns.find((c) => c.colName.toLowerCase() === lower)?.colName;
}

// ── 细粒度冷却 + 并发控制 ────────────────────────────────────────────
// key: t:<table> / c:<table>:<col> / e:<enum>
// 策略：
//   - 同 key 的并发请求：只有一个跑 DDL，其他人 await Promise
//   - DDL 成功：60s 冷却，同 key 不再重复 DDL
//   - DDL 失败：不设冷却，让调用方立即拿到原始错误，避免死循环
//   - schema 中找不到目标定义：大小写不敏感重试后仍找不到 → return false
const FIX_COOLDOWN_MS = 60 * 1000;
type FixState = { inProgress: Promise<boolean> | null; lastDoneAt: number };
const fixMap = new Map<string, FixState>();

async function ensureSchemaFixedFor(err: any): Promise<boolean> {
  const target = targetKeyFromError(err);
  if (!target) return false;

  // 先看 schema 中是否有对应定义（大小写不敏感）—— 找不到就不瞎修
  if (target.kind === 'type') {
    const found = [...schemaEnums.keys()].find(
      (k) => k.toLowerCase() === target.target.toLowerCase()
    );
    if (!found) return false;
    target.target = found; // 修正为 schema 中的真实大小写
  }

  if (target.kind === 'table') {
    const matchedKey = findTableKey(target.target);
    if (!matchedKey) return false;
    target.target = matchedKey; // 修正为 schema 中的真实大小写
  }

  if (target.kind === 'column') {
    const [tName, cName] = target.target.split(':');
    const matchedTblKey = findTableKey(tName);
    if (!matchedTblKey) return false;
    const tbl = schemaTables.get(matchedTblKey)!;
    const matchedColName = findColumnKey(tbl, cName);
    if (!matchedColName) return false;
    // 修正 target 为 schema 中的真实大小写，供后续 get() 使用
    target.target = `${matchedTblKey}:${matchedColName}`;
  }

  const key = `${target.kind[0]}:${target.target}`;
  let state = fixMap.get(key);

  // 1) 有其他请求在修复同一目标 → 等它完成
  if (state && state.inProgress) {
    return await state.inProgress;
  }

  // 2) 该目标 60s 内已修过且成功 → 直接交给调用方重试查询
  const now = Date.now();
  if (state && state.lastDoneAt > 0 && now - state.lastDoneAt < FIX_COOLDOWN_MS) {
    return true;
  }

  // 3) 新修复流程（只有第一个请求到达才会走到这里）
  if (!state) {
    state = { inProgress: null, lastDoneAt: 0 };
    fixMap.set(key, state);
  }

  state.inProgress = (async () => {
    try {
      if (target.kind === 'type') {
        const info = schemaEnums.get(target.target);
        if (!info) return false;
        console.log(`[db] 创建缺失枚举类型: ${target.target}`);
        await rawClient.unsafe(buildCreateTypeSql(info));
        console.log(`[db] ✅ 枚举 ${target.target} 已创建`);
      }

      if (target.kind === 'table') {
        const info = schemaTables.get(target.target);
        if (!info) return false;
        console.log(`[db] 创建缺失表: ${target.target}`);
        await rawClient.unsafe(buildCreateTableSql(info));
        console.log(`[db] ✅ 表 ${target.target} 已创建`);
      }

      if (target.kind === 'column') {
        const [tName, cName] = target.target.split(':');
        const info = schemaTables.get(tName);
        if (!info) return false;
        const colInfo = info.columns.find((c) => c.colName === cName);
        if (!colInfo) return false;
        console.log(`[db] 为表 ${tName} 添加缺失列: ${cName}`);
        await rawClient.unsafe(buildAlterTableSql(tName, cName, colInfo.def, colInfo.enumType));
        console.log(`[db] ✅ 列 ${cName} 已添加`);
      }

      state!.lastDoneAt = Date.now();
      return true;
    } catch (e: any) {
      console.warn(`[db] ⚠️ schema 修复失败（${key}）:`, e?.message ?? e);
      return false;
    } finally {
      state!.inProgress = null;
    }
  })();

  return await state.inProgress;
}

// ── Proxy：让所有查询自动具备 schema 修复能力 ────────────────────
//
// 失败路径：查询 → 捕获 42P01/42703/42704 → ensureSchemaFixedFor() →
//         成功则重试原查询一次 → 失败则抛原始错误
// PostgreSQL 自身对 DDL 是并发安全的（ACCESS EXCLUSIVE 锁），
// 应用层只负责"别让多个请求各自跑一遍相同 DDL"——上面的 fixMap + Promise 排队已解决。
// ──────────────────────────────────────────────────────────────────────

const SCHEMA_ERROR_CODES = new Set(['42P01', '42703', '42704']);
const NON_QUERY_METHODS = new Set(['end', 'destroy', 'close', 'cancel']);

function wrapWithRetry<T>(promise: any, retry: () => Promise<T>): Promise<T> {
  if (!promise || typeof promise.then !== 'function') return promise as Promise<T>;
  return (async () => {
    try {
      return await promise;
    } catch (err: any) {
      const code: string = err?.code ?? '';
      if (!SCHEMA_ERROR_CODES.has(code)) throw err;

      const fixed = await ensureSchemaFixedFor(err);
      if (fixed) return await retry();
      throw err;
    }
  })();
}

const client = new Proxy(rawClient as any, {
  // 拦截 tagged template 调用：client`SELECT ...`
  apply(target, _thisArg, args) {
    const result = target(...args);
    return wrapWithRetry(result, () => target(...args));
  },
  // 拦截 client.unsafe(sql) / client.end() 等方法调用
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== 'function') return value;
    return function (this: any, ...args: any[]) {
      const result = value.apply(target, args); // postgres.js 的方法不依赖 caller this
      // 结束/销毁/取消等非查询方法跳过 schema 修复
      if (typeof prop === 'string' && NON_QUERY_METHODS.has(prop)) return result;
      return wrapWithRetry(result, () => value.apply(target, args));
    };
  }
}) as ReturnType<typeof postgres>;

// ── 对外导出 ──────────────────────────────────────────────────────────────

export const db = drizzle(client, { schema });
export { client };
export * from './schema.ts';
export { eq, ne, and, gt, gte, lt, lte, count, exists, desc, asc, or, sql };

export async function testConnection(): Promise<boolean> {
  try {
    await client`SELECT 1`;
    console.log('[db] ✅ 连接正常');
    return true;
  } catch (error) {
    console.error('[db] ❌ 连接失败:', error);
    return false;
  }
}

export function getConnectionStatus() {
  return {
    connected: !client.ended,
    status: client.ended ? 'disconnected' : 'connected',
    maxConnections: client.options.max,
    idleTimeout: client.options.idle_timeout,
    connectTimeout: client.options.connect_timeout
  };
}

export async function closeConnection(): Promise<void> {
  try {
    if (!client.ended) {
      await client.end({ timeout: 10 });
      console.log('[db] ✅ 连接已优雅关闭');
    }
  } catch (error) {
    console.error('[db] ❌ 关闭连接失败:', error);
  }
}

if (typeof process !== 'undefined') {
  process.on('SIGINT', closeConnection);
  process.on('SIGTERM', closeConnection);
  process.on('beforeExit', closeConnection);
}
