
## 项目结构

```
VoiceHub/
├── .github/                   # GitHub 配置目录
│   └── workflows/             # GitHub Actions 工作流
│       ├── build-fpk.yml      # FnOS FPK 安装包构建
│       ├── docker-build.yml   # Docker 镜像构建
│       ├── docker-postgres.yml # PostgreSQL Docker 镜像构建
│       ├── nix.yml            # Nix 构建校验
│       └── update-nix-pnpm-hash.yml # 自动同步 pnpmDeps 哈希
├── app/                       # Nuxt 4 应用主目录
│   ├── app.vue                # 应用入口文件
│   ├── assets/                # 静态资源目录
│   │   └── css/               # CSS样式文件
│   │       ├── components.css      # 组件样式
│   │       ├── lyric-player.module.css  # 歌词播放器样式
│   │       ├── main.css           # 主样式文件
│   │       ├── mobile-admin.css   # 移动端管理样式
│   │       ├── print-fix.css      # 打印样式修复
│   │       ├── sf-pro-icons.css   # SF Pro图标字体
│   │       ├── theme-protection.css # 主题保护样式
│   │       ├── transitions.css    # 过渡动画样式
│   │       ├── variables.css      # CSS变量定义
│   │       └── year-review.css    # 年度回顾样式
│   ├── components/            # Vue组件目录
│   │   ├── Admin/             # 管理员功能组件
│   │   │   ├── ApiKeyManager.vue      # API密钥管理
│   │   │   ├── BackupManager.vue      # 数据库备份管理
│   │   │   ├── BatchUpdateModal.vue   # 批量更新模态框
│   │   │   ├── BlacklistManager.vue   # 黑名单管理
│   │   │   ├── CardCodesManager.vue   # 点歌券管理
│   │   │   ├── DataAnalysisPanel.vue  # 数据分析面板
│   │   │   ├── DatabaseManager.vue    # 数据库管理
│   │   │   ├── EmailTemplateManager.vue # 邮件模板管理
│   │   │   ├── NotificationSender.vue # 通知发送管理
│   │   │   ├── OAuthConfigManager.vue # OAuth 配置管理
│   │   │   ├── OverviewDashboard.vue  # 管理概览仪表板
│   │   │   ├── PlayTimeManager.vue    # 播放时间管理
│   │   │   ├── ProviderConfigSection.vue # OAuth 提供商配置组件
│   │   │   ├── RequestTimeManager.vue # 点歌时间管理
│   │   │   ├── ScheduleForm.vue       # 排期表单
│   │   │   ├── ScheduleItemPrint.vue  # 排期项目打印
│   │   │   ├── ScheduleManager.vue    # 排期管理
│   │   │   ├── SchedulePlaylistFilterModal.vue # 排期歌单过滤器
│   │   │   ├── SchedulePrinter.vue    # 排期打印功能
│   │   │   ├── ScheduleTablePrint.vue # 排期表格打印功能
│   │   │   ├── SemesterManager.vue    # 学期管理
│   │   │   ├── Sidebar.vue            # 管理后台侧边栏
│   │   │   ├── SiteConfigManager.vue  # 站点配置管理
│   │   │   ├── SmtpManager.vue        # SMTP邮件服务管理
│   │   │   ├── SongDownloadDialog.vue # 歌曲下载弹窗
│   │   │   ├── SongManagement.vue     # 歌曲管理
│   │   │   ├── SubmissionRemarkDialog.vue # 投稿备注弹窗
│   │   │   ├── UserManager.vue        # 用户管理
│   │   │   ├── UserSongsModal.vue     # 用户歌曲查看弹窗
│   │   │   └── VotersModal.vue        # 投票人员查看弹窗
│   │   ├── AMLL/              # Apple Music-Like Lyrics组件
│   │   │   └── LyricPlayer.vue # AMLL歌词播放器
│   │   ├── Auth/              # 认证相关组件
│   │   │   ├── Providers/     # 第三方登录提供商组件
│   │   │   │   ├── Casdoor/   # Casdoor登录组件
│   │   │   │   │   └── Icon.vue # Casdoor图标
│   │   │   │   ├── GitHub/    # GitHub登录组件
│   │   │   │   │   └── Icon.vue # GitHub图标
│   │   │   │   └── Google/    # Google登录组件
│   │   │   │       └── Icon.vue # Google图标
│   │   │   ├── ChangePasswordForm.vue # 修改密码表单
│   │   │   ├── LoginForm.vue         # 登录表单
│   │   │   ├── OAuthBindingCard.vue  # OAuth绑定卡片
│   │   │   ├── CaptchaInput.vue      # 图形验证码输入组件
│   │   │   ├── TurnstileWidget.vue   # Cloudflare Turnstile验证组件
│   │   │   ├── OAuthButtons.vue      # OAuth登录按钮组
│   │   │   ├── TwoFactorSetup.vue    # 双重认证设置组件
│   │   │   └── TwoFactorVerify.vue   # 双重认证验证组件
│   │   ├── Common/            # 通用组件
│   │   │   └── UserSearchModal.vue   # 用户搜索弹窗
│   │   ├── Notifications/     # 通知系统组件
│   │   │   └── NotificationSettings.vue # 通知设置
│   │   ├── Player/            # 播放器相关组件
│   │   │   └── PlayerLyric/   # 播放器歌词子组件
│   │   │       ├── AMLyric.vue        # Apple Music风格歌词
│   │   │       └── DefaultLyric.vue   # 默认风格歌词
│   │   ├── Songs/             # 歌曲相关组件
│   │   │   ├── AlbumDetailsModal.vue   # 网易云音乐专辑详情弹窗
│   │   │   ├── BilibiliEpisodesModal.vue # Bilibili剧集选择弹窗
│   │   │   ├── DuplicateSongModal.vue # 重复歌曲处理对话框
│   │   │   ├── ImportSongsModal.vue   # 导入歌曲弹窗
│   │   │   ├── NeteaseLoginModal.vue  # 网易云音乐登录弹窗
│   │   │   ├── NeteaseUploadDialog.vue # 网易云云盘上传弹窗
│   │   │   ├── PlaylistSelectionModal.vue # 歌单选择弹窗
│   │   │   ├── PodcastEpisodesModal.vue # 播客节目弹窗
│   │   │   ├── QQMusicLoginModal.vue # QQ音乐登录弹窗
│   │   │   ├── RecentSongsModal.vue   # 最近播放弹窗
│   │   │   ├── RequestForm.vue        # 点歌表单
│   │   │   ├── ScheduleList.vue       # 排期列表展示
│   │   │   └── SongList.vue           # 歌曲列表
│   │   ├── UI/                # 通用UI组件
│   │   │   ├── AudioPlayer/   # 音频播放器组件模块
│   │   │   │   ├── AudioElement.vue   # 音频元素组件
│   │   │   │   ├── PlayerControls.vue # 播放器控制组件
│   │   │   │   ├── PlayerInfo.vue     # 播放器信息组件
│   │   │   │   └── VolumeControl.vue  # 播放器音量控制组件
│   │   │   ├── Common/        # 通用UI组件
│   │   │   │   ├── CustomSelect.vue   # 自定义选择器
│   │   │   │   ├── DataTable.vue      # 通用数据表格组件
│   │   │   │   ├── ErrorBoundary.vue  # 错误边界组件
│   │   │   │   ├── LoadingState.vue   # 加载状态组件
│   │   │   │   ├── Pagination.vue     # 翻页组件
│   │   │   │   ├── Popover.vue        # 弹出框组件
│   │   │   │   ├── SearchFilter.vue   # 搜索过滤组件
│   │   │   │   └── StatCard.vue       # 统计卡片组件
│   │   │   ├── AppleMusicLyrics.vue   # 类Apple Music风格歌词显示组件
│   │   │   ├── AudioPlayer.vue        # 主音频播放器组件
│   │   │   ├── BilibiliIframeModal.vue # Bilibili视频预览弹窗
│   │   │   ├── ConfirmDialog.vue      # 确认对话框
│   │   │   ├── Icon.vue               # 图标组件
│   │   │   ├── LyricsModal.vue        # 全屏歌词模态框组件
│   │   │   ├── MarqueeText.vue        # 滚动文本显示组件
│   │   │   ├── Notification.vue       # 单个通知组件
│   │   │   ├── NotificationContainer.vue # 通知容器组件
│   │   │   ├── PageTransition.vue     # 页面过渡动画
│   │   │   ├── ProgressBar.vue        # 进度条组件
│   │   │   ├── AppLoadingScreen.vue   # 启动加载屏幕组件
│   │   │   ├── SongComments.vue       # 网易云音乐评论组件
│   │   │   └── WarpCanvas.vue         # 动态画布背景组件
│   │   ├── year-review/       # 年度回顾组件
│   │   └── SiteFooter.vue         # 站点页脚
│   ├── composables/           # Vue 3 组合式API
│   │   ├── useAdmin.ts         # 管理员功能hooks
│   │   ├── useAudioPlayer.ts   # 音频播放器hooks
│   │   ├── useAudioPlayerControl.ts # 音频播放器控制hooks
│   │   ├── useAudioPlayerEnhanced.ts # 增强音频播放器hooks
│   │   ├── useAudioPlayerSync.ts # 音频播放器同步hooks
│   │   ├── useAudioQuality.ts  # 音质管理hooks
│   │   ├── useAudioVisualizer.ts # 音频可视化hooks
│   │   ├── useAuth.ts          # 认证功能hooks
│   │   ├── useBackgroundRenderer.ts # 背景渲染hooks
│   │   ├── useBilibiliPreview.ts # Bilibili视频预览hooks
│   │   ├── useErrorHandler.ts  # 错误处理hooks
│   │   ├── useLyricManager.ts  # 歌词管理hooks
│   │   ├── useLyricPlayer.ts   # 类Apple Music风格歌词播放器hooks
│   │   ├── useLyrics.ts        # 歌词功能hooks
│   │   ├── useLyricSettings.ts # 歌词设置hooks
│   │   ├── useMediaSession.ts  # 媒体会话API hooks
│   │   ├── useMusicSources.ts    # 音乐源管理hooks
│   │   ├── useMusicWebSocket.ts  # 音乐WebSocket hooks
│   │   ├── useNotifications.ts # 通知功能hooks
│   │   ├── usePermissions.ts   # 权限管理hooks
│   │   ├── useProgress.ts      # 进度管理hooks
│   │   ├── useProgressEvents.ts # 进度事件hooks
│   │   ├── useRequestDedup.ts  # 请求去重hooks
│   │   ├── useSemesters.ts     # 学期管理hooks
│   │   ├── useSiteConfig.js    # 站点配置hooks
│   │   ├── useSongPlayer.ts    # 歌曲播放器hooks
│   │   ├── useSongs.ts         # 歌曲管理hooks
│   │   ├── useSyncedTime.ts    # 时间同步hooks
│   │   ├── useToast.ts         # Toast提示hooks
│   │   └── useUserFilters.ts  # 用户过滤器hooks
│   ├── drizzle/               # 数据库相关
│   │   ├── db.ts               # 数据库连接
│   │   ├── schema.ts           # 数据库模型
│   │   └── migrations/         # 数据库迁移文件
│   ├── layouts/               # 布局组件
│   │   └── default.vue         # 默认布局模板
│   ├── middleware/            # 中间件
│   │   └── auth.global.ts      # 全局认证中间件
│   ├── pages/                 # 页面组件（Nuxt 4路由）
│   │   ├── account/           # 账户管理页面
│   │   │   └── index.vue      # 账户中心（绑定管理）
│   │   ├── auth/              # 认证相关页面
│   │   │   └── error.vue      # 认证错误页面
│   │   ├── change-password.vue # 修改密码页面
│   │   ├── dashboard.vue       # 用户仪表盘
│   │   ├── forgot-password.vue # 找回密码页面
│   │   ├── index.vue           # 首页
│   │   ├── login.vue           # 登录页面
│   │   ├── notification-settings.vue # 通知设置页面
│   │   ├── reset-password.vue  # 重置密码页面
│   │   └── year-review.vue     # 年度回顾页面
│   ├── plugins/               # Nuxt插件
│   │   ├── auth.client.ts      # 客户端认证插件
│   │   ├── auth.server.ts      # 服务端认证插件
│   │   └── time-sync.client.ts # 客户端时间同步插件
│   ├── public/                # 静态文件目录
│   │   ├── images/            # 图片资源
│   │   │   ├── logo.png       # PNG格式Logo
│   │   │   ├── logo.svg       # SVG格式Logo
│   │   │   ├── search.svg     # 搜索图标
│   │   │   └── thumbs-up.svg  # 点赞图标
│   │   ├── favicon.ico        # 网站图标
│   │   └── robots.txt         # 搜索引擎爬虫配置
│   └── utils/                 # 工具函数
│       ├── core/              # 核心工具
│       │   └── security.ts    # 安全相关工具
│       ├── lyric/             # 歌词处理工具
│       │   ├── exclude.ts     # 歌词排除规则
│       │   ├── lyricFormat.ts # 歌词格式化
│       │   ├── lyricParser.ts # 歌词解析器
│       │   ├── lyricStripper.ts # 歌词清理
│       │   ├── parseLrc.ts    # LRC格式解析
│       │   └── qrc-parser.ts  # QRC格式解析
│       ├── bilibiliSource.ts  # 哔哩哔哩音源
│       ├── debounce.ts       # 防抖工具
│       ├── lyricAdapter.ts    # 歌词适配器
│       ├── musicSources.ts    # 音乐源配置
│       ├── musicUrl.ts        # 音乐URL处理
│       ├── sentryUpstreamMusicErrors.ts # Sentry 上游音源错误过滤
│       ├── neteaseApi.ts      # 网易云音乐API
│       ├── oauth-register.ts  # OAuth注册工具
│       ├── oauth.ts           # OAuth工具
│       ├── timeUtils.ts       # 时间工具
│       └── url.ts             # URL处理工具
├── server/                # 服务端代码
│   ├── api/                # API路由
│   │   ├── admin/          # 管理员API
│   │   │   ├── api-keys/            # API密钥管理API
│   │   │   │   ├── [id].delete.ts   # 删除API密钥
│   │   │   │   ├── [id].get.ts      # 获取API密钥详情
│   │   │   │   ├── [id].put.ts      # 更新API密钥
│   │   │   │   ├── index.get.ts     # 获取API密钥列表
│   │   │   │   ├── index.post.ts    # 创建API密钥
│   │   │   │   └── logs.get.ts      # API使用日志
│   │   │   ├── backup/              # 备份管理API
│   │   │   │   ├── delete/          # 删除备份子目录
│   │   │   │   │   └── [filename].delete.ts
│   │   │   │   ├── download/        # 下载备份子目录
│   │   │   │   │   └── [filename].get.ts
│   │   │   │   ├── clear.post.ts    # 清空备份历史
│   │   │   │   ├── download.get.ts  # 下载备份
│   │   │   │   ├── export.post.ts   # 创建备份
│   │   │   │   ├── list.get.ts      # 获取备份列表
│   │   │   │   ├── restore-chunk.post.ts # 恢复备份分片
│   │   │   │   ├── restore.post.ts  # 恢复备份
│   │   │   │   └── upload.post.ts   # 上传备份文件
│   │   │   ├── blacklist/           # 黑名单管理API
│   │   │   │   ├── [id].delete.ts   # 删除黑名单项
│   │   │   │   ├── [id].patch.ts    # 更新黑名单项
│   │   │   │   ├── index.get.ts     # 获取黑名单列表
│   │   │   │   └── index.post.ts    # 添加黑名单项
│   │   │   ├── card-codes/          # 点歌券管理API
│   │   │   │   ├── [id].put.ts      # 更新单张点歌券
│   │   │   │   ├── create.post.ts   # 创建点歌券
│   │   │   │   ├── export.get.ts    # 导出点歌券
│   │   │   │   ├── index.get.ts     # 获取点歌券列表
│   │   │   │   ├── redeem-logs.get.ts # 获取点歌券日志
│   │   │   │   └── update.post.ts   # 批量更新点歌券
│   │   │   ├── database/            # 数据库管理API
│   │   │   │   ├── cleanup.post.ts  # 数据库清理
│   │   │   │   ├── performance.get.ts # 数据库性能监控
│   │   │   │   ├── pool-status.get.ts # 连接池状态
│   │   │   │   ├── reset.post.ts    # 重置数据库
│   │   │   │   └── status.get.ts    # 数据库状态
│   │   │   ├── db-status.get.ts     # 数据库状态检查
│   │   │   ├── email-templates/     # 邮件模板管理API
│   │   │   │   ├── index.delete.ts  # 删除邮件模板
│   │   │   │   ├── index.get.ts     # 获取邮件模板列表
│   │   │   │   ├── index.post.ts    # 创建/更新邮件模板
│   │   │   │   └── preview.post.ts  # 预览邮件模板
│   │   │   ├── fix-sequence.post.ts # 修复数据库序列
│   │   │   ├── notifications/       # 管理员通知API
│   │   │   │   └── send.post.ts     # 发送通知
│   │   │   ├── play-times/          # 播放时间管理API
│   │   │   │   ├── [id].ts          # 播放时间操作
│   │   │   │   ├── index.post.ts    # 创建播放时间
│   │   │   │   └── index.ts         # 播放时间列表
│   │   │   ├── replay-requests/     # 重播申请管理API
│   │   │   │   ├── index.get.ts     # 获取重播申请列表
│   │   │   │   └── reject.post.ts   # 拒绝重播申请
│   │   │   ├── request-times/       # 点歌时间管理API
│   │   │   │   ├── [id].ts          # 点歌时间操作
│   │   │   │   ├── index.post.ts    # 创建点歌时间
│   │   │   │   └── index.ts         # 点歌时间列表
│   │   │   ├── schedule/            # 排期管理API
│   │   │   │   ├── bulk-publish.post.ts # 批量发布排期
│   │   │   │   ├── draft.post.ts    # 保存排期草稿
│   │   │   │   ├── full.get.ts      # 获取完整排期数据（包含草稿）
│   │   │   │   ├── move-date.post.ts # 排期日期迁移
│   │   │   │   ├── publish.post.ts  # 发布排期草稿
│   │   │   │   ├── remove.post.ts   # 移除排期
│   │   │   │   └── sequence.post.ts # 更新排期顺序
│   │   │   ├── schedule.post.ts     # 创建排期
│   │   │   ├── semesters/           # 学期管理API
│   │   │   │   ├── [id].delete.ts   # 删除学期
│   │   │   │   ├── [id].put.ts      # 更新学期
│   │   │   │   ├── index.get.ts     # 获取学期列表
│   │   │   │   ├── index.post.ts    # 创建学期
│   │   │   │   └── set-active.post.ts # 设置活跃学期
│   │   │   ├── smtp/                # SMTP邮件服务API
│   │   │   │   ├── reload.post.ts   # 重新加载SMTP配置
│   │   │   │   ├── test-connection.post.ts # 测试SMTP连接
│   │   │   │   └── test-email.post.ts # 发送测试邮件
│   │   │   ├── songs/               # 管理员歌曲管理API
│   │   │   │   ├── delete.post.ts   # 删除歌曲
│   │   │   │   ├── mark-played.post.ts  # 标记歌曲已播放
│   │   │   │   └── reject.post.ts  # 驳回歌曲
│   │   │   ├── stats.get.ts         # 统计数据
│   │   │   ├── activities.get.ts    # 活动管理API
│   │   │   ├── stats/               # 详细统计API
│   │   │   │   ├── active-users.get.ts # 活跃用户统计
│   │   │   │   ├── realtime.get.ts  # 实时统计
│   │   │   │   ├── semester-comparison.get.ts # 学期对比统计
│   │   │   │   ├── top-songs.get.ts # 热门歌曲统计
│   │   │   │   ├── trends.get.ts    # 趋势分析
│   │   │   │   └── user-engagement.get.ts # 用户参与度统计
│   │   │   ├── system-settings/     # 系统设置API
│   │   │   │   ├── env-oauth-import.post.ts # 导入环境变量OAuth配置
│   │   │   │   ├── env-oauth.get.ts # 获取环境变量OAuth配置
│   │   │   │   ├── index.post.ts    # 更新系统设置
│   │   │   │   ├── index.ts         # 获取系统设置
│   │   │   │   └── secretMask.ts    # 密钥脱敏工具
│   │   │   └── users/               # 用户管理API
│   │   │       ├── [id]/            # 用户详情操作子目录
│   │   │       │   ├── reset-password.post.ts # 重置用户密码
│   │   │       │   ├── songs.get.ts     # 获取用户点歌记录
│   │   │       │   ├── status-logs.get.ts # 获取用户状态变更日志
│   │   │       │   └── status.put.ts    # 更新用户状态
│   │   │       ├── [id].delete.ts   # 删除用户
│   │   │       ├── [id].put.ts      # 更新用户
│   │   │       ├── [id].get.ts      # 用户详情
│   │   │       ├── batch-grade-update.post.ts # 批量年级更新
│   │   │       ├── batch-status.put.ts # 批量状态更新
│   │   │       ├── batch-update.post.ts # 批量更新用户
│   │   │       ├── batch.post.ts    # 批量操作用户
│   │   │       ├── index.get.ts     # 获取用户列表
│   │   │       ├── index.post.ts    # 创建用户
│   │   │       ├── index.ts         # 用户管理
│   │   │       ├── options.ts       # 用户管理选项
│   │   │       └── status-logs.get.ts # 用户状态日志
│   │   ├── api-enhanced/          # 网易云音乐API
│   │   │   └── netease/           # 网易云增强接口代理
│   │   │       └── [...path].ts   # 转发网易云API请求
│   │   ├── auth/           # 认证API
│   │   │   ├── captcha.get.ts         # 图形验证码
│   │   │   ├── oauth-register-options.get.ts # OAuth注册选项
│   │   │   ├── 2fa/             # 2FA验证API
│   │   │   │   ├── send-email.post.ts # 发送2FA验证邮件
│   │   │   │   └── verify.post.ts     # 验证2FA代码
│   │   │   ├── webauthn/      # WebAuthn 相关 API
│   │   │   │   ├── login/     # 登录验证
│   │   │   │   │   ├── options.post.ts   # 获取登录 Challenge
│   │   │   │   │   └── verify.post.ts    # 验证登录签名
│   │   │   │   ├── register/  # 设备注册
│   │   │   │   │   ├── options.get.ts    # 获取注册 Challenge
│   │   │   │   │   └── verify.post.ts    # 验证注册签名
│   │   │   │   └── rename.post.ts    # 重命名设备
│   │   │   ├── [provider]/           # OAuth提供商路由
│   │   │   │   ├── callback.get.ts   # OAuth回调处理
│   │   │   │   └── index.get.ts      # OAuth授权跳转
│   │   │   ├── bind.post.ts          # 绑定社交账号
│   │   │   ├── change-password.post.ts # 修改密码
│   │   │   ├── forgot-password.post.ts # 找回密码
│   │   │   ├── identities.get.ts     # 获取已绑定身份列表
│   │   │   ├── login.post.ts        # 用户登录
│   │   │   ├── logout.post.ts       # 用户登出
│   │   │   ├── oauth-register.post.ts # OAuth用户注册
│   │   │   ├── reset-password.post.ts # 重置密码
│   │   │   ├── set-initial-password.post.ts # 设置初始密码
│   │   │   ├── unbind.post.ts        # 解绑社交账号
│   │   │   └── verify.get.ts        # 验证Token并获取用户信息
│   │   ├── bilibili/       # Bilibili相关API
│   │   │   ├── playurl.get.ts       # 获取播放链接
│   │   │   └── search.get.ts        # Bilibili视频搜索
│   │   ├── blacklist/      # 黑名单API
│   │   │   └── check.post.ts        # 检查黑名单
│   │   ├── card-codes/     # 点歌券API
│   │   │   └── validate.post.ts     # 验证点歌券可用性
│   │   ├── meow/           # MeoW账号绑定API
│   │   │   ├── bind.post.ts         # 绑定MeoW账号
│   │   │   └── unbind.post.ts       # 解绑MeoW账号
│   │   ├── music/          # 音乐相关API
│   │   │   ├── resolve-url.post.ts # 音乐播放链接统一解析
│   │   │   ├── state.post.ts        # 音乐状态管理
│   │   │   └── websocket.ts         # 音乐WebSocket连接
│   │   ├── native-api/     # 原生音乐API
│   │   │   ├── lyric/               # 歌词API
│   │   │   │   └── tx.get.ts        # 腾讯音乐歌词
│   │   │   ├── qq/                  # QQ音乐账号API
│   │   │   │   ├── avatar.get.ts    # 获取QQ音乐头像
│   │   │   │   ├── check-login.post.ts # 检查扫码登录情况
│   │   │   │   └── login-qr.get.ts  # 获取登录二维码
│   │   │   └── search/              # 搜索API
│   │   │       ├── tx.get.ts        # 腾讯音乐搜索
│   │   │       └── wy.get.ts        # 网易云音乐搜索
│   │   ├── notifications/  # 通知系统API
│   │   │   ├── [id]/                # 通知操作子目录
│   │   │   │   └── read.post.ts     # 标记通知已读
│   │   │   ├── [id].delete.ts       # 删除通知
│   │   │   ├── clear-all.delete.ts  # 清空所有通知
│   │   │   ├── index.ts             # 通知列表
│   │   │   ├── meow/                # MeoW通知API
│   │   │   │   ├── send-verification.post.ts # 发送验证码
│   │   │   │   └── test.post.ts     # 测试通知
│   │   │   ├── read-all.post.ts     # 标记所有已读
│   │   │   ├── settings.post.ts     # 更新通知设置
│   │   │   └── settings.ts          # 获取通知设置
│   │   ├── open/           # 开放API（无需认证）
│   │   │   ├── songs/               # 歌曲相关开放API
│   │   │   │   └── mark-played.post.ts # 标记歌曲已播放（供外部调用）
│   │   │   ├── schedules.get.ts     # 获取公开排期
│   │   │   └── songs.get.ts         # 获取公开歌曲列表
│   │   ├── play-times/     # 播放时间API
│   │   │   └── index.ts             # 播放时间管理
│   │   ├── request-times/  # 点歌时间API
│   │   │   └── index.ts             # 点歌时间管理
│   │   ├── progress/       # 进度条API
│   │   │   ├── events.ts            # 进度事件
│   │   │   └── id.ts                # 进度ID管理
│   │   ├── proxy/          # 代理服务API
│   │   │   └── image.get.ts         # 图片代理（解决HTTP/HTTPS混合内容及跨域问题）
│   │   ├── semesters/      # 学期API
│   │   │   ├── current.get.ts       # 获取当前学期
│   │   │   └── options.get.ts       # 获取学期选项
│   │   ├── site-config.get.ts       # 站点配置API
│   │   ├── songs/          # 歌曲相关API
│   │   │   ├── [id]/                # 歌曲详情操作
│   │   │   │   ├── update.put.ts    # 更新歌曲信息
│   │   │   │   └── voters.get.ts    # 获取投票人员
│   │   │   ├── collaborators/       # 联合投稿管理
│   │   │   │   └── reply.post.ts    # 处理联合投稿邀请
│   │   │   ├── add.post.ts          # 添加歌曲
│   │   │   ├── count.get.ts         # 歌曲统计
│   │   │   ├── import.post.ts       # 导入歌曲
│   │   │   ├── index.get.ts         # 歌曲列表
│   │   │   ├── public.get.ts        # 公开歌曲列表
│   │   │   ├── request.post.ts      # 点歌请求
│   │   │   ├── replay.post.ts       # 提交重播申请
│   │   │   ├── replay.delete.ts     # 撤回重播申请
│   │   │   ├── submission-status.get.ts # 投稿状态
│   │   │   ├── vote.post.ts         # 投票
│   │   │   └── withdraw.post.ts     # 撤回歌曲
│   │   ├── sys/            # 系统辅助API
│   │   │   └── time.get.ts          # 获取校准后的服务器时间
│   │   ├── system/         # 系统API
│   │   │   ├── instance.get.ts      # 实例信息
│   │   │   ├── location.get.ts      # 获取系统位置信息
│   │   │   ├── reconnect.post.ts    # 重连数据库
│   │   │   └── status.get.ts        # 系统状态
│   │   ├── user/           # 用户相关API
│   │   │   ├── 2fa/             # 2FA管理API
│   │   │   │   ├── disable.post.ts  # 关闭双重认证
│   │   │   │   ├── enable.post.ts   # 开启双重认证
│   │   │   │   └── generate.post.ts # 生成双重认证密钥
│   │   │   ├── email/               # 用户邮箱管理
│   │   │   │   ├── bind.post.ts     # 绑定邮箱
│   │   │   │   ├── resend-verification.post.ts # 重发验证邮件
│   │   │   │   ├── send-code.post.ts # 发送验证码
│   │   │   │   ├── unbind.post.ts   # 解绑邮箱
│   │   │   │   └── verify-code.post.ts # 验证邮箱验证码
│   │   │   └── year-review.get.ts   # 获取年度回顾数据
│   │   └── users/          # 用户API
│   │       ├── meow/                # 用户MeoW相关子目录
│   │       ├── social-accounts/     # 社交账号管理
│   │       │   ├── meow.delete.ts   # 删除MeoW绑定
│   │       │   └── meow.post.ts     # MeoW账号操作
│   │       ├── search.get.ts        # 搜索用户
│   │       └── social-accounts.get.ts # 获取社交账号
│   ├── config/             # 服务端配置
│   │   └── constants.ts    # 风控阈值与时间窗口常量
│   ├── error.ts            # 全局错误处理
│   ├── middleware/         # 服务端中间件
│   │   ├── api-auth.ts     # API认证中间件
│   │   ├── api-cors.ts     # API跨域中间件
│   │   └── auth.ts         # 认证中间件
│   ├── plugins/            # 服务端插件
│   │   └── error-handler.ts # 错误处理插件
│   ├── services/           # 业务服务层
│   │   ├── apiLogService.ts # API日志服务
│   │   ├── cardCodeLifecycleService.ts # 点歌券生命周期服务
│   │   ├── cacheService.ts # 缓存服务（Redis缓存管理）
│   │   ├── meowNotificationService.ts # MeoW通知服务
│   │   ├── notificationService.ts # 通知服务
│   │   ├── securityService.ts # 安全服务
│   │   ├── smtpService.ts  # SMTP邮件服务
│   │   └── userService.ts # 用户服务
│   ├── utils/              # 服务端工具函数
│   │   ├── auth.ts         # 认证工具函数
│   │   ├── bilibiliWbi.ts  # Bilibili WBI签名工具
│   │   ├── cache-helpers.ts # 缓存辅助工具
│   │   ├── database-health.ts # 数据库健康检查
│   │   ├── database-manager.ts # 数据库管理工具
│   │   ├── geo.ts          # 地理位置工具
│   │   ├── ip-utils.ts     # IP地址工具
│   │   ├── jwt-enhanced.ts # JWT工具
│   │   ├── log-manager.ts  # 日志管理工具
│   │   ├── native_common.ts # 原生API通用工具
│   │   ├── native_tx.ts    # 腾讯音乐原生API
│   │   ├── native_wy.ts    # 网易云音乐原生API
│   │   ├── qq_music_sdk.ts # QQ音乐SDK调用封装
│   │   ├── oauth-strategies.ts # OAuth策略配置
│   │   ├── oauth-token.ts  # OAuth令牌工具
│   │   ├── oauth.ts        # OAuth通用工具
│   │   ├── open-api-cache.ts # 开放API缓存
│   │   ├── permissions.js  # 权限系统配置
│   │   ├── redis.ts        # Redis连接和操作工具
│   │   ├── request-utils.ts # 请求处理通用工具
│   │   ├── siteUtils.ts    # 站点工具函数
│   │   ├── studentMask.ts  # 学生隐私工具
│   │   ├── submissionLimit.ts # 投稿限额工具
│   │   ├── system-settings-defaults.ts # 系统设置默认值
│   │   ├── twoFactorStore.ts # 双重认证存储工具
│   │   ├── user.ts         # 用户相关工具函数
│   │   ├── webauthn-config.ts # WebAuthn配置工具
│   │   └── webauthn-token.ts # WebAuthn令牌工具
│   ├── workers/            # 服务端工作进程
│   │   └── audioEncoderWorker.js # 音频编码工作进程
│   └── tsconfig.json       # 服务端TypeScript配置
├── types/                 # TypeScript类型定义
│   ├── global.d.ts         # 全局类型定义
│   └── index.ts            # 通用类型定义
├── .env.example           # 环境变量示例文件
├── .gitignore             # Git忽略文件配置
├── .vercelignore          # Vercel部署忽略文件
├── docker-compose/        # Docker Compose配置目录
├── docker-compose.yml     # Docker编排文件
├── Dockerfile             # Docker构建文件
├── drizzle.config.ts      # Drizzle配置文件
├── flake.lock             # Nix flake锁定文件
├── flake.nix              # Nix构建与NixOS模块配置
├── LICENSE                # 开源许可证文件
├── netlify.toml           # Netlify部署配置
├── nuxt.config.ts         # Nuxt 4主配置文件
├── package.json           # Node.js项目配置和依赖
├── README.md              # 项目说明文档
├── tsconfig.json          # TypeScript配置文件
└── vercel.json            # Vercel部署配置
```

