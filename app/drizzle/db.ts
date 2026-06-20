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
//   按"修复目标"细粒度控制（key = t:<table> / c:<table>:<col> / e:<enum>），
//   同一时刻 N 个请求缺同一个表，只跑一次 CREATE TABLE，
//   其他请求等 Promise 完成后各自重试。修完 A 表不影响 B 表的修复。
//
// 默认值：
//   SQL 表达式（.defaultNow() → now()）、字面量（字符串/布尔/数字）
//   同步到数据库 DEFAULT 子句；函数型默认值（.default(Math.random)）
//   留给 Drizzle 在 INSERT 时自己算，不在数据库层声明。
// ==========================================================================

import {drizzle} from 'drizzle-orm/postgres-js';
import {and, asc, count, desc, eq, exists, gt, gte, lt, lte, ne, or, sql} from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.ts';
import {config} from 'dotenv';
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
//   col.name          → 列名（来自 pgTable('x', { col: text('col') }) 的 'col'）
//   col.getSQLType()  → SQL 类型名（serial / integer / text / boolean / timestamp / uuid / ...）
//   col.notNull       → 是否 NOT NULL
//   col.primary       → 是否主键列
//   col.hasDefault    → 是否声明了默认值
//   col.default       → 默认值（SQL 表达式对象 / 字面量 / 函数）
//
// pgEnum 导出对象：
//   enumObj.enumName  → 枚举类型名（如 'user_status'）
//   enumObj.values    → 枚举值数组（如 ['active', 'withdrawn', 'graduate']）
// ──────────────────────────────────────────────────────────────────────

type ColumnDef = { pgType: string; notNull: boolean; default: string | null; isSerial: boolean };

// Drizzle 类型名 → PostgreSQL 类型名（大部分一致，少量规范化）
const TYPE_MAP: Record<string, string> = {
  serial: 'serial',
  integer: 'integer',
  bigint: 'bigint',
  boolean: 'boolean',
  text: 'text',
  uuid: 'uuid',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamptz',
  timestamp: 'timestamp',
  timestamptz: 'timestamptz'
};

function resolveDefault(col: any): string | null {
  if (!col) return null;
  if (col.hasDefault === false && col.default === undefined) return null;

  const d = col.default;

  // 1) SQL 表达式对象（.defaultNow() → sql`now()`，.defaultRandom() → sql`gen_random_uuid()`）
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    if (typeof d.getSQL === 'function') return d.getSQL();
    if (Array.isArray(d.queryChunks)) {
      return d.queryChunks.map((c: any) => (c?.chunk ?? c?.sql ?? String(c))).join(' ');
    }
    if (typeof d.sql === 'string') return d.sql;
    const s = d.toString?.();
    if (s && s !== '[object Object]') return s;
  }

  // 2) 字面量
  if (typeof d === 'string') return `'${d.replace(/'/g, "''")}'`;
  if (typeof d === 'boolean' || typeof d === 'number') return String(d);

  // 3) 函数（.default(() => 'x') / .default(Math.random)）→ 留给 Drizzle 在 INSERT 时算
  if (typeof d === 'function') return null;

  // 4) serial 主键：PostgreSQL 自动生成 nextval
  const type = typeof col.getSQLType === 'function' ? col.getSQLType() : '';
  if (type === 'serial') return `nextval('"${col.name ?? ''}_seq"'::regclass)`;

  return null;
}

function getColumnDef(col: any): ColumnDef {
  const rawType = typeof col.getSQLType === 'function' ? col.getSQLType() : 'text';
  const pgType = TYPE_MAP[rawType] ?? (rawType.startsWith('character varying') ? rawType.replace('character varying', 'varchar') : rawType);
  const isSerial = rawType === 'serial';
  const notNull = !!col.notNull || !!col.primary;
  const defaultStr = resolveDefault(col);
  return { pgType, notNull, default: defaultStr, isSerial };
}

// 从 schema.ts 中扫描表和枚举
type TableInfo = { tableName: string; columns: { colName: string; def: ColumnDef; enumType: string | null }[] };
type EnumInfo = { name: string; values: string[] };

