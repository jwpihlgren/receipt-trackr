# Överlämning

Skriven 2026-08-30, omskriven samma kväll efter en dags omfattande ändringar. Läs den
här filen först, sedan planen i `~/.claude/plans/atomic-waddling-nautilus.md`.

## Vad det här är

Ett privat kvittoarkiv för ett hushåll om två personer. Cirka trettio kvitton finns
idag, sedan ett i taget allt eftersom man handlar. **Tiotusen är ett teoretiskt
livstidsmax, inte en backlog som ska läsas in** — den siffran har missförståtts en
gång och ledde till en rekommendation om en dokumentskanner för sextusen kronor.

Kör på en ZimaBoard 2 (Intel N150, passivt kyld) hemma, på ZFS med 14,9 TiB fritt.
Nås på `http://<zima-ip>:5000` över hemnätet, och `https://zima.encke-shark.ts.net`
via Tailscale utifrån.

## Regler som inte får brytas

**Allt körs i engångscontainrar.** Värden har varken Node, npm eller byggverktyg och
ska aldrig få det. Ge alltid hela `docker`-kommandot, aldrig ett bart `node`.

**Sidecar-filen är sanning, SQLite-indexet är härlett.** Skrivordningen är sidecar
först (tmp → fsync → rename → fsync på katalogen), index efteråt, aldrig tvärtom.
Därför finns inga migrationer: en schemaändring är en `reindex`, och indexet gör det
självt när dess `user_version` inte stämmer med kodens.

Undantaget är **radering**, som går åt andra hållet: index först, filer sedan. Kraschar
det däremellan tar `reindex` tillbaka kvittot — en misslyckad radering är ett bättre
fel än en rad som pekar på filer som inte finns.

**Den lokala kopian raderas först när servern svarat med samma sha256.** Ett
HTTP-svar med 200 är inget bevis på att rätt bytes kom fram.

**Servern räknar inte.** Den delar ut jobb och tar emot svar. Att telefonen frågar av
sig själv och datorn bara när någon trycker är beslut som fattas i klienten.
Beställaren har varit uttrycklig: hans dator arbetar när han från den datorn tar emot
ett jobb, aldrig annars. Det bröts en gång i dag — `stoppaLopande()` anropades aldrig,
så datorn fortsatte tolka efter ett ytbyte. Kontrollera att den regeln håller innan
något ändras i `tolkning.service.ts`.

**En människas ord väger tyngre än maskinen.** Har hon satt alla tre fälten själv, eller
sagt att maskinens läsning stämmer, är kvittot klart — hur illa tolkningen än gick.
Utan den regeln finns lägen utan utgång.

## Var saker ligger

| | |
| --- | --- |
| Planen | `~/.claude/plans/atomic-waddling-nautilus.md` (inte i repot) |
| Mätningarna | `spike/README.md` — M0 och M5a, med siffror och slutsatser |
| Drift | `docs/DRIFT.md` |
| Designduken | https://claude.ai/code/artifact/b45461bb-187b-4a6d-95ba-0ac0b79bd235 |
| Designkällorna | `design/*.dc.html` + `canvas.json`. Seedas om med skriptet i design-skillen |

## Informationsarkitektur

Ytan står först i adressen, och sedan vad sidan innehåller. `/telefon/kvitton` och
`/dator/kvitton` är samma sak sedd från två håll. Tidigare hette de `/kvitton` och
`/arkiv`, vilket gav två namn åt en sak och dolde att det var ytan som skilde dem.
Gamla adresser leder vidare.

**Appen heter Kvittoarkiv. Platsen heter Kvitton.** Samma ord i menyn, i rubriken och
i webbläsarfliken. Ett ställe, ett namn.

| Rutt | Innehåll |
| --- | --- |
| `/telefon/kvitton` | hemskärmen: **alla** kvitton, även ofärdiga (`?ofardiga=true`) |
| `/telefon/fanga` | öppnar telefonens egen kameraapp; appen har ingen sökare |
| `/telefon/uppladdning` | kön av bilder på väg in |
| `/telefon/kvitto/:id`, `/telefon/aktivitet` | samma komponenter som datorns, men vet vilken yta de står på |
| `/dator/kvitton` | arkivet: **bara klara** kvitton, tabell med filter, sorterad på kvittots eget datum |
| `/dator/aktivitet` | allt som inte är klart, oavsett läge, med läget som kolumn |
| `/dator/kvitto/:id` | bild, fält som formulär, radering |
| `/dator/drift` | utrymme, monteringspunkt, säkerhetskopior |

**Klart** betyder: fångsten avslutad, alla utlovade bilder framme, butik + datum +
belopp lästa, och antingen en tolkning som gett text av dugligt kvalitetsmått **eller**
tre fält satta av en människa. Definitionen står på ett ställe, `KLAR` i `index-db.ts`.
Två listor som frågar om samma sak måste fråga likadant.

**Låg konfidens skapar aldrig en rad.** Konfidensen mäts, den beordrar ingenting.

