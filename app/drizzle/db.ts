import {drizzle, type PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import {type PgEnum, type PgTable, getTableConfig} from 'drizzle-orm/pg-core';
import type {PgColumn} from 'drizzle-orm/pg-core';
import postgres, {type Sql as PostgresSql, type PendingQuery, type Options} from 'postgres';
import * as schema from './schema';
import {config} from 'dotenv';
import {fileURLToPath} from 'url';
import {dirname, resolve} from 'path';

// ============================================================
// 环境 & 路径
// ============================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({path: resolve(__dirname, '../../.env')});
config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const IS_DEV = process.env.NODE_ENV !== 'production';
const connectionString = process.env.DATABASE_URL;
const isNeonDatabase =
  connectionString.includes('neon.tech') || connectionString.includes('neon.database.com');

// ============================================================
// 日志
// ============================================================

function log(tag: string, ...parts: unknown[]) {
  const ts = new Date().toISOString().slice(11, 23);
  // eslint-disable-next-line no-console
  console.error(`[lazy-schema][${ts}][${tag}] ${parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`);
}
const dlog = (tag: string, ...p: unknown[]) => { if (IS_DEV) log(tag, ...p); };
const ilog = log;
const wlog = log;

// ============================================================
// Schema 索引
// ============================================================

const tablesByName = new Map<string, PgTable>();
const enumsByName = new Map<string, PgEnum<any>>();

(function indexSchema() {
  for (const [, value] of Object.entries(schema)) {
    if (!value || typeof value !== 'object') continue;
    try {
      const cfg = getTableConfig(value as PgTable);
      if (cfg?.name) {
        tablesByName.set(cfg.name, value as PgTable);
        continue;
      }
    } catch {
      // 不是 table，忽略
    }
    const ev = value as any;
    if (typeof ev.enumName === 'string' && Array.isArray(ev.values)) {
      enumsByName.set(ev.enumName, ev as PgEnum<any>);
    }
  }
  ilog('init', `tables=${tablesByName.size} enums=${enumsByName.size}`);
})();

// ============================================================
// PG 类型推断（关键：优先用构造函数名，生产环境可靠）
// ============================================================

const TYPE_BY_CTOR: Record<string, string | undefined> = {
  PgSerial: 'SERIAL',
  PgBigSerial: 'BIGSERIAL',
  PgSmallInt: 'SMALLINT',
  PgInteger: 'INTEGER',
  PgBigInt: 'BIGINT',
  PgUuid: 'UUID',
  PgBoolean: 'BOOLEAN',
  PgJsonb: 'JSONB',
  PgJson: 'JSON',
  PgTimestamp: 'TIMESTAMP',
  PgTimestampString: 'TIMESTAMP',
  PgDate: 'DATE',
  PgDateString: 'DATE',
  PgText: 'TEXT',
  PgVarChar: 'VARCHAR',
  PgChar: 'CHAR',
  PgNumeric: 'NUMERIC',
  PgReal: 'REAL',
  PgDoublePrecision: 'DOUBLE PRECISION',
  PgTime: 'TIME',
  PgBytea: 'BYTEA',
  PgInet: 'INET',
  PgCidr: 'CIDR',
  PgMacAddr: 'MACADDR',
  PgMoney: 'MONEY',
  PgInterval: 'INTERVAL',
  PgBit: 'BIT',
  PgVarBit: 'VARBIT',
};

function pgTypeOfColumn(col: PgColumn): string {
  // 1) 构造函数名（生产环境最可靠）
  const ctor = col.constructor?.name || '';
  if (TYPE_BY_CTOR[ctor]) return TYPE_BY_CTOR[ctor]!;
  // 2) name 子串匹配（容错不同 drizzle 版本）
  const low = ctor.toLowerCase();
  if (low.includes('bigserial')) return 'BIGSERIAL';
  if (low.includes('serial')) return 'SERIAL';
  if (low.includes('uuid')) return 'UUID';
  if (low.includes('jsonb')) return 'JSONB';
  if (low.includes('json')) return 'JSON';
  if (low.includes('boolean')) return 'BOOLEAN';
  if (low.includes('timestamp')) return 'TIMESTAMP';
  if (low.includes('smallint')) return 'SMALLINT';
  if (low.includes('bigint')) return 'BIGINT';
  if (low.includes('integer')) return 'INTEGER';
  if (low.includes('varchar')) return 'VARCHAR';
  if (low.includes('char')) return 'CHAR';
  if (low.includes('text')) return 'TEXT';
  if (low.includes('numeric') || low.includes('decimal')) return 'NUMERIC';
  if (low.includes('real')) return 'REAL';
  if (low.includes('double')) return 'DOUBLE PRECISION';
  if (low.includes('date')) return 'DATE';
  if (low.includes('time')) return 'TIME';
  if (low.includes('bytea')) return 'BYTEA';
  if (low.includes('inet')) return 'INET';
  if (low.includes('cidr')) return 'CIDR';
  // 3) col.columnType / col.dataType
  const colT = (col as any)?.columnType;
  if (typeof colT === 'string') {
    const key = colT.toLowerCase();
    if (TYPE_BY_CTOR[key]) return TYPE_BY_CTOR[key]!;
  }
  const dt = (col as any)?.dataType;
  if (dt === 'string') return 'TEXT';
  if (dt === 'number') return 'INTEGER';
  if (dt === 'boolean') return 'BOOLEAN';
  if (dt === 'json') return 'JSONB';
  if (dt === 'bigint') return 'BIGINT';
  if (dt === 'date') return 'TIMESTAMP';
  return 'TEXT';
}

// ============================================================
// SQL 辅助
// ============================================================

function qIdent(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return `"${name}"`;
  return `"${name.replace(/"/g, '""')}"`;
}

async function relationExists(c: PostgresSql, name: string): Promise<boolean> {
  const r = await c`SELECT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_name = ${name.toLowerCase()}
  ) AS e`;
  return r[0]?.e === true;
}

async function columnExists(c: PostgresSql, table: string, col: string): Promise<boolean> {
  const r = await c`SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table.toLowerCase()} AND column_name = ${col.toLowerCase()}
  ) AS e`;
  return r[0]?.e === true;
}

async function enumTypeExists(c: PostgresSql, name: string): Promise<boolean> {
  const r = await c`SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname = ${name.toLowerCase()}) AS e`;
  return r[0]?.e === true;
}

function defaultClauseFor(col: any): string {
  const def = col.default;
  if (def === undefined || def === null) return '';
  // drizzle 的 defaultNow() / defaultRandom() / sql`` 返回 SQL 对象
  if (def.constructor?.name === 'SQL' && Array.isArray(def.queryChunks)) {
    const val = def.queryChunks[0]?.value;
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'string') {
      return ` DEFAULT ${val[0]}`;
    }
    return '';
  }
  if (typeof def === 'function') {
    const hint = String(((def as any).sql || def.name) || '').toLowerCase();
    if (hint.includes('now')) return ' DEFAULT now()';
    if (hint.includes('gen_random')) return ' DEFAULT gen_random_uuid()';
    return '';
  }
  if (typeof def === 'string') return ` DEFAULT '${def.replace(/'/g, "''")}'`;
  if (typeof def === 'number' || typeof def === 'boolean') return ` DEFAULT ${def}`;
  return '';
}

