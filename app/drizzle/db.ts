import {drizzle, type PostgresJsDatabase} from 'drizzle-orm/postgres-js';
import {and, asc, count, desc, eq, exists, gt, gte, lt, lte, ne, or, sql} from 'drizzle-orm';
import {type PgEnum, type PgTable, getTableConfig} from 'drizzle-orm/pg-core';
import type {PgColumn} from 'drizzle-orm/pg-core';
import postgres, {type Sql as PostgresSql} from 'postgres';
import * as schema from './schema';
import {config} from 'dotenv';
import path from 'path';
import {fileURLToPath} from 'url';

// 加载环境变量（优先使用工作目录的 .env，确保构建后运行时能正确加载）
config({ path: path.resolve(process.cwd(), '.env') });

// 检查环境变量
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

// 创建PostgreSQL连接
const connectionString = process.env.DATABASE_URL;

// 检测数据库类型
const isNeonDatabase = connectionString.includes('neon.tech') || connectionString.includes('neon.database.com');

// 根据数据库类型选择配置
const getDatabaseConfig = () => {
  if (isNeonDatabase) {
    // Neon Database Serverless 优化配置
    return {
      max: 1, // Serverless 环境下每个实例保持最小连接数，利用 Neon 自身的连接池
      idle_timeout: 0, // 立即释放空闲连接，适应 Serverless 的快速冻结特性
      connect_timeout: 10, // Neon 连接速度快，减少超时时间
      max_lifetime: 3600, // 连接最大生命周期（1小时）
      ssl: 'require' as const, // Neon 默认需要 SSL
      prepare: false, // 禁用预处理语句以提高兼容性
      transform: {
        undefined: null, // 将undefined转换为null
      },
      connection: {
        application_name: 'voicehub-app'
      },
      onnotice: process.env.NODE_ENV === 'development' ? console.log : undefined,
      debug: process.env.NODE_ENV === 'development' && process.env.DEBUG_SQL === 'true'
    } as const;
  } else {
    // 标准 PostgreSQL 数据库配置
    const needSsl = connectionString.includes('sslmode=require') || connectionString.includes('ssl=true');
    return {
      max: process.env.NODE_ENV === 'production' ? 10 : 5, // 普通PostgreSQL可以支持更多连接
      idle_timeout: 20, // 增加空闲超时时间
      connect_timeout: 30, // 增加连接超时时间以适应网络延迟
      max_lifetime: 3600, // 连接最大生命周期（1小时）
      ssl: needSsl ? ('require' as const) : false,
      prepare: false, // 禁用预处理语句以提高兼容性
      transform: {
        undefined: null, // 将undefined转换为null
      },
      connection: {
        application_name: 'voicehub-app'
      },
      onnotice: process.env.NODE_ENV === 'development' ? console.log : undefined,
      debug: process.env.NODE_ENV === 'development' && process.env.DEBUG_SQL === 'true'
    } as const;
  }
};

// ============================================================
// Lazy Schema 修复层（Issue #318）
//
// 核心思路：
// 1. 先尝试执行原始查询
// 2. 如果 PG 返回 42P01（relation不存在）/ 42703（column不存在）
//    / 42704（enum type不存在），解析错误信息
// 3. 查询 information_schema/pg_type 确认对象确实不存在
// 4. 根据 schema.ts 生成幂等 DDL 并执行
// 5. 重新执行原始查询
// ============================================================

const IS_DEV = process.env.NODE_ENV === 'development';

// ---------- 开发环境日志工具 ----------
function devLog(prefix: string, ...parts: unknown[]) {
  if (!IS_DEV) return;
  const ts = new Date().toISOString().slice(11, 23);
  console.debug(`[lazy-schema][${ts}][${prefix}]`, ...parts);
}

function devGroup(label: string, fn: () => unknown): unknown {
  if (!IS_DEV) return fn();
  console.group(`[lazy-schema] ${label}`);
  try {
    return fn();
  } finally {
    console.groupEnd();
  }
}

// 表名（SQL 中的）到 PgTable 的反向映射
const tablesByName: Record<string, PgTable> = {};
// 枚举名（SQL 中的）到 PgEnum 的反向映射
const enumsByName: Record<string, PgEnum<any>> = {};

