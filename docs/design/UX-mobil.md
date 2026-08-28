# Mobilläget — interaktionsdesign

Gäller M4 (krav 1, 2, 3, 5, 6, 7, 42, 43) med utblick mot M8 (autoutlösningen).
Skriven för att gå att bygga efter: varje tillstånd har en text, varje beslut ett motiv.

## 0. Den bärande premissen

**Bilden är oåterkallelig, tolkningen är det inte.** Papperet slängs. Allt i det här
dokumentet följer av den asymmetrin, och den ger tre regler som aldrig får brytas:

1. **Ingen bild får försvinna tyst.** En bild som inte gick att spara lokalt är det enda
   fel i hela mobilläget som får blockera användaren — därför att alternativet är förlust.
   Allt annat (nät nere, server full, kö lång, kvaliteten tveksam) varnar men blockerar aldrig.
2. **Den lokala kopian raderas först när servern kvitterat samma `sha256`.** Inte när
   HTTP-svaret var 200. Inte när uppladdningen "gick igenom". Servern svarar med segmentets
   `sha256` (se `server/src/http/receipts.ts`); klienten jämför mot sitt eget innan den släpper.
3. **Tolkningen får vara fel.** Ingenting i fångstflödet väntar på OCR, fältutvinning eller
   ens på att servern har svarat.

Regel 1 och 2 är också det som gör den fysiska rutinen trygg: användaren slänger papper
efter att kvittot visar **Verifierad på servern**, inte efter att det försvann från skärmen.

## 1. Syfte och avgränsning

En skärm, ett syfte: **få in kvittot**. Stående, med en hand, i en butik eller vid
köksbordet med tiotusen papper i en hög. Mobilläget är en egen vy, inte en förminskad
datorvy (krav 42): här finns ingen sökning, ingen fältpanel, ingen arbetslista. Vill man
titta på ett kvitto gör man det i datorläget.

Två användningssituationer med olika rytm, samma gränssnitt:

| | Backloggen | Nya kvitton |
| --- | --- | --- |
| Var | Köksbordet, hög papper, stadigt ljus | Butik, i handen, dåligt ljus |
| Volym | ~10 000, i pass om kanske 50–200 | Några i veckan |
| Kritiskt | Repetitionstakt, att inget hoppas över | Att det går snabbt att bli klar |
| Nät | Wifi, tailnet | Mobilnät, ibland inget |

Skillnaden hanteras med **ett** reglage (läget Gamla högen / Nytt kvitto), inte med två
gränssnitt. Läget sätter `backlog` i sidecaren, som planens mätavsnitt kräver, och ändrar
i övrigt bara en detalj: i Gamla högen-läget står räknaren för passet kvar på skärmen.

## 2. Hierarki

```
Fångstvyn  (start, 95 % av tiden här)
├── Remsan          — segmenten i det pågående kvittot
├── Köstatus        — "N kvitton väntar", tryckbar
│   └── Kölistan    — modal, per kvitto: uppladdat / väntar / fastnat
└── Meny            — läge, kamera, ljus, om/version
```

Tre nivåer, aldrig fler. Kölistan och menyn är modaler över den levande kameran —
kameraströmmen stängs **aldrig** av medan appen är i förgrunden, eftersom omstart av en
ström kostar 300–800 ms och det är hela tidsbudgeten i avsnitt 6.

## 3. Layout

Stående, en hand. Referensram 390 × 844 dp (mindre skärmar krymper förhandsvisningen,
aldrig kontrollerna).

```
┌───────────────────────────────┐  ← statusremsa, 56 dp
│ ▣ Gamla högen      3 väntar ⬆ │     läge till vänster, kö till höger
├───────────────────────────────┤
│                               │
│                               │
│        kameran, live          │  ← förhandsvisning fyller allt däremellan
│                               │
│      ┌───────────────┐        │
│      │               │        │  ← ram som visar var kvittot ska ligga,
│      │               │        │    tunn, dämpad — en hjälp, inte ett krav
│      └───────────────┘        │
│                               │
│   ╭─────────────────────────╮ │  ← kvalitetsrad, 40 dp, opak platta
│   │ Gå närmare — texten är  │ │    text över video måste ha egen bakgrund
│   │ liten                   │ │
│   ╰─────────────────────────╯ │
├───────────────────────────────┤
│ [ 1 ][ 2 ][ 3 ]           ✕   │  ← remsan, 72 dp hög, vågrätt rullbar
├───────────────────────────────┤
│                               │
│   ┌─────────┐  ◉  ┌─────────┐ │  ← handzonen, 132 dp
│   │  Klart  │     │  Nästa  │ │    ◉ = manuell avtryckare, 72 dp
│   │         │     │  bild   │ │    knappar 56 dp höga, 140 dp breda
│   └─────────┘     └─────────┘ │
└───────────────────────────────┘
```

Motiv för placeringen:

- **Allt tryckbart ligger i nedersta 190 dp.** Det är tumzonen för en hand på en telefon
  som hålls i butik. Statusremsan högst upp är läsbar men inte kritisk att nå — köstatusen
  är tryckbar där, och samma sak nås även genom att dra ner från remsan.
- **Manuell avtryckare i mitten, störst.** Krav 7 säger att den alltid finns. Den ligger
  där tummen vilar, är 72 dp och har alltid samma plats — även när autoutlösningen är
  påslagen och gör jobbet åt användaren. Att den är störst är avsiktligt: när
  autoutlösningen tvekar i butiksljus är den här knappen hela räddningen.
- **"Klart" till vänster, "Nästa bild" till höger.** "Nästa bild" är det som trycks oftast
  på ett långt kvitto och ligger därför under tummen på en högerhand. "Klart" avslutar och
  ligger längre bort — en felträff på "Klart" är billig (kvittot går iväg med ett segment
  för lite och syns som **Kräver åtgärd** i datorläget) men irriterande.
- **Remsan mellan förhandsvisning och knappar.** Den ska ses i ögonvrån, inte studeras.

### Remsan

```
 [ ▣1 ] [ ▣2 ] [ ▣3 ]                     ✕ Ta bort sista
   ▲
   senaste, alltid synlig; remsan rullar automatiskt hit
```

Varje ruta är 56 × 72 dp med segmentnumret i hörnet. En ruta har tre utseenden:
sparad lokalt (heldragen kant), på väg upp (kant med rörlig markör), verifierad på
servern (liten bock). Att skilja *sparad lokalt* från *verifierad* är hela poängen med
regel 2 ovan, och det är därför skillnaden syns redan i remsan.

Tryck på en ruta = förstora bilden (bedöm skärpan). Där finns **Ta om** som lägger till
ett nytt segmentnummer och markerar det gamla som ersatt lokalt — **originalet laddas
ändå upp**. Bilden är oåterkallelig; att användaren tyckte den var suddig är en åsikt, och
åsikter raderar inte bilder. I datorläget syns båda och den ersatta kan avfärdas där.

*Osäkerhet:* om "Ta om" i praktiken används ofta blir varje kvitto två uppladdningar i
onödan. Det avgörs av hur ofta det faktiskt trycks — logga antalet i `capture` och titta
efter första backloggpasset.

## 4. Flödet

Flödet nedan beskriver ett kvitto som en följd av segment. Vad ett segment *är* i papper —
en klippunkt på ett långt kvitto, en bit av ett rivet, en baksida — och vad de formerna gör
med flödet står i avsnitt 9.