### 目录说明

#### 核心目录 (app/)

- **`app/components/`**: Vue组件库，按功能模块组织
  - **`Admin/`**: 管理后台组件（排期、用户、数据分析等）
  - **`Admin_Backup/`**: 管理组件备份目录
  - **`AMLL/`**: Apple Music-Like Lyrics歌词播放器组件
  - **`Auth/`**: 认证相关组件（登录、OAuth绑定等）
  - **`Common/`**: 通用业务组件
  - **`Notifications/`**: 通知系统组件
  - **`Player/`**: 播放器相关组件
  - **`Songs/`**: 歌曲相关组件（点歌、导入、歌单等）
  - **`UI/`**: 通用UI组件（播放器、对话框、进度条等）
  - **`year-review/`**: 年度回顾功能组件
- **`app/pages/`**: 页面组件，Nuxt 4 自动路由
- **`app/composables/`**: Vue 3组合式API，业务逻辑复用
- **`app/drizzle/`**: Drizzle ORM配置、数据库连接和迁移文件

#### 配置目录 (app/)

- **`app/assets/css/`**: 样式文件，支持CSS变量和主题
- **`app/plugins/`**: Nuxt插件，扩展框架功能
- **`app/middleware/`**: 中间件，处理路由和认证
- **`app/utils/`**: 客户端工具函数
  - **`core/`**: 核心工具（安全等）
  - **`lyric/`**: 歌词处理工具集

