# M0 — spike

Mäter PP-OCRv6 mot verkliga kvitton **på ZimaBoarden**, inte på utvecklingsmaskinen.
Svarar på fyra frågor och inget annat:

1. Läser den materialet överhuvudtaget — och om inte, faller det på **detektionen**
   (inga textrutor hittas), på **igenkänningen** (rutor finns, men ingen text) eller på
   **orienteringen** (rutor och text finns, men ett tecken per rad för att sidan ligger ned)?
2. Vilken modellnivå och indatabredd är värd sin körtid på det här materialet?
3. Kommer per-rad-konfidensen faktiskt ut, och varierar den användbart?
4. Vad blir genomströmningen när det passivt kylda kortet blivit varmt?

Ingenting härifrån ska överleva in i servern.

## Kör

Spiken körs i en engångscontainer, aldrig direkt på ZimaBoarden — värden hålls fri från
Node, npm och globala paket. Varje kommando nedan säger var det ska köras.

**På värden**, en gång:

```sh
mkdir -p ~/.cache/ppu-paddle-ocr
```

Modellcachen ligger på `$HOME/.cache/ppu-paddle-ocr` inne i containern, alltså utanför
monteringen av repot. Utan den katalogen hämtas ~150 MB modeller vid varje ny container.

**På värden**, före varje körning:

```sh
cd ~/repos/receipt-trackr && git pull
```

**Starta containern**, på värden:

```sh
docker run -it --rm -u $(id -u):$(id -g) -e HOME=/home/node \
  -v ~/repos/receipt-trackr:/repo \
  -v ~/.cache/ppu-paddle-ocr:/home/node/.cache/ppu-paddle-ocr \
  -w /repo/spike node:22 bash
```

`-e HOME=/home/node` gör hemkatalogen explicit i stället för att förlita sig på att uid:t
råkar slå upp mot `node`-användaren i imagen; annars hamnar cachen någon annanstans och
monteringen ovan blir verkningslös. `-u` gör att filerna containern skapar ägs av dig och
går att läsa på värden efteråt.

**I containern**, första gången och efter varje `git pull` som rör `package.json`:

```sh
npm ci
```

`node_modules/` ligger under monteringen och överlever `--rm`, så resten av gångerna kan
det hoppas över. Installationen måste ske i containern: `onnxruntime-node` har kompilerade
binärer som ska matcha den runtime som kör dem.

**I containern**, körningarna:

```sh
# de två högarna mäts var för sig, aldrig ihop
node run.mjs --samples=./samples/gamla   --out=./out-gamla
node run.mjs --samples=./samples/farska --out=./out-farska

node run.mjs --tiers=small --sustained=60      # uthållighetstest, en timme
node run.mjs --threads=4                       # trådtak för ONNX-runtimen
node run.mjs --widths=1280,1600,2000,full      # nedskalning före OCR som egen axel
node run.mjs --tiers=tiny,small,medium         # medium är inte med som standard
node run.mjs --crops --tiers=small             # sparar varje beskuren textruta som PNG
node run.mjs --rotations=auto                   # vridningen avgörs per bild — använd den
node run.mjs --rotations=exif,90,270           # orienteringen som egen mätaxel
node run.mjs --vertcrops=false                 # läs höga rutor ovridna, se nedan
```

`--rotations=auto` avgör vridningen en gång per bild före mätmatrisen och är den enda
inställning som är rättvis mot materialet: högen innehåller både liggande och stående
bilder, så en påtvingad vridning förstör den ena gruppen medan den räddar den andra.
Beslutet tas med `tiny` på den minsta uppmätta bredden och kostade 0,55 s per bild när det
mättes. Det kan inte kombineras med andra vridningar i samma körning.

Standard är `--tiers=tiny,small`, `--widths=1600,full` och `--rotations=exif`. `medium` togs
ur standard­urvalet sedan den mätts till ~28 s/bild på ZimaBoarden — den behöver läggas till
med flaggan om den ska vara med, och bara när det finns skäl att tro att den är värd tio
gånger körtiden.

Första körningen hämtar modellerna, ~150 MB för medium, så maskinen behöver nå nätet just
då. Med cachen monterad enligt ovan sker det bara en gång.

Resultat hamnar i `--out`-katalogen: `summary.md` (läsbar tabell), `summary.json` (rådata),
`text/` (all utläst text med konfidens per rad, för att bedöma kvalitet för hand) och med
`--crops` även `crops/` (varje beskuren textruta som PNG).

