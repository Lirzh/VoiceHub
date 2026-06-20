// ==========================================================================
// VoiceHub · PostgreSQL + Drizzle 连接层
//
// Lazy schema 自动修复：任何查询失败 → 如 PG 返回 42P01/42703/42704
// → 解析缺失对象 → 查元数据确认 → 执行 DDL → 重试查询
// ==========================================================================

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  and, asc, count, desc, eq, exists, gt, gte,
  lt, lte, ne, or, sql,
} from 'drizzle-orm';
import * as schema from './schema.ts';
import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.resolve(process.cwd(), '.env') });
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const DEV = process.env.NODE_ENV === 'development';
const log = (...args: unknown[]) => { if (DEV) console.log('[db]', ...args); };
const warn = (...args: unknown[]) => { console.warn('[db]', ...args); };

// ── 内部 client（不被 Proxy 拦截，用于 schema 检查和 DDL）────
const innerClient = postgres(process.env.DATABASE_URL, {
  max: process.env.NODE_ENV === 'production' ? 10 : 5,
  idle_timeout: 20,
  connect_timeout: 30,
  prepare: false,
  transform: { undefined: null },
  connection: { application_name: 'voicehub-app' },
  onnotice: DEV ? console.log : undefined,
});

// ── SQL 转义辅助 ────────────────────────────────────────────────────────────
const escS = (s: string): string => s.replace(/'/g, "''");
const escI = (s: string): string => `"${s.replace(/"/g, '""')}"`;

// ── PG 内置类型判断（避免把枚举类型加引号导致报错）───────────────
const BUILTIN_PREFIXES: string[] = [
  'serial', 'integer', 'bigint', 'smallint', 'boolean', 'text', 'uuid',
  'timestamp', 'timestamptz', 'date', 'time', 'json', 'jsonb',
  'numeric', 'decimal', 'real', 'double precision', 'inet', 'bytea',
  'character varying', 'varchar', 'character', 'char',
];

function isBuiltinType(typeStr: string): boolean {
  if (BUILTIN_PREFIXES.includes(typeStr)) return true;
  const lower = typeStr.toLowerCase();
  for (const prefix of BUILTIN_PREFIXES) {
    if (lower.startsWith(prefix)) {
      const rest = lower.slice(prefix.length);
      if (rest.length === 0 || rest.startsWith(' ') || rest.startsWith('(')) return true;
    }
  }
  return false;
}

// ── default → SQL 字面量/表达式 ───────────────────────────────────────────
function defaultToSql(d: unknown): string | null {
  if (d === undefined || d === null) return null;
  if (typeof d === 'boolean') return d ? 'true' : 'false';
  if (typeof d === 'number') return String(d);
  if (typeof d === 'string') return `'${escS(d)}'`;
  if (typeof d === 'object') {
    // drizzle SQL 表达式对象（如 defaultNow()、defaultRandom()）
    const obj = d as { queryChunks?: unknown; sql?: unknown };
    if (Array.isArray(obj.queryChunks)) {
      const parts: string[] = [];
      for (const chunk of obj.queryChunks) {
        if (!chunk || typeof chunk !== 'object') continue;
        const c = chunk as { value?: unknown; chunk?: unknown };
        if (Array.isArray(c.value)) parts.push(...c.value.map((v) => String(v)));
        else if (typeof c.chunk === 'string') parts.push(c.chunk);
      }
      const joined = parts.join(' ').trim();
      if (joined.length > 0) return joined;
    }
    if (typeof obj.sql === 'string' && obj.sql.length > 0) return obj.sql;
  }
  return null;
}

// ── Schema 内省：构建 表 + 枚举 映射 ─────────────────────────────────
interface ColDef { name: string; sqlType: string; notNull: boolean; isPrimary: boolean; defaultSql: string | null; isSerial: boolean; }
interface TableDef { name: string; columns: ColDef[]; }
interface EnumDef { name: string; values: string[]; }

const { tables: schemaTables, enums: schemaEnums } = buildSchemaMaps();

function buildSchemaMaps(): { tables: Map<string, TableDef>; enums: Map<string, EnumDef> } {
  const tables = new Map<string, TableDef>();
  const enums = new Map<string, EnumDef>();

  // 1. 枚举收集（pgEnum 返回的 function 同时挂有 .enumName/.enumValues）
  for (const val of Object.values(schema)) {
    if (val && typeof val === 'function') {
      const f = val as { enumName?: unknown; enumValues?: unknown };
      if (typeof f.enumName === 'string' && Array.isArray(f.enumValues)) {
        enums.set(f.enumName, { name: f.enumName, values: (f.enumValues as unknown[]).map((x) => String(x)) });
      }
    }
  }

  // 2. 表 + 列收集（pgTable 返回的对象挂有 Symbol(drizzle:Name)）
  const tableSymbol = findDrizzleSymbol('drizzle:Name');

  for (const val of Object.values(schema)) {
    if (!val || typeof val !== 'object') continue;

    const tableName = tableSymbol ? String((val as any)[tableSymbol]) : undefined;
    if (!tableName) continue;

    const columns: ColDef[] = [];
    for (const col of Object.values(val as object)) {
      if (!col || typeof col !== 'object') continue;
      const c = col as { name?: unknown; primary?: unknown; notNull?: unknown; default?: unknown; getSQLType?: () => unknown };
      if (typeof c.getSQLType !== 'function') continue;

      const rawType = c.getSQLType();
      const sqlType = typeof rawType === 'string' ? rawType : 'text';
      const isSerial = sqlType === 'serial';
      const isPrimary = !!c.primary;

      columns.push({
        name: typeof c.name === 'string' ? c.name : String(c),
        sqlType,
        notNull: !!c.notNull || isPrimary,
        isPrimary,
        defaultSql: isPrimary && isSerial ? null : defaultToSql(c.default),
        isSerial,
      });
    }

    if (columns.length > 0) tables.set(tableName, { name: tableName, columns });
  }

  log(`✅ schema 映射完成：${tables.size} 张表，${enums.size} 个枚举`);
  return { tables, enums };
}

function findDrizzleSymbol(description: string): symbol | null {
  for (const val of Object.values(schema)) {
    if (!val || typeof val !== 'object') continue;
    for (const sym of Object.getOwnPropertySymbols(val)) {
      if (sym.toString().includes(description)) return sym;
    }
  }
  return null;
}

// ── 大小写不敏感查找 ───────────────────────────────────────────────────────
function findTableCI(name: string): TableDef | undefined {
  const exact = schemaTables.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [key, info] of schemaTables) if (key.toLowerCase() === lower) return info;
  return undefined;
}

