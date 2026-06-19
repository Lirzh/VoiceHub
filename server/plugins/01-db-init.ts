// Nuxt 服务端启动插件：在处理请求前确保数据库 schema 已就绪
// 对应 "mkdir -p" 式的懒初始化逻辑在 app/drizzle/db.ts 的 ensureSchema() 中。
import { dbReady } from '~/drizzle/db';

export default defineNitroPlugin(async () => {
  try {
    console.log('🔄 等待数据库 schema 初始化...');
    await dbReady;
    console.log('✅ 数据库 schema 就绪，可以开始处理请求');
  } catch (e: any) {
    console.warn('⚠️ 数据库 schema 初始化失败，但应用仍将尝试启动：', e.message);
  }
});