```
  start
    │
    ▼
 kameran startar ──► ström nekad ──► hjälpvy, se 5.2
    │
    ▼
 ┌──────────────────────────────────────────┐
 │ SIKTAR                                   │◄──────────────┐
 │ mäter texthöjd var 3:e bildruta           │              │
 └───────┬──────────────────────┬───────────┘              │
         │ 3 godkända i rad     │ manuell avtryckare       │
         │ + stabil bild        │ (alltid tillåten)        │
         ▼                      ▼                          │
 ┌──────────────────────────────────────────┐              │
 │ TAR BILD  (~120–400 ms, haptik direkt)   │              │
 └───────┬──────────────────────────────────┘              │
         ▼                                                  │
 ┌──────────────────────────────────────────┐              │
 │ SPARAR LOKALT  (blob + sha256, i worker) │              │
 │  fel här ► blockerande dialog, se 5.6    │              │
 └───────┬──────────────────────────────────┘              │
         ▼                                                  │
 segmentet in i remsan ─────────────────────────────────────┤
 uppladdning startar i bakgrunden                           │
         │                                                   │
         ├── "Nästa bild" ───────────────────────────────────┘
         │
         └── "Klart"
                 │
                 ▼
        kvittot markeras komplett lokalt
        remsan töms, räknaren +1
        kameran är redan igång  ──► SIKTAR (nytt kvitto)
```

Ingen nätverksoperation ligger i den vägen. Det är det som gör krav 1 oberoende av
täckning och av arkivets storlek (krav 46).

**Autoutlösningen återarmeras inte omedelbart efter "Klart".** Annars fotograferar den
kvittot som fortfarande ligger kvar i bildrutan en gång till, som ett nytt kvitto. Regeln:
efter "Klart" krävs ett *scenbyte* — medelvärdet av absolutdifferensen mellan
480 px-gråskalebildrutorna ska ha passerat en tröskel — eller 1,2 s, det som inträffar
först. Den manuella avtryckaren är armerad direkt, alltid. Under tiden står det **Redo**
i kvalitetsraden, inte en spärrtext: användaren ska inte känna sig hindrad.

*Osäkerhet:* tröskeln för scenbyte är inte mätt. Den ska sättas mot verkligt underlag i
M8 tillsammans med texthöjdsmåttet, och tills dess räcker tidsgränsen ensam.

## 5. Alla tillstånd

### 5.1 Första start, kameran ej begärd

```
        📷
   Fånga kvitton

   Bilderna sparas i telefonen
   först och laddas upp i
   bakgrunden. Ingenting går
   förlorat om nätet är borta.

   [ Slå på kameran ]
```

Rubrik: **Fånga kvitton**. Knapp: **Slå på kameran**.
Kamerabegäran görs efter ett tryck, aldrig automatiskt vid sidladdning — annars hamnar
webbläsarens systemdialog framför en tom skärm och nekas av reflex.

Här begärs också **beständig lagring** (`navigator.storage.persist()`). Motiv: utan den
kan webbläsaren vräka ut IndexedDB när utrymmet tryter, och då är oladdade bilder borta.
Nekas den visas ingen dialog, men menyn visar raden **Beständig lagring: nej** och
kölistan varnar tidigare (avsnitt 5.7).

### 5.2 Kameran nekad eller upptagen

| Orsak | Text | Åtgärd |
| --- | --- | --- |
| Nekad | "Kameran är blockerad för den här sidan. Öppna webbläsarens platsinställningar och tillåt kamera, ladda sedan om." | **Ladda om** |
| Upptagen av annan app | "Kameran används av något annat. Stäng den appen och försök igen." | **Försök igen** |
| Ingen kamera | "Den här enheten har ingen kamera som går att använda. Fångst behöver en telefon." | — |
| Osäker kontext (ej HTTPS) | "Kameran kräver en säker anslutning. Öppna adressen via tailnet-namnet, inte via IP-numret." | — |

Sista raden är inte teoretisk: `tailscale serve` terminerar TLS mot värdnamnet, och en
genväg sparad mot `http://10.x.x.x:8080` ger en tyst kamera utan förklaring.

### 5.3 Kameran startar

Förhandsvisningen är svart i 200–800 ms. Under den tiden: knapparna finns på plats men är
utgråade, kvalitetsraden säger **Startar kameran…**, och den manuella avtryckaren visar en
lugn pulsering. Ingen spinner mitt på skärmen — den flyttar blicken till mitten, dit den
inte ska.

### 5.4 Siktar (normaltillstånd)

Kvalitetsraden visar högst **en** sak i taget, den mest åtgärdbara:

| Läge | Text |
| --- | --- |
| Godkänd | "Redo" |
| Texthöjden för låg | "Gå närmare — texten är liten" |
| Rörelseoskärpa | "Håll stilla" |
| För mörkt | "För mörkt — tänd lampan" (+ genväg till ljusknappen) |
| Inget papper i bild | "Rikta mot kvittot" |
| Autoutlösning avstängd | "Autoutlösning av — tryck för att fotografera" |

**Kvalitetsvarningen blockerar aldrig** (krav 7, och planens riskrad om butiksljus). Den
manuella avtryckaren är alltid armerad, även när raden är röd. Formuleringarna är
uppmaningar, inte förbud: "Gå närmare", inte "För långt bort".

*Osäkerhet:* måttet är mediantexthöjd i pixlar (planens M8-avsnitt), och gränsen mellan
"för liten" och "godkänd" är inte satt. Den bestäms av samma mätning som avgör
autoutlösningen, inte här. Tills M8 är byggd är raden i praktiken tyst utom "Redo" och
"Rikta mot kvittot".

### 5.5 Bilden tas

Återkopplingen är **haptisk först**, för att användaren tittar på papperet, inte på
skärmen: en kort vibration i samma ögonblick som stillbilden tas, en kort slutarklickljud
om systemets ljud är på, och därefter att rutan glider in i remsan. Ingen helskärmsblink
— den tvingar blicken tillbaka till skärmen och kostar tid.

Skärmläsaren får `aria-live="polite"`: **"Bild 2 sparad"**.

### 5.6 Bilden kunde inte sparas lokalt — det enda blockerande felet

```
┌───────────────────────────────┐
│  Bilden kunde inte sparas      │
│                                │
│  Telefonen kunde inte spara     │
│  bilden. Den finns just nu bara │
│  i minnet och försvinner om du  │
│  stänger appen.                 │
│                                │
│  [ Försök spara igen ]          │
│  [ Ladda upp direkt ]           │
│  [ Släng bilden ]               │
└───────────────────────────────┘
```

Tre utvägar, i den ordningen. **Släng bilden** kräver en andra bekräftelse
("Bilden går inte att få tillbaka. Slänga ändå?") eftersom det är den enda knappen i hela
mobilläget som förstör något oåterkalleligt. **Ladda upp direkt** försöker skicka den från
minnet utan att gå via kön — det är sista chansen när lagringen är full men nätet finns.

Motiv för att detta blockerar när inget annat gör det: alla andra fel skjuter upp något.
Det här förlorar något.

### 5.7 Utrymmet i telefonen tar slut

Mätt med `navigator.storage.estimate()` efter varje sparad bild.

| Nivå | Var | Text |
| --- | --- | --- |
| < 20 % kvar eller < 500 MB | Statusremsan, gul | "Lite plats kvar i telefonen" |
| < 8 % kvar eller < 150 MB | Banderoll ovanför remsan | "Telefonen är nästan full. Ladda upp det som väntar innan du fotograferar mer." + **Ladda upp nu** |
| Skrivning misslyckas | Dialog 5.6 | — |

Uppladdade och verifierade blobbar städas i bakgrunden, äldst först, men **bara** sådana
där serverns `sha256` stämt. Standard är att behålla dem i sju dagar även efter
verifiering — en billig försäkring mot att något gick fel i andra änden under just den
veckan då papperet slängdes. Talet är en inställning i menyn, inte en konstant i koden.

