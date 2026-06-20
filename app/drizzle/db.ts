// ==========================================================================
// VoiceHub · PostgreSQL + Drizzle 连接层
//
// 核心设计：lazy schema 自动修复（mkdir -p 风格）
//   任何一次数据库查询，若 PostgreSQL 返回 schema 缺失类错误：
//     42P01  relation does not exist   缺表
//     42703  column does not exist     缺列
//     42704  type does not exist       缺枚举类型
//   当场：
//     1) 从错误消息解析出缺失对象 → 2) 查询元数据确认缺失 → 3) 执行幂等 DDL
//     4) 如 DDL 自身还缺其他对象（如 enum 类型），递归修复后重试
//     5) 把失败的用户查询重试一次
//
// 并发控制：
//   同一修复目标同刻只会跑一次"检查+DDL"，其他请求 await 同一个 Promise。
//   runningFixes Map 的 key = t:<table> / c:<table>:<col> / e:<enum>
//
// 默认值处理：
//   .defaultNow() / .defaultRandom() / sql`...` → SQL 表达式 DEFAULT
//   .default('str') / .default(n) / .default(true) → 字面量 DEFAULT
//   .default(fn)（应用层动态值）→ 不写数据库层 DEFAULT
//
// PostgreSQL 大小写规范：
//   schema.ts 中的 dbName 原样保留大小写；未加引号的标识符会被 PG 小写化。
//   所有 DDL 中表/列/枚举类型名都经过 escIdent() 加双引号。
//   元数据查询使用 LOWER() 做大小写不敏感匹配，兼容历史遗留 DB。
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

// ── SQL 字面量/标识符 转义 ───────────────────────────────────────────────

const escString = (s: string) => s.replace(/'/g, "''");
const escIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

// ── Drizzle 内置类型 → PG 类型名 ─────────────────────────────────────────

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
  if (raw.startsWith('character varying')) return raw.replace('character varying', 'varchar');
  if (raw.startsWith('character')) return raw.replace('character', 'char');
  return raw;
}

// 把 Drizzle 的 col.default 转成 SQL DEFAULT 子句字符串
// 返回 null 表示 "该列没有数据库层 DEFAULT"
function defaultToSql(d: unknown): string | null {
  if (d === undefined || d === null) return null;

  if (typeof d === 'object' && !Array.isArray(d)) {
    const obj = d as Record<string, unknown>;
    // 方案 1：直接从 queryChunks 提取（drizzle-orm 0.x 内部格式）
    // 每个 chunk 可能是 { value: [...strings] } → 展开并 join
    if (Array.isArray(obj.queryChunks)) {
      const parts: string[] = [];
      for (const chunk of obj.queryChunks) {
        if (!chunk || typeof chunk !== 'object') continue;
        const c = chunk as Record<string, unknown>;
        if (Array.isArray(c.value)) {
          // { value: ["now()"] } → "now()"
          parts.push(...c.value.map((v) => String(v)));
        } else if (typeof c.chunk === 'string') {
          parts.push(c.chunk);
        } else if (typeof c.sql === 'string') {
          parts.push(c.sql);
        }
      }
      const s = parts.join(' ').trim();
      if (s.length > 0) return s;
    }
    // 方案 2：调用 getSQL()（部分 SQL 对象支持）
    if (typeof obj.getSQL === 'function') {
      try {
        const result = obj.getSQL();
        // getSQL() 可能返回字符串、SQL 对象或数组
        if (typeof result === 'string' && result.length > 0) return result;
        if (result && typeof result === 'object' && !Array.isArray(result)) {
          // 递归处理返回的 SQL 对象
          const nested = defaultToSql(result);
          if (nested) return nested;
        }
      } catch { /* ignore */ }
    }
    // 方案 3：直接取 .sql 字符串
    if (typeof obj.sql === 'string' && obj.sql.length > 0) return obj.sql;
    // 方案 4：toString（用于字面量 SQL）
    const s = obj.toString?.();
    if (s && s !== '[object Object]') return s;
    return null;
  }

  if (typeof d === 'string') return `'${escString(d)}'`;
  if (typeof d === 'boolean' || typeof d === 'number') return String(d);
  return null;
}