devLog('init', '开始扫描 schema.ts，构建表/枚举映射…');
for (const key of Object.keys(schema)) {
  const value = (schema as any)[key];
  if (!value) continue;
  try {
    // 通过是否存在 Symbol 字段来判断是否是一张表
    if (
      typeof value === 'object' &&
      typeof getTableConfig === 'function' &&
      (value as any)[Symbol.toStringTag] === undefined &&
      value.constructor?.name?.includes('PgTable')
    ) {
      const cfg = getTableConfig(value as PgTable);
      if (cfg && (cfg as any).name) {
        tablesByName[(cfg as any).name] = value as PgTable;
        devLog('init:table', `识别表 "${(cfg as any).name}" (key=${key})`);
        continue;
      }
    }
  } catch (e) { devLog('init:table:err', key, e); }

  // PgEnum 判断：有 enumName 和 values
  if (
    typeof value === 'object' &&
    typeof (value as any).enumName === 'string' &&
    Array.isArray((value as any).values)
  ) {
    enumsByName[(value as any).enumName] = value as PgEnum<any>;
    devLog('init:enum', `识别枚举 "${(value as any).enumName}" (key=${key}), values=`, (value as any).values);
  }
}

// 再做一次兜底扫描：遍历 schema 的值，用 getTableConfig 能成功的认为是表
(function () {
  devLog('init', '开始兜底扫描（getTableConfig 探测）…');
  for (const key of Object.keys(schema)) {
    const value = (schema as any)[key];
    if (!value || typeof value !== 'object') continue;
    try {
      const cfg: any = getTableConfig(value);
      if (cfg && typeof cfg.name === 'string' && !tablesByName[cfg.name]) {
        tablesByName[cfg.name] = value as PgTable;
        devLog('init:fallback:table', `兜底识别表 "${cfg.name}" (key=${key}), 列数=${cfg.columns?.length ?? 0}`);
      }
    } catch (e) { /* ignore */ }
  }
  devLog('init:done', `扫描完成，共 ${Object.keys(tablesByName).length} 张表，${Object.keys(enumsByName).length} 个枚举`);
  if (IS_DEV) {
    console.debug('[lazy-schema][init:done] tables =', Object.keys(tablesByName).sort());
    console.debug('[lazy-schema][init:done] enums  =', Object.keys(enumsByName).sort());
  }
})();

// ---------- DDL 生成器 ----------

function pgTypeOfColumn(col: PgColumn): string {
  // drizzle-orm 的 pg-column 上有 `sqlType`，但它是内部字段。
  // 使用 toString() 得到如 "integer" / "text" / "timestamp" / "uuid" / "varchar(255)" 等
  // 但更稳妥是调用 col.build() 并检查其 sqlType/列定义。这里使用已公开属性的兜底推断。
  try {
    const b: any = (col as any)._;
    if (b?.sqlType) return String(b.sqlType).toUpperCase();
  } catch {}
  // 通过 column 的底层 builder 推断
  const raw: any = col;
  const sqlType: string | undefined = raw.sqlType || raw.columnType;
  if (sqlType) return sqlType.toUpperCase();

  // 兜底：根据列的 JS 类型做粗略推断
  const dataType: string = (raw.dataType || '').toLowerCase();
  switch (dataType) {
    case 'string':
      return 'TEXT';
    case 'number':
      return 'INTEGER';
    case 'boolean':
      return 'BOOLEAN';
    case 'date':
      return 'TIMESTAMP';
    case 'json':
      return 'JSONB';
    case 'bigint':
      return 'BIGINT';
    default:
      return 'TEXT';
  }
}

function buildEnumDDL(enumName: string, values: string[]): string {
  const quoted = values.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ');
  devLog('ddl:enum', `生成枚举 DDL "${enumName}", values=`, values);
  return `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${enumName.replace(/'/g, "''")}') THEN
    CREATE TYPE "${enumName}" AS ENUM (${quoted});
  END IF;
END $$;`;
}

