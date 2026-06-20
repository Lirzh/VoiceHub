// ==========================================================================
// VoiceHub · PostgreSQL + Drizzle 连接层
//
// 核心设计：lazy schema 自动修复（mkdir -p 风格）
//   任何一次数据库查询，若 PostgreSQL 返回 schema 缺失类错误：
//     42P01  relation does not exist   缺表
//     42703  column does not exist     缺列
//     42704  type does not exist       缺枚举类型
//   当场：
//     1) 从错误消息解析出缺失的对象
//     2) 查询 information_schema / pg_type 双重确认对象不存在
//     3) 生成并执行精确的 CREATE / ALTER SQL（全部幂等）
//     4) 把失败的查询重试一次
//
// 并发：
//   同一对象同一进程内同一时刻只会跑一次"检查+DDL"，其他请求 await 同一个 Promise。
//   没有任何"冷却时间""延时等待"设计，完全基于真实数据库状态。
//
// 默认值：
//   .defaultNow() / .defaultRandom() → SQL 表达式 DEFAULT
//   .default('str') / .default(n) / .default(true) → 字面量 DEFAULT
//   .default(() => x) / .default(Math.random) → 应用层动态值，不在数据库层声明
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

// ── SQL 字面量转义 ───────────────────────────────────────────────────────

