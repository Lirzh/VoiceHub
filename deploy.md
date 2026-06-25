
## 部署指南

### 一键部署

本项目可以一键部署到Vercel/Netlify/EdgeOne平台：

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Flaoshuikaixue%2FVoiceHub&env=DATABASE_URL,JWT_SECRET,NODE_ENV&envDefaults=%7B%22NODE_ENV%22%3A%22production%22%7D&envDescription=%E7%8E%AF%E5%A2%83%E5%8F%98%E9%87%8F%E8%AF%B4%E6%98%8E&envLink=https%3A%2F%2Fgithub.com%2Flaoshuikaixue%2FVoiceHub%23%E7%8E%AF%E5%A2%83%E5%8F%98%E9%87%8F%E8%AF%B4%E6%98%8E)
[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/laoshuikaixue/VoiceHub)
[![Deploy to EdgeOne Pages](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https://github.com/laoshuikaixue/VoiceHub&env=DATABASE_URL,JWT_SECRET&env-description=%E9%9C%80%E8%A6%81%E9%85%8D%E7%BD%AE%E6%95%B0%E6%8D%AE%E5%BA%93%E5%9C%B0%E5%9D%80%E3%80%81JWT%E5%AF%86%E9%92%A5)

在部署过程中，需要输入必要的环境变量：

1. `DATABASE_URL`：PostgreSQL数据库连接地址
2. `JWT_SECRET`：JWT令牌签名密钥

### Claw 部署

[![Claw](https://ap-southeast-1.run.claw.cloud/logo.svg)](https://ap-southeast-1.run.claw.cloud/)

1. **点击部署按钮**：选择上方的 Claw 部署按钮
2. **打开应用程序启动板**：打开 App Launchpad （应用程序启动板）
3. **创建应用**：选 Create App （创建应用）
4. **相关配置**：
   ```
   Application Name：VoiceHub 或 其它
   Image Name: ghcr.io/laoshuikaixue/voicehub:latest
   Usage：按需调整
   Network：3000 ，开 Public Access
   Environment Variables：
      DATABASE_URL=postgresql://user:password@postgres:5432/voicehub 
      # 可能需要 ?sslmode=disable
      JWT_SECRET=your-jwt-secret-here
      # 按实际情况填写
   ```
5. **等待部署**：平台会自动构建和部署应用
6. **访问应用**：部署完成后，您将获得一个可访问的 URL

### Linux 服务器部署

本项目提供了针对 Ubuntu/Debian 服务器的一键部署脚本，支持自动安装 Node.js 22、配置环境变量、安装依赖和构建项目。

**一键命令：**

```bash
bash <(curl -sL https://raw.githubusercontent.com/laoshuikaixue/VoiceHub/main/sh/main.sh)
```

如果你需要 gh-proxy 加速，使用以下命令：

```bash
bash <(curl -sL https://gh-proxy.com/https://raw.githubusercontent.com/laoshuikaixue/VoiceHub/main/sh/main.sh)
```

### Docker 部署

VoiceHub 支持通过 Docker 进行容器化部署，提供了多种部署方式。

#### 方式一：使用 Docker Compose（推荐）

这是最简单的部署方式，会自动创建应用和数据库容器。


##### 使用预构建镜像

查看 [docker-compose](/docker-compose) 并选择适合的配置文件

##### 本地构建镜像

1. 克隆项目

```bash
git clone https://github.com/laoshuikaixue/VoiceHub.git
cd VoiceHub
```

2. 修改 docker-compose.yml 中的环境变量

```yaml
environment:
  - DATABASE_URL=postgresql://user:password@postgres:5432/voicehub # 可能需要 ?sslmode=disable
  - JWT_SECRET=your-jwt-secret-here # 请修改为强随机字符串
  - NODE_ENV=production
```

3. 启动服务

```bash
docker-compose up -d
```

4. 访问应用
   打开浏览器访问 http://localhost:3000

默认管理员账号：

- 用户名：admin
- 密码：admin123

#### 方式二：使用预构建镜像

如果你已有 PostgreSQL 数据库，可以直接使用预构建的镜像。

使用 GitHub 镜像源：

```bash
docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://username:password@host:port/database?sslmode=require" \  
  # 可能需要替换成 ?sslmode=disable
  -e JWT_SECRET="your-very-secure-jwt-secret-key" \
  -e NODE_ENV=production \
  --name voicehub \
  ghcr.io/laoshuikaixue/voicehub:latest
```

使用南京大学镜像源：

```bash
docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://username:password@host:port/database?sslmode=require" \  
  # 可能需要替换成 ?sslmode=disable
  -e JWT_SECRET="your-very-secure-jwt-secret-key" \
  -e NODE_ENV=production \
  --name voicehub \
  ghcr.nju.edu.cn/laoshuikaixue/voicehub:latest
```

#### 方式三：本地构建镜像

如果需要自定义构建，可以本地构建镜像。

```bash
git clone https://github.com/laoshuikaixue/VoiceHub.git
cd VoiceHub

# 构建镜像（不使用缓存，确保完全重新构建）
docker build --no-cache -t voicehub .

# 运行容器
docker run -d \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://username:password@host:port/database?sslmode=require" \  
  # 可能需要替换成 ?sslmode=disable
  -e JWT_SECRET="your-very-secure-jwt-secret-key" \
  -e NODE_ENV=production \
  --name voicehub \
  voicehub
```

### 飞牛 (FnOS) 部署

VoiceHub 现已支持飞牛 OS (FnOS) 的 `.fpk` 安装包。
- 从 [GitHub Actions](https://github.com/laoshuikaixue/VoiceHub/actions/workflows/build-fpk.yml) 获取最新版本

### Nix / NixOS

VoiceHub 提供了一个 Nix flake，用于构建、开发和在 NixOS 上部署。

#### 前提条件

- [Nix](https://nixos.org/download)（带 flake 支持）
- PostgreSQL 数据库

#### NixOS 部署

将 VoiceHub 添加为 flake input：

```nix
{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    voicehub.url = "github:laoshuikaixue/VoiceHub";
  };

  outputs = { self, nixpkgs, voicehub, ... }: {
    nixosConfigurations.my-server = nixpkgs.lib.nixosSystem {
      specialArgs = { inherit voicehub; };
      modules = [
        voicehub.nixosModules.default
        ./configuration.nix
      ];
    };
  };
}
```

> [!TIP]
> 启用 Binary Cache 可大幅加快构建速度，详见下方[使用 Binary Cache 加速构建](#使用-binary-cache-加速构建)。

然后在 NixOS 配置中使用模块，根据数据库管理方式选择对应场景。

```nix
# 场景 A：自动配置本地 PostgreSQL
# environmentFile 只需提供 JWT_SECRET，DATABASE_URL 由模块自动构造
{ pkgs, inputs, config, ... }: {
  imports = [ inputs.voicehub.nixosModules.default ];

  services.voicehub = {
    enable = true;
    database.createLocally = true;
    environmentFile = config.sops.templates."voicehub-env".path;
    runDeployScript = true;
  };

  sops.templates."voicehub-env" = {
    content = ''
      JWT_SECRET=${config.sops.placeholder."voicehub/jwt-secret"}
    '';
  };
}
```

```nix
# 场景 B：手动管理数据库（Neon / Docker / 远程 PG）
# environmentFile 需同时提供 DATABASE_URL 和 JWT_SECRET
{ pkgs, inputs, config, ... }: {
  imports = [ inputs.voicehub.nixosModules.default ];

  services.voicehub = {
    enable = true;
    environmentFile = config.sops.templates."voicehub-env".path;
    runDeployScript = true;
  };

  sops.templates."voicehub-env" = {
    content = ''
      DATABASE_URL=${config.sops.placeholder."voicehub/database-url"}
      JWT_SECRET=${config.sops.placeholder."voicehub/jwt-secret"}
    '';
  };
}
```

环境文件 (`sops.templates."voicehub-env".content`) 格式参考：

```env
DATABASE_URL=postgresql://voicehub:secret@localhost:5432/voicehub
JWT_SECRET=your-very-secure-jwt-secret-key
NUXT_PUBLIC_HOST=https://voicehub.example.com
```

推荐使用 [sops-nix](https://github.com/Mic92/sops-nix) 管理 secrets，避免明文存储在 Nix store 中。

模块会自动设置 `DynamicUser`、`ProtectSystem=strict`、`NoNewPrivileges` 等安全加固。

应用配置并部署：

```bash
sudo nixos-rebuild switch --flake .#my-server
```

查看服务状态和日志：

```bash
systemctl status voicehub
journalctl -u voicehub -f
```

默认监听 `0.0.0.0:3000`，可通过 `services.voicehub.host` 和 `services.voicehub.port` 修改。

#### 使用 Binary Cache 加速构建

VoiceHub CI 会将构建产物推送到 [Cachix](https://cachix.org) binary cache，
下游用户可直接下载预构建的 `pnpmDeps` 和 `voicehub` 包，跳过本地构建。

在你的 flake 中添加 `nixConfig` 以启用：

```nix
{
  nixConfig = {
    extra-substituters = [ "https://voicehub.cachix.org" ];
    extra-trusted-public-keys = [ "voicehub.cachix.org-1:CKw4/RvZy5c0WVpyo5ZyLbJgdpHZ/+epofIwGOeIOhU=" ];
  };
  inputs = {
    voicehub.url = "github:laoshuikaixue/VoiceHub";
  };
}
```

> [!IMPORTANT]
> 请勿通过 `follows` 覆盖 VoiceHub 的 `nixpkgs` input。缓存中的产物使用
> VoiceHub 自带的 nixpkgs 构建，替换后 hash 不同，无法命中缓存。

#### 其他功能

##### 开发环境

进入开发 shell（自动提供 Node.js、pnpm、PostgreSQL 客户端）：

```bash
nix develop
```

然后在 shell 内：

```bash
cp .env.example .env   # 配置 DATABASE_URL + JWT_SECRET
pnpm install
pnpm run dev           # 启动开发服务器 (port 3000)
```

##### 构建

```bash
nix build              # 产出 result/bin/voicehub
```

构建产物可以直接运行（需要 `DATABASE_URL` 等环境变量）：

```bash
DATABASE_URL="postgresql://..." JWT_SECRET="..." ./result/bin/voicehub
```

或使用附带的环境文件：

```bash
nix run .#default --impure
```

> `nix run` 需要设置 `DATABASE_URL` 环境变量，否则会启动失败。

##### 更新 pnpm 依赖哈希

当 `pnpm-lock.yaml` 更新后，需要同步 `flake.nix` 中的 `pnpmDeps` 哈希。仓库已配置 GitHub Actions，会在 `pnpm-lock.yaml` 或 `flake.nix` 变更时自动计算新哈希并提交回触发分支。

如果需要在本地手动更新，可以先将 `flake.nix` 中 `pnpmDeps.hash` 临时改为空字符串，然后运行：

```bash
nix build .#voicehub
```

Nix 会因固定输出哈希不匹配而失败，并输出 `got: sha256-...`，将该值写回 `pnpmDeps.hash` 即可。也可以使用 impure 构建辅助命令（需要网络和已安装的 pnpm）：

```bash
nix run .#build                # 在项目目录中执行，生成 .output 目录
```

---

### 本地开发部署

#### 前提条件

- Node.js 20+
- PostgreSQL 数据库（推荐使用 Neon）
- Redis 数据库（可选，暂不推荐）

#### 快速开始

1. 克隆项目

```bash
git clone https://github.com/laoshuikaixue/VoiceHub.git
cd VoiceHub
```

2. 安装依赖

```bash
pnpm install --frozen-lockfile
```

3. 配置环境变量

复制 `.env.example` 文件并重命名为 `.env`：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置必需的环境变量：

```env
# 数据库连接地址（必填）
DATABASE_URL="postgresql://username:password@host:port/database?sslmode=require"
# 可能需要替换成 ?sslmode=disable

# JWT 认证密钥（必填）
JWT_SECRET="your-very-secure-jwt-secret-key"

# 应用运行环境（可选）
NODE_ENV=development
```

4. 初始化数据库

首次运行需要初始化数据库结构：

```bash
# 生成数据库迁移文件
pnpm run db:generate

# 执行数据库迁移
pnpm run db:migrate
```

或使用一键部署命令（推荐）：

```bash
pnpm run deploy
```

5. 创建管理员账户

系统会在首次部署时自动创建管理员账户。如需手动创建：

```bash
pnpm run create-admin
```

默认管理员账户：

- 用户名：admin
- 密码：admin123

6. 启动开发服务器

```bash
pnpm run dev
```

应用将在 http://localhost:3000 启动。

### 生产环境部署

1. 构建生产版本

```bash
pnpm run build
```

2. 启动生产服务器

```bash
pnpm run start
```

### 数据库管理命令

```bash
# 新的数据库初始化
pnpm run init-help

# 生成迁移文件
pnpm run db:generate

# 执行数据库迁移
pnpm run db:migrate

# 推送模式变更到数据库（开发环境）
pnpm run db:push

# 启动 Drizzle Studio（数据库管理界面）
pnpm run db:studio

# 清空数据库并重新创建管理员
pnpm run clear-db

# 安全迁移（带备份）
pnpm run safe-migrate
```

### 升级与迁移

有关如何升级现有部署和迁移数据，请参阅 [升级指南](UPGRADE.md)。

## 系统配置

### 站点配置管理

VoiceHub 提供了完整的站点配置管理功能，支持通过管理后台动态配置系统参数：

#### 基本信息配置

- **站点标题**：自定义系统显示名称
- **站点描述**：系统功能描述和介绍
- **站点Logo**：支持上传自定义Logo图片

#### 播放时段管理

- **多时段支持**：支持配置多个播放时段（如午间、晚间）
- **时段名称**：自定义时段显示名称
- **开始/结束时间**：精确到分钟的时间控制
- **时段排序**：支持拖拽调整时段显示顺序

#### 通知系统配置

- **通知开关**：控制系统通知功能的启用状态
- **通知类型**：配置不同类型通知的发送规则
- **通知模板**：自定义通知消息的格式和内容

### 数据库备份与恢复

系统提供了完整的数据备份和恢复解决方案：

#### 备份功能

- **完整备份**：包含所有数据表的完整系统备份
- **用户数据备份**：仅备份用户相关数据（用户、歌曲、投票等）
- **增量备份**：支持基于时间的增量备份策略

#### 恢复功能

- **合并模式**：将备份数据与现有数据合并，保留现有数据
- **替换模式**：完全替换现有数据（谨慎使用）
- **数据验证**：恢复前自动验证备份文件完整性

### 权限与角色管理

VoiceHub 实现了细粒度的权限控制系统：

#### 角色类型

- **超级管理员 (SUPER_ADMIN)**：拥有所有系统权限，包括用户管理、系统配置、数据库管理等
- **管理员 (ADMIN)**：拥有日常管理权限，如用户管理、排期管理、歌曲管理、系统配置等
- **歌曲管理员 (SONG_ADMIN)**：专门负责歌曲相关管理，包括排期管理、歌曲管理、打印排期等
- **普通用户 (USER)**：基本的点歌、投票和查看权限

#### 权限分类

- **内容管理权限**：排期管理、歌曲管理、打印排期等
- **用户管理权限**：创建、编辑、删除用户账户
- **系统管理权限**：通知管理、播放时间管理、学期管理、黑名单管理、站点配置、数据库管理等

#### 权限继承与分配

- **SUPER_ADMIN**：拥有所有权限
- **ADMIN**：拥有除数据库管理外的所有权限
- **SONG_ADMIN**：拥有内容管理相关权限（排期、歌曲、打印）
- **USER**：仅拥有基本的点歌和查看权限

#### 权限验证

- 前端基于角色动态显示界面元素和菜单
- 后端API进行严格的权限验证
- 支持页面级和功能级的权限控制

## 环境变量说明

| 变量名          | 必填 | 说明                              | 示例值                                                                 |
|--------------|----|---------------------------------|---------------------------------------------------------------------|
| DATABASE_URL | 是  | PostgreSQL数据库连接字符串              | `postgresql://username:password@host:port/database?sslmode=require` |
| JWT_SECRET   | 是  | JWT令牌签名密钥，建议使用强随机字符串            | `your-very-secure-jwt-secret-key`                                   |
| NODE_ENV     | 否  | 运行环境，development或production     | `production`                                                        |
| REDIS_URL    | 否  | Redis缓存服务连接字符串，填写后自动启用Redis缓存功能 | `redis://default:password@host:port`                                |
| NITRO_PRESET | 否  | Nitro预设                         | `vercel`                                                            |
| NUXT_PUBLIC_HOST | 否  | 用于 CORS 和反向代理的主机名验证 | `your-app.com`                                                            |
| NUXT_PUBLIC_SEO_CONFIG | 否  | 用于自定义 PWA/SEO 配置的 JSON 字符串 | `{"title":"VoiceHub校园广播站点歌系统","shortName":"校园广播","description":"校园广播站点歌系统 - 让你的声音被听见","logo":"/images/logo.png"}` |

## OAuth 配置

系统支持通过 OAuth 提供商（如 GitHub、Casdoor、Google 等）快速创建账户和登录：

1. **在管理员后台配置**：
  - 导航到系统设置 > OAuth 配置
  - 配置基础设置：
    - **OAuth 重定向 URI**：`https://yourdomain.com/api/auth/[provider]/callback`
    - **OAuth State 密钥**：强随机字符串，用于 state 参数加密
  - 启用需要的 OAuth 提供商并填写相应凭证：
    - GitHub：Client ID / Secret
    - Casdoor：Server URL / Client ID / Secret / Organization Name
    - Google：Client ID / Secret
    - 第三方 OAuth2：完整的 OAuth 端点和字段映射

2. **OAuth 提供商配置**：
  在 OAuth 提供商的开发者控制台配置重定向 URI，确保与后台配置一致

3. **账户创建流程**：
  - 用户点击 OAuth 登录按钮
  - 完成 OAuth 认证后，若身份未关联，用户可选择：
    - 创建新账户：设置用户名和密码，直接创建新账户
    - 绑定现有账户：输入现有用户名和密码进行绑定
  - 成功后自动登录

4. **安全特性**：
  - 所有密码使用 bcrypt 加密
  - OAuth 状态参数使用 AES 加密校验
  - 绑定令牌有 10 分钟有效期
  - 支持账户锁定和风险控制

## 使用说明

### 普通用户

1. 访问主页，查看当前排期
2. 注册/登录账号
3. 在仪表盘中点歌或给喜欢的歌曲投票
   - 支持搜索网易云音乐、QQ音乐和哔哩哔哩平台
   - 可以试听歌曲并选择音质
   - 支持给已有歌曲投票
   - **网易云音乐登录功能**：
     - 扫码登录网易云音乐账号
     - 登录后可一键添加当前排期歌曲到个人歌单
     - 支持从个人歌单中直接投稿歌曲
     - 支持从最近播放记录中投稿歌曲
     - 可搜索并投稿播客和电台内容
4. 使用内置播放器播放歌曲
   - 支持多种音质切换（标准、HQ、无损、Hi-Res等）
   - 实时切换音质并保持播放进度
5. 查看通知中心获取歌曲状态更新

### 管理员

1. 使用管理员账号登录（默认账号：admin，密码：admin123）
2. 进入管理后台，选择相应功能标签
3. **排期管理**：可以看到左侧"待排歌曲"和右侧"播放顺序"
   - 通过拖拽将歌曲从左侧添加到右侧的排期列表
   - 可以在右侧拖拽调整歌曲播放顺序
   - 支持播出时段管理，可设置不同时段的播放安排
   - **草稿功能**：支持保存排期草稿，允许管理员先保存未完成的排期安排
     - 点击"保存草稿"按钮保存当前排期为草稿状态
     - 草稿不会影响公开展示的排期，可以随时修改
     - 点击"保存并发布"按钮将草稿发布为正式排期
   - 点击"保存顺序"按钮保存排期
4. **打印排期**：专业的排期打印和导出功能
   - 选择纸张大小（A4、A3、Letter、Legal）和页面方向
   - 自定义显示内容：歌曲封面、歌名、歌手、投稿人、热度等
   - 快捷日期选择：今天、明天、本周、下周
   - 智能分组显示：按日期分组，有多个播出时段时自动按时间排序
   - 实时预览：所见即所得的打印预览
   - PDF导出：支持导出高质量PDF文件，自动处理跨域图片
5. **歌曲管理**：查看和管理所有歌曲
   - 支持播放歌曲并实时切换音质
   - 动态获取最新的音乐播放链接
   - 提供歌曲下载功能，支持批量下载管理
   - 批量更新歌曲信息和状态
6. **数据分析**：查看系统使用统计和数据分析
   - 实时统计数据：用户活跃度、歌曲热度、投票趋势
   - 学期对比分析：不同学期的数据对比
   - 用户参与度分析：用户行为和参与度统计
   - 趋势分析：系统使用趋势和预测
7. **数据库管理**：数据库备份恢复和维护
   - 创建和下载数据库备份
   - 上传和恢复备份文件
   - 序列重置：修复数据库序列问题
   - 数据库状态检查和完整性验证
8. **学期管理**：设置和管理学期信息
   - 创建新学期（如"2024-2025学年上学期"）
   - 设置当前活跃学期
   - 点歌记录自动关联到当前学期
9. **用户管理**：添加、编辑和删除用户
   - 单个添加：填写用户信息（包括姓名、账号、年级、班级）
   - 批量导入：通过EXCEL文件批量添加用户
   - 可以重置用户密码
10. **黑名单管理**：管理歌曲和关键词黑名单
    - 添加具体歌曲或关键词到黑名单
    - 自动过滤包含黑名单内容的点歌请求
    - 支持启用/禁用黑名单项
11. **系统设置**：配置系统参数和功能开关
    - 站点信息配置：标题、Logo、描述等
    - 投稿限额设置：每日/每周投稿限制
    - 播出时段管理：配置不同的播出时间段
    - 功能开关：启用/禁用特定功能
12. **通知管理**：向用户发送系统通知
    - 支持按全体用户、年级、班级或多班级发送
    - 实时显示发送进度和结果
    - 通知历史记录和管理

## 数据库管理

### Drizzle ORM + Neon Database

项目使用 Drizzle ORM 作为数据库 ORM，配合 Neon Database 提供现代化的数据库解决方案。

#### 核心文件结构

- **`drizzle.config.ts`** - Drizzle ORM 主配置文件
- **`app/drizzle/db.ts`** - 数据库连接和客户端配置
- **`app/drizzle/schema.ts`** - 数据库表结构定义（TypeScript 类型安全）
- **`app/drizzle/migrations/`** - 数据库迁移脚本目录

### 数据库初始化

首次部署时，系统会自动初始化数据库结构。

#### 自动初始化（推荐）

使用部署脚本自动完成数据库初始化：

```bash
pnpm run deploy
```

该命令会：

1. 检查环境变量配置
2. 安装依赖
3. 执行数据库迁移
4. 创建默认管理员账户
5. 构建应用

#### 手动初始化

如需手动管理数据库：

1. 生成迁移文件

```bash
pnpm run db:generate
```

2. 执行数据库迁移

```bash
pnpm run db:migrate
```

3. 推送模式变更到数据库（开发环境）

```bash
pnpm run db:push
```

4. 启动 Drizzle Studio（数据库管理界面）

```bash
pnpm run db:studio
```

访问 https://local.drizzle.studio 查看和管理数据库

5. 清空数据库并创建管理员

```bash
pnpm run clear-db
```

### 数据库备份与恢复

#### 通过管理后台

1. 创建备份
   - 登录管理后台
   - 进入"数据库管理"页面
   - 点击"创建备份"按钮
   - 选择备份类型（完整备份/用户数据备份）

2. 下载备份
   - 备份完成后在列表中找到备份文件
   - 点击"下载"按钮保存到本地

3. 恢复备份
   - 点击"上传备份"按钮
   - 选择备份文件
   - 选择恢复模式：
     - 增量恢复：合并备份数据与现有数据
     - 完全恢复：替换所有现有数据（谨慎使用）
   - 确认并执行恢复

#### 使用 PostgreSQL 命令行

```bash
# 备份数据库
pg_dump -h localhost -U username -d database_name > backup.sql

# 恢复数据库
psql -h localhost -U username -d database_name < backup.sql
```

### 备份文件格式

- **完整备份**：包含所有数据表的 JSON 格式文件
- **用户备份**：仅包含用户相关数据
- **元数据**：包含创建时间、创建者、表信息等