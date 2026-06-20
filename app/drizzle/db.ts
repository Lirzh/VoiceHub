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
//     2) 查询 information_schema / pg_type 确认对象是否真的缺失
//     3) 生成并执行幂等的 CREATE / ALTER TABLE DDL
//     4) 把失败的查询重试一次
//
// 并发控制：
//   同一修复目标同刻只会跑一次"检查+DDL"，其他请求 await 同一个 Promise。
//   没有任何"冷却时间""延时等待"设计，完全基于真实数据库状态。
//
// 默认值处理：
//   .defaultNow() / .defaultRandom() / sql`...` → SQL 表达式 DEFAULT
//   .default('str') / .default(n) / .default(true) → 字面量 DEFAULT
//   .default(fn)（应用层动态值）→ 不写数据库 DEFAULT
//
// PostgreSQL 大小写规范：
//   schema.ts 中的 dbName 原样保留大小写；未加引号的标识符会被 PG
//   小写化，因此所有 SQL 生成都用双引号包裹名字，并与 schema.ts
//   中的 dbName 做大小写不敏感匹配。
// ==========================================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  and, asc, count, desc, eq, exists, gt, gte,
  lt, lte, ne, or, sql
} from 'drizzle-orm';
import * as schema from './schema.ts';
import { config } from 'dotenv';
import path from 'path';

// ── 环境配置 ──────────────────────────────────────────────────────────────

config({ path: path.resolve(process.cwd(), '.env') });
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const DEV = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => { if (DEV) console.log('[db]', ...args); };
const warn = (...args: unknown[]) => { console.warn('[db]', ...args); };

const connectionString = process.env.DATABASE_URL;
const isNeon = connectionString.includes('neon.tech') ||
                connectionString.includes('neon.database.com');

const rawClient = postgres(connectionString, {
  max: isNeon ? 1 : (process.env.NODE_ENV === 'production' ? 10 : 5),
  idle_timeout: isNeon ? 0 : 20,
  connect_timeout: isNeon ? 10 : 30,
  max_lifetime: 3600,
  ssl: isNeon ? 'require'
       : (connectionString.includes('sslmode=require') || connectionString.includes('ssl=true')) ? 'require'
       : false,
  prepare: false,
  transform: { undefined: null },
  connection: { application_name: 'voicehub-app' },
  onnotice: DEV ? console.log : undefined,
  debug: DEV && process.env.DEBUG_SQL === 'true'
});

// ── SQL 字面量转义 ───────────────────────────────────────────────────────

