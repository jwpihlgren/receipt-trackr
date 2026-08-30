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

**Kvalitetsflaggan** (M8) sitter i samma tabell. Måttet är tecken per läst rad, räknat
av klienten som läste bilden och lagrat i `ocr.teckenPerRad`. Under 7 får kvittot läget
`svag_text` — den felklassen är annars osynlig, för en bild som lästs tecken för tecken
kan ha hög konfidens och fyllda fält och ändå vara fel rakt igenom. Gränsen står i
`server/src/store/index-db.ts` och vilar på sjutton segment i M5a: 4,0 och 5,4 på de
suddiga mot 11 i normalfallet. Saknas måttet flaggas ingenting — okänt är inte dåligt.

**Två omtolkningar, och de är olika dyra.** *Tolka om fälten* (`POST /api/falt/omtolka`,
knapp i aktiviteten) räknar om fälten ur texten som redan lästs, för hela arkivet —
ingen bild öppnas, och det är vägen när utvinningsreglerna blivit bättre. *Läs om
bilden* (`POST /api/receipts/:id/lasom`) kastar texten så att kvittot hamnar i
tolkningskön igen; det är den enda vägen när det som lästes inte går att lita på.
Rättelser överlever båda.

**Kvittovyns fältpanel är ett formulär.** Den var tidigare text man kunde klicka på,
och ett fält maskinen inte hittat ritades som ett tankstreck — det gick att rätta men
såg inte ut att gå. Beställaren hittade det inte, och han hade rätt.

**Kalibreringsurvalet** finns på servern (`POST /api/granskning/urval`,
`GET /api/granskning`, `POST /api/receipts/:id/granskning`) och är testat, men **har
ingen skärm**. Det är ett mätverktyg, inte en uppgift i appen, och var det ska visas
är obestämt.

Indexet bär en **schemaversion**. Stämmer den inte med koden kastas tabellerna vid
start och byggs om ur `receipts/`.

## Gränssnittet

**Mörk arbetsbänk — riktning A, vald 2026-08-30.** Ett läge, inte två: ljusa läget
och `prefers-color-scheme` är borta, och `<html data-theme="kvitto">` är satt. Ytorna
är äkta grå (#1f1e23 paneler mot #17161a sida), aldrig svart, med höjd som
ljushetsskillnad; bildbädden ligger på #0e0d10 så att papperets kant syns även när
fotot är överexponerat. Accenten är varm bärnsten #e2b04a, inte blå — närmast papperet
i ton, syns mot mörkret utan att skrika, och krockar inte med felrött eller
varningsgult. Tätheten kommer ur typografin: 44 px rader, 13 px text, versala
kolumnrubriker på 11 px, linjer bara där de skiljer två ting åt.

Valet gjordes mot tre riktningar i duken som skilde sig i **vad de gör till
huvudsak** — raden, fotografiet eller beloppet. Första försöket var tre färgställningar
av samma layout och underkändes med rätta.

**DaisyUI, med husets egen palett.** Knappar, tabeller, fält och paneler var
handskrivna och gled isär mellan skärmarna. Nu är komponenterna DaisyUIs, medan
färgerna är samma som förut — de valdes mot kvittobilder och prövades i mörkt läge,
och det arbetet görs inte om. Temat heter `kvitto`/`kvitto-morkt` och står i
`web/src/styles.css`. Tailwind och DaisyUI ligger i node_modules och bakas in; sidan
är cross-origin isolerad och kan inte hämta något utifrån ändå.

Datorytan är omgjord med DaisyUI. Telefonytan behåller sina egna komponenter men
**delar palett**: den har aldrig haft egna färger — dess CSS läser bara tokens, och
tokens är värde för värde identiska med DaisyUI-temat. Kontrollerat med grep: inga
literala färger finns någonstans utom i `styles/tokens.css` och `styles.css`.

**Namngivning: ett ställe, ett namn.** Ytan står först i adressen
(`/telefon/kvitton`, `/dator/kvitton`), appen heter Kvittoarkiv, platsen heter
Kvitton, och samma ord står i menyn, i rubriken och i webbläsarfliken.

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
3. **Gränsen 7 är inte prövad mot beställarens hög.** Den kommer ur sjutton segment.
   Flaggar den för mycket eller för lite ska siffran flyttas, inte förklaras bort.

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
