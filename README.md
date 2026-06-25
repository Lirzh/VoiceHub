# VoiceHub - 校园广播站点歌系统

这是一个使用Nuxt 4全栈框架开发的现代化校园广播站点歌管理系统。系统提供完整的点歌、投票、排期管理、通知推送、数据分析、权限控制和数据库管理功能，支持多角色权限管理和灵活的系统配置。

<div align="center">

[交流群](https://qm.qq.com/cgi-bin/qm/qr?k=5DV4vGlqn82YaNi7a3xW4zjmS8ZUr6cz&jump_from=webapi&authKey=axAl02PMsIVVAwrXij0YUUrOrUTeLpqLipu5XcTvyBUOzeWaOnicBB+fmBwNJs5S) | [使用学校收集表](https://laoshuikaixue.feishu.cn/share/base/form/shrcniUKakpNYP6KH7qrU20qq5e) | [项目宣传片](https://www.bilibili.com/video/BV1B9ArzMEkA) | [赞助支持](#sponsor)

</div>

## 项目截图

<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/fef6970e-95eb-4cab-a11f-db4e71fc87b5" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/f76e912c-1263-424b-b379-72321de205f7" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/b5de5880-6635-4698-9fd9-dbea9642f06a" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/05472008-57d5-4586-b7ca-572bff8a30ae" />
<img width="1920" height="1080" alt="image" src="https://github.com/user-attachments/assets/c30f2e5a-4cc8-48cb-aca2-4d41daeaaaf8" />

## 主要功能

### 🎵 核心功能

- **智能点歌系统**：用户可以点歌或给已有歌曲投票，支持网易云音乐、QQ音乐和哔哩哔哩搜索，可选择期望播出时段
- **多平台登录支持**：
  - **OAuth 账户系统**：支持通过 GitHub、Casdoor 等 OAuth 提供商快速创建和登录账户
    - **直接创建账户**：用户通过 OAuth 认证后可创建新账户，但仍需设置本地用户名和密码
    - **账户绑定**：已有账户的用户可将 OAuth 身份绑定到现有账户，实现多平台统一登录
    - **WebAuthn 支持**：支持 Windows Hello、生物识别和硬件安全密钥（如 YubiKey）登录
    - **双因素认证（2FA）**：支持 TOTP 和邮箱验证，增强账户安全性
  - **网易云音乐登录**：支持扫码登录，登录后可搜索个人歌单、收藏及播客电台内容
    - **一键添加到歌单**：登录后支持将排期中的网易云音乐歌曲一键添加到个人歌单
    - **从歌单投稿**：支持从个人歌单中直接投稿歌曲到系统
    - **从最近播放投稿**：支持从最近播放记录中投稿歌曲
    - **播客电台投稿**：支持搜索和投稿播客电台内容
- **投稿限额管理**：灵活配置用户投稿限制，支持按时间段、用户角色设置不同的投稿额度，有效控制系统负载
- **歌曲去重功能**：智能识别重复歌曲，优化歌曲库管理，避免重复播放
- **歌曲管理**：按热度排序，避免重复播放，动态URL防止链接过期，支持黑名单管理
- **音乐播放器**：内置音乐播放器，支持进度控制和音质实时切换
- **音质切换**：支持多种音质选择（标准、HQ、无损、Hi-Res等），动态获取最新播放链接
- **音乐下载功能**：支持管理员下载歌曲到本地，提供多种音质选择和批量下载
- **歌曲重播功能**：支持用户对已播放过的歌曲发起重播申请，支持查看申请记录和撤回申请

### 👥 用户管理

- **用户管理**：管理员添加用户，支持按年级班级分类
- **账户创建方式**：
  - 管理员直接添加账户
  - 用户通过 OAuth 快速创建账户
  - 用户通过传统用户名/密码注册
- **权限控制**：多级权限管理，支持普通用户、管理员、超级管理员
- **账户安全**：
  - bcrypt 密码加密
  - 双因素认证（TOTP、邮箱验证）
  - WebAuthn 支持（生物识别、硬件密钥）
  - 账户锁定和风险控制
- **身份关联**：支持将多个 OAuth 身份绑定到同一账户，实现统一登录
- **黑名单管理**：支持歌曲和艺术家黑名单，自动过滤不当内容

### 📅 排期管理

- **排期管理**：管理员可以通过拖拽界面进行歌曲排期和顺序管理
- **排期草稿**：支持保存排期草稿功能，允许管理员分步完成排期安排
  - 草稿状态不影响公开展示，可随时修改和完善
  - 支持草稿发布为正式排期，确保排期质量
- **播出时段**：灵活配置播出时段，**支持多时段管理**
- **打印排期**：支持自定义纸张大小、内容选择、编写备注和PDF导出的打印功能
- **学期管理**：管理员可设置当前学期，自动关联点歌记录
- **公开展示**：公开展示歌曲播放排期，按日期分组展示

### 🔔 通知系统

- **实时通知**：歌曲被选中、投票和系统通知
- **通知设置**：用户可自定义通知偏好，支持独立页面设置
- **批量通知**：管理员可向特定用户群体发送通知
- **社交账号绑定**：支持绑定MeoW等账号，同步推送通知到外部平台
- **验证码验证**：安全的验证码验证机制，支持动态样式反馈

### 💾 数据管理

- **数据库备份**：完整的数据库备份和恢复功能
- **数据库重置**：支持安全的数据库重置操作，可选择性保留用户数据或完全重置
- **文件导入导出**：支持备份文件的上传、下载和管理
- **数据库自检**：自动数据库验证和修复机制，确保系统稳定性

### 🎨 用户体验

- **现代UI**：响应式设计，深色主题，流畅的动画效果
- **玻璃态设计**：现代化的视觉效果和交互体验
- **交互反馈**：hover效果，点击反馈，状态变化动画
- **移动端优化**：适配支持移动设备访问，触摸友好的交互设计

## 技术栈

### 前端技术

- **Nuxt 4**：Vue.js全栈框架，提供SSR和SPA支持
- **Vue 3**：响应式前端框架，使用Composition API
- **TypeScript**：类型安全的JavaScript，提供完整的类型定义
- **Tailwind CSS**：实用优先的CSS框架，响应式设计
- **Vue Router**：前端路由管理

### 后端技术

- **Nuxt Server API**：服务端API路由，支持中间件和认证
- **Drizzle ORM**：现代化数据库ORM，提供类型安全的数据库操作和高性能查询
- **Neon Database**：Serverless PostgreSQL数据库，支持自动启停和无缝扩展
- **PostgreSQL**：关系型数据库，支持复杂查询和事务处理
- **Redis**：高性能缓存数据库，提升系统响应速度（可选，暂不推荐，可能存在潜在的问题）
- **JWT**：标准JWT认证机制，支持24小时token有效期
- **bcrypt**：密码加密，安全的哈希算法
- **Multer**：文件上传处理，支持多种存储方式

## 系统架构

系统采用了现代化的 Serverless 全栈架构：

- **前端**：使用 Nuxt 4 + Vue 3 组合式API构建响应式用户界面
- **后端**：使用 Nuxt Server API 构建 RESTful API 服务
- **数据库**：使用 Drizzle ORM + Neon Database，提供类型安全和高性能的数据库操作
- **认证**：标准 JWT 认证系统
- **缓存**：可选的 Redis 缓存层，提升系统响应速度
- **部署**：支持 Vercel、Netlify、EdgeOne 等 Serverless 平台一键部署，并提供 Docker、Linux 一键脚本及飞牛 FnOS (fpk安装包) 等多种部署方式

## 部署说明

请参考 **[部署说明](deploy.md)** 文件，了解如何部署 VoiceHub 系统。

## 文档与知识库

前往 **[语雀知识库](https://smartteachcn.yuque.com/knzylf/voicehub)** 查看完整的使用文档、开发指南和常见问题解答

## 音乐服务免责声明

VoiceHub 是一款开源的校园广播站点歌管理系统。本软件遵循 GPLv3 协议开源，但请注意在使用过程中涉及的第三方服务和内容可能受相关法律法规限制。

### 关于音乐内容与版权
- 本系统**不存储任何音乐文件**，不拥有任何音乐的版权；
- 所有音乐资源、播放及下载链接均来自**第三方音乐平台 API**；
- 音乐内容的版权、著作权归相应版权方及音乐平台所有。

### 关于功能说明
- 本系统提供**音乐搜索、播放链接获取、音乐下载辅助**功能；
- 系统仅做接口调用与工具呈现，不生产、不篡改音乐内容。

### 法律与责任声明
- 用户使用本系统进行播放、下载等行为，**须自行遵守所在地区版权法律法规及第三方平台服务协议**；
- 用户需自行确保对本系统的使用不侵犯第三方权益（如音乐版权方、API提供方等），特别是涉及商业用途时，请务必确认是否获得相应授权；
- 因用户使用不当、侵权用途所产生的一切法律责任，由**用户自行承担**，项目开发者不承担连带责任；
- 若版权方认为相关功能或接口使用侵犯其合法权益，请联系我们，我们将立即配合整改。

用户使用本系统即表示已阅读、理解并同意以上条款。

## 隐私说明与遥测

VoiceHub 内置可选的错误遥测功能，用于帮助开发者快速定位和修复系统问题。

### 遥测默认状态
- 遥测功能**默认开启**，但**可在管理员后台随时关闭**（站点配置 → 启用错误追踪与遥测）

### 收集的数据范围
系统通过 Sentry 仅收集以下**技术性信息**（不涉及任何个人隐私）：
- **错误堆栈与消息**：前端 Vue 错误、服务端未捕获异常和未处理 Promise 拒绝的技术信息
- **实例标识符**：系统安装时生成的随机 UUID（仅用于区分不同部署实例，不可用于识别个人）
- **实例心跳**：系统启动时发送一条 `instance_online` 消息（仅含实例 ID），用于统计活跃部署实例数量，不包含任何业务数据
- **请求上下文**：请求方法、URL 路径（**不含查询参数，避免泄露令牌**）、HTTP User-Agent
- **运行时环境**：运行平台（Vercel/Netlify/自托管）、Node.js 版本、Nitro 预设
- **前端组件名称**：出错的 Vue 组件名称（仅用于定位前端问题）

### 安全保障
- 所有 HTTP 4xx 业务错误（如认证失败、权限不足）**自动忽略**，不会上报 Sentry
- 前端网络离线状态和浏览器扩展产生的错误**自动过滤**
- 数据通过加密通道传输至 Sentry
- 遥测开关变更即时生效，无需重启服务

### 数据接收方
错误数据由 [Sentry](https://sentry.io/) 处理，仅用于错误排查与系统稳定性改进。

## 致谢

### UI设计

特别感谢 [过客是个铁憨憨](https://github.com/1811304592) 为本项目提供首页UI样式设计

感谢 [Awesome Iwb](https://github.com/awesome-iwb) 项目提供的统一遮罩风格的图标

### 贡献者

Thanks goes to these wonderful people:

[![Contributors](https://contrib.rocks/image?repo=laoshuikaixue/VoiceHub&repo=laoshuikaixue/VoiceHub-docs&repo=laoshuikaixue/VoiceHub-hmos)](https://github.com/laoshuikaixue/VoiceHub/graphs/contributors)

### 参考项目

本项目在开发过程中参考和使用了以下优秀的开源项目和API服务：

- [落月API](https://doc.vkeys.cn/api-doc/)
- [NeteaseCloudMusicApiEnhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)
- [meting-api](https://github.com/injahow/meting-api)
- [lx-music-desktop](https://github.com/lyswhut/lx-music-desktop) (搜索功能参考)
- [the1068fm - 深中风华子衿广播站点歌系统](https://github.com/SMS-COSMO/the1068fm)
- [Sound-of-experiment - 实验之声广播站点歌系统](https://github.com/ljk743121/Sound-of-experiment) (哔哩哔哩音源搜索功能参考)
- [Bilibili-audio-extraction](https://github.com/rio4raki/Bilibili-audio-extraction) (哔哩哔哩音频流获取参考)
- [SPlayer](https://github.com/imsyy/SPlayer)
- [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next)
- [Apple Music-like Lyrics](https://github.com/amll-dev/applemusic-like-lyrics)
- [official-website - Sparkinit](https://github.com/Sparkinit/official-website)
- [MusicAPI-rrvenn](https://music.rrvenn.cn)
- [qq-music-api](https://github.com/sansenjian/qq-music-api) (QQ音乐歌词获取参考)

## 许可证

[GPL-3.0](LICENSE)

## 星标历史

<picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=laoshuikaixue/VoiceHub&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=laoshuikaixue/VoiceHub&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=laoshuikaixue/VoiceHub&type=Date" />
 </picture>

## 其他

本项目有对应的原生鸿蒙版本：https://github.com/laoshuikaixue/VoiceHub-hmos

该项目通过创新的混合架构设计，实现了Web端Vue音频播放器与鸿蒙原生端的跨平台音频控制同步

<h2 id="sponsor">赞助支持</h2>

如果这个项目对你有帮助，欢迎赞助支持，让我有更多动力持续维护和更新。

<div align="center">

<img width="200" alt="wechat" src="https://github.com/user-attachments/assets/0cd13f75-bd9c-4486-8bba-a8895e2e55fd" />

</div>

---

Powered By LaoShui @ 2025-2026
