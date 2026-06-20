
import postgres from 'postgres';
import { config } from 'dotenv';

config();

const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/voicehub';
const sql = postgres(url, { prepare: false });

async function test(sqlStr, tag) {
  try {
    await sql.unsafe(sqlStr);
    console.log(tag, '✅ SUCCESS');
  } catch (e) {
    console.log(tag, '❌ FAILED:', e.message, '| code:', e.code);
  }
}

async function testTagged(sqlStr, tag) {
  try {
    // 用模板标签语法
    const arr = [sqlStr];
    arr.raw = [sqlStr];
    await sql.unsafe(...[arr]);
    console.log(tag, '✅ SUCCESS');
  } catch (e) {
    console.log(tag, '❌ FAILED:', e.message, '| code:', e.code);
  }
}

console.log('=== Test 1: sql.unsafe(str) 纯字符串 ===');
await test('DROP TYPE IF EXISTS "__test_enum"', 'DROP via unsafe(str)');
await test('CREATE TYPE IF NOT EXISTS "__test_enum" AS ENUM (\'a\', \'b\', \'c\')', 'CREATE TYPE via unsafe(str)');

console.log('\n=== Test 2: sql\`...\` 模板标签 ===');
try {
  await sql`CREATE TYPE IF NOT EXISTS "__test_enum_b" AS ENUM ('a', 'b', 'c')`;
  console.log('template sql`...` ✅ SUCCESS');
} catch (e) {
  console.log('template sql`...` ❌ FAILED:', e.message, '| code:', e.code);
}

console.log('\n=== Test 3: sql.unsafe`...` 模板标签 （与 fixTarget 相同形式）===');
try {
  await sql.unsafe`CREATE TYPE IF NOT EXISTS "__test_enum_c" AS ENUM ('active', 'withdrawn', 'graduate')`;
  console.log('template sql.unsafe`...` ✅ SUCCESS');
} catch (e) {
  console.log('template sql.unsafe`...` ❌ FAILED:', e.message, '| code:', e.code);
}

console.log('\n=== Test 4: 检查 unsafe(string) 的行为 ===');
const realDdl = `CREATE TYPE IF NOT EXISTS "__test_enum_d" AS ENUM ('active', 'withdrawn', 'graduate')`;
await test(realDdl, 'fixTarget 相同 DDL');

await sql.end();
