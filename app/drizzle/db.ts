import {drizzle, type PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import {type PgEnum, type PgTable, getTableConfig} from 'drizzle-orm/pg-core';
import type {PgColumn} from 'drizzle-orm/pg-core';
import postgres, {type Sql as PostgresSql} from 'postgres';
import * as schema from './schema';
import {config} from 'dotenv';
import {fileURLToPath} from 'url';
import {dirname, resolve} from 'path';

// ============================================================
// 环境 & 路径
// ============================================================

// 优先级：项目根 .env > process.env
// 使用 import.meta.url 解析 db.ts 同目录向上两级定位项目根
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({path: resolve(__dirname, '../../.env')});
config(); // 再尝试默认查找

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const IS_DEV = process.env.NODE_ENV !== 'production';
const connectionString = process.env.DATABASE_URL;
const isNeonDatabase =
  connectionString.includes('neon.tech') || connectionString.includes('neon.database.com');

// ============================================================
// 日志（dev 模式详细；生产模式仅输出关键 DIAG）
// ============================================================

type Level = 'debug' | 'info' | 'warn';
function log(level: Level, tag: string, ...parts: unknown[]) {
  if (level === 'debug' && !IS_DEV) return;
  const ts = new Date().toISOString().slice(11, 23);
  const line = `[lazy-schema][${ts}][${tag}] ${parts
    .map(p => (typeof p === 'string' ? p : JSON.stringify(p)))
    .join(' ')}`;
  // stderr：避免和 stdout 上的 SQL 输出混在一起
  // eslint-disable-next-line no-console
  console.error(line);
}
const dlog = (tag: string, ...p: unknown[]) => log('debug', tag, ...p);
const ilog = (tag: string, ...p: unknown[]) => log('info', tag, ...p);
const wlog = (tag: string, ...p: unknown[]) => log('warn', tag, ...p);

// ============================================================
// Schema 索引（建立 SQL 名称 → schema 对象 的反向映射）
// ============================================================

const tablesByName = new Map<string, PgTable>();
const enumsByName = new Map<string, PgEnum<any>>();

function indexSchema() {
  for (const [key, value] of Object.entries(schema)) {
    if (!value || typeof value !== 'object') continue;
    try {
      // PgTable：有 getTableConfig 能力
      const cfg = getTableConfig(value as PgTable);
      if (cfg?.name && !tablesByName.has(cfg.name)) {
        tablesByName.set(cfg.name, value as PgTable);
        dlog('scan:table', `${key} -> ${cfg.name} (${cfg.columns.length} cols)`);
        continue;
      }
    } catch {
      // 不是 table，尝试 enum
    }
    const ev = value as any;
    if (typeof ev.enumName === 'string' && Array.isArray(ev.values)) {
      if (!enumsByName.has(ev.enumName)) {
        enumsByName.set(ev.enumName, ev as PgEnum<any>);
        dlog('scan:enum', `${key} -> ${ev.enumName} (${ev.values.length} values)`);
      }
    }
  }
  ilog('scan:done', `${tablesByName.size} tables, ${enumsByName.size} enums`);
}
indexSchema();

// ============================================================
// DDL 生成
// ============================================================

// drizzle 内部类型 / 构造名 -> PG 类型
const TYPE_MAP: Record<string, string> = {
  pgserial: 'SERIAL',
  pgbigserial: 'BIGSERIAL',
  pguuid: 'UUID',
  pgjsonb: 'JSONB',
  pgjson: 'JSON',
  pgboolean: 'BOOLEAN',
  pginteger: 'INTEGER',
  pgsmallint: 'SMALLINT',
  pgbigint: 'BIGINT',
  pgtext: 'TEXT',
  pgvarchar: 'VARCHAR',
  pgchar: 'CHAR',
  pgtimestamp: 'TIMESTAMP',
  pgdate: 'DATE',
  pgtime: 'TIME',
  pginterval: 'INTERVAL',
  pgnumeric: 'NUMERIC',
  pgreal: 'REAL',
  pgdoubleprecision: 'DOUBLE PRECISION',
  pgbytea: 'BYTEA',
  pginet: 'INET',
  pgcidr: 'CIDR',
  pgmacaddr: 'MACADDR',
  pgmoney: 'MONEY',
  pgbit: 'BIT',
  pgvarbit: 'VARBIT',
};

function pgTypeOfColumn(col: PgColumn): string {
  const b: any = (col as any)._;
  const raw: any = b?.sqlType ?? (col as any).sqlType ?? (col as any).columnType;
  if (raw) {
    const key = String(raw).toLowerCase();
    if (TYPE_MAP[key]) return TYPE_MAP[key];
    const stripped = key.replace(/^pg/, '');
    if (TYPE_MAP[stripped]) return TYPE_MAP[stripped];
    if (stripped === 'doubleprecision') return 'DOUBLE PRECISION';
  }
  // 兜底：列类名探测
  const ctor = (col.constructor?.name || '').toLowerCase();
  if (ctor.includes('bigserial')) return 'BIGSERIAL';
  if (ctor.includes('serial')) return 'SERIAL';
  if (ctor.includes('uuid')) return 'UUID';
  if (ctor.includes('jsonb')) return 'JSONB';
  if (ctor.includes('json')) return 'JSON';
  if (ctor.includes('boolean')) return 'BOOLEAN';
  if (ctor.includes('timestamp')) return 'TIMESTAMP';
  if (ctor.includes('smallint')) return 'SMALLINT';
  if (ctor.includes('bigint')) return 'BIGINT';
  if (ctor.includes('integer')) return 'INTEGER';
  if (ctor.includes('varchar')) return 'VARCHAR';
  if (ctor.includes('text')) return 'TEXT';
  if (ctor.includes('numeric') || ctor.includes('decimal')) return 'NUMERIC';
  if (ctor.includes('real') || ctor.includes('float')) return 'REAL';
  if (ctor.includes('double')) return 'DOUBLE PRECISION';
  if (ctor.includes('date')) return 'DATE';
  if (ctor.includes('time')) return 'TIME';
  if (ctor.includes('bytea')) return 'BYTEA';
  if (ctor.includes('inet')) return 'INET';
  if (ctor.includes('cidr')) return 'CIDR';
  // 最后一档：dataType 推断
  const dt = ((col as any).dataType || '').toLowerCase();
  if (dt === 'string') return 'TEXT';
  if (dt === 'boolean') return 'BOOLEAN';
  if (dt === 'date') return 'TIMESTAMP';
  if (dt === 'json') return 'JSONB';
  if (dt === 'bigint') return 'BIGINT';
  if (dt === 'number') return 'INTEGER';
  return 'TEXT';
}

function quoteIdent(name: string): string {
  // 仅允许标识符字符，否则转义
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `"${name}"`;
  return `"${name.replace(/"/g, '""')}"`;
}

function defaultClauseFor(col: any): string {
  const def = col.default;
  if (def === undefined || def === null) return '';
  if (typeof def === 'function') {
    const fx: any = def;
    const hint = String(fx.sql ?? fx.name ?? '').toLowerCase();
    if (hint.includes('now')) return ' DEFAULT now()';
    if (hint.includes('gen_random') || hint.includes('random'))
      return ' DEFAULT gen_random_uuid()';
    return '';
  }
  if (typeof def === 'string') return ` DEFAULT '${def.replace(/'/g, "''")}'`;
  if (typeof def === 'number' || typeof def === 'boolean') return ` DEFAULT ${def}`;
  return '';
}

function hasUsableDefault(col: any): boolean {
  const def = col.default;
  if (def === undefined || def === null) return false;
  if (typeof def === 'function') {
    const fx: any = def;
    const hint = String(fx.sql ?? fx.name ?? '').toLowerCase();
    return hint.includes('now') || hint.includes('gen_random');
  }
  return true;
}

function columnDDL(col: any): string {
  const enumRef: string | undefined = col._?.enumName;
  const type = enumRef && enumsByName.has(enumRef)
    ? quoteIdent(enumRef)
    : pgTypeOfColumn(col);
  const isPrimary = col.primary === true;
  const notNull = col.notNull === true || isPrimary;
  let clause = `${quoteIdent(col.name)} ${type}`;
  if (notNull) clause += ' NOT NULL';
  clause += defaultClauseFor(col);
  if (isPrimary) clause += ' PRIMARY KEY';
  return clause;
}

function enumDDL(name: string, values: readonly string[]): string {
  const list = values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
  return `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${name.replace(/'/g, "''")}') THEN
    CREATE TYPE ${quoteIdent(name)} AS ENUM (${list});
  END IF;
END $$;`;
}

function uniqueConstraintDDL(table: PgTable): string[] {
  const cfg: any = getTableConfig(table);
  const out: string[] = [];
  for (const c of cfg.constraints || []) {
    const name = c?.constructor?.name || '';
    if (name.includes('UniqueConstraint') || (c as any)?.name?.includes('unique')) {
      const cols = (c.columns || []).map((cx: any) => quoteIdent(cx.name || cx));
      if (cols.length) out.push(`UNIQUE (${cols.join(', ')})`);
    }
  }
  return out;
}

function indexDDL(table: PgTable): string[] {
  const cfg: any = getTableConfig(table);
  const out: string[] = [];
  for (const idx of cfg.indexes || []) {
    const cols = (idx.columns || [])
      .map((cx: any) => quoteIdent(cx.name || cx))
      .join(', ');
    if (!cols) continue;
    out.push(`CREATE INDEX IF NOT EXISTS ${quoteIdent(idx.name)} ON ${quoteIdent(cfg.name)} (${cols});`);
  }
  return out;
}

function tableDDL(table: PgTable): string {
  const cfg: any = getTableConfig(table);
  // 1. 先建依赖的枚举类型
  const neededEnums = new Set<string>();
  for (const col of cfg.columns) {
    const er: string | undefined = col._?.enumName;
    if (er && enumsByName.has(er)) neededEnums.add(er);
  }
  const prelude: string[] = [];
  for (const en of neededEnums) {
    const e = enumsByName.get(en)! as any;
    prelude.push(enumDDL(e.enumName, e.values));
  }
  // 2. 列 + 唯一约束
  const colClauses = cfg.columns.map((c: any) => columnDDL(c));
  const uq = uniqueConstraintDDL(table);
  const body = [...colClauses, ...uq].join(',\n  ');
  const create = `CREATE TABLE IF NOT EXISTS ${quoteIdent(cfg.name)} (\n  ${body}\n);`;
  // 3. 索引
  return [...prelude, create, ...indexDDL(table)].join('\n');
}

function addColumnDDL(table: PgTable, columnName: string): string | null {
  const cfg: any = getTableConfig(table);
  const col = cfg.columns.find((c: any) => c.name === columnName);
  if (!col) return null;

  // 枚举依赖：先建枚举
  const enumRef: string | undefined = col._?.enumName;
  const prelude: string[] = [];
  let type: string;
  if (enumRef && enumsByName.has(enumRef)) {
    const e = enumsByName.get(enumRef) as any;
    prelude.push(enumDDL(e.enumName, e.values));
    type = quoteIdent(enumRef);
  } else {
    type = pgTypeOfColumn(col);
  }

  // 加列策略：
  //  - 可空 + 无 default：直接加
  //  - 不可空 + 有 default：一次加（PG 会把 default 应用到现有行）
  //  - 不可空 + 无 default + 非主键：先 nullable，backfill default，再 SET NOT NULL
  //  - 不可空 + 无 default + 是主键：直接 NOT NULL（但实际应当避免这种情况）
  const isPrimary = col.primary === true;
  const wantsNotNull = col.notNull === true || isPrimary;
  const colIdent = quoteIdent(col.name);
  const tblIdent = quoteIdent(cfg.name);
  const ddl: string[] = [];
  if (!wantsNotNull) {
    ddl.push(`ALTER TABLE ${tblIdent} ADD COLUMN IF NOT EXISTS ${colIdent} ${type}${defaultClauseFor(col)};`);
  } else if (hasUsableDefault(col) || isPrimary) {
    ddl.push(`ALTER TABLE ${tblIdent} ADD COLUMN IF NOT EXISTS ${colIdent} ${type}${defaultClauseFor(col)} NOT NULL;`);
  } else {
    // 不可空 + 无 default：分两步
    ddl.push(`ALTER TABLE ${tblIdent} ADD COLUMN IF NOT EXISTS ${colIdent} ${type};`);
    ddl.push(`ALTER TABLE ${tblIdent} ALTER COLUMN ${colIdent} SET NOT NULL;`);
  }
  if (isPrimary) {
    ddl.push(
      `DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = ${quoteIdent(`${cfg.name}_pkey`)}
      AND conrelid = ${quoteIdent(cfg.name)}::regclass
  ) THEN
    ALTER TABLE ${tblIdent} ADD PRIMARY KEY (${colIdent});
  END IF;
END $$;`,
    );
  }
  return [...prelude, ...ddl].join('\n');
}

// ============================================================
// 元数据查询
// ============================================================

async function relationExists(c: PostgresSql, name: string): Promise<boolean> {
  const r = await c`SELECT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = ${name}
  ) AS e`;
  return r[0]?.e === true;
}

async function columnExists(c: PostgresSql, table: string, col: string): Promise<boolean> {
  const r = await c`SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table} AND column_name = ${col}
  ) AS e`;
  return r[0]?.e === true;
}

async function enumTypeExists(c: PostgresSql, name: string): Promise<boolean> {
  const r = await c`SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname = ${name}) AS e`;
  return r[0]?.e === true;
}

// ============================================================
// 错误解析
// ============================================================

type ParsedError =
  | {kind: 'relation'; name: string}
  | {kind: 'column'; relation: string; column: string}
  | {kind: 'type'; name: string}
  | {kind: 'unknown'};

// 从 `public.User` / `"public.User"` 提取纯表名
function stripSchema(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1) : name;
}