**Läs `summary.md` uppifrån.** Första tabellen svarar på om läsningen fungerade alls. Är den
röd är resten av rapporten meningslös, och rätt åtgärd står under tabellen: noll rutor pekar
på bilderna — beskärning, skärpa, att kvittot fyller bildrutan — medan rutor utan text pekar
på beskärningarna i `crops/`.

**Andra tabellen är orienteringen**, och den står före hastighet och konfidens av ett skäl:
den ogiltigförklarar allt under sig när den är fel. Kolumnen *tecken per rad* är måttet att
titta på. Ligger den kring 1 är sidan vriden, hur bra siffrorna i övriga tabeller än ser ut.
`summary.json` har samma sak per bild: `source` (måtten på disken), `exifOrientation`
(taggen, `null` när den saknas), `pixels` (måtten efter förbehandling) och `charsPerLine`.

Modellerna hämtas vid första körningen till `~/.cache/ppu-paddle-ocr`. I produktion
bakas de in i imagen i stället — inget ska hämtas över nätet vid drift (krav 50).

## Urvalet spelar roll

Lägg in **blekt termopapper ur högen och färska kvitton var för sig**, och kör dem som
två omgångar. En sammanslagen siffra ger falskt underkänt, precis som kravställningens
mätavsnitt säger. Bilderna är privata och är utestängda från git.

## Kända fel i tidigare körningar

### Ett tecken per rad — sidan ligger ned (körning två, 2026-08-28)

Andra körningen mot samma 35 kvitton gav ungefär ett tecken per läst rad: 56 rutor gav
56 tecken, 58 gav 58. Två bilder av 35 lästes normalt, och just de två var de enda stående
— 1600x2133 mot 1600x1200 för resten.

Ett tecken per rad är signaturen för text som ligger på sidan. Detektorn ramar in raderna
utmärkt, men varje ruta blir hög och smal i stället för bred och låg, och biblioteket vrider
som standard sådana rutor 90° moturs innan de läses (`rotateVerticalCrops`, `--vertcrops`).
Raden blir då vågrät medan varje **tecken** fortfarande ligger ned, och igenkänningen får ur
sig ett tecken med låg konfidens i stället för en rad. Konfidensen bekräftar det: 0,21 i
medel på en liggande bild mot 0,95 på en stående. Samma sak går att framkalla med flit —
det syntetiska kvittot, som läses med 282 tecken och konfidens 0,94, ger 11 tecken, 1,2
tecken per rad och konfidens 0,42 när det körs med `--rotations=90`.

Felet är däremot **inte** att spiken hoppade över EXIF-orienteringen. `sharp` har rätat upp
bilderna sedan första commiten, numera via `autoOrient` på indatasteget, vilket sker redan
vid avkodningen och därmed före skalning och gråskala oavsett i vilken ordning anropen står.
Måtten säger i stället att bilderna är liggande *efter* att taggen tillämpats. Två
förklaringar återstår, och de kräver olika åtgärder:

- **Taggen saknas.** Telefonen sparade sensorns liggande bild utan Orientation, eller så
  tvättade överföringen bort metadatan. Ingen automatik kan då räta upp bilden — och
  webbläsaren visar den lika liggande som servern läser den.
- **Taggen finns och är 1.** Bilderna är helt enkelt tagna med telefonen liggande, och
  kvittot ligger på sidan i bildrutan.

**Diagnosen kördes 2026-08-28 och svaret är entydigt: taggen saknas.** 91 % av bilderna i
den gamla högen har ingen EXIF-vridning alls, 94 % är liggande efter förbehandlingen och
86 % lästes ett tecken i taget. Vriden 90° läser samma hög med 834 tecken per bild och
konfidens 0,95 mot 29 tecken och 0,27 upprätt — belopp hittas på 94 % av bilderna mot 6 %,
och åäö på 89 % mot 3 %. Motsatt håll, 270°, ger 639 tecken men konfidens 0,58 och belopp
på 11 %: texten står då upp och ner, vilket ger läsbar längd utan läsbart innehåll. Det är
värt att notera, för teckenantal ensamt hade sagt att båda hållen fungerade.

Tiderna ska läsas i samma ljus. 583 ms per bild upprätt mot 1272 ms vriden är inte en
kostnad för uppräting — det är priset för att faktiskt läsa text i stället för att kasta
tomma rutor.

Åtgärden är alltså inte en generell vridning: två bilder av 35 står redan upp och skulle
förstöras av en sådan. Vridningen avgörs per bild, med `--rotations=auto`.

Hela mätserien före det här är ogiltig, slutsatsen om `clahe` inräknad: 33 av 35 bilder
mätte brus, och brus varierar godtyckligt mellan modellnivåer. Att `small` såg sämre ut än
`tiny` betyder därför ingenting alls.

