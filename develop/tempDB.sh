docker run \
  --name postgres \
  --restart unless-stopped \
  -p 5432:5432 \
  -e POSTGRES_USER=user \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=voicehub \
  --health-cmd "pg_isready -U user -d voicehub" \
  --health-interval 5s \
  --health-timeout 5s \
  --health-retries 5 \
  ghcr.nju.edu.cn/laoshuikaixue/voicehub-postgres:latest