function parsePgError(err: any): ParsedError {
  const code: string | undefined = err?.code ?? err?.sqlstate;
  const msg = String(err?.message ?? err?.msg ?? '');

  if (code === '42P01' || /relation\s+.+\s+does not exist/i.test(msg)) {
    const m = msg.match(/relation\s+"?([^"\s.]+)"?\s+does not exist/i);
    if (m) return {kind: 'relation', name: stripSchema(m[1])};
  }
  if (code === '42703' || /column\s+.+\s+of\s+relation\s+.+\s+does not exist/i.test(msg)) {
    const m = msg.match(/column\s+"?([^"\s]+)"?\s+of\s+relation\s+"?([^"\s.]+)"?/i);
    if (m) return {kind: 'column', column: m[1], relation: stripSchema(m[2])};
  }
  if (code === '42704' || /type\s+.+\s+does not exist/i.test(msg)) {
    const m = msg.match(/type\s+"?([^"\s]+)"?\s+does not exist/i);
    if (m) return {kind: 'type', name: stripSchema(m[1])};
  }
  return {kind: 'unknown'};
}

// ============================================================
// 修复执行（带并发去重 + 重试上限）
// ============================================================

const MAX_REPAIR_RETRIES = 3;

// 关键修复：使用 Map<key, Promise> 而非 Set，去重的同时让等待者共享同一结果
const inProgress = new Map<string, Promise<boolean>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inProgress.get(key) as Promise<T> | undefined;
  if (existing) {
    dlog('lock:wait', key);
    return existing;
  }
  const p = fn().finally(() => inProgress.delete(key));
  inProgress.set(key, p as Promise<boolean>);
  return p;
}

