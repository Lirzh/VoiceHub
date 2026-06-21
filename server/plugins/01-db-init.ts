// Nuxt 服务端启动插件：测试数据库连通性
// schema 修复是"懒加载"的（按需），不需要在启动时主动检查：
// 当第一个查询因"表不存在 / 列不存在 / 类型不存在"失败时，
// db.ts 的 Proxy 会自动检测、生成 DDL、修复、并重试。
import { testConnection } from '~/drizzle/db';

export default defineNitroPlugin(async () => {
  try {
    const ok = await testConnection();
    if (ok) console.log('✅ 数据库连接就绪');
    else console.warn('⚠️ 数据库连接测试未通过，首次请求时将自动尝试修复');
  } catch (e: any) {
    console.warn('⚠️ 启动时数据库连接失败：', e.message);
  }
});
