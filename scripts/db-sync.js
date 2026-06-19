#!/usr/bin/env node

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { config } from 'dotenv'
import postgres from 'postgres'
config({ path: path.resolve(process.cwd(), '.env') })

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
}
const log = (msg, color = 'reset') => console.log(`${colors[color]}${msg}${colors.reset}`)
const ok = (msg) => log(`✅ ${msg}`, 'green')
const warn = (msg) => log(`⚠️  ${msg}`, 'yellow')
const err = (msg) => log(`❌ ${msg}`, 'red')

const NON_INTERACTIVE_ENV = {
  ...process.env,
  CI: 'true',
  DRIZZLE_KIT_FORCE: 'true',
  DRIZZLE_KIT_NON_INTERACTIVE: 'true',
  NODE_ENV: process.env.NODE_ENV || 'production'
}

function safeExec(command, options = {}) {
  try {
    execSync(command, { stdio: 'inherit', ...options })
    return true
  } catch (e) {
    return false
  }
}

function fileExists(p) {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}

function ensureDrizzleFiles() {
  if (!fileExists('drizzle.config.ts')) throw new Error('Drizzle 配置文件不存在')
  if (!fileExists('app/drizzle/schema.ts')) throw new Error('Schema 文件不存在')
  if (!fileExists('app/drizzle/migrations/meta/_journal.json')) throw new Error('Drizzle journal 文件不存在')
}

function createSqlClient() {
  return postgres(process.env.DATABASE_URL, { max: 1 })
}

// 判断数据库中是否有任何业务表
async function isEmptyDatabase(sql) {
  const result = await sql`
    SELECT COUNT(*)::int AS count
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '__drizzle_migrations__'
  `
  return result[0]?.count === 0
}

// 判断是否已经有 drizzle 迁移记录
async function hasMigrationRecords(sql) {
  const migrationTable = await sql`
    SELECT to_regclass('public.__drizzle_migrations__') AS table_name
  `
  if (!migrationTable[0]?.table_name) {
    return false
  }
  const result = await sql`
    SELECT COUNT(*)::int AS count
    FROM public.__drizzle_migrations__
  `
  return (result[0]?.count || 0) > 0
}

function loadMigrationJournalEntries() {
  const journalPath = path.resolve(process.cwd(), 'app/drizzle/migrations/meta/_journal.json')
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'))
  return [...journal.entries].sort((a, b) => a.when - b.when)
}

// 给历史上用 push 建表的 legacy 数据库写入迁移基线，
// 以便后续版本可以平滑切换到 migrate 流程。
async function seedLegacyMigrationRecords(sql) {
  const entries = loadMigrationJournalEntries()

  await sql`CREATE TABLE IF NOT EXISTS public.__drizzle_migrations__ (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`

  for (const entry of entries) {
    await sql`
      INSERT INTO public.__drizzle_migrations__ (hash, created_at)
      SELECT ${`legacy:${entry.tag}`}, ${entry.when}
      WHERE NOT EXISTS (
        SELECT 1
        FROM public.__drizzle_migrations__
        WHERE created_at = ${entry.when}
      )
    `
  }
}

async function main() {
  log('🔄 数据库同步', 'cyan')

  if (!process.env.DATABASE_URL) {
    warn('未设置 DATABASE_URL')
    process.exit(0)
  }

  ensureDrizzleFiles()

  const sql = createSqlClient()

  try {
    const emptyDb = await isEmptyDatabase(sql)

    if (emptyDb) {
      // 全新空库：直接走迁移流程
      log('🆕 检测到空库，执行 migrate 创建 schema...', 'cyan')
      if (!safeExec('pnpm run db:migrate', { env: NON_INTERACTIVE_ENV })) {
        err('数据库迁移失败')
        process.exit(1)
      }
      ok('空库迁移完成')
    } else {
      // 已有数据的库：交给 Drizzle push 自己对比 schema 并补齐差异
      // 不再手写检查表/列/枚举 —— Drizzle push 本身就会精确对比 schema.ts
      log('🔁 检测到非空库，使用 drizzle-kit push 同步 schema（Drizzle 会自动对比差异）...', 'cyan')

      const pushCommand = 'pnpm exec drizzle-kit push --config=drizzle.config.ts'
      if (!safeExec(pushCommand, { env: { ...NON_INTERACTIVE_ENV, DRIZZLE_KIT_NON_INTERACTIVE: 'true' } })) {
        err('push 失败')
        process.exit(1)
      }
      ok('push 完成 —— 如果 schema 已是最新，Drizzle 不会做任何改动')

      // 处理 legacy 情况：schema 存在但迁移记录为空
      const migrationRecordsExist = await hasMigrationRecords(sql)
      if (!migrationRecordsExist) {
        warn('检测到迁移记录为空（legacy 数据库），写入迁移基线以便后续继续 migrate。')
        await seedLegacyMigrationRecords(sql)
        ok('legacy 迁移基线记录写入完成')
      }
    }
  } finally {
    await sql.end()
  }

  ok('数据库同步流程完成')
}

try {
  main()
} catch (e) {
  err(`同步异常: ${e.message || e}`)
  process.exit(1)
}