### Aktivitetens lägen, och vägen ut ur var och en

| Läge | Vägen ut |
| --- | --- |
| Väntar på tolkning | *Tolka nu* — läser bilden i den här webbläsaren, direkt |
| Ingen text lästes | skriv in de tre fälten |
| Bilden gick knappt att läsa | *Fälten stämmer*, eller rätta dem |
| Saknar butik/datum/belopp | skriv in det som saknas |
| Fångsten avslutades inte | *Kvittot är helt* |
| Bilder saknas | *Bilden är borta* — förlusten skrivs i sidecarens `lostSegments` |

Det fanns en kö byggd på motsatt premiss — `/pass`, senare `/ratta` — som räknade varje
fungerande tolkning som arbete åt beställaren. Den revs 2026-08-30. Förebilden är
Sonarrs *Activity*: systemet gör jobbet, listan är undantagen.

## Gränssnittet

**Mörk arbetsbänk, riktning A** ur designduken, vald av beställaren. Ett läge, inte
två: ljusa läget och `prefers-color-scheme` är borta, `<html data-theme="kvitto">`.
Ytorna är äkta grå — #1f1e23 paneler mot #17161a sida — aldrig svart, med höjd som
ljushetsskillnad. Bildbädden #0e0d10. Accenten är varm bärnsten #e2b04a, inte blå:
närmast papperet i ton och krockar inte med felrött eller varningsgult i samma rad.

**DaisyUI bär komponenterna.** Egna verktygsklasser ovanpå dem utgår — `flex-col` mot
ett rutnät biter inte, `alert-vertical` finns. Egna regler som ändrar bibliotekets
mått utgår också: de låg i `@layer components` och förlorade tyst mot DaisyUIs eget
lager, så tabellen hade bibliotekets mått hela tiden utan att jag visste det.

Ett undantag är motiverat och mätt: **kontrollernas kanter**. DaisyUI räknar dem ur
bläcket vid 20 %, vilket i den här paletten ger 1,09:1 för en neutral knapp och 1,64:1
för ett fält. Kravet är 3:1. De ligger på `--line-strong` #6e6c7b, uppmätt 3,2:1 mot
panelen. Raddelare är dekor och rörs inte — tätheten ska komma ur typografin.

Telefonytan har egna komponenter men **delar palett**: dess CSS läser bara tokens, och
tokens är värde för värde identiska med DaisyUI-temat. Inga literala färger finns
någonstans utom i `styles/tokens.css` och `styles.css`.

`tokens.css` får inte heta samma sak som Tailwinds egna namnrymder. Den gjorde det —
`--text-*`, `--radius-*`, `--font-*` — och skrev över hela verktygsskalan. De heter nu
`--typ-*`, `--horn-*`, `--typsnitt-*`, `--radavstand-*`, `--teckenavstand-*`.

## Vad som är mätt, och vad siffrorna betyder

Ingenting nedan är gissat. Bryt inte mot det utan att mäta om.

**tiny slår small.** 598 tecken mot 418, högre konfidens, tre gånger snabbare.
Bekräftat två gånger: i Node med sharp (M0) och i webbläsare med canvas (M5a).

**`raw` slår `clahe`.** Ingen kontrastbehandling. Det tar bort hela OpenCV-beroendet.

**Telefonen orkar tolka.** 2023 ms per bild, snabbare än datorn — därför att den nåddes
över https och fick flertrådad WASM. Entrådat kostar ~25 %.

**91 % av backloggens bilder saknar EXIF-orientering.** Regeln ligger i
`web/src/app/ocr/orientering.ts`. Bilder appen själv fångat är redan upprätta — jobbet
bär `uppratt`.

**Datumsvagheten var inte OCR:ens fel.** `2026-06-31` stod bredvid tre segment som
läste `2026-05-31`. Kalendern förkastar, en sifferförväxling får laga, samstämmighet
avgör. Ett datum efter fototillfället kan inte vara ett inköpsdatum.

**Tecken per läst rad är kvalitetsmåttet.** 4,0 och 5,4 på de suddiga mot 11 i
normalfallet. Gränsen 7 står i `index-db.ts` och **är inte prövad mot en riktig hög**.
Klienten räknar måttet och lagrar det i `ocr.teckenPerRad`; saknas det flaggas
ingenting, för okänt är inte dåligt.

## Granskningen 2026-08-30

Tre granskare — frontend, UX och UI — gick över koden och hittade **109 fel**. Ungefär
hälften är åtgärdade, i fem grupper: datafel och regelbrott, köer utan utgång,
telefonytan, kanter och tabellmått, samt texten.

Fyra mönster är värda att inte återinföra:

**Svar som inte kontrolleras.** Ett `fetch` vars status aldrig prövas, plus ett `as`
som gör den ogranskade formen till en typ. Orsaken till fyra av de fem värsta buggarna.

**Något som startas utan att stoppas.** `startaLopande()` i en konstruktor medan
`stoppaLopande()` bara fanns på papperet — och tjänsten lever i roten.

