# LLM-chess — zero-dependency Node server (Chinese Chess + LLM battle platform)
# Build:  docker build -t llm-chess .
# Run:    docker run -p 8788:8788 --mount type=bind,src="$PWD/config",dst=/app/config llm-chess
#         (bind-mount config/ so the auto-generated keys.json persists across restarts)
FROM node:22-alpine

# OCI image metadata (shows on registries: source/license/docs)
LABEL org.opencontainers.image.title="LLM-Chess" \
      org.opencontainers.image.description="Watch two LLMs play Chinese Chess (Xiangqi) with live thinking streams, replays and a HUD" \
      org.opencontainers.image.source="https://github.com/yydsdbc/LLM-Chess" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.documentation="https://github.com/yydsdbc/LLM-Chess#readme"

WORKDIR /app
ENV NODE_ENV=production \
    LLMCHESS_HOST=0.0.0.0

# App is dependency-free: copy source directly (config/ ships keys.example.json only,
# keys.json is gitignored and generated on first run). test/ is not baked into the runtime image.
# 第28轮: PWA 两件套入镜像 (原 Docker 内 manifest/sw 404)
COPY package.json server.js index.html manifest.json sw.js ./
COPY ai benchmark config core evaluation replay tools ui ./

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