// ── Schema 内省 ───────────────────────────────────────────────────────────
//
// Drizzle v0.x schema 对象的真实结构：
//   表 (PgTable):
//     - Symbol(drizzle:IsDrizzleTable) = true
//     - Symbol(drizzle:Name) = 表 DB 名（如 'User'）
//     - 每个属性（除 enableRLS）都是列对象
//     - 列对象 (PgSerial/PgText/PgTimestamp/PgEnumColumn/...)：
//         .name         DB 列名
//         .getSQLType() 返回 PG 类型名（如 'serial', 'text', 'user_status'）
//         .primary      是否主键
//         .notNull      是否 NOT NULL
//         .default      默认值（字面量或 SQL 对象）
//   枚举 (pgEnum):
//     - typeof === 'function'
//     - .enumName     PG 类型名（如 'BlacklistType'）
//     - .enumValues   值数组（如 ['SONG', 'KEYWORD']）
// ==========================================================================

type ColumnDef = {
  colName: string;
  pgType: string;
  notNull: boolean;
  defaultSql: string | null;
  isSerial: boolean;
  isEnum: boolean;
  isPrimary: boolean;
};

type TableInfo = { tableName: string; columns: ColumnDef[] };
type EnumInfo = { name: string; values: string[] };

// 运行时查找 drizzle Symbol key
function findDrizzleSymbol(obj: any, name: string): symbol | undefined {
  const symbols = Object.getOwnPropertySymbols(obj);
  return symbols.find((s) => s.toString() === `Symbol(drizzle:${name})`);
}

// 构建"表/枚举 → 定义"的稳定映射，缓存结果
let cachedMaps: { tables: Map<string, TableInfo>; enums: Map<string, EnumInfo> } | undefined;

function buildSchemaMaps(): {
  tables: Map<string, TableInfo>;
  enums: Map<string, EnumInfo>;
} {
  if (cachedMaps) return cachedMaps;

  const enums = new Map<string, EnumInfo>();
  const tables = new Map<string, TableInfo>();
  const entries = Object.entries(schema);

  // ── 第 1 轮：收集枚举 ────────────────────────────────────────
  // pgEnum 是 function，带 .enumName 和 .enumValues 属性
  for (const [, val] of entries) {
    if (!val) continue;
    const v = val as { enumName?: unknown; enumValues?: unknown };
    if (typeof v.enumName === 'string' && Array.isArray(v.enumValues)) {
      enums.set(v.enumName, {
        name: v.enumName,
        values: (v.enumValues as unknown[]).map((x) => String(x))
      });
    }
  }

  // ── 第 2 轮：处理表 ──────────────────────────────────────────
  // PgTable 有 Symbol(drizzle:IsDrizzleTable) = true，表名在 Symbol(drizzle:Name)
  let nameSym: symbol | undefined;
  let isTableSym: symbol | undefined;

  for (const [, val] of entries) {
    if (!val || typeof val !== 'object') continue;

    // 惰性查找表标识 Symbol（只在第一个表对象上查一次）
    if (!nameSym || !isTableSym) {
      isTableSym = findDrizzleSymbol(val, 'IsDrizzleTable');
      nameSym = findDrizzleSymbol(val, 'Name');
      if (isTableSym && !(val as any)[isTableSym]) continue;
    }

    if (isTableSym && !(val as any)[isTableSym]) continue;
    const tableName = nameSym ? String((val as any)[nameSym]) : undefined;
    if (!tableName) continue;

    // 枚举对象被 PgTable 误匹配？排除（枚举是 function，这里都是 object，所以安全）

    // 遍历列：每个看起来像列的属性（有 getSQLType() 方法）
    const cols: ColumnDef[] = [];
    for (const [key, col] of Object.entries(val)) {
      if (!col || typeof col !== 'object') continue;
      const c = col as {
        getSQLType?: () => unknown;
        name?: unknown;
        primary?: unknown;
        notNull?: unknown;
        default?: unknown;
      };
      if (typeof c.getSQLType !== 'function') continue;

      const rawType = c.getSQLType();
      const typeStr = typeof rawType === 'string' ? rawType : 'text';
      const pgType = TYPE_MAP[typeStr] || mapSqlType(typeStr);
      const isSerial = typeStr === 'serial';
      const isPrimary = !!c.primary;
      const notNull = !!c.notNull || isPrimary;
      const defaultSql = isSerial ? null : defaultToSql(c.default);
      const colName: string = typeof c.name === 'string' ? c.name : key;
      const isEnum = enums.has(pgType) || !!findEnumCI(pgType, enums);
      cols.push({ colName, pgType, notNull, defaultSql, isSerial, isEnum, isPrimary });
    }

    if (cols.length > 0) tables.set(tableName, { tableName, columns: cols });
  }

  cachedMaps = { tables, enums };
  return cachedMaps;
}