### 5.8 Offline

Statusremsan: ikonen byter form och räknaren får ett tillägg.

> **3 kvitton väntar · offline**

Vid första övergången till offline, en gång per pass, en banderoll som försvinner av sig
själv efter 4 s:

> "Ingen kontakt med servern. Bilderna sparas i telefonen och skickas när kontakten är tillbaka."

Fångst påverkas inte alls. Planen noterar att tailnet gör offline till undantagsfallet;
gränssnittet behandlar det ändå som normalt, för i en källare är det normalt.

### 5.9 Servern svarar men vägrar

| Svar | Betydelse | Text i kölistan | Beteende |
| --- | --- | --- | --- |
| 503 `degraded` | Disken under golvet | "Servern har slut på utrymme. Bilderna ligger kvar i telefonen." | Backoff till var 5:e minut; fångst opåverkad |
| 409 `conflict` | Samma segmentnummer, annat innehåll | "Segment 2 finns redan på servern med ett annat innehåll. Ta upp kvittot i datorn innan du slänger papperet." | Ingen ny retry; kvittot markeras **Fastnat** |
| 415 `not_an_image` | Trasig fil | "Servern kunde inte läsa bilden som en bild." | **Fastnat**, blobben behålls |
| 400 `invalid_id` | Klientfel | "Något gick fel med kvittots id." | **Fastnat**, blobben behålls |
| 413 / avbrott mitt i | För stor eller kapad ström | tyst | Retry, samma segmentnummer, samma bytes |

409 förtjänar en kommentar. Servern är byggd så att samma nummer med samma `sha256` är en
tystnad och samma nummer med annat innehåll är ett fel (`server/src/store/archive.ts`).
Det senare kan i praktiken bara uppstå av ett klientfel eller av att två telefoner råkat
mynta samma ULID. Det är alltså ett *larm*, inte ett övergående fel, och därför enda
stället där kön slutar försöka av sig själv. Blobben ligger kvar.

### 5.10 Kölistan

```
┌───────────────────────────────┐
│ ← Kön                    3    │
├───────────────────────────────┤
│ ✓ 14:02  Gamla högen   2 bild │  Verifierad på servern
│ ⬆ 14:05  Gamla högen   1 bild │  Laddar upp… 60 %
│ ⏸ 14:07  Gamla högen   3 bild │  Väntar på nätet
│ ⚠ 13:41  Nytt kvitto   2 bild │  Fastnat — segment 2
│                    [Försök igen]│
├───────────────────────────────┤
│ Uppladdat och verifierat:      │
│ 128 kvitton i det här passet   │
└───────────────────────────────┘
```

Fyra tillstånd med varsin ikon och varsin text, aldrig bara färg:
**Verifierad på servern**, **Laddar upp**, **Väntar på nätet**, **Fastnat**.

Tomt läge: "Allt är uppladdat. Inget väntar."

Raden längst ner finns för den fysiska rutinen: det är den siffra man tittar på innan man
slänger en bunt papper.

### 5.11 Delvis misslyckad uppladdning

Ett kvitto med tre segment där segment 2 fastnat är **inte** klart, och får inte se klart
ut. Kölistan visar `1 av 3 uppladdade`, kvittot står kvar överst tills alla segment är
verifierade, och i datorläget hamnar det under **Kräver åtgärd** (se `UX-dator.md`, 4.3).

Är det **sista** segmentet som fastnat byts texten mot "Sista bilden saknas — där står
oftast totalbeloppet." Skälet står i 9.1: totalen står nästan alltid på sista bilden, så
det tappet är det dyraste som finns.

Det kräver att servern vet hur många segment som ska komma. Det gör den inte i dag — se
avsnitt 12, konflikt K1.

### 5.12 Avbrott

| Avbrott | Vad som händer |
| --- | --- |
| Appen läggs i bakgrunden | Kameraströmmen släpps av systemet. Vid återkomst: strömmen startas om, remsan och det pågående kvittot ligger kvar i IndexedDB och ritas upp igen. Ingenting går förlorat. |
| Telefonen låses mitt i ett kvitto | Samma sak. Vid upplåsning: "Du har ett påbörjat kvitto med 2 bilder." + **Fortsätt** / **Avsluta kvittot**. |
| Appen dödas mitt i en uppladdning | Blobben ligger kvar (den skrevs före uppladdningen). Kön återupptas vid nästa öppning. Samma segmentnummer, samma bytes, samma ULID → servern svarar tystnad om den redan fått den. |
| Appen dödas mitt i "sparar lokalt" | Bilden är förlorad. Det är fönstret som inte går att stänga helt, och det är därför sparandet sker direkt vid varje bild och inte samlat vid "Klart". Fönstret är ~50 ms i stället för minuter. |
| Strömavbrott på servern mitt i | Klientens retry löser det; sidecaren skrivs atomiskt i andra änden. |
| Användaren stänger av läget mitt i backloggen | Passräknaren nollställs inte förrän appen laddas om. |

Ett påbörjat kvitto som legat orört i **sex timmar** avslutas automatiskt vid nästa
öppning och läggs i kön som det är. Motiv: ett halvfärdigt kvitto som aldrig laddas upp är
en osynlig förlust, och ett komplett-nog kvitto i arkivet är alltid bättre. Användaren får
veta: "Ett påbörjat kvitto från i går lades i kön." *Osäkerhet: sex timmar är gissat, inte
mätt. Vad som avgör: hur ofta ett pass faktiskt avbryts mitt i ett långt kvitto.*

## 6. "Klart → nästa" på under tre sekunder

### Vad som mäts

Krav 1 mäts som planens verifieringssteg 4 säger: klocka tio kvitton i rad, för hand.
Sträckan är **tryck på "Klart" → kameran kan ta nästa kvittos första bild**. I den sträckan
ligger också en människa som lägger ner ett papper och tar upp nästa. Programvaran måste
därför inte ta 3 s, den måste ta så lite att människan får resten.

**Mål: ≤ 700 ms från tryck till armerad kamera. Tak: 1000 ms.** Resten av budgeten är
handens.

### Kritisk väg

| ms | Steg | Var |
| --- | --- | --- |
| 0 | `pointerdown` på "Klart" — knappen kvitterar visuellt och haptiskt direkt | huvud |
| 0–16 | Remsan börjar glida ut, räknaren räknas upp | huvud |
| ~5 | En liten *komplettpost* skrivs i IndexedDB (blobbarna ligger redan där) | huvud, ej inväntad för UI |
| 16–60 | Remsan tom, "Klart" och "Nästa bild" utgråade | huvud |
| 0 | Kameraströmmen: **rörs inte**. Ingen omstart, ingen ny `getUserMedia` | — |
| 200–500 | Autoutlösningen återarmeras efter scenbyte eller 1,2 s | mät-loop |
| — | Uppladdning av kvittot startar | bakgrund |

Vad som **inte** får ligga på vägen, och var det ligger i stället:

- **Stillbildstagning och JPEG-kodning.** Sker vid autoutlösning/avtryckare, alltså
  sekunder innan "Klart". `ImageCapture.takePhoto()` där det finns; annars canvas +
  `toBlob`, vilket kostar huvudtrådstid och därför mäts separat.
- **`sha256`.** Räknas i en worker direkt efter att bilden sparats, inte vid "Klart".
- **Tumnagel till remsan.** `createImageBitmap` i worker vid fångst.
- **Nätverk.** Aldrig, i något läge.
- **ULID för nästa kvitto.** Myntas vid nästa kvittos *första* bild, inte i förväg —
  ULID:ens tidsstämpel bestämmer katalogen på disk (`store/paths.ts`), och en ULID myntad
  i förväg ljuger om fångsttiden om användaren pausar.