### Mätverktyget mätte fel sak (körning ett, 2026-08-28)

Den allra första körningen mot 35 riktiga kvitton rapporterade träffar på 3–6 % av
bilderna och en medelkonfidens på 0,95 samtidigt. Den kombinationen är omöjlig, och orsaken
låg i mätverktyget, inte i materialet:

- **Biblioteket kastar allt under 0,5 i konfidens** (`minimumConfidence`, standard 0.5).
  Fördelningen som spiken finns för att mäta var alltså avhuggen nedtill — därav den höga
  medianen bredvid nästan inga rader. Numera sätts tröskeln till 0.
- **Rader räknades som radgrupper**, inte som rader, och tomma rutor räknades som lästa.
- **Detektion och igenkänning mättes ihop**, så ett misslyckande gick inte att lokalisera.
- **Full upplösning in** gav 48 rutor varav 38 tomma där 1600 px ger 11 rutor och samma
  text på halva tiden. Nedskalning är därför en egen mätaxel numera.

## Krav på förbehandlingen i produktion

Uppräting är inte en spikedetalj utan ett krav på servern, och hör därför hemma i planen:

1. **Bilden rätas upp explicit, först i kedjan** — `sharp(buf, { autoOrient: true })`, före
   skalning, gråskala och kontrastarbete. Att stegen inte går att kasta om av misstag är
   halva poängen med att lägga det på indatasteget.
2. **EXIF räcker inte som garanti** — 91 % av bilderna i den gamla högen saknar taggen helt.
   Orienteringen måste avgöras på pixlarna, och regeln som mätts fram ser ut så här:
   andelen textrutor som är högre än breda avgör *om* sidan ligger ned (tröskel 0,5, mätt
   till 0,86 på liggande bilder och 0 på stående), och en provläsning åt båda hållen avgör
   *åt vilket håll* — 90° och 270° går inte att skilja på formen, bara på medelkonfidensen
   (0,95 mot 0,58 på samma hög). `calibrateOrientation()` i `run.mjs` är den regeln.
3. **Vridningen avgörs per bild, aldrig för hela högen.** Två bilder av 35 står redan upp;
   en generell vridning räddar 33 och förstör 2.
4. **Felet ska synas.** En bild som lästes ett tecken i taget får inte sparas som ett kvitto
   med tomma fält. Tecken per läst rad är måttet som fångar det, och det hör till samma
   granskningskö som låg konfidens. Samma sak gäller bilder där provläsningen var svag åt
   båda hållen: valet vilar då inte på något, och `uncertain` i `summary.json` märker dem.

Skälet till att det måste stå som krav och inte bara implementeras: felet är osynligt i det
ena ledet. Webbläsaren läser Orientation-taggen och visar bilden upprätt, servern läser
filen som den ligger. Samma bild ser alltså rätt ut i granskningsvyn och läses fel av OCR:en.

## Vad som redan är känt

Mätt mot en syntetisk kvittobild — alltså ren, renderad text, inte riktigt papper.
Slutsatserna om *kvalitet* är preliminära, men båda fynden nedan uppträder redan på ren
indata och kan bara bli värre på blekt termopapper.

**`tiny` tappar svenska diakriter.** VÄGG lästes som "VÅGG", FÄSTMASSA som "FÅSTMASSA",
GRÅ som "GRA". `small` fick alla rätt. Det stämmer med modellkatalogens notering om att
tiny har en reducerad ordbok. Det avgör nivåvalet oavsett hur snabb tiny är: fritextsök
över kvittots innehåll är ett Steg 1-krav, och en sökning på "kakel till badrummet"
hittar inte det som lästes fel.

**Versalt O läses som nolla.** "T0TALT", "0rg.nr", "R0STFRI" — på båda nivåerna.
Fältutvinningen i M6 måste därför vika ihop de förväxlingsklasserna innan den letar efter
ledord, annars missas totalbeloppet på varje kvitto som skriver "TOTALT" utan att också
skriva "ATT BETALA". `foldConfusables()` i `run.mjs` är den minsta versionen av det.

**Konfidensmåttet kommer ut per rad och varierar** (0,92–0,99 på ren indata). Att det
varierar är en förutsättning för tröskelarbetet i Steg 2 — inte ett bevis för att det är
kalibrerat. Det avgörs först av granskningsurvalet.

**Tidssiffror från utvecklingsmaskinen är inte svaret på fråga 1 eller 3.** De togs på en
12-kärnig maskin med 2 ONNX-trådar: tiny ~260 ms/bild, small ~740 ms/bild. Kör om på
ZimaBoarden, med `--sustained=60`, innan modellnivån bestäms.
