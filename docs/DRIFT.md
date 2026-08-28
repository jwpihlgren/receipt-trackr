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
| Säkerhetskopior | `$BACKUP_DIR` (standard `./backup`), monterad som `/backup` |
| Beskrivning av arkivformatet | `/data/ARKIVFORMAT.md` — skrivs om av servern vid varje start |
| Appen | en container, en port, `127.0.0.1:8080` på värden |
| TLS och åtkomst utifrån | `tailscale serve` på värden, inte i containern |

`$ARCHIVE_DIR` **ska peka in i ZFS-poolen**, aldrig på kortets eMMC. Räkneexemplet
landar på storleksordningen 30 GB för tiotusen kvitton, och en körning mot bootenheten
fyller den.

## Starta och uppgradera

Inställningarna som hör till den här maskinen ligger i `.env` bredvid
`docker-compose.yml`. Den läses automatiskt och är utestängd från git — kopiera
`.env.example` en gång och glöm den sedan:

```sh
cd ~/repos/receipt-trackr
cp .env.example .env                      # ARCHIVE_DIR och en ledig HTTP_PORT
docker compose up -d
docker compose logs -f app                # första raden säger var arkivet ligger
```

Ingenting behöver förberedas på värden. Saknas arkivkatalogen skapar containern den
och sätter ägarskapet till `PUID:PGID` (1000 som standard, alltså den första vanliga
användaren). Är ditt uid något annat, sätt `PUID` och `PGID` i `.env` — då går arkivet
att läsa och kopiera utan `sudo`.

**En fälla värd att känna till:** en variabel som är exporterad i skalet vinner över
`.env`. Har du någon gång kört `export ARCHIVE_DIR=…` gäller den, tyst, och compose
monterar något annat än filen säger. `docker compose config` visar alltid vad som
faktiskt gäller.

Uppgradering:

```sh
docker compose pull && docker compose up -d
```

Det är hela uppgraderingen. Imagen byggs av GitHub Actions vid varje push till master
och ligger i `ghcr.io/jwpihlgren/receipt-trackr:latest` — ZimaBoarden bygger ingenting
och behöver varken Node eller byggverktyg.

Är paketet privat krävs en inloggning en gång på värden:

```sh
docker login ghcr.io -u jwpihlgren        # lösenord = personlig token med read:packages
```

Enklare är att göra paketet publikt i GitHubs paketinställningar. Imagen innehåller
bara programkoden — inga kvitton, inga nycklar, ingenting privat.

Behöver du bygga lokalt ändå går `docker compose build`. Det fungerar på ZimaBoarden
(allt bygge sker inne i containern) men tar sin tid på ett N150.

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

**"Bind for … 8080 failed: port is already allocated."** Något annat på värden lyssnar
redan där. Porten utåt är godtycklig — `tailscale serve` står framför ändå — så flytta
appen i stället för grannen:

```sh
sudo ss -ltnp | grep :8080          # vem är det?
HTTP_PORT=8081 docker compose up -d # eller lägg HTTP_PORT i din profil
```

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

## Säkerhetskopiering

Kopian speglar `receipts/` och skriver ett manifest med sha256 per fil. Sökindexet
kopieras aldrig — det är härlett och byggs om med `reindex`.

```sh
docker compose exec app node server/dist/backup-cli.js          # kopiera och kontrollera
docker compose exec app node server/dist/backup-cli.js verify   # kontrollera kopian igen
```

Kopieringen kontrollerar alltid sig själv mot manifestet innan den rapporterar klart.
En kopia ingen läst tillbaka är precis den sortens trygghet som sviker när den behövs.

Bilderna är oföränderliga, så bara nytillkomna filer kopieras; sidecar-filerna
kopieras alltid eftersom de ändras när fält rättas. Andra körningen mot samma kopia
tar därför en bråkdel av tiden.

Samma sak går att starta från datorläget, och följa medan den kör:
`POST /api/backup` startar, `GET /api/backup` visar framdriften.

**Kopian ska ligga på en annan disk än arkivet.** Standardvärdet `./backup` ligger
bredvid repot och duger för att komma igång, men skyddar bara mot misstag — inte mot
att disken går sönder. Sätt `BACKUP_DIR` i `.env` så snart du har någonstans att peka.

## Återställningsövningen

**Inget papper slängs förrän den här har genomförts på riktigt.** Inte planerats,
inte antagits fungera — genomförts. Den tar tio minuter och är enda sättet att veta
att kopian är värd något.

```sh
# 1. Kopiera, och notera antalet kvitton och filer i utskriften.
docker compose exec app node server/dist/backup-cli.js

# 2. Flytta undan arkivet. Flytta — radera inte, förrän övningen är klar.
docker compose down
mv /mnt/media-pool/kvitton /mnt/media-pool/kvitton.undan
mkdir -p /mnt/media-pool/kvitton

# 3. Kopiera tillbaka från säkerhetskopian.
cp -a /din/backup/receipts /mnt/media-pool/kvitton/

# 4. Starta, kontrollera mot manifestet och bygg om indexet.
docker compose up -d
docker compose exec app node server/dist/backup-cli.js verify data
docker compose exec app node server/dist/reindex.js

# 5. Sök efter något du vet finns. Samma träff som före övningen = klart.
curl -s "localhost:$HTTP_PORT/api/search?q=<ord ur ett kvitto>" | jq

# 6. Först nu: ta bort det undanflyttade arkivet.
rm -rf /mnt/media-pool/kvitton.undan
```

Steg 4 ska säga att alla filer stämmer mot manifestet, och steg 5 ska ge samma
sökträff som före. Gör de inte det: **släng ingenting**, och felsök i stället.

## Bygga om sökindexet

`index.sqlite` är härlett — allt i det går att räkna fram ur `receipts/` igen. Har det
tappats bort, blivit inkonsekvent eller ändrat schema:

```sh
docker compose exec app node server/dist/reindex.js
```

Ingenting går förlorat av att köra det, och det är samma väg som används efter en
återställning från säkerhetskopia.

## Loggar

Servern loggar strukturerad JSON till standard ut, alltså till `docker compose logs`.
Den första raden vid start är den viktigaste i hela filen: den säger vilken version
som kör, var arkivet ligger, vilken monteringspunkt det är, och hur mycket som är
ledigt. Läs den varje gång du startar om.

`LOG_LEVEL=debug` i compose ger mer när något behöver felsökas.

## Vad som inte finns ännu

Mobilläge, textutläsning, datorvy och säkerhetskopiering. Servern tar emot och lagrar
kvitton, men ingenting läser dem ännu — `fields` och `text` i sidecaren står tomma.
Ordningen är avsiktlig, se milstolparna i planen.
