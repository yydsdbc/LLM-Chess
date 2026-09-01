# LLM-chess — zero-dependency Node server (Chinese Chess + LLM battle platform)
# Build:  docker build -t llm-chess .
# Run:    docker run -p 8788:8788 --mount type=bind,src="$PWD/config",dst=/app/config llm-chess
#         (bind-mount config/ so the auto-generated keys.json persists across restarts)
FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    LLMCHESS_HOST=0.0.0.0

# App is dependency-free: copy source directly (config/ ships keys.example.json only,
# keys.json is gitignored and generated on first run)
COPY package.json server.js index.html ./
COPY ai benchmark config core evaluation replay test tools ui ./

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8788/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
