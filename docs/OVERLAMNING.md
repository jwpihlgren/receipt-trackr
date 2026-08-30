# Överlämning

Skriven 2026-08-30. Läs den här filen först, sedan planen i
`~/.claude/plans/atomic-waddling-nautilus.md` — den är reviderad samma dag och
stämmer med koden.

## Vad det här är

Ett privat kvittoarkiv för ett hushåll om två personer. Cirka trettio kvitton finns
idag, sedan ett i taget allt eftersom man handlar. **Tiotusen är ett teoretiskt
livstidsmax, inte en backlog som ska läsas in** — den siffran har missförståtts en
gång och ledde till en rekommendation om en dokumentskanner för sextusen kronor.

Kör på en ZimaBoard 2 (Intel N150, passivt kyld) hemma, på ZFS med 14,9 TiB fritt.
Nås på `http://<zima-ip>:5000` över hemnätet, och `https://zima.encke-shark.ts.net`
via Tailscale utifrån.

## Fyra regler som inte får brytas

**Allt körs i engångscontainrar.** Värden har varken Node, npm eller byggverktyg och
ska aldrig få det. Ge alltid hela `docker`-kommandot, aldrig ett bart `node`.

**Sidecar-filen är sanning, SQLite-indexet är härlett.** Skrivordningen är sidecar
först (tmp → fsync → rename → fsync på katalogen), index efteråt, aldrig tvärtom.
Därför finns inga migrationer: en schemaändring är en `reindex`.

**Den lokala kopian raderas först när servern svarat med samma sha256.** Ett
HTTP-svar med 200 är inget bevis på att rätt bytes kom fram.

**Servern räknar inte.** Den delar ut jobb och tar emot svar. Att telefonen frågar av
sig själv och datorn bara när någon trycker är beslut som fattas i klienten.
Beställaren har varit uttrycklig: hans dator arbetar när han från den datorn tar emot
ett jobb, aldrig annars, och det får aldrig flytta in på servern.

## Var saker ligger

| | |
| --- | --- |
| Planen | `~/.claude/plans/atomic-waddling-nautilus.md` (inte i repot) |
| Mätningarna | `spike/README.md` — M0 och M5a, med siffror och slutsatser |
| Drift | `docs/DRIFT.md` |
| Designytan | https://claude.ai/code/artifact/b45461bb-187b-4a6d-95ba-0ac0b79bd235 |
| Designkällorna | `design/*.dc.html` — 18 skärmar, mobil och skrivbord |

## Läget just nu

M0 till M6 är byggda. M7 är nästan klar — rättningspasset finns, granskningsurvalet
saknas. M8 måste skrivas om.

**Fångst.** Ingen livekamera. `getUserMedia` kräver säker kontext, och det kravet
dikterade hela nätverksarkitekturen — därför öppnar ett filinput telefonens egen
kameraapp i stället. Appen är blind i fångstögonblicket och ska inte låtsas annat.
Granskningen ligger direkt efter återkomsten, och "Börja här" visar slutet på förra
bilden *före* avfärden till kameran, som ett minne man bär med sig.

**Inloggning.** En lösenordsfras för hushållet i `AUTH_PASSWORD`, scrypt, signerad
httpOnly-kaka. Ingen användartabell — den hade infört migrationsskulden designen
finns till för att slippa. `/api/health` och de statiska filerna är öppna, allt annat
under `/api` är stängt. Servern vägrar starta utan fras.

**Tolkning.** PP-OCRv6 tiny via `ppu-paddle-ocr/web` i en Web Worker, modellfiler ur
imagen (hämtas i bygget av `scripts/hamta-modeller.mjs`). Kön härleds ur indexet —
tom FTS-text betyder otolkat. Reservationer lever i minnet och aldrig på disk.

**Fältutvinning** kör på servern, inte på klienten. Det är regexar och räkning, och
därför räcker `POST /api/falt/omtolka` för att låta bättre regler nå gamla kvitton
utan att en bild läses om. Rättelser skrivs över aldrig.

**Aktiviteten** ligger på `/aktivitet`. Två avdelningar: *Pågår* (hur många som väntar
på tolkning, och knappen som startar den på just den här datorn) och *Behöver dig* —
och den senare innehåller **bara sådant som faktiskt gått fel**: bilder som aldrig kom
fram, en tolkning som gav noll text, fält som inte gick att hitta. En rad leder till
kvittovyn, där felet lagas, och försvinner sedan.