function buildTableDDL(table: PgTable): string {
  const cfg: any = getTableConfig(table);
  const tableName: string = cfg.name;
  const columns: any[] = cfg.columns;
  devLog('ddl:table', `生成建表 DDL "${tableName}", 列数=${columns.length}`);
  // 先确保枚举类型存在（用于列类型依赖）
  const enumPrelude: string[] = [];
  const colClauses: string[] = [];
  const constraints: string[] = [];

  for (const col of columns) {
    const colName: string = col.name;
    let typeName = pgTypeOfColumn(col);
    devLog('ddl:table:col', `  列 "${colName}" → PG type="${typeName}"`);

    // 如果列是 enum 类型，先补全枚举 DDL
    const enumRef: string | undefined = (col as any)._?.enumName || (col as any)._?.type;
    if (enumRef && typeof enumRef === 'string' && enumsByName[enumRef]) {
      const e = enumsByName[enumRef];
      enumPrelude.push(buildEnumDDL((e as any).enumName, (e as any).values));
      typeName = `"${enumRef}"`;
      devLog('ddl:table:col:enum', `  列 "${colName}" 依赖枚举 "${enumRef}"，已排队先建`);
    }
    if (enumRef && typeof enumRef === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(enumRef) && enumsByName[enumRef]) {
      // 已处理
    }

    const notNull: boolean = (col as any).notNull === true;
    // default 处理：常用的 now() / random 文本
    let defaultClause = '';
    const def: any = (col as any).default;
    if (def !== undefined && def !== null) {
      if (typeof def === 'function') {
        // 常见 drizzle defaultNow() 等返回一个 SQL 片段
        const fx = (def as any).name;
        if (fx?.includes('Now') || /now/i.test(String((def as any)?.sql || fx || ''))) {
          defaultClause = ' DEFAULT now()';
        } else {
          defaultClause = '';
        }
      } else if (typeof def === 'string') {
        defaultClause = ` DEFAULT '${def.replace(/'/g, "''")}'`;
      } else if (typeof def === 'number' || typeof def === 'boolean') {
        defaultClause = ` DEFAULT ${String(def)}`;
      }
      devLog('ddl:table:col:default', `  列 "${colName}" default=`, defaultClause || '(无)');
    }

    let clause = `"${colName}" ${typeName}${notNull ? ' NOT NULL' : ''}${defaultClause}`;
    if ((col as any).primary === true) {
      clause += ' PRIMARY KEY';
      devLog('ddl:table:col:pk', `  列 "${colName}" 标记为主键`);
    }
    colClauses.push(clause);
  }

  // 复合唯一约束
  if (Array.isArray(cfg.indexes) || Array.isArray(cfg.constraints)) {
    const constraintsList: any[] = cfg.constraints || [];
    for (const c of constraintsList) {
      if (c?.constructor?.name?.includes('UniqueConstraint') || (c as any)?.name?.includes('unique')) {
        const names: string[] = Array.isArray((c as any).columns)
          ? (c as any).columns.map((cx: any) => `"${cx.name || cx}"`)
          : [];
        if (names.length) {
          constraints.push(`UNIQUE (${names.join(', ')})`);
          devLog('ddl:table:constraint', `  生成唯一约束 UNIQUE(${names.join(', ')})`);
        }
      }
    }
  }

  const body = [...colClauses, ...constraints].join(',\n  ');
  const createTable = `CREATE TABLE IF NOT EXISTS "${tableName}" (\n  ${body}\n);`;
  devLog('ddl:table:done', `DDL 生成完毕 "${tableName}"，输出长度=${createTable.length} 字符`);
  devLog('ddl:table:sql', createTable);

  return [...enumPrelude, createTable].join('\n');
}

