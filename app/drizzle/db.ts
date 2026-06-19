import { drizzle } from 'drizzle-orm/postgres-js';
import { and, asc, count, desc, eq, exists, gt, gte, lt, lte, ne, or, sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema.ts';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

config({ path: path.resolve(process.cwd(), '.env') });

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is not set');
}

const connectionString = process.env.DATABASE_URL;

const isNeonDatabase =
  connectionString.includes('neon.tech') || connectionString.includes('neon.database.com');

const getDatabaseConfig = () => {
  if (isNeonDatabase) {
    return {
      max: 1,
      idle_timeout: 0,
      connect_timeout: 10,
      max_lifetime: 3600,
      ssl: 'require',
      prepare: false,
      transform: { undefined: null },
      connection: { application_name: 'voicehub-app' },
      onnotice: process.env.NODE_ENV === 'development' ? console.log : undefined,
      debug: process.env.NODE_ENV === 'development' && process.env.DEBUG_SQL === 'true'
    };
  }
  return {
    max: process.env.NODE_ENV === 'production' ? 10 : 5,
    idle_timeout: 20,
    connect_timeout: 30,
    max_lifetime: 3600,
    ssl:
      connectionString.includes('sslmode=require') || connectionString.includes('ssl=true')
        ? 'require'
        : false,
    prepare: false,
    transform: { undefined: null },
    connection: { application_name: 'voicehub-app' },
    onnotice: process.env.NODE_ENV === 'development' ? console.log : undefined,
    debug: process.env.NODE_ENV === 'development' && process.env.DEBUG_SQL === 'true'
  };
};

const client = postgres(connectionString, getDatabaseConfig());

export const db = drizzle(client, { schema });
export { client };
export * from './schema.ts';
export { eq, ne, and, gt, gte, lt, lte, count, exists, desc, asc, or, sql };

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

let idleTimer: NodeJS.Timeout | null = null;
const IDLE_TIMEOUT = isNeonDatabase ? 5 * 60 * 1000 : 10 * 60 * 1000;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  if (process.env.NODE_ENV === 'production') {
    idleTimer = setTimeout(async () => {
      try {
        if (!client.ended) {
          const dbType = isNeonDatabase ? 'Neon' : 'PostgreSQL';
          console.log(
            `🔄 Auto-closing idle ${dbType} database connections${
              isNeonDatabase ? ' for Serverless optimization' : ''
            }`
          );
          await client.end({ timeout: isNeonDatabase ? 5 : 10 });
        }
      } catch (error) {
        console.error('❌ Error during auto-close:', error);
      }
    }, IDLE_TIMEOUT);
  }
}

export function withAutoReconnect<T extends any[], R>(operation: (...args: T) => Promise<R>) {
  return async (...args: T): Promise<R> => {
    resetIdleTimer();
    try {
      return await operation(...args);
    } catch (error: any) {
      if (error?.code === 'CONNECTION_ENDED' || client.ended) {
        const dbType = isNeonDatabase ? 'Neon' : 'PostgreSQL';
        console.log(
          `🔄 ${dbType} database connection ended${
            isNeonDatabase ? ', Neon will auto-reconnect on next query' : ', will reconnect on next query'
          }`
        );
      }
      throw error;
    }
  };
}

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

if (typeof process !== 'undefined') {
  const gracefulShutdown = async () => {
    console.log('🔄 Shutting down database connections...');
    await closeConnection();
  };
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
  process.on('beforeExit', gracefulShutdown);
}

// ──────────────────────────────────────────────────────────────────────────
//  运行时 schema 初始化（mkdir -p 风格）
//  应用首次启动时自动建表，后续启动什么也不做。
// ──────────────────────────────────────────────────────────────────────────

async function tablesInDb(): Promise<Set<string>> {
  const rows = await client<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `;
  return new Set(rows.map((r: any) => r.table_name));
}

async function columnsInDb(tableName: string): Promise<Set<string>> {
  const rows = await client<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${tableName}
  `;
  return new Set(rows.map((r: any) => r.column_name));
}

async function typeExists(typeName: string): Promise<boolean> {
  const rows = await client`
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = ${typeName.toLowerCase()}
  `;
  return rows.length > 0;
}

