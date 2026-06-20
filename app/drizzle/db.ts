// ==========================================================================
// VoiceHub · PostgreSQL + Drizzle 连接层
//
// 设计：lazy schema 自动修复（mkdir -p 风格）
//   任意查询失败 → 如 PG 返回 42P01 / 42703 / 42704
//   → 从错误消息解析缺失对象 → 查元数据确认缺失 → 执行 DDL
//   → 如 DDL 自身还缺其他依赖（如 enum 类型），递归修复后重试
//   → 失败的用户查询自动重试一次
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

// innerClient：用于 schema 检查和 DDL 执行 —— 不被 Proxy 拦截
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

// ── 工具函数 ──────────────────────────────────────────────────────────────

const escS = (s: string): string => s.replace(/'/g, "''");
const escI = (s: string): string => `"${s.replace(/"/g, '""')}"`;

const BUILTIN_TYPES = new Set([
  'serial', 'integer', 'bigint', 'smallint', 'boolean', 'text', 'uuid',
  'timestamp', 'timestamptz', 'date', 'time', 'json', 'jsonb',
  'numeric', 'decimal', 'real', 'double precision', 'inet', 'bytea',
  'character varying', 'varchar', 'character', 'char'
]);

// defaultToSql: drizzle 列的 default 对象 → SQL 字面量/表达式
function defaultToSql(d: unknown): string | null {
  if (d === undefined || d === null) return null;
  if (typeof d === 'string') return `'${escS(d)}'`;
  if (typeof d === 'number' || typeof d === 'boolean') return String(d);
  if (typeof d === 'object') {
    const obj = d as { queryChunks?: unknown; sql?: unknown; toString?: () => string };
    if (Array.isArray(obj.queryChunks)) {
      const parts: string[] = [];
      for (const chunk of obj.queryChunks) {
        if (!chunk || typeof chunk !== 'object') continue;
        const c = chunk as { value?: unknown; chunk?: unknown };
        if (Array.isArray(c.value)) parts.push(...c.value.map((v) => String(v)));
        else if (typeof c.chunk === 'string') parts.push(c.chunk);
      }
      const s = parts.join(' ').trim();
      if (s.length > 0) return s;
    }
    if (typeof obj.sql === 'string' && obj.sql.length > 0) return obj.sql;
    const s = obj.toString?.();
    if (s && s !== '[object Object]' && s.length > 0) return s;
  }
  return null;
}

// ── Schema 内省：构建表 + 枚举映射（缓存） ──────────────────────

interface ColumnDef { colName: string; pgType: string; notNull: boolean; defaultSql: string | null; isSerial: boolean; isPrimary: boolean; }
interface TableInfo { tableName: string; columns: ColumnDef[]; }
interface EnumInfo { name: string; values: string[]; }

let cachedNameKey: symbol | null = null;
let cachedIsTableKey: symbol | null = null;

function resolveDrizzleKeys(obj: object) {
  if (cachedNameKey !== null) return;
  const symbols = Object.getOwnPropertySymbols(obj);
  for (const sym of symbols) {
    const desc = sym.toString();
    if (desc === 'Symbol(drizzle:Name)') cachedNameKey = sym;
    else if (desc === 'Symbol(drizzle:IsDrizzleTable)') cachedIsTableKey = sym;
  }
}

let cachedMaps: { tables: Map<string, TableInfo>; enums: Map<string, EnumInfo> } | undefined;

function buildSchemaMaps(): { tables: Map<string, TableInfo>; enums: Map<string, EnumInfo> } {
  if (cachedMaps) return cachedMaps;
  const entries = Object.entries(schema);
  const enums = new Map<string, EnumInfo>();
  const tables = new Map<string, TableInfo>();

  // 枚举收集
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

  // 表 + 列 收集
  for (const [, val] of entries) {
    if (!val || typeof val !== 'object') continue;
    if (cachedNameKey === null) resolveDrizzleKeys(val);
    if (cachedIsTableKey !== null && !(val as any)[cachedIsTableKey]) continue;
    if (cachedIsTableKey === null) {
      const hasCol = Object.values(val).some((c) =>
        c && typeof c === 'object' && typeof (c as any).getSQLType === 'function'
      );
      if (!hasCol) continue;
    }
    const tableName: string | undefined = cachedNameKey !== null ? String((val as any)[cachedNameKey]) : undefined;
    if (!tableName) continue;

    const cols: ColumnDef[] = [];
    for (const [key, col] of Object.entries(val)) {
      if (!col || typeof col !== 'object') continue;
      const c = col as { getSQLType?: () => unknown; name?: unknown; primary?: unknown; notNull?: unknown; default?: unknown };
      if (typeof c.getSQLType !== 'function') continue;
      const rawType = c.getSQLType();
      const typeStr = typeof rawType === 'string' ? rawType : 'text';
      const isSerial = typeStr === 'serial';
      const isPrimary = !!c.primary;
      const notNull = !!c.notNull || isPrimary;
      cols.push({
        colName: typeof c.name === 'string' ? c.name : key,
        pgType: typeStr,
        notNull,
        defaultSql: isSerial ? null : defaultToSql(c.default),
        isSerial,
        isPrimary
      });
    }
    if (cols.length > 0) tables.set(tableName, { tableName, columns: cols });
  }

  cachedMaps = { tables, enums };
  log(`✅ schema 映射完成：${tables.size} 张表，${enums.size} 个枚举`);
  return cachedMaps;
}

const { tables: schemaTables, enums: schemaEnums } = buildSchemaMaps();

// 大小写不敏感查找
function findTableCI(name: string): TableInfo | undefined {
  const exact = schemaTables.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [key, info] of schemaTables) if (key.toLowerCase() === lower) return info;
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
  for (const [key, info] of schemaEnums) if (key.toLowerCase() === lower) return info;
  return undefined;
}