- **Skrivning av bildblobbar.** Sker vid varje enskild bild. Det är också vad regel 1 i
  avsnitt 0 kräver: durabiliteten får inte skjutas upp till "Klart", för då blir fönstret
  där en bild kan gå förlorad hela kvittots längd i stället för 50 ms.

### Vad som måste vara förberett innan trycket

1. Kameraströmmen lever och har aldrig stoppats sedan appen öppnades.
2. `ImageCapture`-objektet, mät-canvasen (480 px) och workern är återanvända, inte nyskapade.
3. Alla segmentens blobbar är redan skrivna och har `sha256`.
4. IndexedDB-anslutningen är öppen; ingen `open()` på vägen.
5. Utrymmeskontrollen är gjord vid förra bilden, inte nu.
6. Lampan, fokusläget och zoomen behåller sitt tillstånd mellan kvitton.

### Vad som gör det långsamt i verkligheten

Den ärliga risken är inte vår kod utan **stillbildstagningen**: på telefoner utan
`ImageCapture` kostar canvas + `toBlob` på en 12 MP-bild hundratals millisekunder på
huvudtråden, och den kostnaden hamnar mellan avtryckare och remsa — inte i "Klart", men väl
i användarens upplevda takt. Två svar: mät den (lägg `captureMs` i `capture`-metadata, se
konflikt K2), och erbjud i menyn **Snabb fångst** som tar stillbilden från videospåret i
lägre upplösning när enheten visar sig långsam.

*Osäkerhet, uttalad:* vilken telefon det gäller är inte känt för mig, och därmed inte
heller om `ImageCapture` finns. Det avgörs av en enda mätning på användarnas faktiska
telefon i M4 och ska göras innan "Snabb fångst" byggs — det kan visa sig onödigt.

### Instrumentering

`performance.mark("klart")` vid `pointerdown`, `performance.mark("armerad")` när
autoutlösningen återarmerats, och medianen över passet visas i menyn under **Om**. Det gör
kravet mätbart utan tidtagarur, och siffran finns när planens verifieringssteg 4 ändå görs
för hand.

## 7. Kön och uppladdningen

### Livscykeln för ett segment

```
 tagen ──► sparad lokalt ──► i kö ──► laddas upp ──► kvitterad ──► verifierad ──► städad
   │            │                        │               │             │
   │            │                        │               │             └ sha256 stämmer
   │            │                        │               └ 200/201 från servern
   │            │                        └ nät + serverns kösvar
   │            └ blob + sha256 i IndexedDB   ← här slutar risken för förlust
   └ i minnet                                  ← här är risken som störst
```

**Verifierad** är inte samma sak som **kvitterad**. Först när serverns svar innehåller
samma `sha256` som klienten räknade räknas segmentet som säkert, och först då blir det
städbart. Servern returnerar redan det (`addSegment` svarar med segmentposten).

### Ordning och idempotens

1. `POST /api/receipts` med klientens ULID, `capturedAt` och `backlog`. 201 = nytt, 200 =
   fanns redan. Båda är framgång.
2. `POST /api/receipts/:id/segments/:index` per segment, i nummerordning, en i taget.
   Numret kommer från klienten och ändras aldrig vid retry.
3. Komplettsignal när alla segment är kvitterade (finns inte än — konflikt K1).

Ett i taget, inte parallellt: den passivt kylda servern ska inte få fyra samtidiga
32 MB-strömmar, och en seriell kö gör felhanteringen begriplig.

**Backoff:** 1 s, 2, 5, 15, 30, 60, sedan var 5:e minut. Nollställs vid `online`-händelse,
vid att appen får fokus, och vid manuellt **Försök igen**. Background Sync används där den
finns. *Känd begränsning enligt planen: iOS Safari saknar den, så kön töms när appen
öppnas igen — vilket är precis vad krav 2 kräver, inte mer.*

### Räknaren (krav 3)

Texten är **"N kvitton väntar"**, inte segment. Motiv: användaren tänker i kvitton, och
det är kvitton som ska bli verifierade innan papper slängs. Vid noll: **"Allt uppladdat"**.
Vid minst ett fastnat: **"N väntar · 1 fastnat"** i varningsfärg *och* med ikon.

Räknaren är tryckbar och har tillräcklig träffyta (48 × 48 dp) trots att den ligger i
statusremsan.

## 8. Kvalitetsmätning och autoutlösning (krav 6, 7)

Mätningen är beskriven i planen och byggs i M8; här står bara gränssnittsdelen.

- Var tredje videobildruta ritas till en 480 px canvas, tröskas med Otsu, och radhöjden
  skattas ur den horisontella projektionsprofilen. Måttet är **mediantexthöjd i pixlar**,
  skalad till stillbildens upplösning.
- Autoutlösning efter **tre godkända bildrutor i rad plus bildstabilitet**. Tre i rad, inte
  en, för att en enstaka godkänd bildruta mitt i en rörelse ger en suddig stillbild.
- Mätvärdena följer med bilden upp som `capture: { textHeightPx, sharpness, autoShutter }`
  — det är planens sidecar-format, och det är också vad som gör det möjligt att i M9 se om
  autoutlösta bilder läses sämre än manuella. Det går inte att skicka i dag; konflikt K2.
- **Autoutlösningen går att stänga av** i menyn. Den som fotograferar 200 kvitton i rad vid
  ett bord kan vilja ha full kontroll över takten, och att tvinga fram en automatik som
  triggar en halv sekund fel är dyrare än ett tryck.

## 9. Kvittots fysiska former

Fram till hit har "segment" behandlats som en abstraktion. Det är det inte — det är en bit
papper i en viss form, och formerna skiljer sig mer än flödet i avsnitt 4 antyder. Det här
avsnittet går igenom de sju former som faktiskt ligger i högen och vad var och en gör med
flödet, kön och servern.

Två saker gäller genomgående och är prövostenen för varje förslag nedan:

- **Ingen form får leda till att en bild tyst försvinner eller att ett halvt kvitto ser
  komplett ut.**
- **Ingen form får lägga ett nytt beslut på den kritiska vägen** (avsnitt 6). Allt som
  föreslås här är antingen passiv visning under siktandet, eller frivilligt och nåbart
  *före* "Klart" — aldrig en fråga vid trycket.

Sammanfattningen först, för den som bygger:

| Form | Löses i mobilen | Löses i datorläget | Byggs inte i Steg 1 |
| --- | --- | --- | --- |
| 1 Långt kvitto | Skuggremsa + sömvy + "Klart · N bilder" | Saknad sista bild, total på fel segment | Automatisk hopfogning |
| 2 Kort kvitto | Inget extra — flödet är redan minimalt | — | Enbildsläge |
| 3 Sönderrivet | Bitarna = segment i läsordning | Ser sömbrottet, kan lämna det | Riven-flagga |
| 4 Två kvitton i en bild | Råd i hjälpen, ingen bevakning | Sökbart ändå, syns i råtexten | Uppdelning i två kvitton |
| 5 Dubblett | "Förra kvittot" kvar i remsan | — | Dubblettdetektering |
| 6 Vikt / skrynkligt | Råd en gång, aldrig varning | "Totalbelopp saknas" | Automatisk veckdetektering |
| 7 Baksida | Råd: bara när det står något eget | — | Segmentroll i indexet |

### 9.1 Långt kvitto i flera segment

**Vad användaren ser.** Efter första bilden byter kvalitetsraden innehåll under siktandet,
och överst i förhandsvisningen ligger en **skuggremsa**: de nedersta ~20 % av föregående
bild, halvgenomskinliga, fastnaglade vid ramens överkant.

