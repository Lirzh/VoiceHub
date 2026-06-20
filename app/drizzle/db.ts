import {drizzle} from 'drizzle-orm/postgres-js';
import {and, asc, count, desc, eq, exists, gt, gte, lt, lte, ne, or, sql} from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.ts';
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
      ssl: 'require', // Neon 默认需要 SSL
      prepare: false, // 禁用预处理语句以提高兼容性
      transform: {
        undefined: null, // 将undefined转换为null
      },
      connection: {
        application_name: 'voicehub-app'
      },
      onnotice: process.env.NODE_ENV === 'development' ? console.log : undefined,
      debug: process.env.NODE_ENV === 'development' && process.env.DEBUG_SQL === 'true'
    };
  } else {
    // 标准 PostgreSQL 数据库配置
    return {
      max: process.env.NODE_ENV === 'production' ? 10 : 5, // 普通PostgreSQL可以支持更多连接
      idle_timeout: 20, // 增加空闲超时时间
      connect_timeout: 30, // 增加连接超时时间以适应网络延迟
      max_lifetime: 3600, // 连接最大生命周期（1小时）
      ssl: connectionString.includes('sslmode=require') || connectionString.includes('ssl=true') ? 'require' : false,
      prepare: false, // 禁用预处理语句以提高兼容性
      transform: {
        undefined: null, // 将undefined转换为null
      },
      connection: {
        application_name: 'voicehub-app'
      },
      onnotice: process.env.NODE_ENV === 'development' ? console.log : undefined,
      debug: process.env.NODE_ENV === 'development' && process.env.DEBUG_SQL === 'true'
    };
  }
};

const rawClient = postgres(connectionString, getDatabaseConfig());

// ─── lazy schema 自动修复（mkdir -p 风格）─────────────────────────────
// 任何一次数据库查询，若遇到 schema 缺失类错误（缺表 / 缺列 / 缺枚举），
// 当场分析缺少什么，生成并执行精确的 CREATE / ALTER SQL，
// 然后把失败的查询重试一次。
//
// PostgreSQL 错误码：
//   42P01  relation does not exist
//   42703  column does not exist
//   42704  type does not exist
//
// 幂等性：由 drizzle push 本身保证 —— push 本身是幂等的，
// 重复触发不会有副作用。冷却期（60 秒）仅用于避免同一进程内
// 短时间内重复调用。
// ──────────────────────────────────────────────────────────────────────

// ── Drizzle schema 内省：从 schema.ts 提取列/枚举定义 ──────────────────
//
// 完全基于 Drizzle 列对象的公开属性，不猜内部结构：
//   col.name          → 列名（来自 pgTable('x', { myCol: text('myCol') }) 中的 'myCol'）
//   col.getSQLType()  → SQL 类型（serial / integer / text / boolean / timestamp / uuid / ...）
//   col.notNull       → NOT NULL
//   col.primary       → 是否主键
//   col.hasDefault    → 是否有默认值（注意：.primaryKey().defaultRandom() 的 serial 列会为 true）
//   col.default       → 默认值表达式：可能是 SQL 对象、字面量、或零参函数
//
// 枚举通过 schema 导出的 pgEnum 实例读取：
//   enumObj.enumName  → 枚举类型名（如 'user_status'）
//   enumObj.values    → 枚举值数组（如 ['active', 'withdrawn', 'graduate']）
// ──────────────────────────────────────────────────────────────────────

function sqlExprToString(expr: any): string | null {
  if (expr === undefined || expr === null) return null;
  // 是 SQL 表达式对象（sql`now()` 等），尝试字符串化
  if (typeof expr === 'object') {
    if (typeof expr.getSQL === 'function') return expr.getSQL();
    // 某些版本暴露 queryChunks，例如 [ { type: 'raw', chunk: 'now()' } ]
    if (Array.isArray((expr as any).queryChunks)) {
      return (expr as any).queryChunks
        .map((c: any) => (c && c.chunk ? String(c.chunk) : c && c.sql ? String(c.sql) : String(c)))
        .join(' ');
    }
    // 暴露的 SQL 对象本身可能有 toString / sql 属性
    if (typeof expr.toString === 'function' && expr.toString !== Object.prototype.toString) {
      const s = expr.toString();
      if (s !== '[object Object]') return s;
    }
    if (typeof (expr as any).sql === 'string') return (expr as any).sql;
    return null;
  }
  // 是字面量
  if (typeof expr === 'string') return `'${expr.replace(/'/g, "''")}'`;
  if (typeof expr === 'boolean' || typeof expr === 'number') return String(expr);
  return null;
}