async function tryRepair(
  client: PostgresSql,
  parsed: ParsedError,
  retriesLeft: number,
): Promise<boolean> {
  if (parsed.kind === 'unknown') return false;

  if (parsed.kind === 'type') {
    return withLock(`type:${parsed.name}`, async () => {
      const e = enumsByName.get(parsed.name);
      if (!e) return false;
      if (await enumTypeExists(client, parsed.name)) return true;
      try {
        await client.unsafe(enumDDL((e as any).enumName, (e as any).values));
        ilog('repair:type:ok', parsed.name);
        return true;
      } catch (err: any) {
        wlog('repair:type:fail', parsed.name, err?.message || err);
        return false;
      }
    });
  }

  if (parsed.kind === 'relation') {
    return withLock(`table:${parsed.name}`, async () => {
      const t = tablesByName.get(parsed.name);
      if (!t) return false;
      if (await relationExists(client, parsed.name)) return true;
      try {
        await client.unsafe(tableDDL(t));
        ilog('repair:table:ok', parsed.name);
        return true;
      } catch (err: any) {
        wlog('repair:table:fail', parsed.name, err?.message || err);
        return false;
      }
    });
  }

  // column
  return withLock(`col:${parsed.relation}.${parsed.column}`, async () => {
    const t = tablesByName.get(parsed.relation);
    if (!t) return false;
    if (await columnExists(client, parsed.relation, parsed.column)) return true;
    const ddl = addColumnDDL(t, parsed.column);
    if (!ddl) return false;
    try {
      await client.unsafe(ddl);
      ilog('repair:col:ok', `${parsed.relation}.${parsed.column}`);
      return true;
    } catch (err: any) {
      wlog('repair:col:fail', `${parsed.relation}.${parsed.column}`, err?.message || err);
      return false;
    }
  });
}