```
┌───────────────────────────────┐
│ ▣ Gamla högen      3 väntar ⬆ │
├───────────────────────────────┤
│▒▒▒ ART.NR 4711  199,00 ▒▒▒▒▒▒▒│  ← skuggremsa: slutet på bild 1
│▒▒▒ ART.NR 4712   89,50 ▒▒▒▒▒▒▒│    lägg papperet så att de här
├───────────────────────────────┤    raderna syns igen överst
│                               │
│      kameran, live            │
```

**Vad hen gör.** Skjuter papperet uppåt tills raderna i skuggremsan syns igen i den levande
bilden, och låter autoutlösningen ta nästa segment. Klipppunkten är alltså inte ett beslut
utan en handrörelse: *lägg om tills det som redan är taget syns en gång till*.

**Överlapp: ja, ett par rader.** Motiven är två, och bara det ena är tekniskt:

1. Det gör det **synligt för människan** att inget mellanrum hoppats över. Utan överlapp
   finns ingen skillnad mellan "raderna fortsätter" och "tre rader saknas".
2. Det gör en framtida hopfogning möjlig utan att den behöver byggas nu. Radtexten
   återkommer i två segment, vilket är precis vad en matchning skulle behöva.

Priset är att råtexten innehåller några dubblerade rader per kvitto. Det är billigt: FTS5
bryr sig inte, och fältutvinningen letar ledord, inte unika rader.

*Storleken på överlappet är inte mätt.* 20 % är vald för att skuggremsan ska rymma två
till tre textrader vid normalt avstånd — färre går inte att känna igen, fler äter
bildrutan. Det som avgör siffran är hur många rader som faktiskt syns i skuggremsan på den
telefon som används, och det ses första passet.

**Hur vet användaren att hela kvittot är täckt?** Ärligt svar: **systemet vet det aldrig.**
Det ser aldrig papperet som helhet och kan därför inte intyga täckning. Att låtsas annat —
en bock, en "komplett"-markering — vore det värsta gränssnittsfel som går att göra här,
eftersom det bytte ut användarens uppmärksamhet mot en falsk garanti.

I stället två hjälpmedel som båda är *visning*, inte omdöme:

- **Sömvyn.** Ett tryck på remsan (eller på dess förstoringsikon) staplar segmenten
  lodrätt, kant i kant, i nummerordning. Kvittot syns som en remsa och ett hopp i texten
  syns direkt. Nåbar när som helst före "Klart", frivillig, utanför den kritiska vägen.

```
┌───────────────────────────────┐
│ ← Sömvy               3 bilder │
├───────────────────────────────┤
│  ┌─────────────────────────┐  │
│  │  bild 1                 │  │
│  ├─────────────────────────┤  │  ← skarv: överlappande rader
│  │  bild 2                 │  │    ritas dubbelt med en tunn linje
│  ├─────────────────────────┤  │    emellan, ingen automatisk
│  │  bild 3                 │  │    hopfogning
│  └─────────────────────────┘  │
├───────────────────────────────┤
│   [ Lägg till bild ]  [ Klart ]│
└───────────────────────────────┘
```

- **Knappens etikett räknar.** "Klart" blir **"Klart · 3 bilder"** från och med andra
  segmentet. Det är den enda platsen där antalet möter ögat i samma ögonblick som beslutet
  fattas, och det kostar ingenting: etiketten räknas om när segmentet läggs till, inte vid
  trycket.

**Vad som inte byggs: automatisk överlappsdetektering.** Att mäta om två bilder faktiskt
överlappar kräver bildmatchning per segment, kostar hundratals millisekunder, och skulle —
om den kopplades till "Klart" — lägga ett beslut på den kritiska vägen och kunna neka en
korrekt fångst. Den vinner heller inte det viktiga: den kan säga att två bilder inte
överlappar, men aldrig att kvittot är slut. Skuggremsan ger nästan hela nyttan för noll
millisekunder.

**Att totalen står sist — ska gränssnittet veta det?**

Ja, men bara i *ordval*, aldrig i logik. Planen viktar redan sista segmentet högre i
fältutvinningen. Följden för mobilläget är att ett tappat sista segment är värre än ett
tappat första: det som försvinner är oftast totalbeloppet. Två konsekvenser:

- **Kölistan säger det.** Har det sista segmentet fastnat: "Sista bilden saknas — där står
  oftast totalbeloppet." I stället för det generiska "Fastnat — segment 3".
- **Uppladdningsordningen ändras inte.** Att skicka sista segmentet först övervägdes och
  valdes bort: ingenting går förlorat av att ligga sist i kön, eftersom blobben ligger kvar
  lokalt tills servern kvitterat samma `sha256` (avsnitt 0, regel 2). Ordningen påverkar
  bara vad som syns först i datorn, och där är nummerordning rätt.

Resten hör hemma i datorläget, där man ser hela kvittot: total som hittades på segment 1 av
3 är en åtgärdsrad där, inte en varning här. Se `UX-dator.md`, avsnitt 11.

Serverns tak är 99 segment (`Archive.addSegment`). Ett kvitto som slår i det taket finns
inte i den här högen; skulle det göra det är rätt svar en dialog, inte en tyst avkortning.

### 9.2 Kort kvitto

Det vanliga fallet, och det som får kosta minst. Hela sträckan är: rikta →
autoutlösning → **Klart · 1 bild**. Ett tryck.

**Vad som är byggt för det långa fallet och därför granskades igen:**

| Byggt för långa kvitton | Kostar det korta fallet något? |
| --- | --- |
| Skuggremsan | Nej — den visas först från och med andra segmentet |
| Sömvyn | Nej — den är frivillig och nås bara med ett tryck på remsan |
| Räknaren i knappetiketten | Nej — "Klart · 1 bild" är lika kort |
| Två knappar i stället för en | **Ja, marginellt.** Se nedan |
| Remsan som yta | Nej, men den är tom vid ett segment och tar 72 dp. Behålls: att layouten hoppar mellan kvitton är dyrare än 72 dp |

Den enda verkliga friktionen är att "Klart" måste tryckas även när det bara finns en bild.
**Ett enbildsläge övervägdes och valdes bort**: ett läge som avslutar kvittot automatiskt
efter första bilden gör att ett långt kvitto blir ett halvt kvitto i det ögonblick
användaren glömmer att byta läge — exakt det fel avsnitt 0 finns för att förhindra. Ett
extra tryck är billigare än en tyst avkortning.

**Placeringen av knapparna följer av samma asymmetri.** Ett feltryck på "Nästa bild" kostar
ingenting (man fotograferar en bild till, eller trycker Klart). Ett feltryck på "Klart"
avslutar kvittot för tidigt. Därför ligger "Nästa bild" under den vilande tummen och
"Klart" längre bort — samma resonemang som styr tangentvalet i granskningsläget
(`UX-dator.md`, 6.4). Det är alltså inte frekvens som avgjort layouten i avsnitt 3, utan
felkostnad.

*Osäkerhet:* hur fördelningen mellan korta och långa kvitton faktiskt ser ut vet jag inte.
Antalet segment per kvitto finns i sidecaren från första passet; visar det sig att nio av
tio kvitton är enbildskvitton är det värt att pröva "Klart" som primärknapp med tydligare
vikt — men inte att flytta den under tummen.

### 9.3 Sönderrivet kvitto i två eller flera bitar

**Det är ett kvitto med flera segment.** Datamodellen har ingen annan plats att lägga det,
och behöver ingen: fält söks över alla segment, råtexten läggs ihop, och ett kvitto är den
transaktion papperet beskriver — inte det pappersark den råkar vara tryckt på.