// ── DDL 生成 ─────────────────────────────────────────────────────────────
// 注意：objectMissing 已经在执行 DDL 前确认过对象不存在，因此
// 不需要 IF NOT EXISTS。保留 `CREATE TABLE IF NOT EXISTS` 是因为它
// 在 PG 9.6+ 都被支持。对于 CREATE TYPE，不使用 IF NOT EXISTS
// 以兼容老版本 PG 以及部分 PG 兼容数据库。

function colTypeSql(col: ColumnDef): string {
  return BUILTIN_TYPES.has(col.pgType) ? col.pgType : escI(col.pgType);
}

function buildCreateTableSql(info: TableInfo): string {
  const colDefs = info.columns.map((col) => {
    const parts = [escI(col.colName), colTypeSql(col)];
    if (col.defaultSql) parts.push(`DEFAULT ${col.defaultSql}`);
    if (col.notNull && !col.isSerial) parts.push('NOT NULL');
    return parts.join(' ');
  });
  const pkCol = info.columns.find((c) => c.isPrimary) || info.columns.find((c) => c.isSerial);
  if (pkCol) colDefs.push(`PRIMARY KEY (${escI(pkCol.colName)})`);
  return `CREATE TABLE IF NOT EXISTS ${escI(info.tableName)} (${colDefs.join(', ')})`;
}

function buildAlterTableSql(tableName: string, col: ColumnDef): string {
  const base = `ALTER TABLE ${escI(tableName)} ADD COLUMN IF NOT EXISTS ${escI(col.colName)} ${colTypeSql(col)}`;
  if (col.defaultSql) {
    const parts = [base, `DEFAULT ${col.defaultSql}`];
    if (col.notNull) parts.push('NOT NULL');
    return parts.join(' ');
  }
  return base;
}

function buildCreateTypeSql(info: EnumInfo): string {
  // 不用 IF NOT EXISTS 以兼容 PG < 11
  const vals = info.values.map((v) => `'${escS(v)}'`).join(', ');
  return `CREATE TYPE ${escI(info.name)} AS ENUM (${vals})`;
}

// ── 修复目标定义 + 错误解析 ────────────────────────────────────────

type SchemaTarget =
  | { kind: 'type'; name: string; info: EnumInfo }
  | { kind: 'table'; name: string; info: TableInfo }
  | { kind: 'column'; table: string; col: string; info: TableInfo; colDef: ColumnDef };

function targetKey(t: SchemaTarget): string {
  return t.kind === 'type' ? `e:${t.name}` : t.kind === 'table' ? `t:${t.name}` : `c:${t.table}:${t.col}`;
}