function hasUsableDefault(col: any): boolean {
  const def = col.default;
  if (def === undefined || def === null) return false;
  if (def.constructor?.name === 'SQL' && Array.isArray(def.queryChunks)) return true;
  if (typeof def === 'function') {
    const hint = String(((def as any).sql || def.name) || '').toLowerCase();
    return hint.includes('now') || hint.includes('gen_random');
  }
  return true;
}

// ============================================================
// DDL 生成
// ============================================================

function columnDDL(col: any): string {
  const enumRef: string | undefined = col._?.enumName;
  const type = enumRef && enumsByName.has(enumRef)
    ? qIdent(enumRef)
    : pgTypeOfColumn(col);
  const notNull = col.notNull === true || col.primary === true;
  let clause = `${qIdent(col.name)} ${type}`;
  if (notNull) clause += ' NOT NULL';
  clause += defaultClauseFor(col);
  if (col.primary === true) clause += ' PRIMARY KEY';
  return clause;
}

function enumDDL(name: string, values: readonly string[]): string {
  const list = values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
  return `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${name.replace(/'/g, "''")}') THEN
    CREATE TYPE ${qIdent(name)} AS ENUM (${list});
  END IF;
END $$;`;
}

function uniqueConstraintDDL(table: PgTable): string[] {
  const cfg: any = getTableConfig(table);
  const out: string[] = [];
  for (const c of cfg.constraints || []) {
    const cname = c?.constructor?.name || '';
    if (cname.includes('Unique')) {
      const cols = (c.columns || []).map((cx: any) => qIdent(cx.name || cx));
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
      .map((cx: any) => qIdent(cx.name || cx))
      .join(', ');
    if (!cols) continue;
    out.push(`CREATE INDEX IF NOT EXISTS ${qIdent(idx.name)} ON ${qIdent(cfg.name)} (${cols});`);
  }
  return out;
}

function tableDDL(table: PgTable): string {
  const cfg: any = getTableConfig(table);
  const neededEnums = new Set<string>();
  for (const col of cfg.columns) {
    const er: string | undefined = col._?.enumName;
    if (er && enumsByName.has(er)) neededEnums.add(er);
  }
  const prelude: string[] = [];
  for (const en of neededEnums) {
    const e = enumsByName.get(en) as any;
    prelude.push(enumDDL(e.enumName, e.values));
  }
  const colClauses = cfg.columns.map((c: any) => columnDDL(c));
  const uq = uniqueConstraintDDL(table);
  const body = [...colClauses, ...uq].join(',\n  ');
  const create = `CREATE TABLE IF NOT EXISTS ${qIdent(cfg.name)} (\n  ${body}\n);`;
  return [...prelude, create, ...indexDDL(table)].join('\n');
}

function addColumnDDL(table: PgTable, columnName: string): string | null {
  const cfg: any = getTableConfig(table);
  const col = cfg.columns.find((c: any) => c.name === columnName);
  if (!col) return null;
  const enumRef: string | undefined = col._?.enumName;
  const prelude: string[] = [];
  let type: string;
  if (enumRef && enumsByName.has(enumRef)) {
    const e = enumsByName.get(enumRef) as any;
    prelude.push(enumDDL(e.enumName, e.values));
    type = qIdent(enumRef);
  } else {
    type = pgTypeOfColumn(col);
  }
  const isPrimary = col.primary === true;
  const wantsNotNull = col.notNull === true || isPrimary;
  const colIdent = qIdent(col.name);
  const tblIdent = qIdent(cfg.name);
  const defClause = defaultClauseFor(col);
  const ddl: string[] = [];

  // 1) 加列（IF NOT EXISTS 保证幂等）
  if (!wantsNotNull) {
    ddl.push(`ALTER TABLE ${tblIdent} ADD COLUMN IF NOT EXISTS ${colIdent} ${type}${defClause};`);
  } else if (hasUsableDefault(col) || isPrimary) {
    ddl.push(`ALTER TABLE ${tblIdent} ADD COLUMN IF NOT EXISTS ${colIdent} ${type}${defClause} NOT NULL;`);
  } else {
    ddl.push(`ALTER TABLE ${tblIdent} ADD COLUMN IF NOT EXISTS ${colIdent} ${type};`);
  }

  // 2) 补 DEFAULT（列已存在但缺 DEFAULT 时补上）
  //    直接 SET DEFAULT（幂等操作，不需要条件判断）
  if (defClause) {
    const defVal = defClause.replace(/^ DEFAULT /, '');
    ddl.push(`ALTER TABLE ${tblIdent} ALTER COLUMN ${colIdent} SET DEFAULT ${defVal};`);
  }

  // 3) 补 NOT NULL（列已存在但缺 NOT NULL 时补上）
  //    先回填 NULL 值（用 DEFAULT），再 SET NOT NULL
  if (wantsNotNull) {
    if (defClause) {
      const defVal = defClause.replace(/^ DEFAULT /, '');
      ddl.push(`UPDATE ${tblIdent} SET ${colIdent} = ${defVal} WHERE ${colIdent} IS NULL;`);
    }
    ddl.push(
      `DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass(${JSON.stringify(cfg.name)})
      AND attname = ${JSON.stringify(col.name)}
      AND attnotnull = true
  ) THEN
    ALTER TABLE ${tblIdent} ALTER COLUMN ${colIdent} SET NOT NULL;
  END IF;
END $$;`,
    );
  }

  // 4) PK
  if (isPrimary) {
    ddl.push(
      `DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = ${qIdent(`${cfg.name}_pkey`)}
      AND conrelid = to_regclass(${JSON.stringify(cfg.name)})
  ) THEN
    ALTER TABLE ${tblIdent} ADD PRIMARY KEY (${colIdent});
  END IF;
END $$;`,
    );
  }
  return [...prelude, ...ddl].join('\n');
}

// ============================================================
// 错误解析
// ============================================================

type Parsed =
  | {kind: 'relation'; name: string}
  | {kind: 'column'; relation: string; column: string}
  | {kind: 'type'; name: string}
  | {kind: 'unknown'};

function stripSchema(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1) : name;
}

