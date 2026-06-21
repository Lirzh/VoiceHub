// ============================================================================
// VoiceHub · PostgreSQL + Drizzle 连接层
//
// 设计：lazy schema 自动修复（mkdir -p 风格）
//   任意查询失败 → 如 PG 返回 42P01 / 42703 / 42704
//   → 从错误消息解析缺失对象 → 查元数据确认缺失 → 执行 DDL
//   → 如 DDL 自身还缺其他依赖（如 enum 类型），递归修复后重试
//   → 失败的用户查询自动重试
//
// 默认值策略：DDL 中不带 DEFAULT。默认值由 drizzle 应用层在 INSERT
// 时提供（schema.ts 中的 .default/.defaultNow() 会被 drizzle 编译
// 为 INSERT 值或函数调用）。这样 DDL 生成无需解析 default 对象，
// 零复杂度，零隐患。
// ============================================================================

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

// ── innerClient：schema 检查 & DDL 专用（不被 Proxy 拦截） ──
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

// ── PG 内置类型识别 ─────────────────────────────────────────────────────────
// 带修饰的类型（如 timestamp with time zone / varchar(100)）也应识别为内置
const BUILTIN_PREFIXES: string[] = [
  'serial', 'integer', 'bigint', 'smallint', 'boolean', 'text', 'uuid',
  'timestamp', 'timestamptz', 'date', 'time', 'json', 'jsonb',
  'numeric', 'decimal', 'real', 'double precision', 'inet', 'bytea',
  'character varying', 'varchar', 'character', 'char',
];

function isBuiltin(type: string): boolean {
  if (BUILTIN_PREFIXES.includes(type)) return true;
  const lower = type.toLowerCase();
  for (const prefix of BUILTIN_PREFIXES) {
    if (lower.startsWith(prefix)) {
      const rest = lower.slice(prefix.length);
      if (rest.length === 0 || rest.startsWith(' ') || rest.startsWith('(')) return true;
    }
  }
  return false;
}

// ── schema 内省：构建 表 + 枚举 映射 ────────────────────────────────────────
interface ColDef { name: string; sqlType: string; isSerial: boolean; isPrimary: boolean; notNull: boolean; }
interface TableDef { name: string; columns: ColDef[]; }
interface EnumDef { name: string; values: string[]; }

const { tables: schemaTables, enums: schemaEnums } = buildSchemaMaps();