#### 服务端目录 (server/)

- **`server/api/`**: 服务端API，RESTful接口设计
  - **`admin/`**: 管理员专用API（用户、排期、统计等）
  - **`auth/`**: 认证相关API
  - **`songs/`**: 歌曲管理API
  - **`notifications/`**: 通知系统API
  - **`open/`**: 公共API（无需认证）
- **`server/config/`**: 服务端配置（常量、环境配置等）
- **`server/middleware/`**: 服务端中间件（认证、日志等）
- **`server/plugins/`**: 服务端插件（错误处理等）
- **`server/services/`**: 业务逻辑服务层
- **`server/utils/`**: 服务端工具函数

#### 静态资源

- **`app/public/`**: 静态文件
- **`app/public/images/`**: 图片资源，包含Logo和图标文件

## 开发指南

### 组合式API

项目使用了Vue 3的组合式API，主要包括：

- `useAuth`: 处理用户认证、登录、注册和权限控制
- `useSongs`: 处理歌曲相关操作，包括获取歌曲列表、点歌和投票
- `useAdmin`: 处理管理员操作，包括排期管理和标记播放
- `useNotifications`: 处理通知系统，包括获取、标记已读和设置
- `useAudioQuality`: 处理音质管理，包括音质设置和持久化
- `useSemesters`: 处理学期管理，包括创建学期和设置活跃学期