// 单引号字面量转义（WHERE name = 'O''Neil'）
const escString = (s: string) => s.replace(/'/g, "''");
// 双引号标识符转义（"User""Profile"）— 仅对 schema 中定义的名称使用
const escIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

// ── Schema 内省：从 schema.ts 构建"表/枚举 → DDL 生成信息"的映射 ──────
//
// 两轮遍历：
//   第 1 轮：枚举（pgEnum）— 它们同时暴露 enumName + values 两个属性
//   第 2 轮：表（pgTable）— 暴露 dbName/name；每一列带 getSQLType
//
// 跳过的键：
//   - `$inferSelect` / `$inferInsert`（Drizzle 内部类型辅助）
//   - 所有 `$` 开头的键
//   - 非对象、非函数的值
// ==========================================================================

// Drizzle 列对象公开属性（运行时直觉）：
//   col.name / col.dbName      → 数据库列名
//   col.getSQLType()           → SQL 类型名
//   col.notNull                → NOT NULL
//   col.primary                → 主键列
//   col.default                → 默认值（SQL 对象 / 字面量 / 函数 / undefined）
// pgEnum 导出对象：
//   obj.enumName               → 枚举类型名
//   obj.values                 → 枚举取值字符串数组

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
  timestamp: 'timestamp',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamptz',
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

function mapSqlType(raw: string): string {
  if (TYPE_MAP[raw]) return TYPE_MAP[raw];
  // Drizzle 对 varchar(n) 返回 "character varying(n)"
  if (raw.startsWith('character varying')) return raw.replace('character varying', 'varchar');
  // character(n) → char(n)
  if (raw.startsWith('character')) return raw.replace('character', 'char');
  return raw;
}

// 把 Drizzle 的 col.default 转成 SQL DEFAULT 子句字符串
// 返回 null 表示 "该列没有数据库层 DEFAULT"
function defaultToSql(d: unknown): string | null {
  if (d === undefined || d === null) return null;

  // 1) SQL 表达式对象（.defaultNow() → sql`now()`，.defaultRandom() → sql`gen_random_uuid()`）
  if (typeof d === 'object' && !Array.isArray(d)) {
    const obj = d as {
      getSQL?: () => string;
      queryChunks?: { chunk?: string; sql?: string }[];
      sql?: string;
      toString?: () => string;
    };
    if (typeof obj.getSQL === 'function') {
      try {
        const s = obj.getSQL();
        if (typeof s === 'string' && s.length > 0) return s;
      } catch { /* ignore */ }
    }
    if (Array.isArray(obj.queryChunks)) {
      const s = obj.queryChunks.map((c) => c?.chunk ?? c?.sql ?? String(c)).join(' ').trim();
      if (s.length > 0) return s;
    }
    if (typeof obj.sql === 'string' && obj.sql.length > 0) return obj.sql;
    const s = obj.toString?.();
    if (s && s !== '[object Object]') return s;
    return null;
  }

  // 2) 字面量（字符串 / 布尔 / 数字）
  if (typeof d === 'string') return `'${escString(d)}'`;
  if (typeof d === 'boolean' || typeof d === 'number') return String(d);

  // 3) 函数（应用层动态值，不在数据库层声明 DEFAULT）
  if (typeof d === 'function') return null;

  return null;
}

type ColumnDef = {
  colName: string;
  pgType: string;
  notNull: boolean;
  isPrimary: boolean;
  defaultSql: string | null;
  isSerial: boolean;
};

type TableInfo = { tableName: string; columns: ColumnDef[] };
type EnumInfo = { name: string; values: string[] };

function buildSchemaMaps(): {
  tables: Map<string, TableInfo>;
  enums: Map<string, EnumInfo>;
} {
  const enums = new Map<string, EnumInfo>();
  const tables = new Map<string, TableInfo>();
  const entries = Object.entries(schema);

  // ── 第 1 轮：收集枚举 ────────────────────────────────────────
  for (const [, val] of entries) {
    if (!val || typeof val !== 'object') continue;
    const v = val as { enumName?: unknown; values?: unknown };
    if (typeof v.enumName === 'string' && Array.isArray(v.values)) {
      enums.set(v.enumName, {
        name: v.enumName,
        values: (v.values as unknown[]).map((x) => String(x))
      });
    }
  }

  // ── 第 2 轮：处理表 ──────────────────────────────────────────
  const skipKeys = new Set(['$inferSelect', '$inferInsert']);
  for (const [, val] of entries) {
    if (!val || typeof val !== 'object') continue;
    const v = val as {
      enumName?: unknown; values?: unknown;
      dbName?: unknown; name?: unknown;
    };
    // 已在第 1 轮处理过的枚举
    if (typeof v.enumName === 'string' && Array.isArray(v.values)) continue;

    const tableName: string | undefined =
      typeof v.dbName === 'string' ? v.dbName
      : typeof v.name === 'string' ? v.name
      : undefined;
    if (!tableName) continue;

    const cols: ColumnDef[] = [];
    for (const [key, col] of Object.entries(v)) {
      if (!col || typeof col !== 'object') continue;
      if (skipKeys.has(key) || key.startsWith('$')) continue;
      const c = col as {
        getSQLType?: () => unknown;
        name?: unknown;
        fieldName?: unknown;
        primary?: unknown;
        notNull?: unknown;
        default?: unknown;
      };
      if (typeof c.getSQLType !== 'function') continue;
      const rawType = c.getSQLType();
      const pgType = typeof rawType === 'string' ? mapSqlType(rawType) : 'text';
      const isSerial = rawType === 'serial';
      const isPrimary = !!c.primary;
      const notNull = !!c.notNull || isPrimary;
      const defaultSql = isSerial ? null : defaultToSql(c.default);
      const colName: string =
        typeof c.name === 'string' ? c.name
        : typeof c.fieldName === 'string' ? c.fieldName
        : key;
      cols.push({ colName, pgType, notNull, isPrimary, defaultSql, isSerial });
    }

    if (cols.length > 0) tables.set(tableName, { tableName, columns: cols });
  }

  return { tables, enums };
}

const { tables: schemaTables, enums: schemaEnums } = buildSchemaMaps();

// ── SQL 生成（全部幂等） ────────────────────────────────────────

function buildCreateTableSql(info: TableInfo): string {
  const colDefs = info.columns.map((col) => {
    const parts = [escIdent(col.colName), col.pgType];
    if (col.defaultSql) parts.push(`DEFAULT ${col.defaultSql}`);
    if (col.notNull && !col.isSerial) parts.push('NOT NULL');
    return parts.join(' ');
  });

  // 主键：优先 isPrimary=true；退化找 serial 列
  let pkCol = info.columns.find((c) => c.isPrimary);
  if (!pkCol) pkCol = info.columns.find((c) => c.isSerial);
  if (pkCol) colDefs.push(`PRIMARY KEY (${escIdent(pkCol.colName)})`);

  return `CREATE TABLE IF NOT EXISTS ${escIdent(info.tableName)} (${colDefs.join(', ')})`;
}

// 添加列的规则：
//   - 有 DEFAULT：ADD COLUMN ... + DEFAULT + NOT NULL（PostgreSQL 会回填默认值，不会报错）
//   - 无 DEFAULT：只 ADD COLUMN；不写 NOT NULL（否则已有行因 NULL 报错）
function buildAlterTableSql(tableName: string, col: ColumnDef): string {
  if (col.defaultSql) {
    const parts = [
      `ADD COLUMN IF NOT EXISTS ${escIdent(col.colName)} ${col.pgType}`,
      `DEFAULT ${col.defaultSql}`
    ];
    if (col.notNull) parts.push('NOT NULL');
    return `ALTER TABLE ${escIdent(tableName)} ${parts.join(' ')}`;
  }
  return `ALTER TABLE ${escIdent(tableName)} ADD COLUMN IF NOT EXISTS ${escIdent(col.colName)} ${col.pgType}`;
}

function buildCreateTypeSql(info: EnumInfo): string {
  const vals = info.values.map((v) => `'${escString(v)}'`).join(', ');
  return `CREATE TYPE IF NOT EXISTS ${escIdent(info.name)} AS ENUM (${vals})`;
}

// ── 错误解析 + 数据库元数据检查 ────────────────────────────────

type SchemaTarget =
  | { kind: 'type'; name: string; info: EnumInfo }
  | { kind: 'table'; name: string; info: TableInfo }
  | { kind: 'column'; table: string; col: string; info: TableInfo; colDef: ColumnDef };

function findTableCI(name: string): TableInfo | undefined {
  const exact = schemaTables.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [key, info] of schemaTables) {
    if (key.toLowerCase() === lower) return info;
  }
  return undefined;
}

