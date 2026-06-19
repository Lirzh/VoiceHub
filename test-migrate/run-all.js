import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../app/drizzle/migrations');

// 按文件名排序获取所有迁移 SQL 文件（模拟 drizzle-kit 的 timestamp 排序）
function getMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
  return files;
}

// 按 --> statement-breakpoint 分割 SQL 文件成多条语句
function splitStatements(sqlFile) {
  const content = fs.readFileSync(path.join(MIGRATIONS_DIR, sqlFile), 'utf8');
  return content
    .split(/--> statement-breakpoint\n?/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// 模拟 drizzle-kit 的迁移记录表
async function ensureMigrationsTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations__" (
      "hash" text PRIMARY KEY NOT NULL,
      "created_at" bigint NOT NULL
    )
  `);
}

async function isMigrationApplied(db, fileName) {
  const result = await db.query(
    `SELECT 1 FROM "__drizzle_migrations__" WHERE "hash" = $1`,
    [fileName]
  );
  return result.rows.length > 0;
}

async function markMigrationApplied(db, fileName) {
  await db.query(
    `INSERT INTO "__drizzle_migrations__" ("hash", "created_at") VALUES ($1, $2)`,
    [fileName, Date.now()]
  );
}

// 模拟 drizzle-kit migrate: 顺序执行所有 SQL 文件
// 核心区别：我们真正执行 SQL 文件中的语句，而不是跳过
async function runMigrate(db, scenarioName) {
  const files = getMigrationFiles();
  const report = [];

  for (const file of files) {
    const statements = splitStatements(file);
    const applied = await isMigrationApplied(db, file);

    if (applied) {
      report.push({ file, status: 'SKIP', reason: 'already applied', stmtCount: 0 });
      continue;
    }

    let allOk = true;
    let errorMsg = '';
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await db.query(stmt);
      } catch (e) {
        allOk = false;
        errorMsg = `Stmt ${i + 1}/${statements.length}: ${e.message}`;
        console.log(`  ✗ ${file} [stmt ${i + 1}]`);
        console.log(`    ${e.message}`);
        break;
      }
    }

    if (allOk) {
      await markMigrationApplied(db, file);
      report.push({ file, status: 'OK', stmtCount: statements.length });
      console.log(`  ✓ ${file} (${statements.length} stmts)`);
    } else {
      report.push({ file, status: 'FAIL', error: errorMsg });
      return { ok: false, report, failedAt: file };
    }
  }

  return { ok: true, report };
}

// 直接执行所有 SQL，不检查迁移记录（模拟"legacy 库上直接运行迁移"）
async function runMigrateWithoutChecks(db, scenarioName) {
  const files = getMigrationFiles();
  console.log(`  共 ${files.length} 个迁移文件`);

  for (const file of files) {
    const statements = splitStatements(file);
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await db.query(stmt);
      } catch (e) {
        console.log(`  ✗ ${file} [stmt ${i + 1}/${statements.length}]`);
        console.log(`    SQL: ${stmt.substring(0, 120)}...`);
        console.log(`    错误: ${e.message}`);
        return { ok: false, failedAt: file };
      }
    }
    console.log(`  ✓ ${file} (${statements.length} stmts)`);
  }
  return { ok: true };
}

// 执行后验证：检查表是否都存在
async function verifySchema(db) {
  const expectedTables = [
    'NotificationSettings', 'Notification', 'PlayTime', 'Schedule',
    'Semester', 'SongBlacklist', 'Song', 'SystemSettings',
    'User', 'Vote', 'api_keys', 'api_key_permissions', 'api_logs',
    'user_status_logs', 'EmailTemplate', 'RequestTime',
    'song_collaborators', 'song_replay_requests', 'UserIdentity',
    'CardCode', 'CardCodeRedeemLog'
  ];
  const missing = [];
  for (const table of expectedTables) {
    const result = await db.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1 AND table_schema = 'public')`,
      [table]
    );
    if (!result.rows[0].exists) missing.push(table);
  }
  return missing;
}

