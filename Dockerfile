FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY web ./web
COPY public ./public
COPY server/languages.mjs ./server/languages.mjs
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg gosu ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 DATA_DIR=/var/data
# Accounts run the desk by default. NOTEFISH_PUBLIC_DEMO=true opens a throwaway
# demo with no sign-in; never set it on a desk that takes real calls.
ENV NOTEFISH_PUBLIC_DEMO=false
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node docs/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
COPY --from=build --chown=node:node /app/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/notefish-entrypoint
RUN chmod 755 /usr/local/bin/notefish-entrypoint && install -d -m 700 -o node -g node /var/data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/local/bin/notefish-entrypoint"]
CMD ["node", "server/index.mjs"]