function buildSchemaMaps(): { tables: Map<string, TableInfo>; enums: Map<string, EnumInfo> } {
  const tables = new Map<string, TableInfo>();
  const enums = new Map<string, EnumInfo>();
  const $keys = new Set(['$inferSelect', '$inferInsert']);

  for (const [, val] of Object.entries<any>(schema)) {
    if (!val) continue;
    if (typeof val !== 'object') continue;

    // pgEnum 实例
    if (typeof val.enumName === 'string' && Array.isArray(val.values)) {
      enums.set(val.enumName, { name: val.enumName, values: val.values });
      continue;
    }

    // pgTable 实例
    const tableName: string | undefined = typeof val.dbName === 'string' ? val.dbName : typeof val.name === 'string' ? val.name : undefined;
    if (!tableName) continue;

    const cols: TableInfo['columns'] = [];
    for (const [key, col] of Object.entries<any>(val)) {
      if (!col || typeof col !== 'object') continue;
      if ($keys.has(key) || key.startsWith('$')) continue;
      if (typeof col.getSQLType !== 'function') continue; // 过滤掉非列字段
      const def = getColumnDef(col);
      const enumType = enums.has(def.pgType) ? def.pgType : null; // 枚举列的 getSQLType() 直接返回枚举名
      const colName: string = (col as any).name ?? (col as any).fieldName ?? key;
      cols.push({ colName, def, enumType });
    }
    if (cols.length > 0) tables.set(tableName, { tableName, columns: cols });
  }

  return { tables, enums };
}

const { tables: schemaTables, enums: schemaEnums } = buildSchemaMaps();

// ── SQL 生成 ──────────────────────────────────────────────────────────────

function buildCreateTableSql(info: TableInfo): string {
  const colDefs = info.columns.map(({ colName, def, enumType }) => {
    const type = enumType ?? def.pgType;
    const parts = [`"${colName}"`, type];
    if (def.default) parts.push(`DEFAULT ${def.default}`);
    if (def.notNull && !def.isSerial) parts.push('NOT NULL');
    return parts.join(' ');
  });

  const pkCol = info.columns.find((c) => c.def.isSerial);
  if (pkCol) colDefs.push(`PRIMARY KEY ("${pkCol.colName}")`);

  return `CREATE TABLE "${info.tableName}" (${colDefs.join(', ')})`;
}

function buildAlterTableSql(tableName: string, colName: string, def: ColumnDef, enumType: string | null): string {
  const type = enumType ?? def.pgType;
  const stmts = [`ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${colName}" ${type}`];
  if (def.default) {
    stmts.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" SET DEFAULT ${def.default}`);
    if (def.notNull) {
      stmts.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" SET NOT NULL`);
    }
  }
  return stmts.join('; ');
}

function buildCreateTypeSql(info: EnumInfo): string {
  const vals = info.values.map((v) => `'${v}'`).join(', ');
  return `CREATE TYPE "${info.name}" AS ENUM (${vals})`;
}

// ── 错误 → 修复目标 key ─────────────────────────────────────────────

function targetKeyFromError(err: any): { kind: 'table' | 'column' | 'type'; target: string; extra?: string } | null {
  const msg: string = err?.message ?? '';
  const code: string = err?.code ?? '';

  // relation "User" does not exist
  const tableMatch = msg.match(/relation\s+"([^"]+)"/i);
  if (code === '42P01' && tableMatch) return { kind: 'table', target: tableMatch[1] };

  // column "emailVerified" of relation "User" does not exist
  const colMatch = msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"([^"]+)"/i);
  if (code === '42703' && colMatch) return { kind: 'column', target: `${colMatch[2]}:${colMatch[1]}`, extra: colMatch[1] };

  // type "user_status" does not exist
  const typeMatch = msg.match(/type\s+"([^"]+)"/i);
  if (code === '42704' && typeMatch) return { kind: 'type', target: typeMatch[1] };

  return null;
}

// ── 细粒度冷却 + 并发控制 ────────────────────────────────────────────
// key: t:<table> / c:<table>:<col> / e:<enum>
const FIX_COOLDOWN_MS = 60 * 1000;
type FixState = { inProgress: Promise<void> | null; lastDoneAt: number };
const fixMap = new Map<string, FixState>();

