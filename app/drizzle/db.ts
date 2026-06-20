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
// 当场调用 drizzle-kit push 补齐，然后把失败的查询**重试一次**。
//
// PostgreSQL 错误码（本模块关心的）：
//   42P01  relation does not exist （缺表）
//   42703  column does not exist    （缺列）
//   42704  type does not exist      （缺枚举类型）
//
// 关于默认值（DEFAULT / NOT NULL）：
//   drizzle-kit push 在补齐列时自动生成：
//     ALTER TABLE "Table" ADD COLUMN "col" TIMESTAMP DEFAULT now() NOT NULL
//   并用该默认值 UPDATE 已存在的行。因此用户代码中的
//   .defaultNow() / .default('USER') / .default(false) / .default(true)
//   在"缺列 → 补齐 → 重试"的链路里是安全的，无需手写 SQL。
//
// 幂等性：drizzle-kit push 本身幂等 —— schema 已对齐时什么都不做，
// 因此重复触发不会有副作用。为避免性能浪费，修复完成后的 60 秒内不再
// 重复调用 push（冷却期）。
// ──────────────────────────────────────────────────────────────────────

let schemaSyncInProgress: Promise<void> | null = null;
let schemaSyncLastDoneAt = 0;
const SCHEMA_SYNC_COOLDOWN_MS = 60 * 1000; // 60 秒

async function syncSchemaNow(): Promise<void> {
  const now = Date.now();
  if (now - schemaSyncLastDoneAt < SCHEMA_SYNC_COOLDOWN_MS) return;
  if (schemaSyncInProgress) return schemaSyncInProgress;

  schemaSyncInProgress = (async () => {
    try {
      const { execFileSync } = await import('node:child_process');
      const configPath = path.resolve(process.cwd(), 'drizzle.config.ts');
      console.log('🔧 检测到 schema 缺失，执行 drizzle-kit push 自动修复...');
      execFileSync(
        process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
        ['exec', 'drizzle-kit', 'push', '--config', configPath],
        {
          stdio: ['ignore', process.stdout, process.stderr],
          env: {
            ...process.env,
            CI: 'true',
            DRIZZLE_KIT_FORCE: 'true',
            DRIZZLE_KIT_NON_INTERACTIVE: 'true'
          },
          timeout: 120_000
        }
      );
      console.log('✅ schema 自动修复完成');
      schemaSyncLastDoneAt = Date.now();
    } catch (e: any) {
      console.warn('⚠️ schema 自动修复失败（下一次遇到 schema 错误将再次尝试）：', e?.message ?? e);
    } finally {
      schemaSyncInProgress = null;
    }
  })();

  return schemaSyncInProgress;
}

async function tryFixSchema(err: any): Promise<boolean> {
  const code: string | undefined = err?.code;
  if (!['42P01', '42703', '42704'].includes(code || '')) return false;
  await syncSchemaNow();
  return Date.now() - schemaSyncLastDoneAt < SCHEMA_SYNC_COOLDOWN_MS; // 真的完成过才算修复成功
}

// 包装 Promise：await 时捕获 schema 错误并重试
function wrapThenable(promise: any, retry: () => Promise<any>): any {
  if (!promise || typeof promise.then !== 'function') return promise;
  return (async () => {
    try {
      return await promise;
    } catch (err) {
      if (await tryFixSchema(err)) return await retry();
      throw err;
    }
  })();
}

// 用 Proxy 包装 rawClient，保留所有 postgres 行为（tagged template、
// .end()、.unsafe()、.ended 属性等），只在查询失败时注入修复逻辑
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
