
import postgres from 'postgres';
import { config } from 'dotenv';

config();

const url = process.env.DATABASE_URL;
if (!url) { console.log('No DATABASE_URL'); process.exit(0); }

const sql = postgres(url, { prepare: false });

try {
  const version = await sql`SELECT version()`;
  console.log('PG Version:', version[0].version);

  const showServer = await sql`SHOW server_version`;
  console.log('server_version:', showServer[0].server_version);

  // 测试 CREATE TYPE IF NOT EXISTS 支持
  await sql.unsafe('DROP TYPE IF EXISTS "__test_v_enum"');
  try {
    await sql.unsafe(`CREATE TYPE IF NOT EXISTS "__test_v_enum" AS ENUM ('a', 'b')`);
    console.log('CREATE TYPE IF NOT EXISTS: ✅ SUPPORTED');
  } catch (e) {
    console.log('CREATE TYPE IF NOT EXISTS: ❌ NOT SUPPORTED:', e.message, '| code:', e.code);
  }

  // 测试不带 IF NOT EXISTS 的方式
  await sql.unsafe('DROP TYPE IF EXISTS "__test_v_enum2"');
  try {
    await sql.unsafe(`CREATE TYPE "__test_v_enum2" AS ENUM ('a', 'b')`);
    console.log('CREATE TYPE (no IF NOT EXISTS): ✅ SUCCESS');
  } catch (e) {
    console.log('CREATE TYPE (no IF NOT EXISTS): ❌ FAILED:', e.message, '| code:', e.code);
  }

  // 测试另一种幂等方式：先查 pg_type，不存在才 CREATE
  const res = await sql`SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE t.typname = '__test_v_enum3' AND n.nspname = current_schema()`;
  if (res.length === 0) {
    await sql.unsafe(`CREATE TYPE "__test_v_enum3" AS ENUM ('active', 'withdrawn')`);
    console.log('先查 pg_type 再 CREATE: ✅ SUCCESS');
  }
} catch (e) {
  console.log('Unexpected error:', e.message);
} finally {
  await sql.end();
}