**Vad användaren ser.** Ingenting särskilt. Flödet är identiskt med ett långt kvitto: en
bild per bit, i läsordning, översta biten först.

**Vad hen gör.** Två arbetssätt är båda giltiga, och gränssnittet väljer inte åt henne:

- Lägg bitarna intill varandra så att de bildar kvittot igen, och fotografera som ett
  vanligt kort eller långt kvitto.
- Fotografera varje bit som ett eget segment.

Det andra är oftast bättre när bitarna inte går att lägga plant, och det ger inget sämre
resultat — men **skuggremsan blir meningslös** (bitarnas kanter går inte att lägga i
varandra), och sömvyn kommer att visa ett brott i skarven. Det är korrekt: brottet finns i
verkligheten.

**Vad som händer i kön och på servern.** Ingenting särskilt. Segmenten laddas upp som
vanligt, `segmentsExpected` blir antalet bitar, OCR läser varje bit för sig.

**Ingen "riven"-flagga byggs i M4.** Den skulle vara ett beslut i fångstflödet, den skulle
behöva en ny ändpunkt för att nå sidecaren (`tags.user` går inte att sätta utifrån i dag,
se konflikt K5), och den enda nyttan är att en granskare i datorläget slipper undra över
sömbrottet. Det är för lite för priset. *Vad som skulle ändra det: om granskningsurvalet i
M9 visar att rivna kvitton systematiskt bedöms som "Oläslig" för att brottet tolkas som ett
tappat segment.*

**Om en bit är borta.** Då är kvittot ofullständigt i verkligheten, och ingenting i
programvaran kan laga det. Det ska ändå fångas — halva kvittot är oändligt mycket mer än
inget kvitto, och den saknade totalen fångas i datorläget som "Totalbelopp saknas". Det som
inte får ske är att användaren låter bli att fotografera för att kvittot "ändå är trasigt".
Hjälptexten säger det: **"Fotografera det som finns. Ett halvt kvitto går att söka i, ett
slängt går inte."**

### 9.4 Två kvitton i samma bildruta

**Det är en tolkningsmiss, inte en förlust.** Bilden innehåller båda kvittona, bilden är
det oåterkalleliga, och tolkningen kan köras om. Det är därför fallet **inte förtjänar
någon friktion i fångstflödet** — och därför gränssnittet inte försöker upptäcka det.

**Vad som faktiskt händer:** arkivet får ett kvitto med ett fältuppsättning. Butik, datum
och total blir det ena kvittots (eller en blandning). Det andra kvittots belopp hamnar inte
i något fält.

**Vad som ändå fungerar:** hela råtexten indexeras, så **båda kvittona är sökbara**. Frågan
"vad kostade kakel till badrummet" hittar posten även om det var det andra kvittot i
bilden som handlade om kakel. Det är en verklig egenskap hos valet att indexera råtexten,
inte en efterhandskonstruktion — och den gör felet uthärdligt i Steg 1.

**Vad användaren ser:** inget varningsmeddelande. Två skäl:

1. Det går inte att upptäcka tillförlitligt i förhandsvisningen. Texthöjdsmåttet mäter
   radhöjd, inte hur många papper som ligger i bildrutan, och en varning som slår fel på ett
   kvitto med stor blankyta mitt i är värre än ingen varning.
2. Krav 7 och planens riskrad: kvalitetsvarningar blockerar aldrig, och en varning man inte
   får agera på är bara brus.

**Vad hen får veta i stället**, en gång, i startvyn och i hjälpen:

> **Ett kvitto per bild.** Två kvitton i samma bild blir ett kvitto i arkivet — texten går
> att söka i, men beloppen hamnar fel.

Och den fysiska motåtgärden, som är den enda som fungerar: fotografera mot en enfärgad yta
och lägg resten av högen utanför bildrutan. Ramen i förhandsvisningen (avsnitt 3) finns för
just det.

**Uppdelning i två kvitton byggs inte i Steg 1.** Det skulle kräva att ett nytt kvitto kan
skapas ur en befintlig bild, och papperskorg och radering är uttryckligen utanför Steg 1
(krav 30–35). Rättningen är alltså: låt posten vara, rätta fälten för hand till det kvitto
som är viktigast, och lita på fritextsöket för det andra.

### 9.5 Samma kvitto fotograferat två gånger

Två fall som ser lika ut men inte är det:

**(a) Två segment i samma kvitto visar samma pappersyta.** Helt ofarligt. Råtexten
upprepas, fältutvinningen hittar samma ledord två gånger och väljer ett, och totalen
viktas mot sista segmentet som vanligt. Ingen åtgärd, ingen varning.

**(b) Samma papper blir två separata kvitton.** Det verkliga fallet vid köksbordet: man
tappar bort var i högen man var. Resultatet är två poster i arkivet med samma innehåll.

**Går det att upptäcka?** Inte i mobilen på ett hederligt sätt. `sha256` skiljer sig alltid
mellan två foton av samma papper, så identitetsjämförelsen som kön redan gör hjälper inte.
Det som skulle krävas är en perceptuell hash över alla tidigare bilder i passet — en
kostnad i den kritiska vägen för att lösa ett problem som inte förstör något.

**Ska det upptäckas, och var?** Senare, och i datorläget, av en enkel anledning: en
dubblett går inte att göra något åt i Steg 1. Papperskorg och radering är inte byggda (krav
30–35), så det enda mobilen kunde göra vore att varna för något användaren inte kan städa.
En varning utan åtgärd är brus.

**Vad mobilen gör i stället — det som kostar noll:** efter "Klart" töms remsan, men den
sista bildens tumnagel ligger kvar, nedtonad, med etiketten **Förra kvittot**, tills nästa
bild tas.

```
├───────────────────────────────┤
│ [▨ Förra kvittot]              │  ← nedtonad, försvinner vid nästa bild
├───────────────────────────────┤
```

Det gör att man kan svara på "tog jag redan den där?" med en blick i stället för med
minnet. Det är ingen ny operation vid "Klart" — remsan rensas ändå, och en ruta får stå
kvar i stället för att tas bort. Kostnad på den kritiska vägen: noll.