function buildSchemaMaps(): { tables: Map<string, TableDef>; enums: Map<string, EnumDef> } {
  const tables = new Map<string, TableDef>();
  const enums = new Map<string, EnumDef>();

  // 1. 枚举识别（pgEnum 返回的 function，挂 .enumName / .enumValues）
  for (const val of Object.values(schema)) {
    if (val && typeof val === 'function') {
      const f = val as { enumName?: unknown; enumValues?: unknown };
      if (typeof f.enumName === 'string' && Array.isArray(f.enumValues)) {
        enums.set(f.enumName, { name: f.enumName, values: (f.enumValues as unknown[]).map((x) => String(x)) });
      }
    }
  }

  // 2. 表识别（Symbol(drizzle:Name) 存真实表名）
  let nameSym: symbol | undefined;
  for (const val of Object.values(schema)) {
    if (!val || typeof val !== 'object') continue;
    if (!nameSym) {
      for (const sym of Object.getOwnPropertySymbols(val)) {
        if (sym.toString().includes('drizzle:Name')) { nameSym = sym; break; }
      }
    }
    const tableName: string | undefined = nameSym ? String((val as any)[nameSym]) : undefined;
    if (!tableName) continue;

    // 列收集
    const columns: ColDef[] = [];
    for (const col of Object.values(val as object)) {
      if (!col || typeof col !== 'object') continue;
      const c = col as { name?: unknown; primary?: unknown; notNull?: unknown; getSQLType?: () => unknown };
      if (typeof c.getSQLType !== 'function') continue;
      const sqlType = (c.getSQLType() as string) || 'text';
      const isSerial = sqlType === 'serial';
      const isPrimary = !!c.primary;
      columns.push({
        name: typeof c.name === 'string' ? c.name : '?',
        sqlType,
        isSerial,
        isPrimary,
        notNull: !!c.notNull || isPrimary,
      });
    }
    if (columns.length > 0) tables.set(tableName, { name: tableName, columns });
  }

  log(`✅ schema 映射完成：${tables.size} 张表，${enums.size} 个枚举`);
  return { tables, enums };
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

// ── DDL 生成 ───────────────────────────────────────────────────────────────
// 策略：不带 DEFAULT（让 drizzle 应用层在 INSERT 提供值）。
// serial / uuid 列不需要显式 DEFAULT —— serial 自带序列，uuid 列如果有
// defaultRandom()，会被 drizzle 在 INSERT 时自动生成 gen_random_uuid()。

function buildCreateTableSql(tbl: TableDef): string {
  const colParts = tbl.columns.map((col) => {
    const type = isBuiltin(col.sqlType) ? col.sqlType : escI(col.sqlType);
    const parts = [escI(col.name), type];
    if (col.notNull && !col.isSerial) parts.push('NOT NULL');
    return parts.join(' ');
  });
  const pk = tbl.columns.find((c) => c.isPrimary);
  if (pk) colParts.push(`PRIMARY KEY (${escI(pk.name)})`);
  return `CREATE TABLE IF NOT EXISTS ${escI(tbl.name)} (${colParts.join(', ')})`;
}

function buildAlterTableSql(tbl: TableDef, col: ColDef): string {
  const type = isBuiltin(col.sqlType) ? col.sqlType : escI(col.sqlType);
  const parts = [
    `ALTER TABLE ${escI(tbl.name)} ADD COLUMN IF NOT EXISTS ${escI(col.name)} ${type}`,
  ];
  if (col.notNull) parts.push('NOT NULL');
  return parts.join(' ');
}

function buildCreateTypeSql(en: EnumDef): string {
  // objectMissingType 已确认不存在，无需 IF NOT EXISTS（PG < 11 不支持）
  const vals = en.values.map((v) => `'${escS(v)}'`).join(', ');
  return `CREATE TYPE ${escI(en.name)} AS ENUM (${vals})`;
}

// ── 对象存在性检查（参数化查询 = 安全 + 清晰） ────────────────────────
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

// ── schema 修复引擎 ────────────────────────────────────────────────────────
// FixTarget 同时携带预生成的 DDL，避免在错误处理路径上再次计算
type FixTarget =
  | { kind: 'table'; name: string; ddl: string }
  | { kind: 'column'; table: string; col: string; ddl: string }
  | { kind: 'type'; name: string; ddl: string };

function targetKey(t: FixTarget): string {
  return t.kind === 'type' ? `e:${t.name}` : t.kind === 'table' ? `t:${t.name}` : `c:${t.table}:${t.col}`;
}

// 并发去重 + 递归深度保护
const runningFixes = new Map<string, Promise<boolean>>();
const MAX_RECURSION = 8;

async function fixTarget(target: FixTarget, depth: number): Promise<boolean> {
  if (depth >= MAX_RECURSION) {
    warn(`⚠️ 递归修复达到上限（${MAX_RECURSION}），放弃: ${targetKey(target)}`);
    return false;
  }

  const key = targetKey(target);
  const pending = runningFixes.get(key);
  if (pending) return await pending;

  const fixPromise = (async (): Promise<boolean> => {
    try {
      const missing = target.kind === 'table' ? await objectMissingTable(target.name)
        : target.kind === 'type' ? await objectMissingType(target.name)
        : await objectMissingColumn(target.table, target.col);

      if (!missing) {
        log(`✅ 对象已存在: ${key}`);
        return true;
      }

      log(`📦 执行 DDL (depth=${depth}): ${target.ddl}`);

      try {
        await innerClient.unsafe(target.ddl);
      } catch (ddlErr) {
        // DDL 自身遇到 schema 错误 → 解析依赖 → 递归修复 → 重试本 DDL
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

// ── 错误解析：从 PG 错误消息 → 要修复的目标对象 ───────────────────
const SCHEMA_ERROR_CODES = new Set(['42P01', '42703', '42704']);
function isSchemaError(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return !!code && SCHEMA_ERROR_CODES.has(code);
}

function targetFromError(err: unknown): FixTarget | null {
  const e = err as { code?: string; message?: string };
  const code = e.code ?? '';
  const msg = e.message ?? '';

  // relation "X" does not exist
  if (code === '42P01') {
    const m = msg.match(/relation\s+"([^"]+)"/i);
    if (m) {
      const info = findTableCI(m[1]);
      if (info) return { kind: 'table', name: info.name, ddl: buildCreateTableSql(info) };
    }
  }

  // column "X" of relation "Y" does not exist
  if (code === '42703') {
    const m = msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"([^"]+)"/i);
    if (m) {
      const tbl = findTableCI(m[2]);
      if (tbl) {
        const colDef = tbl.columns.find((c) => c.name.toLowerCase() === m[1].toLowerCase()) ||
          tbl.columns.find((c) => c.name === m[1]);
        if (colDef) return { kind: 'column', table: tbl.name, col: colDef.name, ddl: buildAlterTableSql(tbl, colDef) };
      }
    }
  }

  // type "X" does not exist
  if (code === '42704') {
    const m = msg.match(/type\s+"([^"]+)"/i);
    if (m) {
      const info = findEnumCI(m[1]);
      if (info) return { kind: 'type', name: info.name, ddl: buildCreateTypeSql(info) };
    }
  }

  return null;
}

// ── Promise schema 错误捕获与自动修复重试 ─────────────────────────
function wrapPromise<T>(promise: Promise<T>, execute: () => Promise<T>): Promise<T> {
  return promise.catch(async (err) => {
    if (!isSchemaError(err)) throw err;
    const target = targetFromError(err);
    if (!target) throw err;
    const fixed = await fixTarget(target, 0);
    if (!fixed) throw err;
    log(`🔁 重试查询（schema 已修复: ${targetKey(target)}）`);
    return await execute();
  });
}

// ── Query 对象包装：覆盖 .then / .values / .execute ───────────────
function wrapQuery<T>(result: any, execute: () => Promise<T>): any {
  // postgres.js Query 对象：保留 .values() / .execute()，同时替换 .then
  if (result && typeof result.values === 'function') {
    const origValues = result.values.bind(result);
    const origExecute = result.execute?.bind(result);

    // .then 被 await 调用
    const origThen = result.then.bind(result);
    result.then = function (onFulfilled: any, onRejected: any): any {
      return origThen(
        onFulfilled,
        async (err: unknown) => {
          if (!isSchemaError(err)) throw err;
          const target = targetFromError(err);
          if (!target) throw err;
          const fixed = await fixTarget(target, 0);
          if (!fixed) throw err;
          log(`🔁 重试查询（schema 已修复: ${targetKey(target)}）`);
          return await execute();
        },
      );
    };

    // .values() — drizzle 主要用此
    if (origValues) {
      result.values = function (): any {
        return wrapPromise(origValues(), () => execute() as any);
      };
    }

    // .execute()
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

// ── client：Proxy 包装 innerClient ───────────────────────────────
// 仅拦截查询方法；生命周期方法（end/destroy/close/cancel）直接透传
const client = new Proxy(innerClient as any, {
  // client`SELECT 1` —— Tagged Template 调用 apply
  apply(_t, _this, args) {
    const result = innerClient(...(args as any));
    return wrapQuery(result, () => innerClient(...(args as any)));
  },

  get(target, prop, _receiver) {
    const value = Reflect.get(target, prop);
    if (typeof value !== 'function') return value;

    const boundFn = (value as Function).bind(target);
    const propStr = String(prop);

    // 生命周期方法：直接透传（不参与 schema 修复）
    if (propStr === 'end' || propStr === 'destroy' || propStr === 'close' || propStr === 'cancel') {
      return boundFn;
    }

    // 查询方法（client.unsafe(sql), client.sql(...), client.query(...)）
    return function (this: unknown, ...args: unknown[]): any {
      const result = boundFn(...args);
      return wrapQuery(result, () => boundFn(...args) as any);
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
  try {
    if (!(innerClient as any).ended) {
      await (innerClient as any).end({ timeout: 10 });
      log('✅ 连接已优雅关闭');
    }
  } catch (error) { warn(`❌ 关闭连接失败: ${error}`); }
}

if (typeof process !== 'undefined') {
  process.on('SIGINT', closeConnection);
  process.on('SIGTERM', closeConnection);
  process.on('beforeExit', closeConnection);
}