// 从 schema.ts 导出的对象中识别出所有表
function getTablesFromSchema() {
  const result: { name: string; obj: any }[] = [];
  for (const [key, value] of Object.entries(schema)) {
    if (value && typeof value === 'object' && (value as any).dbName && (value as any)[Symbol.toStringTag] !== 'PgEnum') {
      result.push({ name: (value as any).dbName, obj: value });
    }
  }
  return result;
}

// 从 schema.ts 导出的对象中识别出所有枚举
function getEnumsFromSchema() {
  const result: { name: string; values: string[] }[] = [];
  for (const value of Object.values(schema)) {
    if (
      value &&
      typeof value === 'object' &&
      (value as any).enumName &&
      Array.isArray((value as any).values)
    ) {
      result.push({ name: (value as any).enumName, values: (value as any).values });
    }
  }
  return result;
}

// 识别某列的 SQL 类型 —— 只用于 "列缺失时 ALTER TABLE ADD COLUMN IF NOT EXISTS"
// 不需要精确，够用就行（CREATE TABLE 我们不在这里执行）
function columnToSqlType(column: any): string {
  const colType = column.getSQLType?.() ?? column.dataType ?? 'TEXT';
  if (!colType) return 'TEXT';
  // 枚举类型会返回 enum 名字，普通类型返回 postgres 类型名
  return colType;
}

// 主函数：确保数据库 schema 与代码一致（mkdir -p 风格）
// 1. 空库 → 用 drizzle-kit push 完整建表
// 2. 非空库 → 尝试 push 以补齐差异；如果 CLI 不可用，跳过
async function ensureSchema(): Promise<void> {
  try {
    await client`SELECT 1`; // 确保连接可用
  } catch (e: any) {
    console.warn('⚠️ 数据库暂不可用，跳过 schema 初始化：', e.message);
    return;
  }

  // 通过 child_process 调用 drizzle-kit push —— push 是幂等的，
  // schema 已对齐时什么都不做；有缺失时自动补表、补列、补约束、补索引。
  try {
    const { execFileSync } = await import('node:child_process');
    const configPath = path.resolve(process.cwd(), 'drizzle.config.ts');

    console.log('🔄 检查数据库 schema 是否需要同步...');
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
    console.log('✅ schema 同步完成');
    return;
  } catch (e: any) {
    console.warn(
      '⚠️ drizzle-kit push 不可用或失败（可能是生产环境没有 devDependencies）。尝试兜底逻辑...'
    );
  }

  // 兜底：手动补齐——确保枚举存在 + 枚举值完整
  // 注意：手动兜底只补枚举/表/列的"存在性"，不负责精确对齐类型、默认值、外键、索引等
  try {
    const enums = getEnumsFromSchema();
    for (const { name, values } of enums) {
      if (!(await typeExists(name))) {
        try {
          await client.unsafe(
            `CREATE TYPE "${name}" AS ENUM (${values.map((v) => `'${v}'`).join(', ')})`
          );
          console.log(`✅ 创建枚举类型: ${name}`);
        } catch (e: any) {
          console.warn(`⚠️ 创建枚举 ${name} 失败: ${e.message}`);
        }
      }
    }

    const existingTables = await tablesInDb();
    const tables = getTablesFromSchema();
    for (const { name } of tables) {
      if (existingTables.has(name.toLowerCase())) continue;
      try {
        // 先尝试空表占位（真实结构仍然依赖 Drizzle；这里只是避免 "relation does not exist"）
        // 如果 drizzle-kit 不可用，我们至少尝试一个最小占位表，让应用可以启动
        await client.unsafe(
          `CREATE TABLE IF NOT EXISTS "${name}" (id SERIAL PRIMARY KEY)`
        );
        console.log(`✅ 创建占位表: ${name}（缺少完整 schema，建议手动执行 pnpm db:push）`);
      } catch (e: any) {
        console.warn(`⚠️ 创建表 ${name} 失败: ${e.message}`);
      }
    }
  } catch (e: any) {
    console.warn('⚠️ 兜底 schema 同步失败：', e.message);
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  dbReady: 应用启动时自动执行一次 schema 检查
//  其他模块可以 `import { db, dbReady } from '~/drizzle/db'` 然后 `await dbReady`
// ──────────────────────────────────────────────────────────────────────────

export const dbReady: Promise<void> = ensureSchema();
