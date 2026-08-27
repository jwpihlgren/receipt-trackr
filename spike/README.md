# M0 — spike

Mäter PP-OCRv6 mot verkliga kvitton **på ZimaBoarden**, inte på utvecklingsmaskinen.
Svarar på tre frågor och inget annat:

1. Vilken modellnivå är värd sin körtid på det här materialet?
2. Kommer per-rad-konfidensen faktiskt ut, och varierar den användbart?
3. Vad blir genomströmningen när det passivt kylda kortet blivit varmt?

Ingenting härifrån ska överleva in i servern.

## Kör

```sh
npm install

# de två högarna mäts var för sig, aldrig ihop
node run.mjs --samples=./samples/gamla   --out=./out-gamla
node run.mjs --samples=./samples/farska --out=./out-farska

node run.mjs --tiers=small --sustained=60      # uthållighetstest, en timme
node run.mjs --threads=4                       # trådtak för ONNX-runtimen
```

Kräver Node 18 eller senare (utvecklat mot 22). Första körningen hämtar modellerna,
~150 MB för medium, så maskinen behöver nå nätet just då.

Resultat hamnar i `--out`-katalogen: `summary.md` (läsbar tabell), `summary.json` (rådata) och
`text/` (all utläst text med konfidens per rad, för att bedöma kvalitet för hand).

Modellerna hämtas vid första körningen till `~/.cache/ppu-paddle-ocr`. I produktion
bakas de in i imagen i stället — inget ska hämtas över nätet vid drift (krav 50).

## Urvalet spelar roll

Lägg in **blekt termopapper ur högen och färska kvitton var för sig**, och kör dem som
två omgångar. En sammanslagen siffra ger falskt underkänt, precis som kravställningens
mätavsnitt säger. Bilderna är privata och är utestängda från git.

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