function findEnumCI(name: string): EnumDef | undefined {
  const exact = schemaEnums.get(name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [key, info] of schemaEnums) if (key.toLowerCase() === lower) return info;
  return undefined;
}

function findColumnCI(tbl: TableDef, colName: string): ColDef | undefined {
  const exact = tbl.columns.find((c) => c.name === colName);
  if (exact) return exact;
  const lower = colName.toLowerCase();
  return tbl.columns.find((c) => c.name.toLowerCase() === lower);
}

// ── DDL 生成 ───────────────────────────────────────────────────────────────
function colTypeForDdl(col: ColDef): string {
  return isBuiltinType(col.sqlType) ? col.sqlType : escI(col.sqlType);
}

function buildCreateTableSql(tbl: TableDef): string {
  const colParts = tbl.columns.map((col) => {
    const parts = [escI(col.name), colTypeForDdl(col)];
    if (col.defaultSql) parts.push(`DEFAULT ${col.defaultSql}`);
    if (col.notNull && !col.isSerial) parts.push('NOT NULL');
    return parts.join(' ');
  });
  const pkCol = tbl.columns.find((c) => c.isPrimary);
  if (pkCol) colParts.push(`PRIMARY KEY (${escI(pkCol.name)})`);
  return `CREATE TABLE IF NOT EXISTS ${escI(tbl.name)} (${colParts.join(', ')})`;
}