// ============================================================
// Proxy：包装 postgres client 与 PendingQuery
// ============================================================

// postgres PendingQuery 的链式方法（动态挂到实例属性上）
const PQ_CHAIN_METHODS = new Set([
  'values', 'raw', 'cursor', 'forEach', 'stream', 'describe',
  'execute', 'handle', 'simple', 'readable', 'writable', 'origin',
  'cancel', 'named', 'reduce', 'next', 'return', 'throw',
]);

// postgres client 上返回 PendingQuery 的方法
const CLIENT_PQ_METHODS = new Set([
  'unsafe', 'begin', 'savepoint',
  'file', 'load', 'queue', 'listen', 'notify', 'unlisten',
  'copyFrom', 'copyTo', 'copyToFile', 'copyFromStdin',
]);

type Replay = () => any;

function wrapPendingQuery(
  innerClient: PostgresSql,
  pq: any,
  replay: Replay,
  retriesLeft = MAX_REPAIR_RETRIES,
): any {
  if (!pq || typeof pq !== 'object' || typeof pq.then !== 'function') return pq;

  return new Proxy(pq, {
    get(target, prop, receiver) {
      const key = String(prop);

      // Promise 协议：注入错误修复 + 重试上限
      if (key === 'then' || key === 'catch' || key === 'finally') {
        return (onFulfilled?: any, onRejected?: any) => {
          return new Promise((resolve, reject) => {
            const handleResult = (val: any) => {
              if (key === 'then') {
                try {
                  resolve(onFulfilled ? onFulfilled(val) : val);
                } catch (e) {
                  reject(e);
                }
              } else if (key === 'finally') {
                try {
                  resolve(onFulfilled ? onFulfilled() : undefined);
                } catch (e) {
                  reject(e);
                }
              } else {
                // catch 不消费 val
                resolve(undefined);
              }
            };
            const handleError = async (err: any) => {
              const parsed = parsePgError(err);
              const canRepair = parsed.kind !== 'unknown' && retriesLeft > 0;
              if (!canRepair) {
                if (key === 'then') {
                  try {
                    resolve(onRejected ? onRejected(err) : err);
                  } catch (e) {
                    reject(e);
                  }
                } else if (key === 'catch') {
                  try {
                    resolve(onRejected ? onRejected(err) : undefined);
                  } catch (e) {
                    reject(e);
                  }
                } else {
                  // finally 不消费 error
                  resolve(undefined);
                }
                return;
              }
              const ok = await tryRepair(innerClient, parsed, retriesLeft - 1);
              if (!ok) {
                if (key === 'then') {
                  try {
                    resolve(onRejected ? onRejected(err) : err);
                  } catch (e) {
                    reject(e);
                  }
                } else if (key === 'catch') {
                  try {
                    resolve(onRejected ? onRejected(err) : undefined);
                  } catch (e) {
                    reject(e);
                  }
                } else {
                  resolve(undefined);
                }
                return;
              }
              // 重放原查询：返回新 wrapped PQ（递归走同样的修复路径）
              const newPq = replay();
              Promise.resolve(newPq).then(handleResult, handleError);
            };
            Promise.resolve(target).then(handleResult, handleError);
          });
        };
      }

      // 链式方法：转发到 inner PQ；方法返回若是 thenable 则再包一层
      if (PQ_CHAIN_METHODS.has(key)) {
        return (...args: any[]) => {
          const fn = target[key];
          if (typeof fn !== 'function') return fn;
          const r = fn.apply(target, args);
          if (r && typeof r === 'object' && typeof r.then === 'function') {
            return wrapPendingQuery(innerClient, r, replay, retriesLeft);
          }
          return r;
        };
      }
      // 其他属性穿透
      return (target as any)[prop];
    },
  });
}

