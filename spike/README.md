# M0 — spike

Mäter PP-OCRv6 mot verkliga kvitton **på ZimaBoarden**, inte på utvecklingsmaskinen.
Svarar på fyra frågor och inget annat:

1. Läser den materialet överhuvudtaget — och om inte, faller det på **detektionen**
   (inga textrutor hittas) eller på **igenkänningen** (rutor finns, men ingen text)?
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
```

Standard är `--tiers=tiny,small` och `--widths=1600,full`. `medium` togs ur standard­urvalet
sedan den mätts till ~28 s/bild på ZimaBoarden — den behöver läggas till med flaggan om den
ska vara med, och bara när det finns skäl att tro att den är värd tio gånger körtiden.

Första körningen hämtar modellerna, ~150 MB för medium, så maskinen behöver nå nätet just
då. Med cachen monterad enligt ovan sker det bara en gång.

Resultat hamnar i `--out`-katalogen: `summary.md` (läsbar tabell), `summary.json` (rådata),
`text/` (all utläst text med konfidens per rad, för att bedöma kvalitet för hand) och med
`--crops` även `crops/` (varje beskuren textruta som PNG).

**Läs `summary.md` uppifrån.** Första tabellen svarar på om läsningen fungerade alls. Är den
röd är resten av rapporten meningslös, och rätt åtgärd står under tabellen: noll rutor pekar
på bilderna — beskärning, skärpa, att kvittot fyller bildrutan — medan rutor utan text pekar
på beskärningarna i `crops/`.

Modellerna hämtas vid första körningen till `~/.cache/ppu-paddle-ocr`. I produktion
bakas de in i imagen i stället — inget ska hämtas över nätet vid drift (krav 50).

## Urvalet spelar roll

Lägg in **blekt termopapper ur högen och färska kvitton var för sig**, och kör dem som
två omgångar. En sammanslagen siffra ger falskt underkänt, precis som kravställningens
mätavsnitt säger. Bilderna är privata och är utestängda från git.

## Kända fel i tidigare körningar

Den första körningen mot 35 riktiga kvitton (2026-08-28) rapporterade träffar på 3–6 % av
bilderna och en medelkonfidens på 0,95 samtidigt. Den kombinationen är omöjlig, och orsaken
låg i mätverktyget, inte i materialet:

- **Biblioteket kastar allt under 0,5 i konfidens** (`minimumConfidence`, standard 0.5).
  Fördelningen som spiken finns för att mäta var alltså avhuggen nedtill — därav den höga
  medianen bredvid nästan inga rader. Numera sätts tröskeln till 0.
- **Rader räknades som radgrupper**, inte som rader, och tomma rutor räknades som lästa.
- **Detektion och igenkänning mättes ihop**, så ett misslyckande gick inte att lokalisera.
- **Full upplösning in** gav 48 rutor varav 38 tomma där 1600 px ger 11 rutor och samma
  text på halva tiden. Nedskalning är därför en egen mätaxel numera.

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