// 大小写不敏感的查找辅助
function findTableCI(name: string, tables: Map<string, TableInfo>): TableInfo | undefined {
  const exact = tables.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [key, info] of tables) {
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

function findEnumCI(name: string, enums: Map<string, EnumInfo>): EnumInfo | undefined {
  const exact = enums.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [key, info] of enums) {
    if (key.toLowerCase() === lower) return info;
  }
  return undefined;
}

// 构建 schema maps 后导出给下游使用
const { tables: schemaTables, enums: schemaEnums } = buildSchemaMaps();

// 列类型在 DDL 中的书写：枚举类型加双引号，内置类型直接写
function colTypeSql(col: ColumnDef): string {
  return col.isEnum ? escIdent(col.pgType) : col.pgType;
}

// ── DDL 生成（全部幂等：CREATE IF NOT EXISTS） ─────────────────────────

function buildCreateTableSql(info: TableInfo): string {
  const colDefs = info.columns.map((col) => {
    const parts = [escIdent(col.colName), colTypeSql(col)];
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

function buildAlterTableSql(tableName: string, col: ColumnDef): string {
  const base = `ADD COLUMN IF NOT EXISTS ${escIdent(col.colName)} ${colTypeSql(col)}`;
  if (col.defaultSql) {
    const parts = [base, `DEFAULT ${col.defaultSql}`];
    if (col.notNull) parts.push('NOT NULL');
    return `ALTER TABLE ${escIdent(tableName)} ${parts.join(' ')}`;
  }
  return `ALTER TABLE ${escIdent(tableName)} ${base}`;
}

function buildCreateTypeSql(info: EnumInfo): string {
  const vals = info.values.map((v) => `'${escString(v)}'`).join(', ');
  return `CREATE TYPE IF NOT EXISTS ${escIdent(info.name)} AS ENUM (${vals})`;
}

// ── 可修复目标：表 / 列 / 枚举 ────────────────────────────────────────

type SchemaTarget =
  | { kind: 'type'; name: string; info: EnumInfo }
  | { kind: 'table'; name: string; info: TableInfo }
  | { kind: 'column'; table: string; col: string; info: TableInfo; colDef: ColumnDef };

function targetKey(t: SchemaTarget): string {
  if (t.kind === 'type') return `e:${t.name}`;
  if (t.kind === 'table') return `t:${t.name}`;
  return `c:${t.table}:${t.col}`;
}

function targetDdl(t: SchemaTarget): string {
  if (t.kind === 'type') return buildCreateTypeSql(t.info);
  if (t.kind === 'table') return buildCreateTableSql(t.info);
  return buildAlterTableSql(t.table, t.colDef);
}

// ── 错误解析：从 PG 错误消息 → SchemaTarget ──────────────────────────

const SCHEMA_ERROR_CODES = new Set(['42P01', '42703', '42704']);

function isSchemaError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return !!code && SCHEMA_ERROR_CODES.has(code);
}

function targetFromError(err: unknown): SchemaTarget | null {
  const e = err as { code?: string; message?: string } | undefined;
  const code = e?.code ?? '';
  const msg = e?.message ?? '';

  if (code === '42P01') {
    const m = msg.match(/relation\s+"([^"]+)"/i);
    if (m) {
      const info = findTableCI(m[1], schemaTables);
      if (info) {
        log(`🔍 schema错误 → 缺表 "${m[1]}"，映射到 "${info.tableName}"`);
        return { kind: 'table', name: info.tableName, info };
      }
      log(`⚠️ 42P01 但 schema 中找不到表 "${m[1]}"`);
    }
  }

  if (code === '42703') {
    const m = msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"([^"]+)"/i);
    if (m) {
      const tbl = findTableCI(m[2], schemaTables);
      if (tbl) {
        const col = findColumnCI(tbl, m[1]);
        if (col) {
          log(`🔍 schema错误 → 缺列 "${m[1]}"（表 "${tbl.tableName}"）`);
          return { kind: 'column', table: tbl.tableName, col: col.colName, info: tbl, colDef: col };
        }
        log(`⚠️ 42703 但表 "${tbl.tableName}" 中找不到列 "${m[1]}"`);
      }
    }
  }

  if (code === '42704') {
    const m = msg.match(/type\s+"([^"]+)"/i);
    if (m) {
      const info = findEnumCI(m[1], schemaEnums);
      if (info) {
        log(`🔍 schema错误 → 缺枚举类型 "${m[1]}"，映射到 "${info.name}"`);
        return { kind: 'type', name: info.name, info };
      }
      log(`⚠️ 42704 但 schema 中找不到枚举类型 "${m[1]}"`);
    }
  }

  return null;
}

