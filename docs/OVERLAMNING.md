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

**Delade mönster bor i `styles/monster.css`.** Notisen, miniatyren och telefonens
topprad ritades förut i varje komponentfil för sig, och gled isär. Fyra regler gäller:

*En typskala.* Fyra steg på 1,125 från 16 px — 14/16/18/20 — vilket är exakt Tailwinds
`text-sm/base/lg/xl`, så ytorna delar skala i stället för att ha var sin. Filen påstod
förut att den var 1,125 medan talen var 12/13/16/18/22/28. `--typ-xl` är ytans egen
rubrik och ingenting är större; en rubrik **inuti** en yta är `--typ-lg`. Det var
tvärtom förut: h2 var 22 px och h1 18.

*Ett miniatyrformat.* Kvittots eget, 3:4, i tre storlekar (`--tumnagel-sm/md/lg`).
Höjden räknas ur bredden med `aspect-ratio` i `.tumnagel`, så en ny plats kan välja
storlek men inte proportion. Det fanns fyra format.

*En ledande kontroll per telefonskärm.* Menyn på toppnivån, bakåtpilen på en undersida,
krysset i ett flöde — alltid 48 px, alltid först. Därför står rubriken på 64 px från
kanten på varje skärm; det var 56, 64 och 16 förut. Menyknappen är `btn-lg` på
telefonen, vilket är DaisyUIs egen 48, inte ett eget mått: standardknappens 40 px är
under WCAG:s tryckminimum.

*Ett sätt att visa ett meddelande per yta.* Skrivbordet: DaisyUI-alert. Telefonen:
`.notis`, med `.illa` eller `.varsam` för nivån och `.svavande` när meddelandet gäller
något användaren just gjorde i stället för sidans innehåll. Fältfel är något annat och
står kvar under sitt fält.

Täthetsaxeln (`data-density`) är telefonens. Skrivbordet får sina mått ur DaisyUI, och
attributet satt på en enda skrivbordsskärm där det bara ändrade radavstånd.

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

Tre granskare — frontend, UX och UI — gick över koden och hittade **109 fel**. Alla är
åtgärdade, i sju omgångar: datafel och regelbrott, köer utan utgång, telefonytan,
kanter och tabellmått, texten, de elva buggarna, och sist formen och skräpet.

Sex mönster är värda att inte återinföra:

**Svar som inte kontrolleras.** Ett `fetch` vars status aldrig prövas, plus ett `as`
som gör den ogranskade formen till en typ. Orsaken till fyra av de fem värsta buggarna.

**Något som startas utan att stoppas.** `startaLopande()` i en konstruktor medan
`stoppaLopande()` bara fanns på papperet — och tjänsten lever i roten.

**Lägen utan utgång.** Varje rad i aktiviteten måste kunna nå ett slut med appens egna
medel.

**Egna klasser ovanpå DaisyUI.** Se avsnittet om gränssnittet.

**`display` utan villkor på en `<dialog>`.** Egna regler slår ut webbläsarens
`dialog:not([open]) { display: none }`, och rutan ligger och lyser över skärmen även
när den är stängd. Layouten hör på `[open]`, resten på elementet.

**Ett klassnamn med två betydelser i samma fil.** `.farlig` var både en textfärg på
lägesraden och en knappfyllnad; statusraden blev ett rött block utan läsbar text.
Ingetdera av de här två syns i en diff — båda hittades av att skärmen renderades.

### Kvar av listan

**Buggarna är åtgärdade** — alla elva, 2026-08-30 sent. Testerna är 22 i webben och
111 i servern, alla gröna, och varje rättning är dessutom renderad i en huvudlös
webbläsare och avläst på skärmen, inte bara i koden. Tre saker föll ut som är värda
att bära vidare:

