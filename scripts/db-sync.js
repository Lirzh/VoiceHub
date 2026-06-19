#!/usr/bin/env node
// 可选手动工具：触发一次数据库 schema 同步（等同于应用启动时自动做的事）
// 用法: node scripts/db-sync.js
//
// 注意：应用自身启动时会自动做同样的事情，所以通常不需要手动调用此脚本。
// 此脚本的用途：1) 首次部署时手动触发；2) 修复模式（--force-migrate / --force-push）。

import { execSync } from 'child_process';
import path from 'path';
import { config } from 'dotenv';
import postgres from 'postgres';

config({ path: path.resolve(process.cwd(), '.env') });

const args = new Set(process.argv.slice(2));
const forceMigrate = args.has('--force-migrate');
const forcePush = args.has('--force-push');

function log(msg, color) {
  const colors = { green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', reset: '\x1b[0m' };
  console.log(`${colors[color] || ''}${msg}${colors.reset}`);
}

if (!process.env.DATABASE_URL) {
  log('未设置 DATABASE_URL', 'red');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

try {
  // 简单检查 —— 是否为空库
  const countRes = await sql`
    SELECT COUNT(*)::int AS count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '__drizzle_migrations__'
  `;
  const isEmpty = countRes[0]?.count === 0;

  if (forceMigrate || (isEmpty && !forcePush)) {
    log(isEmpty ? '🆕 空库，执行 migrate...' : '🔄 强制 migrate 模式', 'yellow');
    execSync('pnpm run db:migrate', { stdio: 'inherit', env: { ...process.env, CI: 'true' } });
    log('✅ migrate 完成', 'green');
  } else {
    log('🔄 执行 push 同步 schema（幂等，无改动则什么都不做）...', 'yellow');
    execSync('pnpm exec drizzle-kit push --config=drizzle.config.ts', {
      stdio: 'inherit',
      env: { ...process.env, CI: 'true', DRIZZLE_KIT_FORCE: 'true', DRIZZLE_KIT_NON_INTERACTIVE: 'true' }
    });
    log('✅ push 完成', 'green');
  }
} catch (e) {
  log(`同步失败: ${e.message || e}`, 'red');
  process.exit(1);
} finally {
  await sql.end();
}