function findColumnCI(tbl: TableInfo, colName: string): ColumnDef | undefined {
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

// 解析 PG 错误 → SchemaTarget（可修复对象）
function targetFromError(err: unknown): SchemaTarget | null {
  const e = err as { code?: string; message?: string } | undefined;
  const code = e?.code ?? '';
  const msg = e?.message ?? '';

  const tableMatch = msg.match(/relation\s+"([^"]+)"/i);
  if (code === '42P01' && tableMatch) {
    const info = findTableCI(tableMatch[1]);
    if (info) {
      log(`🔍 解析 schema 错误 → 缺表 "${tableMatch[1]}"，映射到 "${info.tableName}"`);
      return { kind: 'table', name: info.tableName, info };
    }
    warn(`⚠️ 42P01 但 schema.ts 中找不到表 "${tableMatch[1]}"`);
  }

  const colMatch = msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"([^"]+)"/i);
  if (code === '42703' && colMatch) {
    const tbl = findTableCI(colMatch[2]);
    if (tbl) {
      const col = findColumnCI(tbl, colMatch[1]);
      if (col) {
        log(`🔍 解析 schema 错误 → 缺列 "${colMatch[1]}"（表 "${tbl.tableName}"）`);
        return { kind: 'column', table: tbl.tableName, col: col.colName, info: tbl, colDef: col };
      }
      warn(`⚠️ 42703 但 schema.ts 表 "${tbl.tableName}" 中找不到列 "${colMatch[1]}"`);
    }
  }

  const typeMatch = msg.match(/type\s+"([^"]+)"/i);
  if (code === '42704' && typeMatch) {
    const info = findEnumCI(typeMatch[1]);
    if (info) {
      log(`🔍 解析 schema 错误 → 缺枚举类型 "${typeMatch[1]}"`);
      return { kind: 'type', name: info.name, info };
    }
    warn(`⚠️ 42704 但 schema.ts 中找不到枚举类型 "${typeMatch[1]}"`);
  }

  return null;
}