function buildAddColumnDDL(table: PgTable, columnName: string): string {
  const cfg: any = getTableConfig(table);
  const columns: any[] = cfg.columns;
  devLog('ddl:column', `生成 ADD COLUMN DDL "${cfg.name}"."${columnName}"`);
  const col = columns.find((c: any) => c.name === columnName);
  if (!col) {
    devLog('ddl:column:miss', `列 "${columnName}" 在 schema.ts 中未找到，无法生成 DDL`);
    return '';
  }

  let typeName = pgTypeOfColumn(col);
  const enumRef: string | undefined = (col as any)._?.enumName;
  if (enumRef && typeof enumRef === 'string' && enumsByName[enumRef]) {
    typeName = `"${enumRef}"`;
    devLog('ddl:column:enum', `列 "${columnName}" 依赖枚举 "${enumRef}"`);
  }

  const notNull: boolean = (col as any).notNull === true;
  let defaultClause = '';
  const def: any = (col as any).default;
  if (def !== undefined && def !== null) {
    if (typeof def === 'function') {
      defaultClause = ' DEFAULT now()';
    } else if (typeof def === 'string') {
      defaultClause = ` DEFAULT '${def.replace(/'/g, "''")}'`;
    } else if (typeof def === 'number' || typeof def === 'boolean') {
      defaultClause = ` DEFAULT ${String(def)}`;
    }
  }
  const nullClause = notNull ? ' NOT NULL' : '';
  const ddl = `ALTER TABLE IF EXISTS "${cfg.name}" ADD COLUMN IF NOT EXISTS "${columnName}" ${typeName}${defaultClause}${nullClause};`;
  devLog('ddl:column:done', ddl);
  return ddl;
}

// ---------- 元数据检查 ----------

async function relationExists(sql: PostgresSql, name: string): Promise<boolean> {
  devLog('meta:table', `查询 information_schema.tables: table_name="${name}"`);
  try {
    const r = await sql`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = ${name}) AS exists_`;
    const exists = (r as any)[0]?.exists_ === true;
    devLog('meta:table', `  → ${exists ? '存在 ✓' : '不存在 ✗'} "${name}"`);
    return exists;
  } catch (e) {
    devLog('meta:table:err', `查询表是否存在失败 "${name}":`, e);
    return false;
  }
}

async function columnExists(sql: PostgresSql, tableName: string, columnName: string): Promise<boolean> {
  devLog('meta:column', `查询 information_schema.columns: table="${tableName}", column="${columnName}"`);
  try {
    const r = await sql`
      SELECT EXISTS(
        SELECT 1 FROM information_schema.columns
        WHERE table_name = ${tableName} AND column_name = ${columnName}
      ) AS exists_`;
    const exists = (r as any)[0]?.exists_ === true;
    devLog('meta:column', `  → ${exists ? '存在 ✓' : '不存在 ✗'} "${tableName}"."${columnName}"`);
    return exists;
  } catch (e) {
    devLog('meta:column:err', `查询列是否存在失败 "${tableName}"."${columnName}":`, e);
    return false;
  }
}

async function enumTypeExists(sql: PostgresSql, typeName: string): Promise<boolean> {
  devLog('meta:enum', `查询 pg_type: typname="${typeName}"`);
  try {
    const r = await sql`SELECT EXISTS(SELECT 1 FROM pg_type WHERE typname = ${typeName}) AS exists_`;
    const exists = (r as any)[0]?.exists_ === true;
    devLog('meta:enum', `  → ${exists ? '存在 ✓' : '不存在 ✗'} "${typeName}"`);
    return exists;
  } catch (e) {
    devLog('meta:enum:err', `查询枚举是否存在失败 "${typeName}":`, e);
    return false;
  }
}

// ---------- 错误解析与修复 ----------

type ParsedError =
  | { kind: 'relation'; name: string }
  | { kind: 'column'; relation: string; column: string }
  | { kind: 'type'; name: string }
  | { kind: 'unknown' };

