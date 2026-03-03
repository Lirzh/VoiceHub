# ==========================================
# 第一阶段：构建阶段
# ==========================================
# 预定义各架构的构建镜像
FROM node:24-alpine AS builder-amd64
FROM node:24-alpine AS builder-arm64
FROM arm32v7/node:22-alpine AS builder-arm
FROM s390x/node:24-alpine AS builder-s390x
FROM ppc64le/node:24-slim AS builder-ppc64le

# 根据 TARGETARCH 选择对应的构建镜像
FROM builder-${TARGETARCH} AS builder

USER root
WORKDIR /app

# 安装编译bcrypt所需的系统依赖
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat \
    linux-headers

# 设置node-gyp的Python路径
ENV PYTHON=/usr/bin/python3

# 强制bcrypt使用预编译包
ENV BCRYPT_BUILD_FROM_SOURCE=false

# 复制依赖文件和 scripts 目录
COPY package*.json ./
COPY scripts ./scripts

# 安装所有依赖
RUN npm ci || npm install

# 复制所有源代码
COPY . .

# 构建应用
RUN npm run build

# ==========================================
# 第二阶段：运行阶段
# ==========================================
# 预定义各架构的运行时镜像
FROM node:24-alpine AS runtime-amd64
FROM node:24-alpine AS runtime-arm64
FROM arm32v7/node:22-alpine AS runtime-arm
FROM s390x/node:24-alpine AS runtime-s390x
FROM ppc64le/node:24-slim AS runtime-ppc64le

# 根据 TARGETARCH 选择对应的运行时镜像
FROM runtime-${TARGETARCH} AS runtime

USER root
WORKDIR /app

# 安装编译bcrypt所需的系统依赖
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    libc6-compat \
    linux-headers

# 设置node-gyp的Python路径
ENV PYTHON=/usr/bin/python3

# 强制bcrypt使用预编译包
ENV BCRYPT_BUILD_FROM_SOURCE=false

# 从构建阶段复制必要文件
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/app/drizzle ./app/drizzle
COPY --from=builder /app/scripts ./scripts

# 环境变量配置
ENV NODE_ENV=production \
    PORT=3000 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PREBUILT=true

# 暴露端口
EXPOSE $PORT

# 启动命令：先执行数据库迁移，再启动应用
CMD ["sh", "-c", "node scripts/deploy.js && node .output/server/index.mjs"]