// 单引号字面量转义（WHERE name = 'O''Neil'）
const escString = (s: string) => s.replace(/'/g, "''");
// 双引号标识符转义（"User""Profile"）— 仅对 schema 中定义的名称使用，避免 SQL 注入
const escIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

// ── Schema 内省 ───────────────────────────────────────────────────────
// Drizzle 列对象公开属性：
//   col.name / col.dbName      → 数据库列名
//   col.getSQLType()           → SQL 类型名
//   col.notNull                → NOT NULL
//   col.primary                → 主键列
//   col.default                → 默认值（SQL 对象 / 字面量 / 函数 / undefined）
// pgEnum 导出对象：enumName / values
// ──────────────────────────────────────────────────────────────────────

type ColumnDef = {
  pgType: string;       // PostgreSQL 列类型（枚举列的 pgType 即枚举名）
  notNull: boolean;     // 是否 NOT NULL
  isPrimary: boolean;   // 是否主键列
  default: string | null; // DEFAULT 子句（如 "now()" / "'USER'"），无则 null
  isSerial: boolean;    // serial 自带隐式 nextval，不重复声明
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

// 把 Drizzle 的 col.default 转成 SQL DEFAULT 子句字符串
// 返回 null 表示 "该列没有数据库层 DEFAULT"
function defaultToSql(d: unknown): string | null {
  if (d === undefined || d === null) return null;

  // 1) SQL 表达式对象（.defaultNow() → sql`now()`）
  if (typeof d === 'object' && !Array.isArray(d)) {
    const obj = d as { getSQL?: () => string; queryChunks?: { chunk?: string; sql?: string }[]; sql?: string; toString?: () => string };
    if (typeof obj.getSQL === 'function') {
      try { return obj.getSQL(); } catch { /* ignore */ }
    }
    if (Array.isArray(obj.queryChunks)) {
      return obj.queryChunks.map((c) => c?.chunk ?? c?.sql ?? String(c)).join(' ');
    }
    if (typeof obj.sql === 'string') return obj.sql;
    const s = obj.toString?.();
    if (s && s !== '[object Object]') return s;
    return null;
  }

  // 2) 字面量（字符串 / 布尔 / 数字）
  if (typeof d === 'string') return `'${escString(d)}'`;
  if (typeof d === 'boolean' || typeof d === 'number') return String(d);

  // 3) 函数（应用层动态值，不在数据库层声明）
  if (typeof d === 'function') return null;

  return null;
}

function getColumnDef(col: unknown): ColumnDef {
  const c = col as { getSQLType?: () => string; primary?: boolean; notNull?: boolean; default?: unknown };
  const rawType = typeof c.getSQLType === 'function' ? c.getSQLType() : 'text';
  const pgType = TYPE_MAP[rawType] ?? (typeof rawType === 'string' && rawType.startsWith('character varying') ? rawType.replace('character varying', 'varchar') : rawType);
  const isSerial = rawType === 'serial';
  const isPrimary = !!c.primary;
  const notNull = !!c.notNull || isPrimary;
  const defaultStr = isSerial ? null : defaultToSql(c.default);
  return { pgType, notNull, isPrimary, default: defaultStr, isSerial };
}

// 从 schema.ts 中扫描表和枚举
// 两轮遍历：先枚举，再表，避免依赖定义顺序
type TableInfo = { tableName: string; columns: { colName: string; def: ColumnDef }[] };
type EnumInfo = { name: string; values: string[] };

function buildSchemaMaps(): { tables: Map<string, TableInfo>; enums: Map<string, EnumInfo> } {
  const enums = new Map<string, EnumInfo>();
  const tables = new Map<string, TableInfo>();
  const entries = Object.entries(schema);

  // ── 第 1 轮：收集枚举 ────────────────────────────────────────
  for (const [, val] of entries) {
    if (!val || typeof val !== 'object') continue;
    const v = val as { enumName?: unknown; values?: unknown };
    if (typeof v.enumName === 'string' && Array.isArray(v.values)) {
      enums.set(v.enumName, { name: v.enumName, values: v.values as string[] });
    }
  }
  // ── 第 2 轮：处理表 ──────────────────────────────────────────
  const skipKeys = new Set(['$inferSelect', '$inferInsert']);
  for (const [, val] of entries) {
    if (!val || typeof val !== 'object') continue;
    const v = val as { enumName?: unknown; values?: unknown; dbName?: unknown; name?: unknown };
    if (typeof v.enumName === 'string' && Array.isArray(v.values)) continue; // 已在第 1 轮处理

    const tableName: string | undefined =
      typeof v.dbName === 'string' ? v.dbName :
        typeof v.name === 'string' ? v.name : undefined;
    if (!tableName) continue;

    const cols: TableInfo['columns'] = [];
    for (const [key, col] of Object.entries(v)) {
      if (!col || typeof col !== 'object') continue;
      if (skipKeys.has(key) || key.startsWith('$')) continue;
      const c = col as { getSQLType?: unknown; name?: unknown; fieldName?: unknown };
      if (typeof c.getSQLType !== 'function') continue;
      const def = getColumnDef(col);
      const colName: string = typeof c.name === 'string' ? c.name : (typeof c.fieldName === 'string' ? c.fieldName : key);
      cols.push({ colName, def });
    }
    if (cols.length > 0) tables.set(tableName, { tableName, columns: cols });
  }

  return { tables, enums };
}

const { tables: schemaTables, enums: schemaEnums } = buildSchemaMaps();

// ── SQL 生成（全部幂等） ────────────────────────────────────────

function buildCreateTableSql(info: TableInfo): string {
  const colDefs = info.columns.map(({ colName, def }) => {
    // 枚举列的 pgType 就是枚举名，直接用；普通列用类型名
    const parts = [escIdent(colName), def.pgType];
    if (def.default) parts.push(`DEFAULT ${def.default}`);
    if (def.notNull && !def.isSerial) parts.push('NOT NULL');
    return parts.join(' ');
  });

  // 主键：优先 isPrimary=true；退化找 serial 列
  let pkCol = info.columns.find((c) => c.def.isPrimary);
  if (!pkCol) pkCol = info.columns.find((c) => c.def.isSerial);
  if (pkCol) colDefs.push(`PRIMARY KEY (${escIdent(pkCol.colName)})`);

  return `CREATE TABLE IF NOT EXISTS ${escIdent(info.tableName)} (${colDefs.join(', ')})`;
}

function buildAlterTableSql(tableName: string, colName: string, def: ColumnDef): string {
  if (def.default) {
    // 有默认值：一条语句搞定（ADD COLUMN + DEFAULT + NOT NULL，PostgreSQL 自动回填）
    const parts = [`ADD COLUMN IF NOT EXISTS ${escIdent(colName)} ${def.pgType}`, `DEFAULT ${def.default}`];
    if (def.notNull) parts.push('NOT NULL');
    return `ALTER TABLE ${escIdent(tableName)} ${parts.join(' ')}`;
  }
  // 无默认值：只加列，不设 NOT NULL（否则已有行因 NULL 报错）
  return `ALTER TABLE ${escIdent(tableName)} ADD COLUMN IF NOT EXISTS ${escIdent(colName)} ${def.pgType}`;
}

function buildCreateTypeSql(info: EnumInfo): string {
  const vals = info.values.map((v) => `'${escString(v)}'`).join(', ');
  // $drizzle_enum$ 自定义定界符，与枚举内容永不冲突
  return `DO $drizzle_enum$ BEGIN CREATE TYPE ${escIdent(info.name)} AS ENUM (${vals}); EXCEPTION WHEN duplicate_object THEN NULL; END $drizzle_enum$;`;
}

// ── 错误解析 + 数据库元数据检查 ────────────────────────────────

type SchemaTarget =
  | { kind: 'type';   name: string; info: EnumInfo }
  | { kind: 'table';  name: string; info: TableInfo }
  | { kind: 'column'; table: string; col: string; info: TableInfo; colDef: ColumnDef };

// PostgreSQL 未加引号的标识符被规范化为小写，schema.ts 的 dbName 可能是混合大小写。
// 先精确匹配，找不到再做大小写不敏感匹配。
function findTableCI(name: string): TableInfo | undefined {
  const exact = schemaTables.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [key, info] of schemaTables) {
    if (key.toLowerCase() === lower) return info;
  }
  return undefined;
}

function findColumnCI(tbl: TableInfo, colName: string): { colName: string; def: ColumnDef } | undefined {
  const exact = tbl.columns.find((c) => c.colName === colName);
  if (exact) return exact;
  const lower = colName.toLowerCase();
  return tbl.columns.find((c) => c.colName.toLowerCase() === lower);
}

function findEnumCI(name: string): EnumInfo | undefined {
  const exact = schemaEnums.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [key, info] of schemaEnums) {
    if (key.toLowerCase() === lower) return info;
  }
  return undefined;
}

