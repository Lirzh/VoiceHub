FROM node:20-alpine

WORKDIR /app

COPY . .

# 安装所有依赖
RUN npm ci

# 复制源代码并构建应用
RUN npm run build

# 环境变量配置
ENV NODE_ENV=production \
    ENABLE_IDLE_MODE=false \
    NODE_OPTIONS="--experimental-specifier-resolution=node"

# 暴露端口并设置启动命令
EXPOSE 3000
CMD ["sh", "-c", "npm run db:migrate && npm run deploy && npm start"]
