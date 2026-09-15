FROM node:22-alpine
WORKDIR /app

# Dependencies first so they cache between builds.
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server/ ./
COPY games/index.html /app/app/index.html
ENV APP_HTML=/app/app/index.html
ENV DATA_DIR=/data
ENV PORT=8787
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server.mjs"]