function wrapClientWithLazySchema(inner: PostgresSql): PostgresSql {
  // [PROD-DIAG] 写文件，确保即使 stderr 被吞也能看到
  try {
    // eslint-disable-next-line no-console
    console.error('[DB-PROD] wrapClientWithLazySchema CALLED at', new Date().toISOString());
    // eslint-disable-next-line no-console
    console.error('[DB-PROD] inner.unsafe type =', typeof (inner as any)?.unsafe);
    // eslint-disable-next-line no-console
    console.error('[DB-PROD] CALL_STACK:', new Error('wrap call').stack?.split('\n').slice(0, 8).join(' | '));
  } catch (e) { /* ignore */ }
  const handler: ProxyHandler<PostgresSql> = {
    get(target, prop, receiver) {
      const key = String(prop);
      const original: any = Reflect.get(target, prop, receiver);
      if (typeof original !== 'function') return original;
      if (!CLIENT_PQ_METHODS.has(key)) return original;
      return function (this: any, ...args: any[]) {
        const bound = this === receiver ? target : this;
        const replay = () => original.apply(bound, args);
        const pq = replay();
        try {
          // [PROD-DIAG]
          // eslint-disable-next-line no-console
          console.error('[DB-PROD] client.' + key + '() called, pq.type=', typeof pq, 'pq.then=', typeof pq?.then, 'pq.values=', typeof pq?.values);
        } catch (e) { /* ignore */ }
        if (pq && typeof pq === 'object' && typeof pq.then === 'function') {
          return wrapPendingQuery(inner, pq, replay);
        }
        return pq;
      };
    },
    apply(target, thisArg, args) {
      const replay = () => target.apply(thisArg, args);
      const pq = replay();
      try {
        // eslint-disable-next-line no-console
        const firstArg = (args[0] as any)?.raw?.[0] || '?';
        // eslint-disable-next-line no-console
        console.error('[DB-PROD] client(' + firstArg + ') called, pq.values=', typeof pq?.values);
      } catch (e) { /* ignore */ }
      if (pq && typeof pq === 'object' && typeof pq.then === 'function') {
        return wrapPendingQuery(inner, pq, replay);
      }
      return pq;
    },
  };
  return new Proxy(inner, handler) as PostgresSql;
}

