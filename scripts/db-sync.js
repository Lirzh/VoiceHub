// 已废弃。schema 初始化由 app/drizzle/db.ts 在每次数据库查询时自动处理（lazy schema）。
// 部署时不再需要单独运行此脚本。如需手动对齐 schema，可执行：
//   pnpm db:push
//   pnpm db:migrate
