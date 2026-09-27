FROM node:20-alpine
RUN mkdir -p /app/src/engine/logs
WORKDIR /app/src/engine
COPY src/engine/package*.json ./
# Copy config to /app/config
COPY src/config /app/src/config/
# npm install downloads a glibc-linked sqlite3 prebuild (node_sqlite3.node).
# On musl its napi_*/uv_* symbols stay unresolved, so any later sqlite call
# jumps to a null pointer and kills the process with SIGSEGV. Rebuild it from
# source against musl, then drop the toolchain.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm install \
 && npm rebuild sqlite3 --build-from-source \
 && apk del .build-deps
COPY src/engine .
EXPOSE 3002
CMD ["node", "servicesLauncher.js"]