**"Avbryt" kastar nu på riktigt.** Den släppte förut skärmen medan kön laddade upp
bilderna ändå, och kvittot blev liggande i arkivet utan känt antal bilder — alltså
ofärdigt för alltid. `discardReceipt()` i kön är den enda platsen i appen där bilder
försvinner utan att ha nått arkivet, och den ligger bakom en `<dialog>` som säger vad
som händer. Regeln om oåterkalleliga bilder skyddar mot **tyst** förlust — en krasch,
ett tappat svar, en kapplöpning — inte mot en människa som står med papperet kvar i
handen och säger nej.

**Avvisningen bär sitt skäl.** `stuck` var en lista med id:n, vilket gjorde alla fel
lika: en bild servern inte kan läsa fick samma "Försök igen" som en krock en människa
kan lösa vid datorn. Nu är den `Fastnat[]` med `status`, `skal` och `gorOm`, och bara
det som `gorOm` säger något om släpps av knappen. En 415 får i stället sin egen väg ut
— *Kasta bilderna* — för ett läge utan utgång är värre än en radering.

Och `pass()` hoppar nu över det som redan är avvisat. Märkningen påstod att den
hindrade "en tyst loop som ingen ser", men ingenting stoppade slingan: kvittot
skickades om var femtonde sekund i evighet.

**Mönstret bakom fem av dem: ett tillstånd som saknades.** Överlappande `load()` utan
sekvensnummer, `refresh()` likaså, "Hämtar …" som betydde "inga rader" i stället för
"en hämtning pågår", "Försök igen nu" utan vetskap om nät eller om det fanns något att
försöka med, och driftsidans avsaknad av 401. Var och en är en signal som inte fanns.

**Hela väggen är tom.** Buggarna, konsekvensen och formen, och skräpet — 2026-08-30.
Det som stod kvar var inga buggar utom en, och den togs också:

**Kön försöker när appen öppnas.** `start()` körde bara `refresh()`, så en kö som legat
kvar sedan förra sessionen väntade på femtonsekundersklockan innan något hände. Den som
öppnade sidan just för att se kön fick stillastående som svar.

**Formen är fyra regler, inte åtta rättelser** — de står i avsnittet om gränssnittet:
en typskala, ett miniatyrformat, en ledande kontroll per telefonskärm, ett sätt att
visa ett meddelande per yta. Dessutom: kvittovyn bryter vid **lg (1024)** och inte xl,
för den staplade sig till en kolumn på varje laptop under 1280 px; laddläget heter
"Hämtar …" överallt, inte "Läser status …" på driftsidan; och verben är ett per
operation — **Tolka** läser en bild, **Räkna om** räknar fält ur text som redan finns,
**Uppdatera** hämtar en frisk sida, **Försök igen** hämtar om efter ett fel. Fyra
knappar hette något med "tolka" och menade tre olika saker.

**Skräpet är borta.** 33 döda tokens (granskningen sa 27; mekanisk räkning gav 33),
`@angular/forms` ur `package.json` och låsfilen, `confirmedAt` som lästes men aldrig
skrevs — att posten finns kvar *är* att den inte är kvitterad, ett fält till kan bara
hamna i otakt — och datumformateringen samlad i `web/src/app/shared/datum.ts` med fyra
former, en per fråga, i stället för fem komponenter med tre format.

`previewWarning` raderades inte utan kopplades in: `normalise()` säger nu om
webbläsaren kunde avkoda filen, och kan den inte det står det på skärmen att bilden är
sparad men inte visningsbar. Grenen fanns, signalen sattes aldrig — och utan orden ser
en trasig ruta i remsan ut som en förlorad bild.

**Medvetet kvar:** att "saknar datum eller belopp" är en lista att beta av. Ett kvitto
utan datum går inte att sortera eller filtrera på — det är en verklig lucka, inte en
kvittering av något som redan fungerar. Beslutet står.

## Skalet i cachen

Appen har en service worker (`@angular/service-worker`) och ett webbmanifest sedan
2026-08-30. Utan dem laddades **ingenting** i en butik utan täckning: kön i IndexedDB
räddar bilder man hunnit ta, men bara om fliken redan är öppen — och utan app finns
ingen kamera att öppna.