function parsePgError(err: any): Parsed {
  const msg = String(err?.message || err?.msg || '');
  const code: string | undefined = err?.code ?? err?.sqlstate;

  // 1) relation "X" does not exist  (X 可能是 schema.table — 我们只取 table)
  let m = msg.match(/relation\s+"?([^"\s]+)"?\s+does not exist/i);
  if (m) return {kind: 'relation', name: stripSchema(m[1])};
  // 2) column "X" of relation "Y" does not exist
  m = msg.match(/column\s+"?([^"\s]+)"?\s+of\s+relation\s+"?([^"\s]+)"?/i);
  if (m) return {kind: 'column', column: m[1], relation: stripSchema(m[2])};
  // 3) type "X" does not exist
  m = msg.match(/type\s+"?([^"\s]+)"?\s+does not exist/i);
  if (m) return {kind: 'type', name: stripSchema(m[1])};
  // 4) null value in column "X" of relation "Y" violates not-null constraint (23502)
  //    这通常是因为列缺少 DEFAULT 值，可以通过 addColumnDDL 补 DEFAULT 修复
  m = msg.match(/null value in column\s+"?([^"\s]+)"?\s+of\s+relation\s+"?([^"\s]+)"?\s+violates not-null constraint/i);
  if (m) return {kind: 'column', column: m[1], relation: stripSchema(m[2])};
  return {kind: 'unknown'};
}

