# Drift

Skriven för någon som inte minns hur systemet är byggt. Det kan vara du själv om
två år, klockan elva på kvällen, när något inte startar.

## Vad det här är

Ett privat kvittoarkiv för ett hushåll, som körs på en ZimaBoard i hemmets nät och
nås via tailnet. Papperskvittona är slängda; **bilderna i arkivet är det enda
originalet**. Allt annat — utläst text, fält, taggar, sökindex — kan alltid räknas om
från bilderna. Den asymmetrin styr varje beslut nedan: en server som är nere är ett
billigt fel, en förlorad bild ett oåterkalleligt.

## Var saker ligger

| Vad | Var |
| --- | --- |
| Arkivet (sanningen) | `$ARCHIVE_DIR` på värden, monterad som `/data` i containern |
| Säkerhetskopior | `$BACKUP_DIR`, monterad som `/backup` |
| Beskrivning av arkivformatet | `/data/ARKIVFORMAT.md` — skrivs om av servern vid varje start |
| Appen | en container, en port, `127.0.0.1:8080` på värden |
| TLS och åtkomst utifrån | `tailscale serve` på värden, inte i containern |

`$ARCHIVE_DIR` **ska peka in i ZFS-poolen**, aldrig på kortets eMMC. Räkneexemplet
landar på storleksordningen 30 GB för tiotusen kvitton, och en körning mot bootenheten
fyller den.

## Starta och uppgradera

```sh
cd ~/repos/receipt-trackr
export ARCHIVE_DIR=/pool/kvitton          # lägg den i din profil, inte i huvudet
docker compose up -d
docker compose logs -f app                # första raden säger var arkivet ligger
```

Uppgradering, när ett register är valt:

```sh
docker compose pull && docker compose up -d
```

Tills dess byggs imagen lokalt på en utvecklingsmaskin: `docker compose build`.
Bygg aldrig på ZimaBoarden — den har varken Node eller byggverktyg, med flit.

## Mår den bra?

```sh
curl -s localhost:8080/api/health | jq
```

Svaret säger var arkivet ligger, på vilken monteringspunkt och vilket filsystem, hur
mycket som är ledigt, och var golvet går. `status: "ok"` och HTTP 200 betyder att allt
är i sin ordning. `status: "degraded"` och HTTP 503 betyder att ledigt utrymme fallit
under golvet — servern fortsätter svara, men utrymmet måste åtgärdas.

Samma fråga ställs av containerns egen hälsokontroll, så `docker compose ps` visar
`healthy` eller `unhealthy` utan att du behöver fråga själv.

## Servern startar inte

Felmeddelandet är skrivet för att läsas, inte tolkas. `docker compose logs app` visar
det direkt. De två som förekommer:

**"DATA_DIR saknas."** Miljövariabeln `ARCHIVE_DIR` var inte satt när compose kördes.
Sätt den och starta om.

**"För lite ledigt utrymme … Servern startar inte."** Det här är avsiktligt, inte ett
haveri. Servern vägrar starta hellre än att låta en körning fylla disken. Tre möjliga
åtgärder, i den ordningen:

1. Kontrollera *vilken* disk. Meddelandet skriver ut monteringspunkt och filsystem.
   Står det något annat än `zfs` pekar `ARCHIVE_DIR` sannolikt fel — det är den
   vanligaste orsaken, och den ser inte ut som ett diskfel.
2. Frigör utrymme på poolen.
3. Sänk golvet medvetet: `MIN_FREE_BYTES` i `docker-compose.yml`. Gör det bara när du
   vet varför, och skriv ned varför.

Servern varnar också i loggen, utan att vägra starta, när arkivet ligger på något
annat filsystem än ZFS. Den varningen är värd att läsa varje gång den dyker upp.

## Säkerhetskopiering och återställning

Byggs i M3. **Grinden är att inget papper slängs förrän en återställning har
genomförts på riktigt** — inte planerats, inte antagits fungera. När den finns
dokumenteras övningen här, steg för steg, tillsammans med hur man kontrollerar att
antal och sha256 stämmer.

## Loggar

Servern loggar strukturerad JSON till standard ut, alltså till `docker compose logs`.
Den första raden vid start är den viktigaste i hela filen: den säger vilken version
som kör, var arkivet ligger, vilken monteringspunkt det är, och hur mycket som är
ledigt. Läs den varje gång du startar om.

`LOG_LEVEL=debug` i compose ger mer när något behöver felsökas.

## Vad som inte finns ännu

Kvittolagring, mobilläge, OCR, sök och säkerhetskopiering. Det här är driftskelettet:
en tjänst som startar, kontrollerar disken, svarar på sin hälsa och serverar en vy som
visar just det. Ordningen är avsiktlig — se milstolparna i planen.
