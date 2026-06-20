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
// 关键约束：
//   * 所有 DDL 语句都是幂等的（CREATE TABLE IF NOT EXISTS / ADD COLUMN IF
//     NOT EXISTS / CREATE TYPE IF NOT EXISTS AS ENUM）
//   * 所有 DDL 以纯字符串形式通过 innerClient.unsafe(sql) 执行（不走
//     postgres.js 的模板标签/参数化查询，避免参数解析问题）
//   * schema 内省与 DDL 执行使用独立的 innerClient（不被 Proxy 拦截），
//     避免"修复查询本身触发修复"的无限递归
//   * 同一修复目标跨请求互斥：runningFixes Map 保存目标 → Promise，
//     并发请求 await 同一个 Promise
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

// innerClient：原始 postgres 客户端，仅用于 schema 内省和 DDL 执行
// 不被 Proxy 拦截，避免"检查 schema 的查询本身触发 schema 修复"
const innerClient = postgres(connectionString, {
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
  onnotice: DEV ? console.log : undefined
});

// ── SQL 字面量/标识符 转义 ───────────────────────────────────────────────

const escString = (s: string) => s.replace(/'/g, "''");
const escIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

// ── Schema 内省：从 schema.ts 构建"表/枚举 → 定义"映射 ─────────────

// drizzle-orm pg-core 表/列结构：
//   * pgTable 返回 PgTable 实例，表名在 Symbol(drizzle:Name)
//   * pgEnum 返回 function，带 .enumName (string) 和 .enumValues (string[])
//   * 列对象有 .name (string)、.primary (boolean)、.notNull (boolean)、
//     .default (任意类型)、.getSQLType() 返回 PG 类型名

type ColumnDef = {
  colName: string;
  pgType: string;
  notNull: boolean;
  defaultSql: string | null;
  isSerial: boolean;
  isPrimary: boolean;
};

type TableInfo = { tableName: string; columns: ColumnDef[] };
type EnumInfo = { name: string; values: string[] };

// drizzle Symbol key 查找（惰性初始化，缓存）
let cachedNameKey: symbol | null = null;
let cachedIsTableKey: symbol | null = null;

function resolveDrizzleKeys(obj: object) {
  if (cachedNameKey !== null) return;  // 已解析
  const symbols = Object.getOwnPropertySymbols(obj);
  for (const sym of symbols) {
    const desc = sym.toString();
    if (desc === 'Symbol(drizzle:Name)') cachedNameKey = sym;
    else if (desc === 'Symbol(drizzle:IsDrizzleTable)') cachedIsTableKey = sym;
  }
}

// 将 col.default（drizzle-orm 的 SQL 对象/字面量）转为 SQL DEFAULT 子句字符串
// 返回 null 表示"无数据库层 DEFAULT"
function defaultToSql(d: unknown): string | null {
  if (d === undefined || d === null) return null;

  // 字符串字面量 → 'value'
  if (typeof d === 'string') return `'${escString(d)}'`;
  // 数字/布尔字面量 → 直接 SQL
  if (typeof d === 'number' || typeof d === 'boolean') return String(d);

  // 对象：可能是 drizzle 的 SQL 表达式对象（如 defaultNow()、defaultRandom()）
  if (typeof d === 'object') {
    // 1) drizzle-orm 格式：{ queryChunks: [{ value: [string, ...], chunk?: string }, ...] }
    //    queryChunks 是 SQL 表达式的内部解析块，value 数组是字符串片段
    const obj = d as { queryChunks?: unknown; sql?: unknown; toString?: () => string };
    if (Array.isArray(obj.queryChunks)) {
      const parts: string[] = [];
      for (const chunk of obj.queryChunks) {
        if (!chunk || typeof chunk !== 'object') continue;
        const c = chunk as { value?: unknown; chunk?: unknown };
        if (Array.isArray(c.value)) {
          // { value: ["CURRENT_TIMESTAMP"] } → 字符串片段
          parts.push(...c.value.map((v) => String(v)));
        } else if (typeof c.chunk === 'string') {
          // { chunk: "NOW()" } → 直接字符串
          parts.push(c.chunk);
        }
      }
      const s = parts.join(' ').trim();
      if (s.length > 0) return s;
    }
    // 2) sql 属性
    if (typeof obj.sql === 'string' && obj.sql.length > 0) return obj.sql;
    // 3) toString() 兜底
    const s = obj.toString?.();
    if (s && s !== '[object Object]' && s.length > 0) return s;
  }
  return null;
}

// PG 内置类型（非枚举）的类型名映射（仅用于 isEnum 检测）
const BUILTIN_TYPES = new Set([
  'serial', 'integer', 'bigint', 'smallint', 'boolean', 'text', 'uuid',
  'timestamp', 'timestamptz', 'date', 'time', 'json', 'jsonb',
  'numeric', 'decimal', 'real', 'double precision', 'inet', 'bytea',
  'character varying', 'varchar', 'character', 'char'
]);

// 构建稳定的 schema 映射（缓存结果）
let cachedMaps: { tables: Map<string, TableInfo>; enums: Map<string, EnumInfo> } | undefined;

function buildSchemaMaps(): { tables: Map<string, TableInfo>; enums: Map<string, EnumInfo> } {
  if (cachedMaps) return cachedMaps;

  const entries = Object.entries(schema);
  const enums = new Map<string, EnumInfo>();
  const tables = new Map<string, TableInfo>();

  // ── 第 1 轮：收集枚举 ────────────────────────────────────────
  // pgEnum 返回 function，带 .enumName 和 .enumValues
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

  // ── 第 2 轮：处理表 ────────────────────────────────────────────
  for (const [, val] of entries) {
    if (!val || typeof val !== 'object') continue;

    // 惰性解析 drizzle 的 Symbol key（只在第一个表对象上解析一次）
    if (cachedNameKey === null) resolveDrizzleKeys(val);

    // 必须有 IsDrizzleTable === true 才能当作表处理
    if (cachedIsTableKey !== null && !(val as any)[cachedIsTableKey]) continue;
    // 兼容老版本：如果没有 IsDrizzleTable symbol，但有 Name symbol 且属性中有列对象
    if (cachedIsTableKey === null) {
      // 检查是否有一个有效的列属性（有 getSQLType 的对象）
      const hasCol = Object.values(val).some((c) =>
        c && typeof c === 'object' && typeof (c as any).getSQLType === 'function'
      );
      if (!hasCol) continue;
    }

    const tableName: string | undefined =
      cachedNameKey !== null ? String((val as any)[cachedNameKey]) : undefined;
    if (!tableName) continue;

    // ── 解析列 ────────────────────────────────────────────
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
      const pgType = typeStr;  // 保留原始类型名（如 "user_status"）
      const isSerial = typeStr === 'serial';
      const isPrimary = !!c.primary;
      const notNull = !!c.notNull || isPrimary;
      const defaultSql = isSerial ? null : defaultToSql(c.default);
      const colName: string = typeof c.name === 'string' ? c.name : key;

      cols.push({ colName, pgType, notNull, defaultSql, isSerial, isPrimary });
    }

    if (cols.length > 0) tables.set(tableName, { tableName, columns: cols });
  }

  cachedMaps = { tables, enums };
  log(`✅ schema 映射完成：${tables.size} 张表，${enums.size} 个枚举`);
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

const { tables: schemaTables, enums: schemaEnums } = buildSchemaMaps();

// ── DDL 生成（全部幂等）────────────────────────────────────────────

// 列类型在 DDL 中的书写：
//   - 枚举类型：用双引号括起来的类型名（"user_status"）
//   - 内置类型：直接写（text, integer, timestamptz 等）
function colTypeSql(col: ColumnDef): string {
  return BUILTIN_TYPES.has(col.pgType) ? col.pgType : escIdent(col.pgType);
}

function buildCreateTableSql(info: TableInfo): string {
  const colDefs = info.columns.map((col) => {
    const parts = [escIdent(col.colName), colTypeSql(col)];
    if (col.defaultSql) parts.push(`DEFAULT ${col.defaultSql}`);
    if (col.notNull && !col.isSerial) parts.push('NOT NULL');
    return parts.join(' ');
  });

  let pkCol = info.columns.find((c) => c.isPrimary);
  if (!pkCol) pkCol = info.columns.find((c) => c.isSerial);
  if (pkCol) colDefs.push(`PRIMARY KEY (${escIdent(pkCol.colName)})`);

  return `CREATE TABLE IF NOT EXISTS ${escIdent(info.tableName)} (${colDefs.join(', ')})`;
}

function buildAlterTableSql(tableName: string, col: ColumnDef): string {
  const base = `ALTER TABLE ${escIdent(tableName)} ADD COLUMN IF NOT EXISTS ${escIdent(col.colName)} ${colTypeSql(col)}`;
  if (col.defaultSql) {
    const parts = [base, `DEFAULT ${col.defaultSql}`];
    if (col.notNull) parts.push('NOT NULL');
    return parts.join(' ');
  }
  return base;
}

function buildCreateTypeSql(info: EnumInfo): string {
  const vals = info.values.map((v) => `'${escString(v)}'`).join(', ');
  return `CREATE TYPE IF NOT EXISTS ${escIdent(info.name)} AS ENUM (${vals})`;
}

// ── 可修复目标：表/列/枚举 ──────────────────────────────────────────

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

// ── PostgreSQL 错误解析 ──────────────────────────────────────────────

// 三个核心 schema 缺失错误码：relation/column/type does not exist
const SCHEMA_ERROR_CODES = new Set(['42P01', '42703', '42704']);

function isSchemaError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return !!code && SCHEMA_ERROR_CODES.has(code);
}