function buildAlterTableSql(tbl: TableDef, col: ColDef): string {
  const parts = [
    `ALTER TABLE ${escI(tbl.name)} ADD COLUMN IF NOT EXISTS ${escI(col.name)} ${colTypeForDdl(col)}`,
  ];
  if (col.defaultSql) {
    parts.push(`DEFAULT ${col.defaultSql}`);
    if (col.notNull) parts.push('NOT NULL');
  }
  return parts.join(' ');
}

function buildCreateTypeSql(en: EnumDef): string {
  // objectMissing 已确认类型不存在，不需要 IF NOT EXISTS
  const vals = en.values.map((v) => `'${escS(v)}'`).join(', ');
  return `CREATE TYPE ${escI(en.name)} AS ENUM (${vals})`;
}

// ── 对象存在性检查（参数化查询，避免 SQL 注入）──────────────
async function objectMissingTable(name: string): Promise<boolean> {
  const rows = await innerClient.unsafe(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND LOWER(table_name) = LOWER($1)',
    [name],
  ) as unknown[];
  return rows.length === 0;
}

async function objectMissingColumn(table: string, col: string): Promise<boolean> {
  const rows = await innerClient.unsafe(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND LOWER(table_name) = LOWER($1) AND LOWER(column_name) = LOWER($2)',
    [table, col],
  ) as unknown[];
  return rows.length === 0;
}

async function objectMissingType(name: string): Promise<boolean> {
  const rows = await innerClient.unsafe(
    'SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE LOWER(t.typname) = LOWER($1) AND n.nspname = current_schema()',
    [name],
  ) as unknown[];
  return rows.length === 0;
}

// ── Schema 修复引擎 ──────────────────────────────────────────────────────
// runningFixes: 同一目标（表/列/枚举）并发请求只执行一次 DDL
const runningFixes = new Map<string, Promise<boolean>>();
const MAX_RECURSION = 8;

type FixTarget =
  | { kind: 'table'; name: string; ddl: string }
  | { kind: 'column'; table: string; col: string; ddl: string }
  | { kind: 'type'; name: string; ddl: string };

function targetKey(t: FixTarget): string {
  return t.kind === 'type' ? `e:${t.name}` : t.kind === 'table' ? `t:${t.name}` : `c:${t.table}:${t.col}`;
}

async function objectMissing(t: FixTarget): Promise<boolean> {
  if (t.kind === 'table') return objectMissingTable(t.name);
  if (t.kind === 'column') return objectMissingColumn(t.table, t.col);
  return objectMissingType(t.name);
}

async function fixTarget(target: FixTarget, depth: number): Promise<boolean> {
  if (depth >= MAX_RECURSION) {
    warn(`⚠️ 递归修复达到上限（${MAX_RECURSION}），放弃: ${targetKey(target)}`);
    return false;
  }

  // 并发去重：如果已有同目标的修复 Promise，直接复用
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

      log(`📦 执行 DDL (depth=${depth}): ${target.ddl}`);

      try {
        await innerClient.unsafe(target.ddl);
      } catch (ddlErr) {
        // DDL 自身缺 schema 对象？递归修复依赖后重试
        if (!isSchemaError(ddlErr)) throw ddlErr;
        const dep = targetFromError(ddlErr);
        if (!dep) throw ddlErr;
        log(`🔗 DDL 依赖其他 schema 对象，先递归修复: ${targetKey(dep)}`);
        const depFixed = await fixTarget(dep, depth + 1);
        if (!depFixed) throw ddlErr;
        await innerClient.unsafe(target.ddl);
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

// ── 错误解析：从 PG 错误消息判断缺哪个 schema 对象 ─────────
const SCHEMA_ERROR_CODES = new Set(['42P01', '42703', '42704']);
function isSchemaError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return !!code && SCHEMA_ERROR_CODES.has(code);
}

function targetFromError(err: unknown): FixTarget | null {
  const e = err as { code?: string; message?: string };
  const code = e.code ?? '';
  const msg = e.message ?? '';

  if (code === '42P01') {
    const m = msg.match(/relation\s+"([^"]+)"/i);
    if (m) {
      const info = findTableCI(m[1]);
      if (info) return { kind: 'table', name: info.name, ddl: buildCreateTableSql(info) };
    }
  }
  if (code === '42703') {
    const m = msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"([^"]+)"/i);
    if (m) {
      const tbl = findTableCI(m[2]);
      if (tbl) {
        const col = findColumnCI(tbl, m[1]);
        if (col) return { kind: 'column', table: tbl.name, col: col.name, ddl: buildAlterTableSql(tbl, col) };
      }
    }
  }
  if (code === '42704') {
    const m = msg.match(/type\s+"([^"]+)"/i);
    if (m) {
      const info = findEnumCI(m[1]);
      if (info) return { kind: 'type', name: info.name, ddl: buildCreateTypeSql(info) };
    }
  }
  return null;
}