### 添加新功能

1. 在 `server/api` 中添加新的API端点
2. 在 `app/composables` 中添加相应的组合式函数
3. 在 `app/components` 中创建UI组件
4. 在 `app/pages` 中整合组件和功能

### 数据库模型修改

如需修改数据库模型：

1. 编辑`app/drizzle/schema.ts`文件中的表结构定义
2. 生成新的迁移文件：`pnpm run db:generate`
3. 应用迁移到数据库：`pnpm run db:migrate`
4. 确保同时更新 `types/index.ts` 中的TypeScript类型定义
5. 使用Drizzle Studio查看数据库：`pnpm run db:studio`

### OAuth 平台扩展指南

VoiceHub 采用配置化与策略模式（Strategy Pattern）相结合的灵活 OAuth 扩展机制，所有 OAuth 提供商及认证设置现均已迁移至管理员后台界面。你可以直接在后台动态配置，无需修改环境变量和重启服务。

对于想要通过代码深度定制 OAuth 行为（如自定义用户信息解析逻辑等）的开发者，可参考以下机制：

#### 扩展步骤

##### 1. 定义 OAuth 策略

在 `server/utils/oauth-strategies.ts` 文件中，实现 `OAuthStrategy` 接口。该接口定义了 OAuth 流程中的三个核心方法：