function targetFromError(err: unknown): SchemaTarget | null {
  const code = (err as { code?: string })?.code ?? '';
  const msg = (err as { message?: string })?.message ?? '';

  // relation "User" does not exist
  const tableMatch = msg.match(/relation\s+"([^"]+)"/i);
  if (code === '42P01' && tableMatch) {
    const info = findTableCI(tableMatch[1]);
    if (info) {
      log(`🔍 解析 schema 错误 → 缺表 "${tableMatch[1]}"，映射到 "${info.tableName}"`);
      return { kind: 'table', name: info.tableName, info };
    }
    warn(`⚠️ 42P01 但 schema.ts 中找不到表 "${tableMatch[1]}"`);
  }

  // column "emailVerified" of relation "User" does not exist
  const colMatch = msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"([^"]+)"/i);
  if (code === '42703' && colMatch) {
    const tbl = findTableCI(colMatch[2]);
    if (tbl) {
      const col = findColumnCI(tbl, colMatch[1]);
      if (col) {
        log(`🔍 解析 schema 错误 → 缺列 "${colMatch[1]}"（表 "${tbl.tableName}"），映射到 "${col.colName}"`);
        return { kind: 'column', table: tbl.tableName, col: col.colName, info: tbl, colDef: col.def };
      }
      warn(`⚠️ 42703 但 schema.ts 表 "${tbl.tableName}" 中找不到列 "${colMatch[1]}"`);
    }
  }

  // type "user_status" does not exist
  const typeMatch = msg.match(/type\s+"([^"]+)"/i);
  if (code === '42704' && typeMatch) {
    const info = findEnumCI(typeMatch[1]);
    if (info) {
      log(`🔍 解析 schema 错误 → 缺枚举类型 "${typeMatch[1]}"，映射到 "${info.name}"`);
      return { kind: 'type', name: info.name, info };
    }
    warn(`⚠️ 42704 但 schema.ts 中找不到枚举类型 "${typeMatch[1]}"`);
  }

  return null;
}