function parsePgError(err: any): ParsedError {
  const code: string | undefined = err?.code ?? err?.sqlstate;
  const msg: string = (err?.message || err?.msg || '').toString();
  devLog('error:parse', `收到 PG 错误: code=${code}, msg="${msg.slice(0, 200)}"`);

  if (code === '42P01' || /relation .+ does not exist/i.test(msg)) {
    const m = msg.match(/relation\s+"([^"]+)"\s+does not exist/i);
    if (m) {
      const result = { kind: 'relation' as const, name: m[1] };
      devLog('error:parse', `  → 解析为 relation "${m[1]}" (PG 42P01)`);
      return result;
    }
  }
  if (code === '42703' || /column .+ of relation .+ does not exist/i.test(msg)) {
    const m = msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"([^"]+)"\s+does not exist/i);
    if (m) {
      const result = { kind: 'column' as const, column: m[1], relation: m[2] };
      devLog('error:parse', `  → 解析为 column "${m[2]}"."${m[1]}" (PG 42703)`);
      return result;
    }
  }
  if (code === '42704' || /type .+ does not exist/i.test(msg)) {
    const m = msg.match(/type\s+"([^"]+)"\s+does not exist/i);
    if (m) {
      const result = { kind: 'type' as const, name: m[1] };
      devLog('error:parse', `  → 解析为 type "${m[1]}" (PG 42704)`);
      return result;
    }
  }
  devLog('error:parse', '  → 无法识别，未知错误类型');
  return { kind: 'unknown' };
}

const repairInProgress = new Set<string>();

async function tryRepair(rawClient: PostgresSql, parsed: ParsedError): Promise<boolean> {
  if (parsed.kind === 'unknown') return false;

  // 1) 修复缺失枚举类型
  if (parsed.kind === 'type') {
    devLog('repair:start:type', `尝试修复枚举类型 "${parsed.name}"`);
    const e = enumsByName[parsed.name];
    if (!e) {
      devLog('repair:skip:type', `枚举 "${parsed.name}" 在 schema.ts 中未注册，跳过`);
      return false;
    }
    const key = `type:${parsed.name}`;
    if (repairInProgress.has(key)) {
      devLog('repair:skip:type:concurrent', `枚举 "${parsed.name}" 正在被其他修复任务处理，跳过`);
      return false;
    }
    repairInProgress.add(key);
    try {
      const exists = await enumTypeExists(rawClient, parsed.name);
      if (exists) {
        devLog('repair:skip:type:exists', `枚举 "${parsed.name}" 数据库中已存在，无需修复`);
        return true;
      }
      const ddl = buildEnumDDL((e as any).enumName, (e as any).values);
      devLog('repair:exec:type', `执行枚举 DDL "${parsed.name}"`);
      await rawClient.unsafe(ddl);
      devLog('repair:ok:type', `枚举 "${parsed.name}" 创建成功 ✓`);
      return true;
    } catch (err) {
      devLog('repair:fail:type', `修复枚举 "${parsed.name}" 失败 ✗:`, (err as any)?.message || err);
      return false;
    } finally {
      repairInProgress.delete(key);
    }
  }

  // 2) 修复缺失表
  if (parsed.kind === 'relation') {
    devLog('repair:start:table', `尝试修复表 "${parsed.name}"`);
    const table = tablesByName[parsed.name];
    if (!table) {
      devLog('repair:skip:table', `表 "${parsed.name}" 在 schema.ts 中未注册，跳过`);
      return false;
    }
    const key = `table:${parsed.name}`;
    if (repairInProgress.has(key)) {
      devLog('repair:skip:table:concurrent', `表 "${parsed.name}" 正在被其他修复任务处理，跳过`);
      return false;
    }
    repairInProgress.add(key);
    try {
      const exists = await relationExists(rawClient, parsed.name);
      if (exists) {
        devLog('repair:skip:table:exists', `表 "${parsed.name}" 数据库中已存在，无需修复`);
        return true;
      }
      const ddl = buildTableDDL(table);
      devLog('repair:exec:table', `执行建表 DDL "${parsed.name}"（${ddl.length} 字符）`);
      await rawClient.unsafe(ddl);
      devLog('repair:ok:table', `表 "${parsed.name}" 创建成功 ✓`);
      return true;
    } catch (err) {
      devLog('repair:fail:table', `修复表 "${parsed.name}" 失败 ✗:`, (err as any)?.message || err);
      return false;
    } finally {
      repairInProgress.delete(key);
    }
  }

  // 3) 修复缺失列
  if (parsed.kind === 'column') {
    devLog('repair:start:column', `尝试修复列 "${parsed.relation}"."${parsed.column}"`);
    const table = tablesByName[parsed.relation];
    if (!table) {
      devLog('repair:skip:column', `表 "${parsed.relation}" 在 schema.ts 中未注册，跳过`);
      return false;
    }
    const key = `col:${parsed.relation}.${parsed.column}`;
    if (repairInProgress.has(key)) {
      devLog('repair:skip:column:concurrent', `列 "${parsed.relation}"."${parsed.column}" 正在被其他修复任务处理，跳过`);
      return false;
    }
    repairInProgress.add(key);
    try {
      const exists = await columnExists(rawClient, parsed.relation, parsed.column);
      if (exists) {
        devLog('repair:skip:column:exists', `列 "${parsed.relation}"."${parsed.column}" 数据库中已存在，无需修复`);
        return true;
      }
      const ddl = buildAddColumnDDL(table, parsed.column);
      if (!ddl) {
        devLog('repair:skip:column:ddl', `无法生成列 "${parsed.relation}"."${parsed.column}" 的 DDL，跳过`);
        return false;
      }
      devLog('repair:exec:column', `执行 ADD COLUMN DDL "${parsed.relation}"."${parsed.column}"`);
      await rawClient.unsafe(ddl);
      devLog('repair:ok:column', `列 "${parsed.relation}"."${parsed.column}" 添加成功 ✓`);
      return true;
    } catch (err) {
      devLog('repair:fail:column', `修复列 "${parsed.relation}"."${parsed.column}" 失败 ✗:`, (err as any)?.message || err);
      return false;
    } finally {
      repairInProgress.delete(key);
    }
  }

  return false;
}