// ============================================================
// 连接配置
// ============================================================

function buildClientConfig() {
  if (isNeonDatabase) {
    return {
      max: 1,
      idle_timeout: 0,
      connect_timeout: 10,
      max_lifetime: 3600,
      ssl: 'require' as const,
      prepare: false,
      transform: {undefined: null},
      connection: {application_name: 'voicehub-app'},
    };
  }
  const needSsl =
    connectionString.includes('sslmode=require') ||
    connectionString.includes('ssl=true');
  return {
    max: process.env.NODE_ENV === 'production' ? 10 : 5,
    idle_timeout: 20,
    connect_timeout: 30,
    max_lifetime: 3600,
    ssl: needSsl ? ('require' as const) : false,
    prepare: false,
    transform: {undefined: null},
    connection: {application_name: 'voicehub-app'},
  };
}

// ============================================================
// 实例化
// ============================================================

export const rawClient = postgres(connectionString, buildClientConfig());
export const client: PostgresSql = wrapClientWithLazySchema(rawClient);
export const db: PostgresJsDatabase<typeof schema> = drizzle(client, {schema});

// ============================================================
// 工具导出
// ============================================================

export {eq, ne, and, gt, gte, lt, lte, count, exists, desc, asc, or, sql} from 'drizzle-orm';
export * from './schema';

export async function testConnection() {
  try {
    await client`SELECT 1`;
    // eslint-disable-next-line no-console
    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

export function getConnectionStatus() {
  const opts = (rawClient as any).options ?? {};
  return {
    isConnected: !(rawClient as any).ended,
    status: (rawClient as any).ended ? 'disconnected' : 'connected',
    maxConnections: opts.max,
    idleTimeout: opts.idle_timeout,
    connectTimeout: opts.connect_timeout,
  };
}

export async function closeConnection() {
  try {
    if (!(rawClient as any).ended) {
      await (rawClient as any).end({timeout: 10});
      // eslint-disable-next-line no-console
      console.log('✅ Database connection closed gracefully');
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('❌ Error closing database connection:', error);
  }
}

if (typeof process !== 'undefined') {
  const shutdown = async () => {
    await closeConnection();
  };
  // once：避免 hot reload / 多 import 累积监听器
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('beforeExit', shutdown);
}

// 调试导出
export const __lazySchemaTables = tablesByName;
export const __lazySchemaEnums = enumsByName;