// 真正查询数据库，确认对象是否真的不存在。
// 完全基于真实数据库状态，不依赖任何延时/冷却假设。
async function objectMissing(target: SchemaTarget): Promise<boolean> {
  const kind = target.kind === 'type' ? `枚举 ${target.name}` : target.kind === 'table' ? `表 ${target.name}` : `列 ${target.table}.${target.col}`;
  log(`🔎 检查数据库中是否存在: ${kind}`);
  try {
    if (target.kind === 'type') {
      // SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
      // WHERE t.typname = '...' AND n.nspname = current_schema()
      const rows = await rawClient.unsafe(
        `SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE t.typname = '${escString(target.name)}' AND n.nspname = current_schema()`
      );
      return (rows as unknown as { length: number }).length === 0;
    }
    if (target.kind === 'table') {
      const rows = await rawClient.unsafe(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = '${escString(target.name)}'`
      );
      const missing = (rows as unknown as { length: number }).length === 0;
      log(`🔎 "${target.name}" 在 information_schema.tables 中 ${missing ? '不存在' : '已存在'}`);
      return missing;
    }
    // column
    const rows = await rawClient.unsafe(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${escString(target.table)}' AND column_name = '${escString(target.col)}'`
    );
    const colMissing = (rows as unknown as { length: number }).length === 0;
    log(`🔎 "${target.table}.${target.col}" 在 information_schema.columns 中 ${colMissing ? '不存在' : '已存在'}`);
    return colMissing;
  } catch (e) {
    // 数据库元数据查询失败（如连接断开）：不认为是"对象已存在"，让调用方收到原始错误
    const msg = (e as { message?: string })?.message ?? String(e);
    warn(`⚠️ objectMissing 查询失败（DB 不可用）: ${msg}`);
    throw e;
  }
}

// ── 并发控制：每 key 同刻只跑一次"检查+DDL" ────────────────
// 没有任何"冷却时间"——每次都先查 information_schema 确认。
// key = t:<table> / c:<table>:<col> / e:<enum>
const runningFixes = new Map<string, Promise<boolean>>();

function keyFor(target: SchemaTarget): string {
  if (target.kind === 'type')   return `e:${target.name}`;
  if (target.kind === 'table')  return `t:${target.name}`;
  return `c:${target.table}:${target.col}`;
}

async function ensureSchemaFixedFor(err: unknown): Promise<boolean> {
  const target = targetFromError(err);
  if (!target) return false;

  const key = keyFor(target);

  // 1) 其他请求正在修同一对象 → 等它完成
  const pending = runningFixes.get(key);
  if (pending) return await pending;

  // 2) 新的"检查+修复"流程。立即 set Promise 作为锁，并发请求会被 1) 拦截。
  const fixPromise = (async (): Promise<boolean> => {
    try {
      // 真正查询数据库确认对象是否缺失
      const missing = await objectMissing(target);
      if (!missing) {
        log(`✅ 对象 "${key}" 已存在（瞬时错误），让调用方重试`);
        return true; // 对象已存在（瞬时错误），让调用方重试
      }

      if (target.kind === 'type') {
        const sql = buildCreateTypeSql(target.info);
        log(`📦 执行 DDL: ${sql}`);
        await rawClient.unsafe(sql);
        log(`✅ 枚举 ${target.name} 已创建`);
      }
      if (target.kind === 'table') {
        const sql = buildCreateTableSql(target.info);
        log(`📦 执行 DDL: ${sql}`);
        await rawClient.unsafe(sql);
        log(`✅ 表 ${target.name} 已创建`);
      }
      if (target.kind === 'column') {
        const sql = buildAlterTableSql(target.table, target.col, target.colDef);
        log(`📦 执行 DDL: ${sql}`);
        await rawClient.unsafe(sql);
        log(`✅ 列 ${target.col} 已添加`);
      }
      return true;
    } catch (e) {
      const msg = (e as { message?: string })?.message ?? String(e);
      warn(`⚠️ schema 修复失败（${key}）: ${msg}`);
      return false;
    } finally {
      runningFixes.delete(key);
    }
  })();

  runningFixes.set(key, fixPromise);
  return await fixPromise;
}

// ── Proxy：让所有查询自动具备 schema 修复能力 ───────────────
//
// 关键设计：drizzle-orm 通过 client.unsafe(sql, params).values() 执行查询，
//   unsafe 返回的是 postgres.js 的 Query 对象（extends Promise），
//   带 .values() / .execute() 等链式方法。如果把返回值包成普通 Promise，
//   drizzle 调 .values() 就会报 "client.unsafe(...).values is not a function"。
//
// 两条路径：
//   1. apply — tagged template 调用 client`SELECT ...` → 直接包 Promise
//   2. get   — client.unsafe(...) 等方法调用 → 保留原始 Query 对象，
//              只在 .then 决议时注入 schema 错误检测与重试，
//              不破坏 .values/.execute 等同步链式方法
//
// 失败路径：查询 → .then 捕获 42P01/42703/42704 → ensureSchemaFixedFor →
//           成功则返回新 Query 重试 → 失败则抛原始错误
const SCHEMA_ERROR_CODES = new Set(['42P01', '42703', '42704']);
const NON_QUERY_METHODS = new Set(['end', 'destroy', 'close', 'cancel']);

// 路径 1：给普通 Promise 套一层 schema 检测（用于 apply/template-string）
function wrapPromiseWithRetry<T>(promise: any, retry: () => Promise<T>): Promise<T> {
  if (!promise || typeof promise.then !== 'function') return promise as Promise<T>;
  return (async () => {
    try {
      return await promise;
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (!SCHEMA_ERROR_CODES.has(code)) throw err;
      const fixed = await ensureSchemaFixedFor(err);
      if (fixed) {
        log(`🔁 重试查询（schema 已修复）`);
        return await retry();
      }
      log(`⚠️ schema 修复失败，抛出原错误`);
      throw err;
    }
  })();
}

// 路径 2：为 postgres.js Query 对象注入 schema 错误检测（用于 unsafe/.values 路径）
//   不改写 Query 对象结构，只在 .then 决议时刻拦截 schema 错误并触发修复+重试
function wrapQueryWithSchemaFix(query: any, retry: () => any): any {
  // 取原始 Promise.then（Query extends Promise）
  const origThen = query.then.bind(query);

  // 覆盖实例的 .then，让 schema 错误在 await 决议时被捕获并修复
  query.then = function (onFulfilled: any, onRejected: any) {
    return origThen(
      onFulfilled,
      async (err: any) => {
        const code = (err as { code?: string })?.code ?? '';
        if (!SCHEMA_ERROR_CODES.has(code)) throw err;
        const fixed = await ensureSchemaFixedFor(err);
        if (fixed) {
          log(`🔁 重试查询（schema 已修复）`);
          return await retry(); // 返回新的 Query，由上层继续 await；失败则 throw
        }
        log(`⚠️ schema 修复失败，抛出原错误`);
        throw err;
      }
    );
  } as Promise<any>['then'];

  query.catch = function (onRejected: any) {
    return query.then(undefined, onRejected);
  };

  query.finally = function (onFinally: any) {
    return query.then(
      (v: any) => { onFinally?.(); return v; },
      (e: any) => { onFinally?.(); throw e; }
    );
  };

  return query;
}

const client = new Proxy(rawClient as any, {
  // 路径 1：tagged template 调用 client`SELECT ...` → 返回普通 Promise
  apply(target, _thisArg, args) {
    const result = target(...args);
    return wrapPromiseWithRetry(result, () => target(...args));
  },
  // 路径 2：client.unsafe(sql) / client.end() 等方法调用
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== 'function') return value;
    const boundFn = (value as Function).bind(target);
    return function (this: unknown, ...args: unknown[]) {
      const result = boundFn(...args);
      // 非查询方法（end/close/destroy/cancel）直接透传
      if (typeof prop === 'string' && NON_QUERY_METHODS.has(prop)) return result;
      // 有 .values 方法 → 是 postgres.js Query 对象 → 用 Query 级包装
      // 否则 → 普通 Promise → 用 Promise 级包装
      if (result && typeof result.values === 'function') {
        return wrapQueryWithSchemaFix(result, () => boundFn(...args));
      }
      return wrapPromiseWithRetry(result, () => boundFn(...args));
    };
  }
}) as ReturnType<typeof postgres>;

// ── Dev 模式日志 ─────────────────────────────────────────────────────────
const DEV = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => { if (DEV) console.log('[db]', ...args); };
const warn = (...args: unknown[]) => { if (DEV) console.warn('[db]', ...args); };

// ── 对外导出 ──────────────────────────────────────────────────────────────

export const db = drizzle(client, { schema });
export { client };
export * from './schema.ts';
export { eq, ne, and, gt, gte, lt, lte, count, exists, desc, asc, or, sql };

export async function testConnection(): Promise<boolean> {
  try {
    await client`SELECT 1`;
    log('✅ 连接正常');
    return true;
  } catch (error) {
    warn(`❌ 连接失败: ${error}`);
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
      log('✅ 连接已优雅关闭');
    }
  } catch (error) {
    warn(`❌ 关闭连接失败: ${error}`);
  }
}

if (typeof process !== 'undefined') {
  process.on('SIGINT', closeConnection);
  process.on('SIGTERM', closeConnection);
  process.on('beforeExit', closeConnection);
}