function resolveDefault(col: any): string | null {
  if (!col) return null;
  // Drizzle 列对象未声明默认值 → 不生成 DEFAULT 子句
  if (col.hasDefault === false && col.default === undefined) return null;

  const d = col.default;

  // --- 1) SQL 表达式对象（.defaultNow() → sql`now()`, .defaultRandom() → sql`gen_random_uuid()`）
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    const exprStr = sqlExprToString(d);
    if (exprStr) return exprStr;
    // 兜底：对象 toString
    const s = d.toString?.();
    if (s && s !== '[object Object]') return s;
  }

  // --- 2) 字面量（字符串 / 布尔 / 数字）
  if (typeof d === 'string') return `'${d.replace(/'/g, "''")}'`;
  if (typeof d === 'boolean' || typeof d === 'number') return String(d);

  // --- 3) 函数：.default(() => 'x') / .default(Math.random) 等
  //   → 应用层动态默认值，不在数据库层声明 DEFAULT，留给 Drizzle INSERT 时计算
  //   → 返回 null，后续生成 SQL 时不加 DEFAULT 子句
  if (typeof d === 'function') return null;

  // --- 4) serial 主键有隐式 nextval 默认值
  const type = typeof col.getSQLType === 'function' ? col.getSQLType() : '';
  if (type === 'serial') return `nextval('"${col.name ?? ''}_seq"'::regclass)`;

  return null;
}

function getColumnDef(col: any): { pgType: string; notNull: boolean; default: string | null; isSerial: boolean; isUuid: boolean } {
  const type: string = typeof col.getSQLType === 'function' ? col.getSQLType() : 'text';

  // 映射 Drizzle 类型 → PostgreSQL 类型
  let pgType = type;
  let isSerial = false;
  let isUuid = false;

  if (type === 'serial') {
    pgType = 'serial';
    isSerial = true;
  } else if (type === 'uuid') {
    pgType = 'uuid';
    isUuid = true;
  } else if (type === 'integer') {
    pgType = 'integer';
  } else if (type === 'boolean') {
    pgType = 'boolean';
  } else if (type === 'text') {
    pgType = 'text';
  } else if (type === 'timestamp' || type === 'timestamp without time zone') {
    pgType = 'timestamp';
  } else if (type === 'timestamp with time zone' || type === 'timestamptz') {
    pgType = 'timestamptz';
  } else if (type === 'bigint') {
    pgType = 'bigint';
  } else if (type.startsWith('varchar')) {
    pgType = type;
  } else if (type.startsWith('character varying')) {
    pgType = type.replace('character varying', 'varchar');
  }

  const defaultStr = resolveDefault(col);
  const notNull = !!col.notNull || !!col.primary;

  return { pgType, notNull, default: defaultStr, isSerial, isUuid };
}

function getEnumType(col: any): string | null {
  // 枚举列的 getSQLType() 返回枚举类型名（如 "user_status"），或可以从列对象上直接读
  const type = typeof col.getSQLType === 'function' ? col.getSQLType() : '';
  if (type && schemaEnums.has(type)) return type;
  // 退一步：从 schema 导出的枚举实例中查找，若列对象引用了某个枚举
  for (const [enumName] of schemaEnums) {
    // 列名或类型名中包含枚举名，认为是该枚举
    if (type === enumName || type.includes(enumName)) return enumName;
  }
  return null;
}

function getTableColumns(table: any): { colName: string; def: ReturnType<typeof getColumnDef>; enumType: string | null }[] {
  const result: { colName: string; def: ReturnType<typeof getColumnDef>; enumType: string | null }[] = [];
  const entries = Object.entries(table);
  for (const [key, col] of entries) {
    if (!col || typeof col !== 'object') continue;
    if (key === '$inferSelect' || key === '$inferInsert' || key.startsWith('$')) continue;
    const def = getColumnDef(col);
    const enumType = getEnumType(col);
    // 列名从 builder config 中取（如 timestamp('createdAt') → createdAt）
    const colName: string = (col as any).name ?? (col as any).fieldName ?? key;
    result.push({ colName, def, enumType });
  }
  return result;
}

// ── 核心表 / 枚举定义映射 ─────────────────────────────────────────────