// ---------- 包装 client ----------

function summarizeArgs(args: any[]): string {
  const summary = args.map(a => {
    if (typeof a === 'string') return a.length > 80 ? a.slice(0, 80) + '…' : a;
    if (Buffer.isBuffer(a)) return `<Buffer ${a.length}b>`;
    return String(a).slice(0, 80);
  });
  return summary.length > 2 ? summary.slice(0, 2).join(', ') + ', …' : summary.join(', ');
}

function wrapClientWithLazySchema(rawClient: PostgresSql): PostgresSql {
  // 拦截以模板字符串形式调用的 `client\`...\``
  const handler: ProxyHandler<PostgresSql> = {
    get(target: any, prop: string | symbol, receiver: any) {
      devLog('proxy:get', `访问属性 "${String(prop)}"`);
      const original = Reflect.get(target, prop, receiver);
      if (typeof original !== 'function') return original;

      // 这些方法返回实际结果/承诺，我们拦截它们的返回值以处理错误
      return function (this: any, ...args: any[]) {
        devLog('proxy:call', `调用 ${String(prop)}(${summarizeArgs(args)})`);
        const result = original.apply(this === receiver ? target : this, args);

        // 主要拦截异步方法：unsafe / file / begin / transaction 等
        if (result && typeof result.then === 'function') {
          return result.catch(async (err: any) => {
            devLog('proxy:catch', `${String(prop)} 抛出错误，尝试自动修复…`);
            const parsed = parsePgError(err);
            if (parsed.kind === 'unknown') {
              devLog('proxy:throw', `无法识别错误类型，直接抛出`);
              throw err;
            }

            const repaired = await tryRepair(rawClient, parsed);
            if (!repaired) {
              devLog('proxy:throw', `修复失败，直接抛出原始错误`);
              throw err;
            }

            // 再次尝试
            devLog('proxy:retry', `修复成功，重试 ${String(prop)}(…)`);
            return original.apply(this === receiver ? target : this, args);
          });
        }

        // 模板标签函数 `sql` 返回的也是 Promise-like，使用 apply 调用
        return result;
      };
    },
    apply(target: any, thisArg: any, args: any[]) {
      devLog('proxy:apply', `模板标签调用 args=`, args);
      const result = target.apply(thisArg, args);
      if (result && typeof result.then === 'function') {
        return result.catch(async (err: any) => {
          devLog('proxy:apply:catch', `模板标签查询抛出错误，尝试自动修复…`);
          const parsed = parsePgError(err);
          if (parsed.kind === 'unknown') throw err;
          const repaired = await tryRepair(rawClient, parsed);
          if (!repaired) throw err;
          devLog('proxy:apply:retry', `修复成功，重试模板标签查询`);
          return target.apply(thisArg, args);
        });
      }
      return result;
    },
  };

  // 先把 client 转成可被 apply 拦截的函数：使用 `new Proxy` 并同时作为函数对象
  // postgres 的返回值本身就是一个函数（模板标签），Proxy 可以直接代理它。
  return new Proxy(rawClient, handler) as PostgresSql;
}

