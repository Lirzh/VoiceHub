import { PGlite } from '@electric-sql/pglite';

async function test() {
  const db = new PGlite();
  console.log('=== PGlite 语法兼容性测试 ===');

  try {
    // 1. 测试 DO $$ CREATE TYPE 块
    await db.query(`DO $$ BEGIN CREATE TYPE "public"."test_enum" AS ENUM('a', 'b'); EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    console.log('✓ DO $$ CREATE TYPE 块');
    // 再执行一次（测试幂等）
    await db.query(`DO $$ BEGIN CREATE TYPE "public"."test_enum" AS ENUM('a', 'b'); EXCEPTION WHEN duplicate_object THEN null; END $$;`);
    console.log('✓ CREATE TYPE 块重复执行 (幂等)');

    // 2. 测试 CREATE TABLE IF NOT EXISTS
    await db.query(`CREATE TABLE IF NOT EXISTS "TestTable" (id serial PRIMARY KEY NOT NULL, name text NOT NULL, val "test_enum" DEFAULT 'a')`);
    console.log('✓ CREATE TABLE IF NOT EXISTS');
    // 再执行一次
    await db.query(`CREATE TABLE IF NOT EXISTS "TestTable" (id serial PRIMARY KEY NOT NULL, name text NOT NULL, val "test_enum" DEFAULT 'a')`);
    console.log('✓ CREATE TABLE 重复执行 (幂等)');

    // 3. 测试 ALTER TABLE ADD COLUMN IF NOT EXISTS
    await db.query(`ALTER TABLE "TestTable" ADD COLUMN IF NOT EXISTS "newCol" text`);
    console.log('✓ ADD COLUMN IF NOT EXISTS');
    await db.query(`ALTER TABLE "TestTable" ADD COLUMN IF NOT EXISTS "newCol" text`);
    console.log('✓ ADD COLUMN 重复执行 (幂等)');

    // 4. 测试 DROP CONSTRAINT + undefined_object 捕获
    await db.query(`DO $$ BEGIN ALTER TABLE "TestTable" DROP CONSTRAINT "nonexistent_constraint"; EXCEPTION WHEN undefined_object THEN null; END $$;`);
    console.log('✓ DROP CONSTRAINT 不存在时捕获');

    // 5. 测试 ALTER TYPE ADD VALUE IF NOT EXISTS
    await db.query(`ALTER TYPE "public"."test_enum" ADD VALUE IF NOT EXISTS 'c'`);
    console.log('✓ ALTER TYPE ADD VALUE IF NOT EXISTS');
    await db.query(`ALTER TYPE "public"."test_enum" ADD VALUE IF NOT EXISTS 'c'`);
    console.log('✓ ALTER TYPE ADD VALUE 重复执行 (幂等)');

    // 6. 测试带默认值的 NOT NULL 列
    await db.query(`ALTER TABLE "TestTable" ADD COLUMN IF NOT EXISTS "flagCol" boolean DEFAULT false NOT NULL`);
    console.log('✓ ADD COLUMN DEFAULT false NOT NULL');

    // 7. 测试 DROP COLUMN IF EXISTS
    await db.query(`ALTER TABLE "TestTable" DROP COLUMN IF EXISTS "flagCol"`);
    console.log('✓ DROP COLUMN IF EXISTS');

    // 8. 测试 CREATE INDEX IF NOT EXISTS
    await db.query(`CREATE INDEX IF NOT EXISTS "idx_test_name" ON "TestTable" USING btree ("name")`);
    console.log('✓ CREATE INDEX IF NOT EXISTS');
    await db.query(`CREATE INDEX IF NOT EXISTS "idx_test_name" ON "TestTable" USING btree ("name")`);
    console.log('✓ CREATE INDEX 重复执行 (幂等)');

    // 9. 测试 CREATE TABLE 带 UNIQUE 约束
    await db.query(`CREATE TABLE IF NOT EXISTS "TestUnique" (id serial PRIMARY KEY NOT NULL, "userId" integer NOT NULL, CONSTRAINT "TestUnique_userId_unique" UNIQUE("userId"))`);
    console.log('✓ CREATE TABLE 带 UNIQUE 约束');
    await db.query(`CREATE TABLE IF NOT EXISTS "TestUnique" (id serial PRIMARY KEY NOT NULL, "userId" integer NOT NULL, CONSTRAINT "TestUnique_userId_unique" UNIQUE("userId"))`);
    console.log('✓ CREATE TABLE 带 UNIQUE 约束重复执行 (幂等)');

    // 10. 测试 uuid 和 gen_random_uuid()
    await db.query(`CREATE TABLE IF NOT EXISTS "TestUUID" (id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, name varchar(100) NOT NULL, created_at timestamp DEFAULT now() NOT NULL)`);
    console.log('✓ uuid + gen_random_uuid()');

    console.log('\n=== 所有语法兼容性测试通过 ===');
  } catch (e) {
    console.error('✗ 失败:', e.message);
    process.exit(1);
  }
  await db.close();
}

test();