// ── 真实数据库检查：对象是否真的缺失（大小写不敏感） ───────────────

async function objectMissing(target: SchemaTarget): Promise<boolean> {
  if (target.kind === 'type') {
    const rows = await rawClient.unsafe(
      `SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE LOWER(t.typname) = LOWER($1) AND n.nspname = current_schema()`,
      [target.name]
    );
    return !rows || (rows as unknown[]).length === 0;
  }
  if (target.kind === 'table') {
    const rows = await rawClient.unsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND LOWER(table_name) = LOWER($1)`,
      [target.name]
    );
    const missing = !rows || (rows as unknown[]).length === 0;
    log(`🔎 表 "${target.name}" 在数据库中 ${missing ? '不存在' : '已存在'}`);
    return missing;
  }
  const rows = await rawClient.unsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND LOWER(table_name) = LOWER($1) AND LOWER(column_name) = LOWER($2)`,
    [target.table, target.col]
  );
  return !rows || (rows as unknown[]).length === 0;
}

// ── 修复引擎：递归/并发安全 ────────────────────────────────────────
//
// 修复逻辑：
//   1) runningFixes 中已有该 key → await（避免并发重复修复）
//   2) 查 information_schema 确认对象缺失
//   3) 生成并执行幂等 DDL；若 DDL 自身报 schema 错误（如依赖 enum），
//      递归修复依赖后重试本目标 DDL
//   4) 递归深度上限：8，防御循环依赖
// ==========================================================================

const runningFixes = new Map<string, Promise<boolean>>();
const MAX_RECURSION = 8;

async function ensureSchemaFixedFor(err: unknown): Promise<boolean> {
  const target = targetFromError(err);
  if (!target) return false;
  return fixTarget(target, 0);
}