Tre beslut, alla mätta:

**Modellerna cachas inte i förväg.** `ngsw-config.json` har tre grupper: skalet och
ikonerna med `prefetch`, och `tolkningen` — 37 MB modeller plus WASM-runtime — med
`lazy`. En förcachning hade laddat ned 37 MB i butiken.

**Registreringen sker efter två sekunder, inte "när appen är stabil".** Angulars
standard är `registerWhenStable:30000`, och den här appen blir aldrig stabil: kön har
en femtonsekunderstimer och tolkningen en på trettio. Standarden föll därför alltid
tillbaka på sin bortre gräns, och den som öppnade appen och stängde den efter tjugo
sekunder fick aldrig någon service worker alls. Uppmätt: med `registerWithDelay:2000`
kontrollerar tjänsten sidan efter tre sekunder.

**En ny version tas i bruk tyst**, utan ruta om att en uppdatering finns — men aldrig
medan man står i fångsten eller på ett kvitto, för de skärmarna bär tillstånd som bara
finns i minnet. Listan i `app.component.ts` heter `ARBETE_PAGAR`.

Två fel som service workern avslöjade, båda värda att inte återinföra:

**Nätverksfel är inte utloggning.** `auth.check()` svarade `false` när servern inte gick
att nå, och skalet kastade den som stod i en källare till en inloggningsruta som inte
går att logga in i. Den svarar nu `true | false | null`, och bara ett bestämt nej leder
vidare.

**API-svar cachades av webbläsaren.** Arkivet skickade inget `cache-control` alls, och
utan nät svarade `/api/receipts` 200 med en gammal lista som skärmen visade som
aktuell. Ett arkiv som ljuger tyst är sämre än ett som säger att det inte når servern.
Alla `/api/`-svar bär nu `no-store`; bilderna är undantaget och behåller sin hårda cache
eftersom de är oföränderliga. Det finns ett test.

**Prövat med servern avstängd**, inte emulerad: appen öppnas, listan säger att den inte
når arkivet, kameran fungerar, ett kvitto fångas och ligger kvar i kön — och går fram
av sig själv när servern kommer tillbaka. Första besöket kräver några sekunder på nätet
innan skalet ligger i cachen; det är ofrånkomligt och värt att veta.

## Mätsidan på `/debug` — tillfällig, ska bort

Byggd 2026-08-30 på beställarens uttryckliga tillåtelse, för att han ska kunna köra
sina egna kvitton genom kedjan och få siffror ur den. **Den är inte en del av appen.**
Den står inte i menyn, ligger utanför `/telefon` och `/dator`, och ingen annan fil
importerar något ur den.

Så tas den bort, helt: radera katalogen `web/src/app/debug/` och rutt-blocket märkt
"TILLFÄLLIG MÄTSIDA" i `app.routes.ts`. Servern är orörd — sidan använder bara rutter
som appen redan har.

Vad den gör: väljer man bilder läses varje bild i den här webbläsaren och en rad
skrivs med px, vald vridning, ms, tecken, rader, **tecken per rad**, konfidensens
median och p10, samt råtexten bakom en knapp. Med *Spara i arkivet* på går bilden hela
vägen — uppladdning, kvittens på sha256, komplettsignal, tolkning inlämnad — och
kolumnerna Butik, Datum och Belopp visar vad **servern** utvann. Sammandraget räknar
medianer och hur många som skulle flaggas av gränsen 7. *Kopiera mätningen* lägger allt
som JSON i urklippet.

Varför den finns i stället för en skärm i appen: ett kalibreringsurval **är** en lista
att beta av, och ingen skärm i appen får vara det. Mätningen hör hemma i något som
slängs. Siffrorna den ger är underlaget till M9 och till frågan om gränsen 7 är rätt
satt.

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