// 从 PG 错误消息解析出缺失的 schema 对象；找不到则返回 null
function targetFromError(err: unknown): SchemaTarget | null {
  const e = err as { code?: string; message?: string } | undefined;
  const code = e?.code ?? '';
  const msg = e?.message ?? '';

  if (code === '42P01') {
    const m = msg.match(/relation\s+"([^"]+)"/i);
    if (m) {
      const info = findTableCI(m[1], schemaTables);
      if (info) {
        log(`🔍 schema错误 → 缺表 "${m[1]}" → 映射到 "${info.tableName}"`);
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
        log(`🔍 schema错误 → 缺枚举类型 "${m[1]}" → 映射到 "${info.name}"`);
        return { kind: 'type', name: info.name, info };
      }
      log(`⚠️ 42704 但 schema 中找不到枚举类型 "${m[1]}"`);
    }
  }

  return null;
}

// ── 真实 DB 检查：对象是否缺失（大小写不敏感）─────────────────────
// 使用 innerClient（不经过 Proxy 拦截），避免"检查查询本身触发修复"

async function objectMissing(target: SchemaTarget): Promise<boolean> {
  if (target.kind === 'type') {
    // 注意：name 来自 schema.ts（由我们控制），安全地拼入 SQL
    const rows = await innerClient.unsafe(
      `SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE LOWER(t.typname) = LOWER('${escString(target.name)}') AND n.nspname = current_schema()`
    );
    const missing = !rows || (rows as unknown[]).length === 0;
    log(`🔎 枚举 "${target.name}" ${missing ? '不存在，需创建' : '已存在'}`);
    return missing;
  }

  if (target.kind === 'table') {
    const rows = await innerClient.unsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND LOWER(table_name) = LOWER('${escString(target.name)}')`
    );
    const missing = !rows || (rows as unknown[]).length === 0;
    log(`🔎 表 "${target.name}" ${missing ? '不存在，需创建' : '已存在'}`);
    return missing;
  }

  // column
  const rows = await innerClient.unsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND LOWER(table_name) = LOWER('${escString(target.table)}') AND LOWER(column_name) = LOWER('${escString(target.col)}')`
  );
  const missing = !rows || (rows as unknown[]).length === 0;
  log(`🔎 列 "${target.table}.${target.col}" ${missing ? '不存在，需创建' : '已存在'}`);
  return missing;
}