Låg konfidens skapar ingen rad, och ett fält maskinen läst utan att någon kvitterat
det är inte en uppgift. Det fanns en kö byggd på motsatsen — `/pass`, senare `/ratta` —
och den revs 2026-08-30: den räknade varje fungerande tolkning som arbete åt
beställaren, vilket är en anställningsmodell och inte det han bett om. Förebilden är
Sonarrs *Activity*: systemet gör jobbet, listan är undantagen.

**Kalibreringsurvalet** finns på servern (`POST /api/granskning/urval`,
`GET /api/granskning`, `POST /api/receipts/:id/granskning`) och är testat, men **har
ingen skärm**. Det är ett mätverktyg, inte en uppgift i appen, och var det ska visas
är obestämt.

Indexet bär en **schemaversion**. Stämmer den inte med koden kastas tabellerna vid
start och byggs om ur `receipts/`.

## Vad som är mätt, och vad siffrorna betyder

Ingenting nedan är gissat. Bryt inte mot det utan att mäta om.

**tiny slår small.** 598 tecken mot 418, högre konfidens, tre gånger snabbare.
Bekräftat två gånger: i Node med sharp (M0) och i webbläsare med canvas (M5a). Det
är kontraintuitivt och stämmer ändå.

**`raw` slår `clahe`.** Ingen kontrastbehandling. Det tar bort hela
OpenCV-beroendet ur förbehandlingen.

**Telefonen orkar tolka.** 2023 ms per bild, och snabbare än datorn — därför att den
nåddes över https och fick flertrådad WASM. Entrådat kostar ~25 %.

**91 % av backloggens bilder saknar EXIF-orientering.** En liggande sida läses som
skräp med hög konfidens. Regeln ligger i `web/src/app/ocr/orientering.ts`: andelen
höga textrutor avgör *om* sidan ligger ned, en provläsning åt båda hållen avgör *åt
vilket håll*. Bilder appen själv fångat är redan upprätta — jobbet bär `uppratt`.

**Datumsvagheten var inte OCR:ens fel.** `2026-06-31` stod bredvid tre segment som
läste `2026-05-31`. Den 31 juni finns inte. Kalendern förkastar, en enda
sifferförväxling får laga, samstämmighet avgör. Ett datum efter fototillfället kan
inte vara ett inköpsdatum.

**Tecken per läst rad är kvalitetsmåttet.** 4,0 och 5,4 på de suddiga bilderna mot
11 i normalfallet. Gränsen ligger kring 7. Det är M8:s nya innehåll.

## Nästa steg

1. **Aktiviteten är byggd men inte körd av beställaren.** Den ska ses på burken innan
   något byggs ovanpå.
2. **Kalibreringsurvalet behöver en plats.** API:t finns; skärmen gör det inte.
   Mätning, inte uppgift.
3. **Kvalitetsflaggan** (M8 omskriven). Tecken per rad, på servern. Ett kvitto under
   gränsen är ett problem i aktivitetslistan — det är där den hör hemma.

## Så arbetar beställaren

Han testar på riktig hårdvara och rapporterar rakt. Han vill ha **beslut, inte
alternativlistor**, och han säger ifrån när något är fel — lyssna första gången.

Fyra saker han uttryckligen sagt:

- **Fråga inte om samma sak igen.** Har han svarat är det svarat.
- **Återställningsövningen är ingen grind.** Han slänger sina kvitton när han vill.
- **Bygg inte med påhittade data.** En tom kolumn är ärligare än en gissning, och han
  har underkänt gränssnitt som påstod saker systemet inte kan.
- **Appen är appen.** Inga meddelanden till beställaren i gränssnittet — inga
  milstolpar, inga resonemang om varför något är utformat som det är, ingen
  brasklapp om vad som kommer senare. All kommunikation sker i samtalet.
- **Han är inte anställd för att rätta kvitton.** Ingen skärm får presentera en lista
  att beta av. Det som visas är det som gått fel.
- **Inga metaforer i gränssnitt eller adresser.** "Pass" var mitt ord och betydde
  ingenting för honom.
- **Att det står i HTML att något fungerar är inget bevis på att det gör det.** Visa
  med tester och med att han kör det.
- **Färg får bära betydelse**, men måste dubbelkodas för tillgänglighetens skull.
  Konfidensgrad är undantaget: den är en siffra i neutralt bläck, för en färgskala
  skulle påstå en gräns ingen mätt.

Han har också, med rätta, sågat två saker jag gjorde: att bygga innan jag designat,
och att designa utan att fråga. Ordningen som fungerade var **research → design →
bygg**, med UX och UI som egna genomgångar.