// ============================================================
// 修复执行（并发去重 + 错误上报）
// ============================================================

const MAX_RETRIES = 3;
const inProgress = new Map<string, Promise<boolean>>();

async function tryRepair(
  runSQL: (sql: string) => Promise<any>,
  parsed: Parsed,
): Promise<boolean> {
  if (parsed.kind === 'unknown') return false;

  let key: string;
  let doRepair: () => Promise<boolean>;

  if (parsed.kind === 'relation') {
    key = `table:${parsed.name}`;
    const t = tablesByName.get(parsed.name);
    if (!t) return false;
    doRepair = async () => {
      try {
        const ddl = tableDDL(t);
        await runSQL(ddl);
        ilog('repair:table', `ok ${parsed.name}`);
        return true;
      } catch (err: any) {
        wlog('repair:table', `fail ${parsed.name}: ${err?.message || err}`);
        return false;
      }
    };
  } else if (parsed.kind === 'type') {
    key = `type:${parsed.name}`;
    const e = enumsByName.get(parsed.name);
    if (!e) return false;
    doRepair = async () => {
      try {
        await runSQL(enumDDL((e as any).enumName, (e as any).values));
        ilog('repair:type', `ok ${parsed.name}`);
        return true;
      } catch (err: any) {
        wlog('repair:type', `fail ${parsed.name}: ${err?.message || err}`);
        return false;
      }
    };
  } else {
    key = `col:${parsed.relation}.${parsed.column}`;
    const t = tablesByName.get(parsed.relation);
    if (!t) return false;
    const ddl = addColumnDDL(t, parsed.column);
    if (!ddl) return false;
    doRepair = async () => {
      try {
        await runSQL(ddl);
        ilog('repair:col', `ok ${parsed.relation}.${parsed.column}`);
        return true;
      } catch (err: any) {
        wlog('repair:col', `fail ${parsed.relation}.${parsed.column}: ${err?.message || err}`);
        return false;
      }
    };
  }

  const existing = inProgress.get(key);
  if (existing) {
    dlog('dedup', key);
    return existing;
  }
  const p = doRepair().finally(() => inProgress.delete(key));
  inProgress.set(key, p);
  return p;
}