async function ensureSchemaFixedFor(err: unknown): Promise<boolean> {
  const target = targetFromError(err);
  if (!target) return false;
  return fixTarget(target, 0);
}

// ── Proxy 包装：拦截业务查询 + schema 错误自动修复 ────────────
// wrapPromise: 对任意 Promise 捕获 schema 错误 → 修复 → 重新 execute
function wrapPromise<T>(promise: Promise<T>, execute: () => Promise<T>): Promise<T> {
  return promise.catch(async (err) => {
    if (!isSchemaError(err)) throw err;
    const fixed = await ensureSchemaFixedFor(err);
    if (!fixed) throw err;
    log(`🔁 重试查询（schema 已修复）`);
    return await execute();
  });
}

// wrapQuery: 对 postgres.js 的 Query 对象覆盖 .then / .values / .execute
function wrapWithSchemaFix<T>(result: any, execute: () => Promise<T>): any {
  if (result && typeof result.values === 'function') {
    const origThen = result.then.bind(result);
    const origValues = result.values?.bind(result);
    const origExecute = result.execute?.bind(result);

    result.then = function (onFulfilled: any, onRejected: any): any {
      return origThen(
        onFulfilled,
        async (err: unknown) => {
          if (!isSchemaError(err)) throw err;
          const fixed = await ensureSchemaFixedFor(err);
          if (!fixed) throw err;
          log(`🔁 重试查询（schema 已修复）`);
          return await execute();
        },
      );
    };

    if (origValues) {
      result.values = function (): any {
        return wrapPromise(origValues(), () => execute() as any);
      };
    }

    if (origExecute) {
      result.execute = function (): any {
        return wrapPromise(origExecute(), () => execute() as any);
      };
    }

    return result;
  }

  // 普通 Promise / thenable
  return wrapPromise(result as any, execute);
}

// ── 对外 client：Proxy 包装 innerClient ───────────────────────
const client = new Proxy(innerClient as any, {
  // client`SELECT 1` 形式（Tagged Template）
  apply(_t, _this, args) {
    const result = innerClient(...(args as any));
    return wrapWithSchemaFix(result, () => innerClient(...(args as any)));
  },
  // client.unsafe(sql), client.end() 等方法调用
  get(target, prop, _receiver) {
    const value = Reflect.get(target, prop);
    if (typeof value !== 'function') return value;
    const boundFn = (value as Function).bind(target);
    // 生命周期方法直接透传（不参与 schema 修复）
    const s = String(prop);
    if (s === 'end' || s === 'destroy' || s === 'close' || s === 'cancel') return boundFn;
    return function (this: unknown, ...args: unknown[]): any {
      const result = boundFn(...args);
      return wrapWithSchemaFix(result, () => boundFn(...args) as any);
    };
  },
}) as ReturnType<typeof postgres>;

// ── 对外导出 ───────────────────────────────────────────────────────────────
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