async function verifyEnums(db) {
  const expectedEnums = ['BlacklistType', 'user_status', 'card_code_status', 'collaborator_status', 'replay_request_status'];
  const missing = [];
  for (const enumName of expectedEnums) {
    const result = await db.query(
      `SELECT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'public' AND t.typname = $1)`,
      [enumName]
    );
    if (!result.rows[0].exists) missing.push(enumName);
  }
  return missing;
}

// ======================================================================
// 主测试流程
// ======================================================================

const results = {};

// ---- 场景 1：空库（全新部署） ----
console.log('\n============================================');
console.log('场景 1: 空库 — 全新部署');
console.log('============================================');
{
  const db = new PGlite();
  await ensureMigrationsTable(db);
  const result = await runMigrateWithoutChecks(db, '场景1');
  results.scene1 = result;

  if (result.ok) {
    const missingTables = await verifySchema(db);
    const missingEnums = await verifyEnums(db);
    console.log(`  缺失表: ${missingTables.length === 0 ? '无' : missingTables.join(', ')}`);
    console.log(`  缺失枚举: ${missingEnums.length === 0 ? '无' : missingEnums.join(', ')}`);
    results.scene1.missingTables = missingTables;
    results.scene1.missingEnums = missingEnums;
  }
  await db.close();
}

// ---- 场景 2：legacy 库（有表但无迁移记录） ----
// 模拟：之前用 push --force 创建了完整库，现在切换到 migrate
console.log('\n============================================');
console.log('场景 2: legacy 库 — 有表但无迁移记录');
console.log('============================================');
{
  const db = new PGlite();

  // 先执行一次迁移来模拟"完整库"
  console.log('  [准备] 先执行所有迁移以创建完整 schema...');
  const prepare = await runMigrateWithoutChecks(db, 'prepare');
  if (!prepare.ok) {
    console.log('  ✗ 准备阶段失败');
    process.exit(1);
  }

  // 清空迁移记录表，模拟"只有 push 但从未 migrate"的状态
  await db.query(`TRUNCATE TABLE "__drizzle_migrations__"`);
  console.log('  [准备] 已清空迁移记录表');

  // 现在执行迁移（这是真实的修复测试）
  console.log('  [测试] 对 legacy 库执行迁移...');
  const result = await runMigrateWithoutChecks(db, '场景2');
  results.scene2 = result;

  if (result.ok) {
    // 迁移记录表现在应该有记录
    const count = await db.query(`SELECT COUNT(*) as cnt FROM "__drizzle_migrations__"`);
    console.log(`  迁移记录数: ${count.rows[0].cnt}`);
  }
  await db.close();
}

// ---- 场景 3：有迁移记录的库，重复部署 ----
// 模拟：已经运行过 migrate 了，现在再部署一次（drizzle-kit 会跳过已记录的）
console.log('\n============================================');
console.log('场景 3: 正常库 — 有迁移记录，重复部署');
console.log('============================================');
{
  const db = new PGlite();
  await ensureMigrationsTable(db);

  console.log('  [准备] 第一次部署...');
  const first = await runMigrate(db, 'first');
  if (!first.ok) {
    console.log('  ✗ 第一次部署失败');
    process.exit(1);
  }

  console.log('  [测试] 第二次部署（drizzle-kit 会根据迁移记录表跳过已执行的）...');
  const second = await runMigrate(db, 'second');
  results.scene3 = second;

  if (second.ok) {
    const skippedCount = second.report.filter(r => r.status === 'SKIP').length;
    console.log(`  跳过文件数: ${skippedCount}/${second.report.length}`);
  }
  await db.close();
}

// ---- 汇总报告 ----
console.log('\n============================================');
console.log('测试汇总报告');
console.log('============================================');
let allPass = true;
for (const [key, val] of Object.entries(results)) {
  const pass = val && val.ok !== false;
  console.log(`${key}: ${pass ? '✅ 通过' : '❌ 失败'}${val.failedAt ? ` (失败于: ${val.failedAt})` : ''}`);
  if (!pass) allPass = false;
}
console.log(`\n最终结果: ${allPass ? '✅ 所有场景通过' : '❌ 有场景失败'}`);
process.exit(allPass ? 0 : 1);
