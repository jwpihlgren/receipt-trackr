# syntax=docker/dockerfile:1
#
# Krav 52: en image, en tjänst. Bygget sker på en utvecklingsmaskin och aldrig på
# ZimaBoarden — värden hålls fri från Node, npm och byggverktyg. Plattformen är
# fastlåst till linux/amd64 därför att OCR-steget i M5 tar in `onnxruntime-node`
# med kompilerade binärer, och en image byggd på fel arkitektur upptäcks först i drift.

FROM --platform=linux/amd64 node:22-bookworm-slim AS build
WORKDIR /app
# Manifesten först: lagret med beroenden ska inte byggas om när en källfil ändras.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci
COPY . .
# Modellerna hämtas här, i bygget, och följer med i imagen. I drift finns inget
# nätverksberoende kvar: burken tolkar kvitton även när internet är nere.
RUN node scripts/hamta-modeller.mjs
RUN npm run build

# Egen fas för driftberoenden, så att inget byggverktyg följer med in i imagen.
FROM --platform=linux/amd64 node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci --omit=dev --workspace @receipt-trackr/server --include-workspace-root

FROM --platform=linux/amd64 node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    BACKUP_DIR=/backup \
    WEB_ROOT=/app/web/public \
    PORT=8080
WORKDIR /app
COPY --from=deps /app ./
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist/web/browser ./web/public
COPY entrypoint.sh /entrypoint.sh

# Startar som root enbart för att kunna rätta ägarskapet på monteringen; entrypoint
# släpper rättigheterna till PUID:PGID innan servern startar. Se entrypoint.sh.
EXPOSE 8080

# Hälsokontrollen frågar servern samma sak som runbooken: ligger arkivet rätt och
# finns det utrymme kvar? Under golvet svarar den 503, och containern rapporteras sjuk.
HEALTHCHECK --interval=1m --timeout=5s --start-period=10s --retries=3 CMD \
  node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server/dist/index.js"]