// 真正查询数据库，确认对象是否真的不存在。
// 注意：这里不使用 try/catch 吞掉 DB 查询错误——连接断开等错误
// 应该透明向上传播，不应被误解释为"修复失败（return false）"。
async function objectMissing(target: SchemaTarget): Promise<boolean> {
  const kindLabel = target.kind === 'type' ? `枚举 ${target.name}`
    : target.kind === 'table' ? `表 ${target.name}`
    : `列 ${target.table}.${target.col}`;
  log(`🔎 检查数据库中是否存在: ${kindLabel}`);

  if (target.kind === 'type') {
    const rows = await rawClient.unsafe(
      `SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE t.typname = $1 AND n.nspname = current_schema()`,
      [target.name]
    );
    return rows === undefined || (rows as unknown as { length: number }).length === 0;
  }
  if (target.kind === 'table') {
    const rows = await rawClient.unsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1`,
      [target.name]
    );
    const missing = rows === undefined || (rows as unknown as { length: number }).length === 0;
    log(`🔎 "${target.name}" 在 information_schema.tables 中 ${missing ? '不存在' : '已存在'}`);
    return missing;
  }
  // column
  const rows = await rawClient.unsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2`,
    [target.table, target.col]
  );
  return rows === undefined || (rows as unknown as { length: number }).length === 0;
}

// ── 并发控制：每 key 同刻只跑一次"检查+DDL" ────────────────
// key = t:<table> / c:<table>:<col> / e:<enum>
const runningFixes = new Map<string, Promise<boolean>>();

function keyFor(target: SchemaTarget): string {
  if (target.kind === 'type') return `e:${target.name}`;
  if (target.kind === 'table') return `t:${target.name}`;
  return `c:${target.table}:${target.col}`;
}