// 从 schema.ts 导出中提取所有 pgTable → { tableName, columns }
type TableInfo = { tableName: string; columns: { colName: string; pgType: string; notNull: boolean; default: string | null; isSerial: boolean; isUuid: boolean; enumType: string | null }[] };
type EnumInfo = { name: string; values: string[] };

function buildSchemaMaps(): { tables: Map<string, TableInfo>; enums: Map<string, EnumInfo> } {
  const tables = new Map<string, TableInfo>();
  const enums = new Map<string, EnumInfo>();

  for (const [, val] of Object.entries<any>(schema)) {
    if (!val) continue;
    // 枚举
    if (val.enumName && Array.isArray(val.values)) {
      enums.set(val.enumName, { name: val.enumName, values: val.values });
      continue;
    }
    // 表
    const tableName: string = val.dbName ?? val?.name;
    if (!tableName || typeof tableName !== 'string') continue;
    if (val[Symbol.toStringTag] === 'PgEnum' || !val[Symbol.for?.('drizzle::Column') ?? '']) continue;

    const cols = getTableColumns(val);
    if (cols.length > 0) {
      tables.set(tableName, { tableName, columns: cols });
    }
  }

  return { tables, enums };
}

const { tables: schemaTables, enums: schemaEnums } = buildSchemaMaps();

// ── SQL 生成器 ────────────────────────────────────────────────────────

function buildCreateTableSql(info: TableInfo): string {
  const colDefs = info.columns.map(({ colName, def, enumType }) => {
    let type = enumType ?? def.pgType;
    if (def.isSerial) type = 'serial';
    else if (def.isUuid && def.default === 'gen_random_uuid()') type = 'uuid';

    let parts = [`"${colName}"`, type];
    if (def.default) parts.push(`DEFAULT ${def.default}`);
    if (def.notNull && !def.isSerial) parts.push('NOT NULL');
    return parts.join(' ');
  });

  // 主键
  const pkCol = info.columns.find((c) => c.def.isSerial || c.def.isUuid);
  if (pkCol) {
    colDefs.push(`PRIMARY KEY ("${pkCol.colName}")`);
  }

  return `CREATE TABLE "${info.tableName}" (${colDefs.join(', ')})`;
}

function buildAlterTableSql(tableName: string, colName: string, def: ReturnType<typeof getColumnDef>, enumType: string | null): string {
  let type = enumType ?? def.pgType;
  let parts: string[] = [`"${tableName}"`, 'ADD COLUMN', `"${colName}"`, type];
  if (def.default) parts.push(`DEFAULT ${def.default}`);
  if (def.notNull && def.default) parts.push('NOT NULL');
  // 对于有默认值但无 NOT NULL 的列，先 ADD COLUMN，再（如果需要 NOT NULL）ALTER SET NOT NULL
  const alterParts = [`ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${colName}" ${type}`];
  if (def.default) alterParts.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" SET DEFAULT ${def.default}`);
  if (def.notNull && def.default) {
    alterParts.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" SET NOT NULL`);
  } else if (!def.notNull) {
    alterParts.push(`ALTER TABLE "${tableName}" ALTER COLUMN "${colName}" DROP NOT NULL`);
  }
  return alterParts.join('; ');
}

function buildCreateTypeSql(info: EnumInfo): string {
  const vals = info.values.map((v) => `'${v}'`).join(', ');
  return `CREATE TYPE "${info.name}" AS ENUM (${vals})`;
}

// ── 错误解析 ──────────────────────────────────────────────────────────

function parseRelationError(msg: string): { kind: 'table'; table: string } | null {
  // relation "User" does not exist
  const m = msg.match(/relation\s+"([^"]+)"/i);
  if (m) return { kind: 'table', table: m[1] };
  return null;
}

function parseColumnError(msg: string): { kind: 'column'; table: string; column: string } | null {
  // column "emailVerified" of relation "User" does not exist
  const m = msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"([^"]+)"/i);
  if (m) return { kind: 'column', table: m[2], column: m[1] };
  return null;
}

function parseTypeError(msg: string): { kind: 'type'; type: string } | null {
  // type "user_status" does not exist
  const m = msg.match(/type\s+"([^"]+)"/i);
  if (m) return { kind: 'type', type: m[1] };
  return null;
}

// ── 冷却控制 ──────────────────────────────────────────────────────────

let schemaFixInProgress: Promise<void> | null = null;
let schemaFixLastDoneAt = 0;
const SCHEMA_FIX_COOLDOWN_MS = 60 * 1000;