```typescript
export interface OAuthStrategy {
  /**
   * 获取授权跳转 URL
   * @param redirectUri 回调地址（通常是 /api/auth/[provider]/callback）
   * @param state 包含安全校验信息的加密字符串
   */
  getAuthorizeUrl(redirectUri: string, state: string): string

  /**
   * 使用 code 换取 access_token
   * @param code 授权码
   * @param redirectUri 回调地址
   */
  exchangeToken(code: string, redirectUri: string): Promise<string>

  /**
   * 获取用户信息
   * @param accessToken 访问令牌
   */
  getUserInfo(accessToken: string): Promise<OAuthUserInfo>
}
```

**示例：接入 Google 登录**

```typescript
// server/utils/oauth-strategies.ts
const googleStrategy: OAuthStrategy = {
  getAuthorizeUrl(redirectUri, state) {
    const clientId = process.env.GOOGLE_CLIENT_ID
    // Google 授权端点
    return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=email%20profile&state=${encodeURIComponent(state)}`
  },

  async exchangeToken(code, redirectUri) {
    // ... 实现 Google 的 Token 交换逻辑
    // 通常是发送 POST 请求到 https://oauth2.googleapis.com/token
  },

  async getUserInfo(accessToken) {
    // ... 实现获取 Google 用户信息的逻辑
    // 通常是发送 GET 请求到 https://www.googleapis.com/oauth2/v3/userinfo
    // 需返回统一的 OAuthUserInfo 格式：
    // { id, username, email, name, avatar }
  }
}
```

##### 2. 注册策略

在同一个文件 (`server/utils/oauth-strategies.ts`) 的 `strategies` 对象中注册你的新策略：

```typescript
const strategies: Record<string, OAuthStrategy> = {
  github: githubStrategy,
  casdoor: casdoorStrategy,
  google: googleStrategy // <--- 注册新平台
  // ... 其他平台
}
```

##### 3. 完成！

现在，你可以在管理员后台的 **站点配置 -> OAuth 第三方登录配置** 中直接填写该平台的信息并启用它。系统会自动处理路由分发、State 校验、CSRF 保护和用户绑定逻辑。

#### Casdoor 配置说明

项目已内置对 [Casdoor](https://casdoor.org/) 的支持。Casdoor 是一个开源的 UI 优先的身份认证管理系统 (IAM)，支持 OAuth 2.0、OIDC 等多种协议。

要启用 Casdoor 登录，只需进入管理员后台的 **站点配置 -> OAuth 第三方登录配置**，开启 Casdoor 选项，并填入以下信息：
- **Casdoor 服务器 URL** (如 `https://your-casdoor-domain.com`)
- **Casdoor Client ID**
- **Casdoor Client Secret**
- **Casdoor 组织名称**