// ============================================================
// Client 包装（显式对象，不用 Proxy，Nitro 不会内联优化）
// ============================================================

// 关键：rollup 会内联局部常量函数引用。
// 为了避免内联，所有对 raw 方法的获取都通过动态属性访问 `raw['unsafe']`，
// 并且把 wrap 逻辑直接内联到每个方法里（不通过外部 wrapPQ 函数）。

function buildWrappedClient(raw: PostgresSql): PostgresSql {
  const rawAny = raw as any;

  // runSQL：执行原始 DDL（不走错误修复）
  const runSQL = (sql: string): Promise<any> => rawAny['unsafe'](sql);

  // 内联 wrap 逻辑：把 raw PQ 包装成带错误修复的 thenable
  const makeWrapped = (rawPq: any, replayFn: () => any, depth: number): any => {
    if (depth > MAX_RETRIES || !rawPq || typeof rawPq !== 'object' || typeof rawPq.then !== 'function') {
      return rawPq;
    }

    const wrapped: any = {
      then(onF?: any, onR?: any) {
        return Promise.resolve(rawPq).then(
          onF,
          async (err: any) => {
            const parsed = parsePgError(err);
            if (parsed.kind === 'unknown') {
              if (onR) return onR(err);
              throw err;
            }
            const ok = await tryRepair(runSQL, parsed);
            if (!ok) {
              if (onR) return onR(err);
              throw err;
            }
            const newRaw = replayFn();
            const newWrapped = makeWrapped(newRaw, replayFn, depth + 1);
            return Promise.resolve(newWrapped).then(onF, onR);
          },
        );
      },
      catch(onR: any) { return this.then(undefined, onR); },
      finally(onF: any) {
        return this.then(
          (v: any) => { onF && onF(); return v; },
          (e: any) => { onF && onF(); throw e; },
        );
      },
    };

    // 转发所有原型方法；返回 thenable 时递归包装
    for (const key of Object.getOwnPropertyNames(Object.getPrototypeOf(rawPq))) {
      const fn = rawPq[key];
      if (typeof fn === 'function' && key !== 'then' && key !== 'constructor') {
        wrapped[key] = function (...args: any[]) {
          const r = fn.apply(rawPq, args);
          if (r && typeof r === 'object' && typeof r.then === 'function') {
            const newReplay = () => fn.apply(replayFn(), args);
            return makeWrapped(r, newReplay, depth + 1);
          }
          return r;
        };
      }
    }

    return wrapped;
  };

  // 模板标签调用：client`SELECT ...`
  function taggedTemplateFn(...args: any[]): any {
    const replay = () => rawAny.apply(raw, args);
    const pq = replay();
    return makeWrapped(pq, replay, 0);
  }

  // unsafe：通过动态属性访问获取，阻止 rollup 内联
  taggedTemplateFn['unsafe'] = function (...args: any[]) {
    const fn = rawAny['unsafe'];
    const replay = () => fn.apply(raw, args);
    const pq = replay();
    return makeWrapped(pq, replay, 0);
  };

  // begin
  taggedTemplateFn['begin'] = function (...args: any[]) {
    return rawAny['begin'].apply(raw, args);
  };

  // 透传所有自有属性（options / transform / 等）
  for (const key of Object.getOwnPropertyNames(rawAny)) {
    if (key === 'unsafe' || key === 'begin' || key === 'prototype') continue;
    const val = rawAny[key];
    if (typeof val === 'function') {
      taggedTemplateFn[key] = function (...args: any[]) { return val.apply(raw, args); };
    } else {
      Object.defineProperty(taggedTemplateFn, key, {
        get() { return rawAny[key]; },
        set(v: any) { rawAny[key] = v; },
        configurable: true,
      });
    }
  }

  // 透传原型方法（跳过严格模式禁止访问的属性）
  const proto = Object.getPrototypeOf(rawAny);
  if (proto && proto !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor' || key === 'prototype' || key === 'caller' || key === 'callee' || key === 'arguments') continue;
      // 用 Object.prototype.hasOwnProperty 判断，避免访问严格模式禁止的属性
      if (Object.prototype.hasOwnProperty.call(taggedTemplateFn, key)) continue;
      const desc = Object.getOwnPropertyDescriptor(proto, key);
      if (!desc) continue;
      if (typeof desc.value === 'function') {
        (taggedTemplateFn as any)[key] = function (...args: any[]) { return desc.value.apply(raw, args); };
      } else if (desc.get || desc.set) {
        Object.defineProperty(taggedTemplateFn, key, {
          get: desc.get ? () => (desc.get as Function).call(raw) : undefined,
          set: desc.set ? (v: any) => (desc.set as Function).call(raw, v) : undefined,
          configurable: true,
        });
      }
    }
  }

  return taggedTemplateFn as PostgresSql;
}