// ============================================================
// 主 client / db 实例
// ============================================================

const rawClient = postgres(connectionString, getDatabaseConfig());
const client: PostgresSql = wrapClientWithLazySchema(rawClient);

// 创建Drizzle数据库实例
export const db: PostgresJsDatabase<typeof schema> = drizzle(client, { schema });

// 导出连接客户端（用于手动查询或关闭连接）
export { client };

// 供调试：暴露 schema 映射
export const __lazySchemaTables = tablesByName;
export const __lazySchemaEnums = enumsByName;

// 导出schema以便在其他地方使用
export * from './schema';

// 导出drizzle-orm函数
export {eq, ne, and, gt, gte, lt, lte, count, exists, desc, asc, or, sql};

// 数据库连接测试函数
export async function testConnection() {
  try {
    await client`SELECT 1`;
    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

// 获取数据库连接状态
export function getConnectionStatus() {
  const isConnected = !(rawClient as any).ended;

  return {
    isConnected,
    connected: isConnected,
    status: isConnected ? 'connected' : 'disconnected',
    maxConnections: (rawClient as any).options.max,
    idleTimeout: (rawClient as any).options.idle_timeout,
    connectTimeout: (rawClient as any).options.connect_timeout
  };
}

// 连接管理 - 根据数据库类型自适应
let idleTimer: NodeJS.Timeout | null = null;
// Neon 数据库使用更短的空闲时间以支持自动启停，普通 PostgreSQL 使用更长的空闲时间
const IDLE_TIMEOUT = isNeonDatabase ? 5 * 60 * 1000 : 10 * 60 * 1000; // Neon: 5分钟，PostgreSQL: 10分钟

// 重置空闲计时器
function resetIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  
  // 只在生产环境启用自动断开
  if (process.env.NODE_ENV === 'production') {
    idleTimer = setTimeout(async () => {
      try {
        if (!(rawClient as any).ended) {
          const dbType = isNeonDatabase ? 'Neon' : 'PostgreSQL';
          console.log(`🔄 Auto-closing idle ${dbType} database connections${isNeonDatabase ? ' for Serverless optimization' : ''}`);
          await (rawClient as any).end({ timeout: isNeonDatabase ? 5 : 10 });
        }
      } catch (error) {
        console.error('❌ Error during auto-close:', error);
      }
    }, IDLE_TIMEOUT);
  }
}

// 包装数据库操作以支持自动启停
export function withAutoReconnect<T extends any[], R>(
  operation: (...args: T) => Promise<R>
) {
  return async (...args: T): Promise<R> => {
    resetIdleTimer();
    
    try {
      return await operation(...args);
    } catch (error: any) {
      // 如果连接已关闭，记录信息
      if (error?.code === 'CONNECTION_ENDED' || (rawClient as any).ended) {
        const dbType = isNeonDatabase ? 'Neon' : 'PostgreSQL';
        console.log(`🔄 ${dbType} database connection ended${isNeonDatabase ? ', Neon will auto-reconnect on next query' : ', will reconnect on next query'}`);
      }
      throw error;
    }
  };
}

// 优雅关闭数据库连接
export async function closeConnection() {
  try {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    
    if (!(rawClient as any).ended) {
      await (rawClient as any).end({ timeout: 10 });
      console.log('✅ Database connection closed gracefully');
    }
  } catch (error) {
    console.error('❌ Error closing database connection:', error);
  }
}

// 设置优雅关闭处理
if (typeof process !== 'undefined') {
  const gracefulShutdown = async () => {
    console.log('🔄 Shutting down database connections...');
    await closeConnection();
  };
  
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
  process.on('beforeExit', gracefulShutdown);
}