async function fixTarget(target: SchemaTarget, depth: number): Promise<boolean> {
  if (depth >= MAX_RECURSION) {
    warn(`⚠️ 递归修复达到上限 (${MAX_RECURSION})，放弃: ${targetKey(target)}`);
    return false;
  }

  const key = targetKey(target);
  const pending = runningFixes.get(key);
  if (pending) return await pending;

  const fixPromise = (async (): Promise<boolean> => {
    try {
      const missing = await objectMissing(target);
      if (!missing) {
        log(`✅ 对象已存在: ${key}`);
        return true;
      }

      const ddl = targetDdl(target);
      log(`📦 执行 DDL (depth=${depth}): ${ddl}`);

      try {
        await rawClient.unsafe(ddl);
      } catch (ddlErr) {
        // DDL 自身遇到 schema 错误（如 CREATE TABLE 需要的 enum 不存在）
        if (!isSchemaError(ddlErr)) throw ddlErr;

        const dep = targetFromError(ddlErr);
        if (!dep) throw ddlErr;

        log(`🔗 DDL 依赖其他 schema 对象，先递归修复: ${targetKey(dep)}`);
        const depFixed = await fixTarget(dep, depth + 1);
        if (!depFixed) throw ddlErr;

        // 依赖已补齐，重试本次 DDL
        await rawClient.unsafe(ddl);
      }

      log(`✅ schema 已修复: ${key}`);
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

// ── Proxy：拦截所有查询 → 遇 schema 错误时修复并重试 ─────────────
//
// 关键设计：drizzle-orm 通过 client.unsafe(sql, params).values() 执行查询，
//   unsafe 返回 postgres.js 的 Query 对象（extends Promise）。
//   我们保留原始 Query 对象，只覆盖 .then 捕获 schema 错误。
//
// 统一 wrap 逻辑：
//   - 若结果有 .values 函数 → Query 对象，覆盖 .then
//   - 否则 → 普通 Promise，用 try/catch 包一层
// ==========================================================================

const NON_QUERY_METHODS = new Set(['end', 'destroy', 'close', 'cancel']);

function wrapWithSchemaFix<T>(result: any, retry: () => any): any {
  if (result && typeof result.values === 'function') {
    // postgres.js Query 对象：保留链式方法，只覆盖 .then
    const origThen = result.then.bind(result);
    result.then = function (onFulfilled: any, onRejected: any): any {
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
    return result;
  }
  // 普通 Promise：用 try/catch 包一层
  return (async () => {
    try { return await result; } catch (err) {
      if (!isSchemaError(err)) throw err;
      const fixed = await ensureSchemaFixedFor(err);
      if (!fixed) throw err;
      log(`🔁 重试查询（schema 已修复）`);
      return await retry();
    }
  })();
}

const client = new Proxy(rawClient as any, {
  apply(_target, _thisArg, args) {
    // 模板标签调用：client`SELECT 1`
    const result = rawClient(...(args as any));
    return wrapWithSchemaFix(result, () => rawClient(...(args as any)));
  },
  get(target, prop, _receiver) {
    const value = Reflect.get(target, prop);
    if (typeof value !== 'function') return value;
    const boundFn = (value as Function).bind(target);

    return function (this: unknown, ...args: unknown[]) {
      const result = boundFn(...args);
      // 非查询方法：直接透传，不包装
      if (typeof prop === 'string' && NON_QUERY_METHODS.has(prop)) return result;
      return wrapWithSchemaFix(result, () => boundFn(...args));
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
  const options: any = (rawClient as any).options ?? {};
  return {
    connected: !(rawClient as any).ended,
    status: (rawClient as any).ended ? 'disconnected' : 'connected',
    maxConnections: options.max,
    idleTimeout: options.idle_timeout,
    connectTimeout: options.connect_timeout
  };
}

export async function closeConnection(): Promise<void> {
  try {
    if (!(rawClient as any).ended) {
      await (rawClient as any).end({ timeout: 10 });
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