Därtill hör en fysisk rutin som ingen programvara ersätter, och som står i hjälpen: **lägg
det fotograferade i en egen hög med trycket nedåt.** Passräknaren ("Uppladdat och
verifierat: 128 kvitton i det här passet") är avstämningen mot den högen.

*Dubblettlistning i datorläget är inte byggd i Steg 1;* vad som skulle krävas står i
`UX-dator.md`, avsnitt 11.

### 9.6 Hopvikta och skrynkliga kvitton

Det här är inte ett kantfall utan **materialet**: M0 mätte 35 kvitton ur den gamla högen och
beskriver dem som "förhållandevis nya kvitton, en del vikta — inte blekt termopapper". Vecken
är det som gör materialet svårt, och de bryter raderna **geometriskt**, inte kontrastmässigt
— vilket också är skälet till att `clahe` inte hjälpte.

**Vad gränssnittet ska säga:** ett råd, en gång, i startvyn och i hjälpen — och det ska
förklara varför, för det är rådet som avgör hur bra hela arkivet blir:

> **Platta till kvittot innan du fotograferar.** Vecken är det som gör texten svår att
> läsa, inte ljuset. Bilden är det enda som blir kvar — tolkningen kan köras om hur många
> gånger som helst, men bilden tas bara en gång.

Det är den enda platsen i hela systemet där asymmetrin från avsnitt 0 vänder sig mot
användaren i stället för för henne: allt annat går att göra om, men *bildens kvalitet* går
inte att förbättra i efterhand när papperet är slängt. Därför får rådet ta plats.

**Vad gränssnittet inte ska säga:** ingen körningsvarning om veck. Måttet som finns är
mediantexthöjd i pixlar; det mäter inte veck. En varning byggd på fel mått skulle antingen
tiga när den borde tala eller tala i tid och otid, och krav 7 säger dessutom att den aldrig
får blockera. Kvalitetsraden håller sig alltså till det den faktiskt mäter (avsnitt 5.4).

**En taktik som är värd att lära ut**, för den är billig och räddar det viktigaste: **går
vecket rakt över totalraden och papperet inte vill ligga plant — ta en extra närbild på den
delen som eget segment.** Ett tryck till, utanför den kritiska vägen, och totalbeloppet får
en andra chans att läsas. Utan den är alternativet att felet upptäcks i datorläget som
"Totalbelopp saknas" — vilket det gör, men då är papperet borta.

*Osäkerhet:* om närbildstaktiken faktiskt hjälper är **inte mätt**. Det avgörs enkelt när
materialet finns: jämför konfidensen på totalfältet i kvitton med och utan extra närbild,
i M9:s mätuttag. Tills dess är det ett råd, inte ett krav, och det står i hjälpen — inte
som en knapp.

### 9.7 Tryck på baksidan

**Standardsvar: fotografera inte baksidan.**

Skälet är konkret och handlar om söket. Baksidan på ett butikskvitto innehåller nästan
alltid samma returvillkor på varje kvitto från samma kedja. Läggs den texten in i FTS-
indexet blir varje sökning på ord ur villkoren — "retur", "öppet köp", "garanti" — en
träfflista med samtliga kvitton från den kedjan. Det gör krav 27 sämre, inte bättre, och
det är inte reparabelt utan att ta bort segment.

**Undantaget, och regeln som gäller i stället:** fotografera baksidan **när det står något
som just det här kvittot behöver** — en garantistämpel, en returkod, ett handskrivet
kolliprisnummer, en anteckning om vilket rum kaklet gick till. Då är det ett segment som
vilket som helst, sist i ordningen.

Hjälptexten:

> **Baksidan behövs sällan.** Fotografera den bara när det står något eget där — en
> stämpel, en returkod eller en anteckning. Standardvillkor gör bara söket sämre.

**Vad användaren ser:** ingenting extra. Ingen "baksida"-knapp, ingen fråga.

**Vad som övervägdes och valdes bort: en segmentroll.** Ett fält per segment
(`role: "front" | "back"`) skulle låta indexet utesluta baksidestext från FTS medan bilden
ändå sparas. Det är den tekniskt rena lösningen, och den är inte dyr — men den kräver ett
val vid varje bild, alltså ett beslut i fångstflödet, och den kräver att servern tar emot
och lagrar rollen (blockerat av konflikt K2, som ändå måste lösas). Den kostar mer än den
smakar när svaret "fotografera inte baksidan" löser samma problem gratis.

*Osäkerhet, uttalad:* **hur mycket baksidestext egentligen stör söket är inte mätt** — det
finns inga baksidor i M0:s material. Den dag några ändå fotograferas syns det direkt: en
sökning på "öppet köp" som ger femtio träffar från samma kedja är beviset. Då är
segmentrollen rätt åtgärd, och den går att lägga till i efterhand eftersom bilderna finns
kvar och tolkningen kan köras om.

### 9.8 Vad det här kostar på den kritiska vägen

Prövningen mot krav 1, punkt för punkt:

| Tillägg | När det körs | Kostnad vid "Klart" |
| --- | --- | --- |
| Skuggremsan | Ritas när ett segment lagts till, ligger som en statisk bild över förhandsvisningen | 0 |
| Sömvyn | Bara när användaren trycker på remsan | 0 |
| "Klart · N bilder" | Etiketten skrivs om när segmentet läggs till | 0 |
| "Förra kvittot" i remsan | Ersätter en rensning som ändå sker | 0 |
| Ordvalet "Sista bilden saknas" | I kölistan, efter uppladdningsförsöket | 0 |
| Råden om veck, baksida, ett kvitto per bild | Startvyn och hjälpen, aldrig i flödet | 0 |

Inget av det lägger ett beslut mellan tryck och nästa kvitto. Det är inte en tillfällighet
utan urvalskriteriet: varje förslag som krävde en fråga vid "Klart" — bekräfta antal bilder,
välj segmentroll, godkänn överlapp — ströks av den anledningen.

## 10. Text, samlad

| Plats | Text |
| --- | --- |
| Titel/PWA-namn | Kvittofångst |
| Startknapp | Slå på kameran |
| Lägesväljare | Gamla högen / Nytt kvitto |
| Primärknappar | Nästa bild · Klart · Klart · N bilder |
| Avtryckare (skärmläsare) | Fotografera nu |
| Remsa, ta bort | Ta bort sista |
| Remsa, i bildvy | Ta om · Stäng |
| Remsa, efter Klart | Förra kvittot |
| Sömvy | Sömvy · N bilder · Lägg till bild · Klart |
| Skuggremsa (skärmläsare) | Slutet på förra bilden — lägg papperet så att raderna syns igen |
| Kvalitetsrad | Redo · Gå närmare — texten är liten · Håll stilla · För mörkt — tänd lampan · Rikta mot kvittot · Startar kameran… · Autoutlösning av — tryck för att fotografera |
| Köräknare | N kvitton väntar · Allt uppladdat · N väntar · 1 fastnat |
| Kölista, tomt | Allt är uppladdat. Inget väntar. |
| Kölista, status | Verifierad på servern · Laddar upp… · Väntar på nätet · Fastnat |
| Kölista, sista segmentet fastnat | Sista bilden saknas — där står oftast totalbeloppet. |
| Kölista, botten | Uppladdat och verifierat: N kvitton i det här passet |
| Offline | Ingen kontakt med servern. Bilderna sparas i telefonen och skickas när kontakten är tillbaka. |
| Server full | Servern har slut på utrymme. Bilderna ligger kvar i telefonen. |
| Konflikt | Segment N finns redan på servern med ett annat innehåll. Ta upp kvittot i datorn innan du slänger papperet. |
| Lagring nästan full | Telefonen är nästan full. Ladda upp det som väntar innan du fotograferar mer. |
| Sparfel (dialog) | Bilden kunde inte sparas / Telefonen kunde inte spara bilden. Den finns just nu bara i minnet och försvinner om du stänger appen. / Försök spara igen · Ladda upp direkt · Släng bilden |
| Sparfel, bekräftelse | Bilden går inte att få tillbaka. Slänga ändå? |
| Återupptaget kvitto | Du har ett påbörjat kvitto med N bilder. / Fortsätt · Avsluta kvittot |
| Automatiskt avslutat | Ett påbörjat kvitto från i går lades i kön. |
| Kamera nekad | Kameran är blockerad för den här sidan. Öppna webbläsarens platsinställningar och tillåt kamera, ladda sedan om. |
| Hjälp: ett kvitto per bild | Ett kvitto per bild. Två kvitton i samma bild blir ett kvitto i arkivet — texten går att söka i, men beloppen hamnar fel. |
| Hjälp: veck | Platta till kvittot innan du fotograferar. Vecken är det som gör texten svår att läsa, inte ljuset. Bilden är det enda som blir kvar — tolkningen kan köras om hur många gånger som helst, men bilden tas bara en gång. |
| Hjälp: trasigt kvitto | Fotografera det som finns. Ett halvt kvitto går att söka i, ett slängt går inte. |
| Hjälp: baksida | Baksidan behövs sällan. Fotografera den bara när det står något eget där — en stämpel, en returkod eller en anteckning. Standardvillkor gör bara söket sämre. |
| Hjälp: långt kvitto | Låt ett par rader från förra bilden synas överst i nästa. Då syns det om något hoppats över. |

Genomgående: **du-tilltal, ingen jargong, ingen versalisering av knappar**. Felmeddelanden
säger vad som hände och vad som gäller för bilden — aldrig bara att något gick fel.

## 11. Tillgänglighet

| Krav | Lösning |
| --- | --- |
| Träffytor | Minst 48 × 48 dp överallt, avtryckaren 72 dp. Minst 8 dp mellan tryckbara ytor. |
| Enhandsräckvidd | Allt som trycks under ett kvitto ligger inom 190 dp från underkanten. Statusremsan är också nåbar genom nedåtdrag. |
| Kontrast | Text över video ligger alltid på en opak platta (kontrast mot videon går inte att garantera). Minst 4,5:1 för brödtext, 3:1 för ikoner och ramar. |
| Färg ensam | Aldrig. Varje kötillstånd har ikon + ord. Kvalitetsraden har ord, inte bara ram. |
| Skärmläsare | `aria-live="polite"` för "Bild N sparad", "Kvitto klart, N väntar". `aria-live="assertive"` bara för sparfelet i 5.6. Kameravyn har `aria-label="Kameravy"`, inte en bildbeskrivning som ljuger. |
| Blindanvändning | Hela flödet går att köra utan att titta: haptik vid tagen bild, dubbel haptik vid "Klart", avvikande mönster vid fel. |
| Rörelse | `prefers-reduced-motion` ⇒ remsan glider inte, den byts. Pulsering ersätts av statisk text. |
| Textstorlek | Layouten håller vid 200 % systemtext; knapparna växer på höjden, förhandsvisningen krymper. |
| Ljus | Mörkt gränssnitt genomgående — kameravyer i ljust läge bländar i mörka butiker och ger sämre bedömning av förhandsvisningen. Detta är den enda vyn i systemet som inte följer systemets ljusläge, och det är avsiktligt. |

## 12. Konflikter mot planen och mot servern som den ser ut i dag

Fem saker den här designen behöver som inte finns. De tre första är blockerande för M4;
K5 är det bara om avsnitt 9 någon gång ska få sina flaggor, vilket den inte ska i Steg 1.

**K1 — servern vet inte när ett kvitto är komplett.**
`POST /api/receipts` är idempotent på så sätt att den returnerar det befintliga kvittot och
**skriver inte om något** (`Archive.create`). Det finns alltså inget sätt att i efterhand
tala om att kvittot har tre segment. Följden: ett kvitto där segment 2 tappats bort ser
likadant ut som ett kvitto med ett segment — den tysta förlusten planen är byggd för att
undvika. Det påverkar också M5: OCR-jobbet vet inte när det får starta.
Avsnitt 9.1 skärper kravet: eftersom totalbeloppet nästan alltid står på det **sista**
segmentet är ett tappat sista segment det dyraste tappet som finns, och utan
`segmentsExpected` är det också det mest osynliga — ett kvitto på tre bilder där den sista
aldrig kom fram ser ut som ett komplett tvåbildskvitto med ett oläst totalbelopp.
*Förslag:* `POST /api/receipts/:id/complete { "segments": 3 }`, idempotent, som sätter ett
`segmentsExpected` i sidecaren och köar tolkningsjobbet. Kvitton där antalet inte stämmer
hamnar i **Kräver åtgärd**.

**K2 — `capture`-metadata når aldrig disken.**
`Archive.addSegment` tar emot en `capture`-parameter, men rutten i
`server/src/http/receipts.ts` skickar den inte vidare. Planens sidecar-format har
`capture: { textHeightPx, sharpness, autoShutter }`, och M9 ska kunna skilja autoutlösta
bilder från manuella. Utan det går den mätningen inte att göra i efterhand — mätvärdena
finns bara i telefonens ögonblick.
*Förslag:* ta emot ett `capture`-fält i samma multipart-anrop och skicka det vidare.
`Segment.capture` är redan `Record<string, unknown>`, så det behöver inget schemaarbete —
och det är samma lucka som skulle behöva stängas den dag en segmentroll (`front`/`back`,
avsnitt 9.7) eller ett mått på överlapp någonsin blir aktuellt.

**K3 — `backlog` går inte att sätta i efterhand, och det är rätt, men lägesväljaren måste
därför läsas vid *skapandet*.** Ingen ändring behövs i servern; det är en anmärkning till
klienten: kvittot skapas mot servern med det läge som gällde när **första bilden** togs,
inte det som gäller vid "Klart". Byter användaren läge mitt i ett kvitto är det första
bilden som räknas, och lägesväljaren låses visuellt medan ett kvitto pågår.

**K4 — tumnaglarna går inte att hämta.**
`GET /api/receipts/:id/files/:name` avvisar namn med snedstreck (`isSafeFileName`), och
tumnaglarna ligger i `derived/`. Mobilläget klarar sig utan (det har egna lokala
tumnaglar), men datorläget gör det inte — se `UX-dator.md`.

**K5 — `tags.user` går inte att sätta utifrån.**
Sidecaren har `tags: { user: [], auto: [] }` men ingen ändpunkt skriver till dem. Det är
skälet till att avsnitt 9.3 inte bygger någon "riven"-märkning i mobilen: den skulle behöva
en ny ändpunkt för en nytta som är svår att belägga. **Blockerar inte M4** och ska inte
lösas för den här designens skull — det noteras bara så att beslutet är spårbart, och för
att automatisk taggning (krav 21, 23–26) ändå är utanför Steg 1.

## 13. Vad jag inte vet

Skrivet så här för att inget ska förväxlas med underlag:

- **Ingen användarforskning finns.** Allt om hur högen faktiskt hanteras vid bordet är
  slutsatser ur kravställningen och planen, inte observationer.
- **Telefonmodellen är okänd** för mig, och därmed om `ImageCapture` finns, hur snabb
  JPEG-kodningen är och hur mycket lagring som är ledig. Ett pass på tjugo kvitton med
  instrumenteringen i avsnitt 6 påslagen avgör allt tre.
- **Texthöjdströskeln är inte satt** och kan inte sättas här. Den hör till M8 och ska mätas
  mot samma slags material som M0 använde — och mot blekt termopapper, som fortfarande
  saknas i allt underlag.
- **Sex timmars gräns för övergivna kvitton** är gissad.
- **Scenbyteströskeln efter "Klart"** är gissad; tidsgränsen på 1,2 s är säkerhetsnätet.
- **Fördelningen mellan korta och långa kvitton är okänd.** Planens räkneexempel antar ~2
  bilder per kvitto, men det är ett lagringsantagande, inte en mätning. Antalet segment per
  kvitto finns i sidecaren efter första passet och avgör om knapparnas vikt i avsnitt 3 och
  9.2 är rätt.
- **Överlappets storlek (20 %) är inte mätt** — den är vald för att rymma två till tre
  textrader i skuggremsan vid normalt avstånd. Vad som avgör: hur många rader som faktiskt
  syns där på den telefon som används.
- **Om närbild på totalraden räddar ett vikt kvitto är inte mätt.** Jämför konfidensen på
  totalfältet med och utan extra närbild i M9:s mätuttag.
- **Hur mycket baksidestext stör fritextsöket är inte mätt.** Det finns inga baksidor i
  M0:s material. Beviset, om det kommer, är en sökning på "öppet köp" som ger femtio
  träffar från samma kedja.
- **Hur ofta rivna kvitton förekommer i högen vet jag inte.** Är de många kan sömvyns
  brutna skarv bli en återkommande källa till onödig oro i granskningen, och då är en
  märkning värd sitt pris. Är de få är den det inte.
