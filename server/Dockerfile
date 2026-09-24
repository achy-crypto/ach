FROM node:22-alpine
WORKDIR /app

# Dependencies first so they cache between builds.
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server/ ./
# Every app. The server reads each from its own path, and one missing here is a
# 500 on that app's page with the others still working — easy to miss.
COPY games/index.html /app/app/games.html
COPY holds/index.html /app/app/holds.html
COPY wavelength/index.html /app/app/wavelength.html
ENV APP_HTML=/app/app/games.html
ENV APP_HTML_HOLDS=/app/app/holds.html
ENV APP_HTML_VIBE=/app/app/wavelength.html
ENV DATA_DIR=/data
ENV PORT=8787
VOLUME ["/data"]
EXPOSE 8787
CMD ["node", "server.mjs"]