async function ensureSchemaFixedFor(err: unknown): Promise<boolean> {
  const target = targetFromError(err);
  if (!target) return false;

  const key = keyFor(target);

  // 1) 已有同对象正在修复 → await 它结束
  const pending = runningFixes.get(key);
  if (pending) return await pending;

  // 2) 新的"检查+修复"流程。立即 set Promise 作为锁。
  const fixPromise = (async (): Promise<boolean> => {
    try {
      const missing = await objectMissing(target);
      if (!missing) {
        log(`✅ 对象 "${key}" 已存在（瞬时错误），让调用方重试`);
        return true;
      }

      let ddl = '';
      if (target.kind === 'type') {
        ddl = buildCreateTypeSql(target.info);
      } else if (target.kind === 'table') {
        ddl = buildCreateTableSql(target.info);
      } else {
        ddl = buildAlterTableSql(target.table, target.col, target.colDef);
      }

      log(`📦 执行 DDL: ${ddl}`);
      await rawClient.unsafe(ddl);

      if (target.kind === 'type') log(`✅ 枚举 ${target.name} 已创建`);
      else if (target.kind === 'table') log(`✅ 表 ${target.name} 已创建`);
      else log(`✅ 列 ${target.table}.${target.col} 已添加`);

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
//   1. apply — tagged template 调用 client`SELECT ...` → 普通 Promise 重试
//   2. get — client.unsafe(...) 等方法调用 → 保留原始 Query 对象，
//             仅覆盖 .then 注入 schema 错误检测与重试

const SCHEMA_ERROR_CODES = new Set(['42P01', '42703', '42704']);
const NON_QUERY_METHODS = new Set(['end', 'destroy', 'close', 'cancel']);

function isSchemaError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return !!code && SCHEMA_ERROR_CODES.has(code);
}

// 路径 1：普通 Promise 包一层 schema 检测
function wrapPromiseWithRetry<T>(
  promise: Promise<T>,
  retry: () => Promise<T>
): Promise<T> {
  return (async () => {
    try {
      return await promise;
    } catch (err) {
      if (!isSchemaError(err)) throw err;
      const fixed = await ensureSchemaFixedFor(err);
      if (!fixed) throw err;
      log(`🔁 重试查询（schema 已修复）`);
      return await retry();
    }
  })();
}

// 路径 2：为 postgres.js Query 对象注入 schema 检测
//   不改写 Query 对象结构，只覆盖 .then 让 schema 错误在决议时被捕获并修复
function wrapQueryWithSchemaFix<T>(query: any, retry: () => any): any {
  const origThen = query.then.bind(query);

  query.then = function (onFulfilled: any, onRejected: any): any {
    return origThen(
      onFulfilled,
      async (err: any) => {
        if (!isSchemaError(err)) throw err;
        const fixed = await ensureSchemaFixedFor(err);
        if (!fixed) throw err;
        log(`🔁 重试查询（schema 已修复）`);
        return await retry();
      }
    );
  } as Promise<T>['then'];

  query.catch = function (onRejected: any): any {
    return query.then(undefined, onRejected);
  };

  query.finally = function (onFinally: any): any {
    return query.then(
      (v: any) => { onFinally?.(); return v; },
      (e: any) => { onFinally?.(); throw e; }
    );
  };

  return query;
}

// 统一的"检测查询结果类型 → 对应包装"辅助函数
// 保留原始 Query 对象结构（.values/.execute 等），仅覆盖 .then/.catch/.finally 注入 schema 修复
function wrapResult<T>(result: any, retry: () => any): any {
  if (result && typeof (result as any).values === 'function') {
    return wrapQueryWithSchemaFix<T>(result, retry);
  }
  return wrapPromiseWithRetry<T>(result as Promise<T>, retry as () => Promise<T>);
}

const client = new Proxy(rawClient as any, {
  apply(_target, _thisArg, args) {
    const argsCopy = args as any;
    return wrapResult(
      rawClient(...argsCopy),
      () => rawClient(...argsCopy)
    );
  },
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value !== 'function') return value;
    const boundFn = (value as Function).bind(target);

    return function (this: unknown, ...args: unknown[]) {
      const result = boundFn(...args);
      // 非查询方法（end / close / destroy / cancel）直接透传
      if (typeof prop === 'string' && NON_QUERY_METHODS.has(prop)) return result;
      return wrapResult(result, () => boundFn(...args));
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
    log('✅ 连接正常');
    return true;
  } catch (error) {
    warn(`❌ 连接失败: ${error}`);
    return false;
  }
}

export function getConnectionStatus(): {
  connected: boolean;
  status: string;
  maxConnections?: number;
  idleTimeout?: number;
  connectTimeout?: number;
} {
  const options: any =
    (client as any).options ?? (rawClient as any).options ?? {};
  return {
    connected: !(client as any).ended,
    status: (client as any).ended ? 'disconnected' : 'connected',
    maxConnections: options.max,
    idleTimeout: options.idle_timeout,
    connectTimeout: options.connect_timeout
  };
}

export async function closeConnection(): Promise<void> {
  try {
    if (!(client as any).ended) {
      await (client as any).end({ timeout: 10 });
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