**Lägen utan utgång.** Varje rad i aktiviteten måste kunna nå ett slut med appens egna
medel.

**Egna klasser ovanpå DaisyUI.** Se avsnittet om gränssnittet.

### Kvar av listan

**Buggar:**

- *Avbryt* i fångsten laddar upp bilderna ändå, utan bekräftelse, och skapar ett kvitto
  utan `expectedSegments`. Ordet lovar motsatsen till vad som händer.
- Överlappande `load()` i arkivet: ändra butik och datum snabbt, så avgör svarsordningen
  vad tabellen visar.
- "Hämtar …" står kvar under felrutan för alltid när ett anrop misslyckats.
- Driftsidan visar `Http failure response for /api/health: 401` rakt av vid utgången
  session; den har ingen 401-hantering alls.
- `track segment.sha256` är instabil: två identiska bilder ger NG0955 i stället för en lista.
- Menyn är en fokusfälla — ingen Esc, ingen fokusflytt, bakgrunden inte inert.
- *Försök igen nu* saknar allt tillstånd och gör ingenting när man är offline.
- Sparfel vid full telefon syns bara i fångstvyn, inte på listan man står på.
- Tumnaglarna på uppladdningssidan är garanterat 404 — kvittona är per definition inte
  i arkivet än.
- `retryStuck()` nollar även det servern avvisat med 415/409, som aldrig går igenom.
- `refresh()` i kön är osekvenserad och kan skriva tillbaka en äldre lista.

**Konsekvens och form:** fem sätt att visa ett fel, tre laddlägen med två
formuleringar, fyra verb för samma operation, tre olika vänsterkanter på telefonens
rubriker, h2 större än h1, fyra miniatyrformat, typskalan som inte följer sin egen
beskrivning, kvittovyn som staplar sig ända upp till 1280 px.

**Skräp:** 27 döda tokens; täthetsaxeln (`data-density`) saknas på tre av fyra
skrivbordsskärmar så `--d-*` inte gäller där; `@angular/forms` importeras aldrig;
`confirmedAt` läses men skrivs aldrig; `previewWarning` har en mallgren som aldrig kan
visas; datumformatering dubblerad i fyra komponenter med tre olika format.

**Medvetet inte åtgärdat:** att "saknar datum eller belopp" är en lista att beta av.
Ett kvitto utan datum går inte att sortera eller filtrera på — det är en verklig lucka,
inte en kvittering av något som redan fungerar.

## Vad som inte är prövat

- **Ingenting av dagens arbete är kört mot beställarens egna kvitton.** Skärmarna är
  renderade i en webbläsare och mätta; de är inte använda.
- **Telefonens fångstflöde i mörkt läge.** Paletten är delad, men flödet är inte
  provat i handen.
- **Gränsen 7** för svagt läst text.
- **Kalibreringsurvalet** finns på servern med tester (`POST /api/granskning/urval`,
  `GET /api/granskning`, `POST /api/receipts/:id/granskning`) men **har ingen skärm**.
  Det är mätning, inte en uppgift i appen, och var det hör hemma är obestämt. Utan det
  finns inga siffror till M9.
- **Designduken säger 44 px rader och 13 px text.** Koden säger 35 och 12 — DaisyUIs
  egen skala. Duken ska rättas efter koden, inte tvärtom.

## Så arbetar beställaren

Han testar på riktig hårdvara och rapporterar rakt. Han vill ha **beslut, inte
alternativlistor**, och han säger ifrån när något är fel — lyssna första gången.

- **Fråga inte om samma sak igen.** Har han svarat är det svarat.
- **Återställningsövningen är ingen grind.** Han slänger sina kvitton när han vill.
- **Appen är appen.** Inga meddelanden till honom i gränssnittet — inga milstolpar,
  inga resonemang om designval, ingen brasklapp om vad som kommer senare. All
  kommunikation sker i samtalet.
- **Han är inte anställd för att rätta kvitton.** Ingen skärm får presentera en lista
  att beta av. Det som visas är det som gått fel.
- **Inga metaforer i gränssnitt eller adresser.** "Pass" var mitt ord och betydde
  ingenting för honom.
- **Inga "x av y"-räknare utspridda överallt.**
- **Bygg inte med påhittade data.** En tom kolumn är ärligare än en gissning.
- **Färg får bära betydelse**, men måste dubbelkodas. Konfidensgrad är undantaget: en
  siffra i neutralt bläck, för en färgskala skulle påstå en gräns ingen mätt.
- **Att det står i HTML att något fungerar är inget bevis.** Visa med tester, med
  mätningar, och med att han kör det. Rendera och titta innan du påstår att något är
  klart — det felet gjordes flera gånger i dag.

Han har med rätta sågat tre saker: att bygga innan jag designat, att designa utan att
fråga, och att presentera tre färgställningar av samma layout som tre riktningar.
Ordningen som fungerar är **research → design → bygg**, med UX och UI som egna
genomgångar.