配置保存后，系统会立即启用 Casdoor 登录策略。

#### 前端图标配置

当添加了新的服务端 OAuth 策略后，如果需要在前端登录页面显示对应的图标按钮，请按照以下步骤操作：

1.  在 `app/components/Auth/Providers` 目录下创建一个以 Provider 名称（首字母大写）命名的文件夹，例如 `Google`。
2.  在该文件夹内创建一个 `Icon.vue` 组件，放入对应的 SVG 图标代码。
    - 建议 SVG 大小设置为 `w-5 h-5` 以保持样式统一。
3.  系统会自动检测并加载该图标，无需额外配置。

例如：`app/components/Auth/Providers/Google/Icon.vue`

**注意：** 对于 Casdoor，请创建 `app/components/Auth/Providers/Casdoor/Icon.vue`，并填入 Casdoor 的图标代码。

#### OAuth 工具函数

为了统一前端 OAuth 提供商的名称显示，系统提供了 `getProviderDisplayName` 工具函数。

**位置**: `app/utils/oauth.ts`

**使用方法**:

```typescript
import { getProviderDisplayName } from '~/utils/oauth'

// 获取显示名称
const displayName = getProviderDisplayName('github') // 返回 "GitHub"
const displayName2 = getProviderDisplayName('casdoor') // 返回 "Casdoor"
const displayName3 = getProviderDisplayName('google') // 返回 "Google" (默认首字母大写)
```

