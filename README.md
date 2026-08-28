# receipt-trackr

Privat kvittoarkiv för ett hushåll. Kör på en ZimaBoard i hemmets nät, nås via tailnet,
och är byggt kring en enda asymmetri: **bilderna är oåterkalleliga, tolkningen är det
inte.** Papperet är slängt; text, fält och taggar kan alltid räknas om från bilderna.

## Kom igång

```sh
npm install
npm test                       # server + webb
npm run build

DATA_DIR=./data npm run dev    # servern på :8080
npm start --workspace web      # webben på :4200, proxar /api till 8080
```

`DATA_DIR` är obligatorisk och skapas om den saknas. Servern **vägrar starta** om
ledigt utrymme underskrider `MIN_FREE_BYTES` (5 GiB som standard) — det är avsiktligt,
och `docs/DRIFT.md` säger vad man gör åt det.

## Vad som finns

| Del | Var | Status |
| --- | --- | --- |
| Server (Fastify) | `server/` | Drift och kvittolagring: diskkontroll, `/api/health`, kvitton, segment, sökindex |
| Webb (Angular 19) | `web/` | En vy som visar arkivets status |
| OCR-spike | `spike/` | Klar. Mätningen som valde modellnivå och förbehandling |
| Runbook | `docs/DRIFT.md` | Skriven för någon som inte minns hur systemet är byggt |

Planen med milstolpar och kravnummer ligger utanför repot, i
`~/.claude/plans/atomic-waddling-nautilus.md`.

## Drift

Se `docs/DRIFT.md`. Kortversionen: `cp .env.example .env`, fyll i `ARCHIVE_DIR`,
`docker compose up -d`, och `curl localhost:8080/api/health` svarar på om arkivet
ligger rätt.