// ============================================================
// 连接配置
// ============================================================

function buildClientConfig(): Options<any> {
  if (isNeonDatabase) {
    return {
      max: 1,
      idle_timeout: 0,
      connect_timeout: 10,
      max_lifetime: 3600,
      ssl: 'require',
      prepare: false,
      transform: {undefined: null} as any,
      connection: {application_name: 'voicehub-app'},
    } as Options<any>;
  }
  const needSsl =
    connectionString.includes('sslmode=require') ||
    connectionString.includes('ssl=true');
  return {
    max: process.env.NODE_ENV === 'production' ? 10 : 5,
    idle_timeout: 20,
    connect_timeout: 30,
    max_lifetime: 3600,
    ssl: needSsl ? 'require' : false,
    prepare: false,
    transform: {undefined: null} as any,
    connection: {application_name: 'voicehub-app'},
  } as Options<any>;
}

// ============================================================
// 实例化
// ============================================================

export const rawClient = postgres(connectionString, buildClientConfig());
export const client: PostgresSql = buildWrappedClient(rawClient);
export const db: PostgresJsDatabase<typeof schema> = drizzle(client, {schema});

// ============================================================
// 工具导出
// ============================================================

export {eq, ne, and, gt, gte, lt, lte, count, exists, desc, asc, or, sql} from 'drizzle-orm';
export * from './schema';

export async function testConnection() {
  try {
    await client`SELECT 1`;
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
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('❌ Error closing database connection:', error);
  }
}

if (typeof process !== 'undefined') {
  process.once('SIGINT', closeConnection);
  process.once('SIGTERM', closeConnection);
  process.once('beforeExit', closeConnection);
}

// 调试导出
export const __lazySchemaTables = tablesByName;
export const __lazySchemaEnums = enumsByName;
