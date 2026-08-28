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

Det kräver att servern vet hur många segment som ska komma. Det gör den inte i dag — se
avsnitt 11, konflikt K1.

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

## 9. Text, samlad

| Plats | Text |
| --- | --- |
| Titel/PWA-namn | Kvittofångst |
| Startknapp | Slå på kameran |
| Lägesväljare | Gamla högen / Nytt kvitto |
| Primärknappar | Nästa bild · Klart |
| Avtryckare (skärmläsare) | Fotografera nu |
| Remsa, ta bort | Ta bort sista |
| Remsa, i bildvy | Ta om · Stäng |
| Kvalitetsrad | Redo · Gå närmare — texten är liten · Håll stilla · För mörkt — tänd lampan · Rikta mot kvittot · Startar kameran… · Autoutlösning av — tryck för att fotografera |
| Köräknare | N kvitton väntar · Allt uppladdat · N väntar · 1 fastnat |
| Kölista, tomt | Allt är uppladdat. Inget väntar. |
| Kölista, status | Verifierad på servern · Laddar upp… · Väntar på nätet · Fastnat |
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

Genomgående: **du-tilltal, ingen jargong, ingen versalisering av knappar**. Felmeddelanden
säger vad som hände och vad som gäller för bilden — aldrig bara att något gick fel.

## 10. Tillgänglighet

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

## 11. Konflikter mot planen och mot servern som den ser ut i dag

Fyra saker den här designen behöver som inte finns. De tre första är blockerande för M4.

**K1 — servern vet inte när ett kvitto är komplett.**
`POST /api/receipts` är idempotent på så sätt att den returnerar det befintliga kvittot och
**skriver inte om något** (`Archive.create`). Det finns alltså inget sätt att i efterhand
tala om att kvittot har tre segment. Följden: ett kvitto där segment 2 tappats bort ser
likadant ut som ett kvitto med ett segment — den tysta förlusten planen är byggd för att
undvika. Det påverkar också M5: OCR-jobbet vet inte när det får starta.
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

**K3 — `backlog` går inte att sätta i efterhand, och det är rätt, men lägesväljaren måste
därför läsas vid *skapandet*.** Ingen ändring behövs i servern; det är en anmärkning till
klienten: kvittot skapas mot servern med det läge som gällde när **första bilden** togs,
inte det som gäller vid "Klart". Byter användaren läge mitt i ett kvitto är det första
bilden som räknas, och lägesväljaren låses visuellt medan ett kvitto pågår.

**K4 — tumnaglarna går inte att hämta.**
`GET /api/receipts/:id/files/:name` avvisar namn med snedstreck (`isSafeFileName`), och
tumnaglarna ligger i `derived/`. Mobilläget klarar sig utan (det har egna lokala
tumnaglar), men datorläget gör det inte — se `UX-dator.md`.

## 12. Vad jag inte vet

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