// ── 执行一次 schema 修复 ──────────────────────────────────────────────

async function applySchemaFix(err: any): Promise<boolean> {
  const msg: string = err?.message ?? '';
  const code: string = err?.code ?? '';

  const relationErr = parseRelationError(msg);
  const columnErr = parseColumnError(msg);
  const typeErr = code === '42704' || msg.includes('type') ? parseTypeError(msg) : null;

  if (!relationErr && !columnErr && !typeErr) return false;

  // 等待同进程内的其他修复完成
  if (schemaFixInProgress) {
    await schemaFixInProgress;
    return true; // 另一个已完成，假设修好了
  }

  schemaFixInProgress = (async () => {
    try {
      if (typeErr) {
        const info = schemaEnums.get(typeErr.type);
        if (info) {
          console.log(`🔧 创建缺失的枚举类型: ${typeErr.type}`);
          await rawClient.unsafe(buildCreateTypeSql(info));
          console.log(`✅ 枚举 ${typeErr.type} 创建完成`);
        }
      }

      if (relationErr) {
        const info = schemaTables.get(relationErr.table);
        if (info) {
          console.log(`🔧 创建缺失的表: ${relationErr.table}`);
          await rawClient.unsafe(buildCreateTableSql(info));
          console.log(`✅ 表 ${relationErr.table} 创建完成`);
        }
      }

      if (columnErr) {
        const tableInfo = schemaTables.get(columnErr.table);
        if (tableInfo) {
          const colInfo = tableInfo.columns.find((c) => c.colName === columnErr.column);
          if (colInfo) {
            console.log(`🔧 为表 ${columnErr.table} 添加缺失的列: ${columnErr.column}`);
            await rawClient.unsafe(buildAlterTableSql(columnErr.table, columnErr.column, colInfo.def, colInfo.enumType));
            console.log(`✅ 列 ${columnErr.column} 添加完成`);
          }
        }
      }

      schemaFixLastDoneAt = Date.now();
    } catch (e: any) {
      console.warn('⚠️ schema 修复失败：', e?.message ?? e);
    } finally {
      schemaFixInProgress = null;
    }
  })();

  await schemaFixInProgress;
  return true;
}

// ── Promise 包装：捕获 schema 错误 → 修复 → 重试 ─────────────────────

function wrapThenable(promise: any, retry: () => Promise<any>): any {
  if (!promise || typeof promise.then !== 'function') return promise;
  return (async () => {
    try {
      return await promise;
    } catch (err: any) {
      const now = Date.now();
      const code: string = err?.code ?? '';
      const isSchemaErr = ['42P01', '42703', '42704'].includes(code);
      const cooled = now - schemaFixLastDoneAt >= SCHEMA_FIX_COOLDOWN_MS;

      if (isSchemaErr && cooled) {
        const fixed = await applySchemaFix(err);
        if (fixed) return await retry();
      }
      throw err;
    }
  })();
}

// 用 Proxy 包装 rawClient：保留所有行为，只在查询失败时注入修复逻辑
const client = new Proxy(rawClient as any, {
  apply(target, _thisArg, args) {
    const result = target(...args);
    return wrapThenable(result, () => target(...args));
  },
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value === 'function') {
      return function (this: any, ...args: any[]) {
        const result = value.apply(target, args);
        return wrapThenable(result, () => value.apply(target, args));
      };
    }
    return value;
  }
}) as ReturnType<typeof postgres>;

// 创建Drizzle数据库实例
export const db = drizzle(client, { schema });

// 导出连接客户端（用于手动查询或关闭连接）
export { client };

// 导出schema以便在其他地方使用
export * from './schema.ts';

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
  const isConnected = !client.ended;

  return {
    isConnected,
    connected: isConnected,
    status: isConnected ? 'connected' : 'disconnected',
    maxConnections: client.options.max,
    idleTimeout: client.options.idle_timeout,
    connectTimeout: client.options.connect_timeout
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
        if (!client.ended) {
          const dbType = isNeonDatabase ? 'Neon' : 'PostgreSQL';
          console.log(`🔄 Auto-closing idle ${dbType} database connections${isNeonDatabase ? ' for Serverless optimization' : ''}`);
          await client.end({ timeout: isNeonDatabase ? 5 : 10 });
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
      if (error?.code === 'CONNECTION_ENDED' || client.ended) {
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

    if (!client.ended) {
      await client.end({ timeout: 10 });
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