async function ensureSchemaFixedFor(err: any): Promise<boolean> {
  const parsed = targetKeyFromError(err);
  if (!parsed) return false;

  const key = `${parsed.kind[0]}:${parsed.target}`;
  const now = Date.now();
  let state = fixMap.get(key);

  // 1) 有其他请求在修复同一目标 → 等它完成
  if (state && state.inProgress) {
    await state.inProgress;
    return true;
  }

  // 2) 该目标 60s 内已修过 → 直接重试（PostgreSQL DDL 同步可见）
  if (state && now - state.lastDoneAt < FIX_COOLDOWN_MS) {
    return true;
  }

  // 3) 新修复流程
  if (!state) {
    state = { inProgress: null, lastDoneAt: 0 };
    fixMap.set(key, state);
  }

  state.inProgress = (async () => {
    try {
      if (parsed.kind === 'type') {
        const info = schemaEnums.get(parsed.target);
        if (info) {
          console.log(`[db] 创建缺失枚举类型: ${parsed.target}`);
          await rawClient.unsafe(buildCreateTypeSql(info));
          console.log(`[db] ✅ 枚举 ${parsed.target} 已创建`);
        }
      }

      if (parsed.kind === 'table') {
        const info = schemaTables.get(parsed.target);
        if (info) {
          console.log(`[db] 创建缺失表: ${parsed.target}`);
          await rawClient.unsafe(buildCreateTableSql(info));
          console.log(`[db] ✅ 表 ${parsed.target} 已创建`);
        }
      }

      if (parsed.kind === 'column') {
        const [tName, cName] = parsed.target.split(':');
        const info = schemaTables.get(tName);
        if (info) {
          const colInfo = info.columns.find((c) => c.colName === cName);
          if (colInfo) {
            console.log(`[db] 为表 ${tName} 添加缺失列: ${cName}`);
            await rawClient.unsafe(buildAlterTableSql(tName, cName, colInfo.def, colInfo.enumType));
            console.log(`[db] ✅ 列 ${cName} 已添加`);
          }
        }
      }

      state!.lastDoneAt = Date.now();
    } catch (e: any) {
      console.warn(`[db] ⚠️ schema 修复失败（${key}）:`, e?.message ?? e);
    } finally {
      state!.inProgress = null;
    }
  })();

  await state.inProgress;
  return state.lastDoneAt > now;
}

// ── Proxy：让所有查询自动具备 schema 修复能力 ────────────────────
//
// PostgreSQL 自身对 DDL 是并发安全的（ACCESS EXCLUSIVE 锁），
// 应用层只负责"别让多个请求各自跑一遍相同的 DDL"——上面的 fixMap
// + Promise 排队已解决这个问题。普通 SELECT/INSERT 零开销通过。
// ──────────────────────────────────────────────────────────────────────

function wrapWithRetry(promise: any, retry: () => Promise<any>): any {
  if (!promise || typeof promise.then !== 'function') return promise;
  return (async () => {
    try {
      return await promise;
    } catch (err: any) {
      const code: string = err?.code ?? '';
      if (!['42P01', '42703', '42704'].includes(code)) throw err;
      if (await ensureSchemaFixedFor(err)) return await retry();
      throw err;
    }
  })();
}

const client = new Proxy(rawClient as any, {
  // 拦截 tagged template 调用（Drizzle 实际使用方式：client`SELECT ...`）
  apply(target, _thisArg, args) {
    const result = target(...args);
    return wrapWithRetry(result, () => target(...args));
  },
  // 拦截 client.unsafe(sql) / client.end() 等方法调用
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value === 'function') {
      return function (this: any, ...args: any[]) {
        const result = value.apply(target, args);
        // .end() / .destroy() 等非查询方法不需要 schema 修复
        const skipAutoFix = typeof prop === 'string' && (prop === 'end' || prop === 'destroy' || prop === 'close');
        if (skipAutoFix) return result;
        return wrapWithRetry(result, () => value.apply(target, args));
      };
    }
    return value;
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