**扩展**:
当添加新的 OAuth 提供商时，可以在 `app/utils/oauth.ts` 的 `map` 对象中添加对应的映射关系，以实现自定义显示名称。

#### 添加绑定卡片

为了在账号管理页面显示新添加的 OAuth 提供商绑定选项，你需要修改 `app/components/Auth/OAuthBindingCard.vue` 文件。

**1. 添加计算属性**

在 `<script setup>` 中，添加用于获取特定提供商身份信息的计算属性：

```javascript
const googleIdentity = computed(() => identities.value.find((i) => i.provider === 'google'))
```

**2. 添加卡片模板**

在 `<template>` 中添加对应的卡片代码。你可以复制现有的卡片代码并进行修改：

```vue
<!-- Google (如果启用) -->
<div v-if="config.public.oauth.google" :class="itemClass">
  <div class="flex items-center gap-4">
    <div class="w-10 h-10 rounded-xl bg-zinc-950 flex items-center justify-center border border-zinc-800 text-zinc-100">
      <!-- 引入你之前创建的图标组件 -->
      <AuthProvidersGoogleIcon class="w-5 h-5" />
    </div>
    <div class="flex flex-col">
      <span class="text-sm font-bold text-zinc-200">Google</span>
      <span v-if="googleIdentity" class="text-[11px] text-blue-500 font-medium mt-0.5">{{ googleIdentity.providerUsername }}</span>
      <span v-else class="text-[11px] text-zinc-500 mt-0.5">未绑定</span>
    </div>
  </div>

  <button
      v-if="googleIdentity"
      class="..."
      @click="confirmUnbind('google')"
      :disabled="actionLoading"
  >
    {{ actionLoading ? '处理中...' : '解绑' }}
  </button>
  <button
      v-else
      class="..."
      @click="handleBind('google')"
      :disabled="actionLoading"
  >
    {{ actionLoading ? '跳转中...' : '立即绑定' }}
  </button>
</div>
```

**3. 更新解绑确认逻辑**

修改 `confirmUnbind` 方法，添加新提供商的显示名称映射：

```javascript
const confirmUnbind = (provider) => {
  let providerName = ''
  switch (provider) {
    case 'github':
      providerName = 'GitHub'
      break
    case 'casdoor':
      providerName = 'Casdoor'
      break
    case 'google':
      providerName = 'Google'
      break // <--- 添加这一行
    default:
      providerName = provider
  }
  // ...
}
```

---

### 音源扩展开发指南

VoiceHub 采用了模块化的音源架构，支持多音源故障转移和动态扩展。开发者可以轻松添加新的音乐API源，提高系统的可用性和音乐资源覆盖率。

#### 音源架构概述

音源系统由以下核心组件构成：

- **音源配置文件** (`app/utils/musicSources.ts`)：定义音源接口、配置和默认设置
- **音源管理器** (`app/composables/useMusicSources.ts`)：提供多音源搜索、故障转移和状态监控
- **数据转换层**：统一不同API的响应格式
- **故障转移机制**：自动切换到可用的备用音源

#### 音源接口定义

每个音源都必须实现以下接口：

```typescript
export interface MusicSource {
  /** 音源唯一标识 */
  id: string
  /** 音源显示名称 */
  name: string
  /** API基础URL */
  baseUrl: string
  /** 优先级，数字越小优先级越高 */
  priority: number
  /** 是否启用 */
  enabled: boolean
  /** 请求超时时间（毫秒），可选 */
  timeout?: number
  /** 自定义请求头，可选 */
  headers?: Record<string, string>
}
```

#### 如何添加新音源

##### 1. 在配置文件中添加音源

编辑 `app/utils/musicSources.ts` 文件，在 `MUSIC_SOURCE_CONFIG.sources` 数组中添加新音源：

```
{
  id: 'my-new-source',
  name: '我的新音源',
  baseUrl: 'https://api.example.com',
  priority: 6, // 设置优先级
  enabled: true,
  timeout: 8000,
  headers: {
    // ...
  }
}
```

##### 2. 实现数据转换函数

在 `app/composables/useMusicSources.ts` 中的 `searchWithSource` 函数里添加新音源的处理逻辑：

```typescript
if (source.id === 'my-new-source') {
  // 构建API请求URL
  url = `${source.baseUrl}/search?q=${encodeURIComponent(params.keywords)}&limit=${params.limit || 30}`

  // 定义响应数据转换函数
  transformResponse = (data: any) => transformMyNewSourceResponse(data)
}
```