// ── schema 修复引擎（并发安全 + 递归依赖） ──────────────────────
//
// 同一修复目标跨请求互斥：runningFixes Map 保存 key → Promise<boolean>
//   * 第一个请求负责"检查+DDL"，返回的 Promise 被其他并发请求 await
//   * 无论成功/失败，最终都从 Map 中清理
//
// 递归依赖：
//   CREATE TABLE 可能引用尚未创建的 enum 类型 → DDL 失败（42704）
//   → 解析依赖 → 递归修复 enum → 重试本目标 DDL
//   递归深度上限 8（防御性保护，避免循环依赖）
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
  if (pending) return await pending;  // 并发请求 await 同一 Promise

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
        await innerClient.unsafe(ddl);  // 用 innerClient，不走 Proxy
      } catch (ddlErr) {
        // DDL 自身遇到 schema 错误（如 CREATE TABLE 需要的 enum 不存在）
        if (!isSchemaError(ddlErr)) throw ddlErr;

        const dep = targetFromError(ddlErr);
        if (!dep) throw ddlErr;

        log(`🔗 DDL 依赖其他 schema 对象，先递归修复: ${targetKey(dep)}`);
        const depFixed = await fixTarget(dep, depth + 1);
        if (!depFixed) throw ddlErr;

        // 依赖已补齐，重试本次 DDL
        await innerClient.unsafe(ddl);
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

// ── Proxy：拦截所有用户查询 → 遇 schema 错误时修复并重试 ─────────
//
// drizzle-orm 通过 client.unsafe(...) 执行查询：
//   * 普通用户查询：我们的 Proxy 拦截 → 执行 → 若返回 schema 错误 →
//     fixTarget → 重试
//   * innerClient 的 DDL/检查查询：不经过 Proxy，不会触发二次修复
//
// postgres.js 的 Query 对象是 Promise 的子类，支持 .values()、.execute()
// 等链式方法。我们只覆盖 .then（捕获 Promise 层面的错误），保留
// Query 对象的其他方法链行为。
// ==========================================================================

function wrapWithSchemaFix<T>(result: any, retry: () => any): any {
  // postgres.js Query 对象：覆盖 .then 捕获 schema 错误
  if (result && typeof result.values === 'function') {
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

  // 普通 Promise/thenable：用 then 链捕获 schema 错误
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

const client = new Proxy(innerClient as any, {
  // 模板标签调用：client`SELECT 1` → args = [stringsArray, ...interpolations]
  apply(_target, _thisArg, args) {
    const result = innerClient(...(args as any));
    return wrapWithSchemaFix(result, () => innerClient(...(args as any)));
  },
  // 方法调用：client.unsafe(sql) 或 client.end() / client.destroy()
  get(target, prop, _receiver) {
    const value = Reflect.get(target, prop);
    if (typeof value !== 'function') return value;
    const boundFn = (value as Function).bind(target);

    // 生命周期方法：直接透传（不参与 schema 修复）
    const propStr = String(prop);
    if (propStr === 'end' || propStr === 'destroy' || propStr === 'close' || propStr === 'cancel') {
      return boundFn;
    }

    return function (this: unknown, ...args: unknown[]): any {
      const result = boundFn(...args);
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
  return {
    connected: !(innerClient as any).ended,
    status: (innerClient as any).ended ? 'disconnected' : 'connected',
  };
}

export async function closeConnection(): Promise<void> {
  try {
    if (!(innerClient as any).ended) {
      await (innerClient as any).end({ timeout: 10 });
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