function targetDdl(t: SchemaTarget): string {
  if (t.kind === 'type') return buildCreateTypeSql(t.info);
  if (t.kind === 'table') return buildCreateTableSql(t.info);
  return buildAlterTableSql(t.table, t.colDef);
}

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
      const info = findTableCI(m[1]);
      if (info) return { kind: 'table', name: info.tableName, info };
    }
  }
  if (code === '42703') {
    const m = msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"([^"]+)"/i);
    if (m) {
      const tbl = findTableCI(m[2]);
      if (tbl) {
        const col = findColumnCI(tbl, m[1]);
        if (col) return { kind: 'column', table: tbl.tableName, col: col.colName, info: tbl, colDef: col };
      }
    }
  }
  if (code === '42704') {
    const m = msg.match(/type\s+"([^"]+)"/i);
    if (m) {
      const info = findEnumCI(m[1]);
      if (info) return { kind: 'type', name: info.name, info };
    }
  }
  return null;
}

// ── 元数据检查 + schema 修复引擎（并发安全 + 递归依赖） ─────────

async function objectMissing(target: SchemaTarget): Promise<boolean> {
  if (target.kind === 'type') {
    const rows = await innerClient.unsafe(
      `SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE LOWER(t.typname) = LOWER('${escS(target.name)}') AND n.nspname = current_schema()`
    );
    return !rows || (rows as unknown[]).length === 0;
  }
  if (target.kind === 'table') {
    const rows = await innerClient.unsafe(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND LOWER(table_name) = LOWER('${escS(target.name)}')`
    );
    return !rows || (rows as unknown[]).length === 0;
  }
  // column
  const rows = await innerClient.unsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND LOWER(table_name) = LOWER('${escS(target.table)}') AND LOWER(column_name) = LOWER('${escS(target.col)}')`
  );
  return !rows || (rows as unknown[]).length === 0;
}

const runningFixes = new Map<string, Promise<boolean>>();
const MAX_RECURSION = 8;

async function fixTarget(target: SchemaTarget, depth: number): Promise<boolean> {
  if (depth >= MAX_RECURSION) {
    warn(`⚠️ 递归修复达到上限，放弃: ${targetKey(target)}`);
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
        await innerClient.unsafe(ddl);
      } catch (ddlErr) {
        // DDL 自身遇到 schema 错误（如 CREATE TABLE 需要的 enum 不存在）
        if (!isSchemaError(ddlErr)) throw ddlErr;
        const dep = targetFromError(ddlErr);
        if (!dep) throw ddlErr;
        log(`🔗 DDL 依赖其他 schema 对象，先递归修复: ${targetKey(dep)}`);
        const depFixed = await fixTarget(dep, depth + 1);
        if (!depFixed) throw ddlErr;
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

async function ensureSchemaFixedFor(err: unknown): Promise<boolean> {
  const target = targetFromError(err);
  if (!target) return false;
  return fixTarget(target, 0);
}

// ── Proxy：拦截业务查询 + schema 修复 + 自动重试 ─────────

function wrapWithSchemaFix<T>(result: any, retry: () => any): any {
  // postgres.js Query 对象：只覆盖 .then，保留 .values/.execute 等
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
  // client`SELECT 1` 形式
  apply(_target, _thisArg, args) {
    const result = innerClient(...(args as any));
    return wrapWithSchemaFix(result, () => innerClient(...(args as any)));
  },
  // client.unsafe(sql), client.end() 等方法调用
  get(target, prop, _receiver) {
    const value = Reflect.get(target, prop);
    if (typeof value !== 'function') return value;
    const boundFn = (value as Function).bind(target);
    const propStr = String(prop);
    if (propStr === 'end' || propStr === 'destroy' || propStr === 'close' || propStr === 'cancel') {
      return boundFn; // 生命周期方法，直接透传
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
  try { await client`SELECT 1`; log('✅ 连接正常'); return true; }
  catch (error) { warn(`❌ 连接失败: ${error}`); return false; }
}

export function getConnectionStatus(): { connected: boolean; status: string } {
  return { connected: !(innerClient as any).ended, status: (innerClient as any).ended ? 'disconnected' : 'connected' };
}

export async function closeConnection(): Promise<void> {
  try { if (!(innerClient as any).ended) { await (innerClient as any).end({ timeout: 10 }); log('✅ 连接已优雅关闭'); } }
  catch (error) { warn(`❌ 关闭连接失败: ${error}`); }
}

if (typeof process !== 'undefined') {
  process.on('SIGINT', closeConnection);
  process.on('SIGTERM', closeConnection);
  process.on('beforeExit', closeConnection);
}
