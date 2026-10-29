# SF Κέντρο — server mode (one program for every PC). Data in the /data volume.
FROM node:22-alpine
# (Node carries its own time zone data: TZ works without extra packages)
ENV NODE_ENV=production \
    SFK_MODE=server \
    SFK_PORT=17321 \
    SFK_DATA=/data \
    APPDATA=/data/config \
    TZ=Europe/Athens
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js ./
COPY lib ./lib
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 17321
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:17321/ping').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