##### 3. 编写数据转换函数

创建对应的数据转换函数，将API响应转换为统一格式：

```typescript
const transformMyNewSourceResponse = (response: any): any[] => {
  if (!response || !response.data) {
    throw new Error('API响应数据为空')
  }

  return response.data.map((song: any) => ({
    id: song.songId,
    title: song.songName,
    artist: song.artistName || '未知艺术家',
    cover: song.albumCover,
    album: song.albumName,
    duration: song.duration,
    musicPlatform: 'my-platform',
    musicId: song.songId?.toString(),
    sourceInfo: {
      source: 'my-new-source',
      originalId: song.songId?.toString(),
      fetchedAt: new Date()
    }
  }))
}
```

#### 音源配置说明

##### 优先级设置

- **priority**: 数字越小优先级越高
- 系统会按优先级顺序尝试音源

##### 超时配置

- **timeout**: 单个请求的超时时间（毫秒）
- 建议设置为5000-10000ms

##### 请求头配置

- **headers**: 自定义HTTP请求头
- 常用于设置User-Agent、Authorization等

#### 数据转换函数编写

##### 统一数据格式

所有音源的搜索结果都应转换为以下统一格式：

```
{
  id: string | number,           // 歌曲ID
  title: string,                 // 歌曲标题
  artist: string,                // 艺术家（多个艺术家使用 / 分隔）
  cover?: string,                // 封面图片URL
  album?: string,                // 专辑名称
  duration?: number,             // 时长（秒）
  musicPlatform: string,         // 音乐平台标识
  musicId: string,               // 音乐平台的歌曲ID
  sourceInfo: {                  // 音源信息
    source: string,              // 音源ID
    originalId: string,          // 原始ID
    fetchedAt: Date             // 获取时间
  }
}
```

**注意**：为了确保歌曲重复匹配判断的准确性，所有音源返回的歌手信息都应使用 `/` 作为分隔符。例如：

- 单个歌手：`"周深"`
- 多个歌手：`"颜人中/VaVa娃娃"`

这是为了保证各个音源的歌手格式保持一致，避免因分隔符不同导致的重复歌曲匹配失效。

##### 错误处理

数据转换函数应包含完善的错误处理：

```typescript
const transformResponse = (response: any): any[] => {
  // 检查响应状态
  if (response.code !== 200) {
    throw new Error(`API错误: ${response.message} (code: ${response.code})`)
  }

  // 检查数据存在性
  if (!response.data || !Array.isArray(response.data)) {
    throw new Error('API响应数据格式错误')
  }

  // 转换数据
  return response.data
    .map((item: any) => {
      // 验证必要字段
      if (!item.id || !item.title) {
        console.warn('跳过无效歌曲数据:', item)
        return null
      }

      return {
        // ... 转换逻辑
      }
    })
    .filter(Boolean) // 过滤掉null值
}
```

#### 故障转移机制

系统内置了自动故障转移机制：

##### 工作原理

1. **按优先级尝试**：系统按priority从小到大的顺序尝试音源
2. **错误检测**：当音源请求失败时，自动记录错误并尝试下一个音源
3. **状态监控**：实时监控各音源的可用性和响应时间
4. **智能重试**：支持配置重试次数和重试间隔

##### 故障转移配置

```typescript
export const MUSIC_SOURCE_CONFIG: MusicSourceConfig = {
  primarySource: 'vkeys', // 主音源ID
  enableFailover: true, // 启用故障转移
  timeout: 10000, // 默认超时时间
  retryAttempts: 2, // 重试次数
  sources: [
    /* 音源列表 */
  ]
}
```

#### 开发示例

以下是一个完整的音源扩展示例，展示如何添加一个虚构的"MusicAPI"音源：

##### 1. 添加音源配置

```
// app/utils/musicSources.ts
{
  id: 'music-api',
  name: 'MusicAPI音源',
  baseUrl: 'https://api.musicapi.com/v1',
  priority: 4,
  enabled: true,
  timeout: 8000,
  headers: {
    'User-Agent': 'VoiceHub/1.0',
    'X-API-Key': 'your-api-key'
  }
}
```

##### 2. 实现搜索逻辑

```typescript
// app/composables/useMusicSources.ts
if (source.id === 'music-api') {
  url = `${source.baseUrl}/search?query=${encodeURIComponent(params.keywords)}&limit=${params.limit || 30}&type=song`
  transformResponse = (data: any) => transformMusicApiResponse(data)
}
```

##### 3. 数据转换函数

```typescript
const transformMusicApiResponse = (response: any): any[] => {
  console.log('[transformMusicApiResponse] 开始转换数据:', response)

  if (!response || response.status !== 'success') {
    throw new Error(`MusicAPI错误: ${response.message || '未知错误'}`)
  }

  if (!response.results || !Array.isArray(response.results)) {
    throw new Error('MusicAPI响应数据格式错误')
  }

  return response.results
    .map((song: any) => {
      if (!song.id || !song.name) {
        console.warn('[transformMusicApiResponse] 跳过无效歌曲:', song)
        return null
      }

      return {
        id: song.id,
        title: song.name,
        artist: song.artists?.map((a: any) => a.name).join('/') || '未知艺术家',
        cover: song.album?.cover_url,
        album: song.album?.name,
        duration: song.duration_ms ? Math.floor(song.duration_ms / 1000) : undefined,
        musicPlatform: 'musicapi',
        musicId: song.id.toString(),
        sourceInfo: {
          source: 'music-api',
          originalId: song.id.toString(),
          fetchedAt: new Date(),
          // 保存额外信息供后续使用
          popularity: song.popularity,
          explicit: song.explicit
        }
      }
    })
    .filter(Boolean)
}
```

## 贡献说明

如果您希望为 VoiceHub 贡献代码，请注意以下几点，特别是涉及数据库变更时：

1. **数据库迁移文件**：
   - 任何对 `schema.ts` 的更改都**必须**伴随相应的迁移文件。
   - 迁移文件需要使用有意义的命名。请通过命令 `pnpm exec drizzle-kit generate --name=your_meaningful_name` 生成。
2. **备份与恢复支持**：
   - 当向系统设置（`systemSettings`）或其它关键表添加新字段时，**必须**同步更新数据备份和恢复的相关端点。
   - 需要检查并更新的文件：
     - `server/api/admin/backup/restore.post.ts`（`systemSettingsFields` 数组等）
     - `server/api/admin/backup/restore-chunk.post.ts`（`fields` 数组等）
3. **提交规范**：
   - 请确保在提交 PR 前至少在本地测试过相关功能。
   - 请使用标准的 Git 提交规范。