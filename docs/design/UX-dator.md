# Datorläget — interaktionsdesign

Gäller M7 (krav 13, 14, 27, 29, 37, 44, 45) med beröring på M3 (säkerhetskopiering) och
M9 (mätuttaget ur granskningsurvalet).

## 0. Premissen, igen

**Bilden är oåterkallelig, tolkningen är det inte.** I mobilläget betyder det att inget får
gå förlorat. Här betyder det motsatsen: **allt som visas i fältpanelen är billigt att ha
fel**, och gränssnittet får därför vara frimodigt med maskinläsningen — så länge det aldrig
låtsas att en maskinläsning är ett faktum.

Därav en enda genomgående regel: **originalbilden är alltid närmare än ett klick från
varje siffra som påstås komma ur den.**

## 1. Syfte och hierarki

Datorläget är arbetsplatsen: hitta i högen, se vad som fastnat, rätta det som blev fel, och
göra granskningsurvalet som Steg 2 vilar på.

```
Ram (alltid synlig: navigering + serverstatus)
├── Arbetslista        krav 37, 45     start
├── Sök                krav 27, 29
├── Kvittovy           krav 13, 14, 29  ← nås från båda ovan
│   └── Bildvy         helskärm, segmentväxling
├── Granskningsläge    kalibreringsurvalet
└── Underhåll          säkerhetskopiering (M3), reindex, hälsa
```

Fem ytor. Kvittovyn är den enda som nås inifrån två håll och den enda som skriver till
sidecaren utanför granskningsläget.

## 2. Ramen

```
┌────────────────────────────────────────────────────────────────────────────┐
│ Kvittoarkiv   Arbetslista  Sök  Granska  Underhåll        ● Ansluten  14 ⧗ │
└────────────────────────────────────────────────────────────────────────────┘
```

Längst till höger två saker som alltid syns:

- **Anslutningsindikator för SSE.** `● Ansluten` / `◌ Återansluter…` / `✕ Ingen kontakt med
  servern`. Motiv: krav 45 lovar att ett kvitto som just fångats dyker upp direkt. Om
  strömmen tystnar ser listan ut som om ingenting händer, vilket är oskiljbart från att
  ingenting *händer*. Skillnaden måste synas.
- **Köräknaren `14 ⧗`** — antal kvitton som väntar på eller genomgår tolkning. Klick går
  till arbetslistan.

Vid `status: "degraded"` från `/api/health` läggs en banderoll över hela bredden, röd, som
inte går att stänga:

> **Servern har ont om diskutrymme (2,1 GiB kvar, golvet är 5 GiB). Nya bilder tas emot men
> tolkningen bör pausas. Se docs/DRIFT.md.**

Motiv: det är det enda felet i planen som kan ta ner maskinen, och det får inte gömmas i en
undermeny.

## 3. Arbetslistan (krav 37, 45)

### Syfte

Svara på en fråga i taget: **finns det något jag behöver göra?** Inte "visa alla kvitton" —
det är sökets uppgift.

### Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Arbetslista                                     [ Kör om allt som fastnat ]│
├────────────────────────────────────────────────────────────────────────────┤
│  KRÄVER ÅTGÄRD · 7                                                         │
│  ┌────┐ 01K5F2XQ…   Fångat i dag 14:02   Gamla högen                       │
│  │ ▤  │ Datum saknas                                            [ Öppna ]  │
│  └────┘                                                                    │
│  ┌────┐ 01K5F1TT…   Fångat i dag 13:58   Gamla högen                       │
│  │ ▤  │ Låg teckentäthet — kan ligga ned                        [ Öppna ]  │
│  └────┘                                                                    │
│  … 5 till                                                                  │
├────────────────────────────────────────────────────────────────────────────┤
│  BEARBETAS · 1                                                             │
│  ┌────┐ 01K5F3AA…   Segment 2 av 3  ▓▓▓▓▓▓░░░░  ca 4 s kvar                │
│  └────┘                                                                    │
│  Genomströmning: 2,6 kvitton/min · senaste timmen 154 · median 1,4 s/bild   │
├────────────────────────────────────────────────────────────────────────────┤
│  VÄNTAR · 9 842                                                            │
│  Beräknad tid kvar: ca 13 timmar   (uppdateras var minut)                  │
│  ┌────┐┌────┐┌────┐┌────┐┌────┐  … de äldsta först                        │
│  └────┘└────┘└────┘└────┘└────┘                                            │
├────────────────────────────────────────────────────────────────────────────┤
│  KLARA I DAG · 213                                    [ Visa i sök ]        │
└────────────────────────────────────────────────────────────────────────────┘
```

Fyra sektioner i **åtgärdsordning**, inte i tidsordning: det som kräver en människa först,
det som går av sig självt sist. Under en backloggkörning kommer "Väntar" att innehålla
tiotusen poster; den sektionen visar därför en **siffra och en tidsuppskattning**, inte en
lista. En lista med tiotusen rader är inte information.

Genomströmningsraden är krav 47 och planens termiska oro gjord synlig: sjunker
`median s/bild` under en lång körning stryper kortet, och det är den enda plats det
kommer att märkas.

### Tillstånd

| Tillstånd | Utseende |
| --- | --- |
| **Tomt arkiv** | "Inga kvitton än. Fotografera det första med telefonen — öppna samma adress där." + QR-kod till mobilläget. QR:en är motiverad: adressen är ett tailnet-namn som ingen vill skriva av. |
| **Inget att göra** | "Ingenting kräver åtgärd. 9 842 kvitton är tolkade." Sektionerna Kräver åtgärd och Bearbetas fälls ihop. |
| **Laddar** | Skelettrader i rätt antal om antalet är känt sedan förra hämtningen, annars tre. Ingen helskärmsspinner — listan byggs om ofta via SSE och får inte blinka. |
| **Fel vid hämtning** | "Kunde inte hämta arbetslistan. Servern svarade inte." + **Försök igen**. Föregående lista ligger kvar, nedtonad, med "Kan vara inaktuell". |
| **SSE bruten** | Indikatorn i ramen + listan pollar var 30 s som reserv. Data blir aldrig färskare än så, och det ska stå: "Uppdateras var 30:e sekund." |
| **Servern degraderad** | Banderoll enligt avsnitt 2. Sektionen Väntar får raden "Tolkningen bör pausas tills utrymmet är löst." |
| **Jobb som misslyckats upprepat** | Egen rad i Kräver åtgärd: "Tolkningen misslyckades 3 gånger: <felmeddelande>" + **Kör om**. Aldrig tyst borttappat — soparen återköar (krav 48), men något som återköats för evigt måste synas. |

### Skäl till "Kräver åtgärd"

Alla ska vara **faktiska**, aldrig tröskelberoende — det är samma princip som avsnitt 6.

| Skäl | Text i listan |
| --- | --- |
| Fält saknas helt | "Datum saknas" / "Totalbelopp saknas" / "Butik saknas" |
| Få tecken per läst rad | "Låg teckentäthet — kan ligga ned" |
| Orienteringen osäker (marginal < 0,05 åt båda håll) | "Osäker orientering" |
| Färre segment än väntat | "1 av 3 bilder har kommit fram" |
| Jobbet misslyckades | "Tolkningen misslyckades" |

De tre första kommer ur M0:s mätning och ur planens krav på förbehandlingen: en bild som
lästes ett tecken i taget får inte sparas som ett kvitto med tomma fält. Den fjärde
förutsätter K1 i `UX-mobil.md`.

## 4. Sök (krav 27, 29)

### Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│  🔍 kakel                                                          283 träffar│
├────────────────────────────────────────────────────────────────────────────┤
│ ┌──────┐  Bauhaus Kungens Kurva      2026-04-11        4 218,50 kr          │
│ │ bild │  …VÄGGPLATTA VIT 20x40 [KAKEL] 12 kvm 1 899,00…                    │
│ │      │  2 bilder · Gamla högen                     [ Öppna ] [ Bild ]     │
│ └──────┘                                                                    │
│ ┌──────┐  Byggmax Sisjön             2026-04-19          842,00 kr          │
│ │ bild │  …FOG [KAKEL] GRÅ 5 KG…                                            │
│ └──────┘                                                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

Varje träff visar: tumnagel, butik, datum, totalbelopp, textutdrag med träffen markerad,
antal bilder, och `backlog`-läget. **Tumnageln är själv en knapp till bildvyn** — det är
krav 29 bokstavligt: originalbilden ett klick bort. `B` gör samma sak från tangentbordet.

Butik, datum och belopp visas **utan** konfidensmarkering i träfflistan. Motiv: en
sökträfflista är ett navigeringsverktyg, och konfidensmärken på varje rad blir tapet som
ingen läser. Markeringen hör hemma där värdet ska bedömas — i kvittovyn.
*Undantag:* saknas ett fält står det `—` med `title="Fältet kunde inte läsas"`, aldrig ett
gissat värde.

### Tillstånd

| Tillstånd | Text |
| --- | --- |
| **Tomt fält** | "Sök i allt som står på kvittona." + de tre senaste sökningarna + raden "Sökningen bryr sig inte om å/ä/ö — en sökning på *återköp* hittar även *äterköp*." |
| **Laddar** | Träfflistan tonas till 40 % och behåller sin höjd. Inget hopp. |
| **Ingen träff** | "Ingen träff på **kakel**." + tre förslag: "Sökningen matchar orden i följd — prova ett ord i taget." / "OCR:en förväxlar 0 och O — prova den andra varianten." / "Kvitton som ännu inte tolkats är inte sökbara. 9 842 väntar." |
| **Fel** | "Sökningen gick inte att köra. Servern svarade inte." + **Försök igen** |
| **Fler än 50** | Sista raden: "Visar de 50 mest relevanta träffarna." + **Visa fler** |
| **Tom fråga** | Inget anrop skickas (servern svarar 400). |

Den mittersta förslagstexten är inte kosmetik: den är en direkt följd av M0-mätningen om
förväxlade tecken, och den tredje är en direkt följd av att indexet bara innehåller tolkad
text. Båda är sådant som annars gör att man tror att arkivet tappat ett kvitto.

Fritextsöket går över `text`-fältet i sidecaren, alltså hela råtexten, med
`remove_diacritics 2`. Det är precis vad planens M0-avsnitt kräver.

*Konflikt, se avsnitt 11 (D1 och D2):* söksvaret innehåller i dag varken butik, datum,
belopp eller tumnagelsökväg, och flerordsfrågor blir fraser.

## 5. Kvittovyn

### Layout

```
┌───────────────────────────────────┬────────────────────────────────────────┐
│  ‹ Tillbaka   01K5F2XQ…   ‹ 3/47 › │  Bauhaus Kungens Kurva                 │
│                                    │  ─────────────────────────────────────│
│   ┌──────────────────────────┐     │  BUTIK                          [1]   │
│   │                          │     │  Bauhaus Kungens Kurva                 │
│   │                          │     │  Maskinläst · 0,94   ┄┄┄┄┄┄┄┄┄┄        │
│   │      segment 1 av 2      │     │  ┌ ur bilden, segment 1, rad 3 ──────┐│
│   │                          │     │  │  BAUHAUS KUNGENS KURVA           ││
│   │   ▭ ← markerad evidens   │     │  └──────────────────────────────────┘│
│   │                          │     │  [ Rätta (E) ]  [ Bekräfta (Enter) ]  │
│   │                          │     │                                        │
│   └──────────────────────────┘     │  DATUM                          [2]   │
│   [1][2]   [ − ][ + ][ ⤢ ]         │  2026-04-11                            │
│                                    │  Maskinläst · 0,97   ┄┄┄┄┄┄┄┄┄┄        │
│                                    │  ┌ ur bilden, segment 1, rad 5 ──────┐│
│                                    │  │  2026-04-11 14:22  KASSA 4        ││
│                                    │  └──────────────────────────────────┘│
│                                    │                                        │
│                                    │  TOTALBELOPP                    [3]   │
│                                    │  4 219,00 kr                           │
│                                    │  Fastställd av dig · i går 20:14       │
│                                    │  Maskinen läste 4 218,50 (0,61)        │
│                                    │                                        │
│                                    │  ─────────────────────────────────────│
│                                    │  Fångat 2026-04-19 14:02 · Gamla högen│
│                                    │  Tolkad med ppocrv6-tiny@1, 2,5 s     │
│                                    │  [ Kör om tolkningen ]                 │
│                                    │  ▸ Hela råtexten                       │
└───────────────────────────────────┴────────────────────────────────────────┘
```

Bilden till vänster och stor, fälten till höger. Motiv: läsordningen ska gå från belägg
till påstående, inte tvärtom.

### Bildpanelen

- Segmentväxling med `[1][2]` och med `,` / `.`. På ett långt kvitto i tre segment är
  totalen på det sista — det står i planens riskrad, och därför **öppnas kvittovyn på det
  segment där evidensen för totalbeloppet ligger**, inte alltid på segment 1.
- Zoom med `+` / `−` / hjul, panorering med piltangenter eller drag, `⤢` = helskärm.
- Klick på ett fälts evidensruta i panelen zoomar bilden till just den rutan.
- Bilden visas som den ligger på disk plus samma uppräting som OCR-steget valde, med
  knappen **Visa som originalet ligger**. Motiv, direkt ur spikens README: webbläsaren
  rättar EXIF-orientering medan servern läser filen som den ligger, så samma bild kan se
  rätt ut här och läsas fel av OCR:en. Går det att växla syns felet.

### Fältpanelen — och krav 13 utan tröskel

Detta är dokumentets viktigaste avsnitt. Se avsnitt 6.

### Nedre delen

- **Fångstuppgifter**: tid, `backlog`, antal segment.
- **Tolkningsuppgifter**: motor, version, körtid, orienteringsbeslut ("vriden 90° medurs,
  marginal 0,31"). Det är den raden som förklarar ett obegripligt resultat.
- **Kör om tolkningen** — alltid tillgänglig, aldrig farlig: bilden rörs inte, och
  användarens rättningar skrivs inte över (fält med `source: "manual"` behålls; det står i
  bekräftelsen: "Dina rättningar behålls. Bara maskinlästa fält räknas om.").
- **Hela råtexten** fälls ut med per-rad-konfidens i marginalen. Behövs när ett fält saknas
  helt och man vill se om texten ens finns.

### Tillstånd

| Tillstånd | Utseende |
| --- | --- |
| **Ännu inte tolkad** | Fältpanelen: "Kvittot är inte tolkat än. Det ligger på plats 412 i kön." + **Tolka det här först** (flyttar jobbet främst). Bilden visas som vanligt — den är det viktiga och den finns redan. |
| **Under tolkning** | "Tolkas nu…" + framdrift, uppdaterad via SSE. |
| **Tolkning misslyckades** | "Tolkningen misslyckades: `<felmeddelande>`." + **Kör om**. Bild och råtext (om någon) visas ändå. |
| **Fält saknas** | Fältet visas med `—` och texten "Kunde inte läsas ur bilden." Knappen är **Skriv in** (inte "Bekräfta" — det finns inget att bekräfta). |
| **Bilden går inte att visa** | "Bilden kunde inte hämtas från servern." + **Försök igen** + sökvägen i arkivet som text, så att den går att leta upp för hand. Fältpanelens bekräftelseknappar **låses** — se regel 4 i avsnitt 6. |
| **Segment saknas** | "1 av 3 bilder har kommit fram. Kontrollera telefonens kö innan papperet slängs." Röd, överst, inte i en flik. |
| **Sparande misslyckas** | Rättningen ligger kvar i fältet, gult: "Rättningen kunde inte sparas. Den ligger kvar här tills den gått igenom." + **Försök igen**. Aldrig tyst rensad. |
| **Redigerad någon annanstans** | SSE säger att kvittot ändrats medan man skriver: "Kvittot ändrades i ett annat fönster." + **Läs om** / **Behåll min text**. Två personer i hushållet, ett arkiv — det kan hända. |

## 6. Krav 13 utan tröskel: hur en människa bedömer ett maskinläst värde

Frågan att svara på: **vad visas, och hur undviks att användaren blint bekräftar allt?**

### 6.1 De tre tillstånden ett fält kan ha

Inte två, och inte en skala:

| Tillstånd | Visas som | `source` |
| --- | --- | --- |
| **Maskinläst** — ingen har sett på det | Värdet i normal vikt, **prickad underlinje**, raden `Maskinläst · 0,94` + en tunn grå stapel | `"ocr"` |
| **Fastställd** — en människa har bekräftat eller rättat | Värdet i halvfet, **ingen** underlinje, raden `Fastställd av dig · i går 20:14`, och om det rättats: `Maskinen läste 4 218,50 (0,61)` | `"manual"` |
| **Saknas** | `—` och "Kunde inte läsas ur bilden" | fältet finns inte |

Det är planens definition, ordagrant: *osäkert = ännu inte bekräftat av en människa*.
Konfidenssiffran är information om läsningen, aldrig en dom över den.

### 6.2 Ingen färgkodning av konfidens. Alls.

Det här är det enda beslut i hela datorläget som jag skulle kalla principiellt.

En grön 0,94 och en röd 0,61 **är** en tröskel. Den är bara inte skriven i koden utan i
ögat, och den blir omöjlig att kalibrera i efterhand eftersom man aldrig får veta vad
användaren egentligen reagerade på. Planen säger uttryckligen att tröskeln inte byggs i
Steg 1 och varför. En trafikljusfärgning smyger in beslutet ändå.

Alltså: **siffran skrivs ut med två decimaler och ritas som en neutral grå stapel** i samma
kulör oavsett värde. Stapeln finns för att göra jämförelser mellan fält snabba för ögat,
inte för att döma. När Steg 2 har en kalibrerad tröskel går det att lägga färg ovanpå — och
då finns siffror bakom den.

*Detta är också ett medvetet pris:* utan färg går granskningen långsammare. Det är rätt
pris i Steg 1, eftersom hela poängen med granskningsurvalet är att mäta hur ofta hög
konfidens ändå var fel.

### 6.3 Belägget, inte bara värdet

Varje maskinläst fält visar **ett utsnitt ur originalbilden** — evidensrutan ur sidecarens
`evidence.box` — direkt under värdet. Utsnittet är litet (max 60 px högt, hela raden brett)
och laddas lat.

Det är den enskilt viktigaste detaljen i vyn. Bedömningen blir då en **jämförelse av två
saker som ligger bredvid varandra**, inte en gissning om huruvida en siffra känns rätt. Det
är snabbt, det kräver inte att man letar i bilden, och det är omöjligt att göra utan att ha
tittat.

Konsekvens som måste hanteras: **evidensrutan kan i sig vara fel** — den pekar på den rad
som mönstret matchade, och matchade mönstret fel rad så pekar rutan fel. Därför står alltid
`ur bilden, segment 1, rad 3` ovanför utsnittet, och ett klick zoomar huvudbilden till samma
ställe så att sammanhanget syns.

### 6.4 Så undviks blind bekräftelse

Sex mekanismer, ingen av dem en tröskel:

1. **Det finns ingen "Bekräfta allt"-knapp.** Inte i kvittovyn, inte i listan, inte som
   massåtgärd. Ett fält i taget, ett kvitto i taget. Det är det billigaste och starkaste
   skyddet, och det kostar bara några sekunder per kvitto — som ändå bara görs på hundra
   kvitton i granskningsurvalet plus de som fastnat.
2. **Fält utan evidensruta går inte att snabbekräfta.** Saknas `evidence.box` byts
   **Bekräfta** mot **Öppna bilden för att bedöma**, som först zoomar och först därefter
   visar bekräftelseknappen. Detta är en regel som vilar på ett *faktum* (finns rutan eller
   inte), inte på en tröskel.
3. **Bekräftelse kräver att bilden faktiskt visas.** Har bilden inte laddats — nätfel,
   trasig fil — är bekräftelseknapparna låsta med texten "Bilden måste visas innan värdet
   kan bekräftas." Man ska inte kunna intyga något man inte sett.
4. **Den lätta tangenten är den säkra.** Se granskningsläget, 7.2: `F` (fel, rätta) ligger
   under vänsterhandens pekfinger; `Enter` (rätt) kräver högerhanden. Asymmetrin är
   avsiktlig och följer felkostnaden: ett felaktigt "Fel" kostar några sekunder, ett
   felaktigt "Rätt" förgiftar kalibreringsunderlaget tyst.
5. **Betänketiden mäts, men blockerar aldrig.** `review.dwellMs` och `review.imageShown`
   sparas per granskat kvitto. Ingen spärr, ingen nedräkning — men M9 kan då räkna
   felfrekvens med och utan de snabbaste besluten och se om det spelar roll. Det är det
   ärliga svaret på "hur vet vi att någon tittade": mät det, tvinga inte fram det.
6. **Rättning kräver ett värde.** Man kan inte klicka "det ser fel ut" och gå vidare. Antingen
   skriver man rätt värde, eller så väljer man **Oläslig** (`O`), som är ett eget utfall.
   Utan det tredje utfallet hamnar alla "jag kan faktiskt inte avgöra" i högen "Rätt" och
   underlaget blir för snällt — precis det fel planens avsnitt om kalibreringsurvalet finns
   för att undvika.

### 6.5 Ett alternativ som övervägdes och valdes bort

**Blind inmatning:** dölj maskinvärdet, låt granskaren läsa siffran ur bilden själv, visa
sedan maskinens värde och jämför automatiskt. Det tar bort ankringseffekten helt och ger
den renaste mätningen som går att få.

Valdes bort för Steg 1 därför att det gör hundra kvitton till ett par timmars arbete i
stället för tjugo minuter, och därför att det bryter tvåtangentskravet.

**Vad som skulle avgöra det:** om M9 visar att medianbetänketiden i granskningsurvalet är
under ~2 sekunder och andelen "Rätt" ligger nära 100 %, är underlaget sannolikt
rubberstamping och inte mätning. Då körs ett *delurval* om 20 kvitton med blind inmatning
och de två siffrorna jämförs. Skiljer de sig inte är den snabba metoden god nog. Detta är
en mätning som ska göras, inte en gissning jag lägger i designen nu.

## 7. Granskningsläget

### 7.1 Syfte

Kalibreringsurvalet ur planen: **hundra slumpvis dragna kvitton, oavsett konfidens**,
granskade mot bilden, där även utfallet "rätt" skrivs ner. Det är den enda datakälla ur
vilken felfrekvens per konfidensintervall får räknas i Steg 2.

Urvalet dras under backloggkörningen och märks `review.sampled = true` i sidecaren
(fältet finns redan i `server/src/store/sidecar.ts`).

### 7.2 Layout

```
┌────────────────────────────────────────────────────────────────────────────┐
│  Granskning                          Kvitto 12 av 100      [ Pausa (Esc) ]  │
├──────────────────────────────────┬─────────────────────────────────────────┤
│                                  │  BUTIK                                  │
│                                  │  Bauhaus Kungens Kurva      0,94        │
│                                  │  ┌ segment 1, rad 3 ──────────────────┐ │
│     ┌────────────────────────┐   │  │ BAUHAUS KUNGENS KURVA              │ │
│     │                        │   │  └────────────────────────────────────┘ │
│     │   hela kvittot,        │   │                                         │
│     │   zoomat till          │   │  DATUM                                  │
│     │   evidensrutorna       │   │  2026-04-11                 0,97        │
│     │                        │   │  ┌ segment 1, rad 5 ──────────────────┐ │
│     │                        │   │  │ 2026-04-11 14:22 KASSA 4           │ │
│     └────────────────────────┘   │  └────────────────────────────────────┘ │
│                                  │                                         │
│                                  │  TOTALBELOPP                            │
│                                  │  4 218,50 kr                0,61        │
│                                  │  ┌ segment 2, rad 41 ─────────────────┐ │
│                                  │  │ ATT BETALA        4218,50          │ │
│                                  │  └────────────────────────────────────┘ │
├──────────────────────────────────┴─────────────────────────────────────────┤
│   [ Fel — rätta  (F) ]        [ Oläslig (O) ]        [ Rätt  (Enter) ]      │
│   ▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░  12/100 · 4 rättade · 1 oläslig           │
└────────────────────────────────────────────────────────────────────────────┘
```

Tre utfall, två av dem på de tangenter uppdraget beskriver, och det tredje för det som
annars smyger sig in i "Rätt".

- **Rätt (Enter)** — alla tre fälten stämmer. `verdict: "correct"`, inga fält ändras,
  `source` förblir `"ocr"`. Motiv: en granskning är inte en bekräftelse av varje fält, den
  är en mätpunkt. Att sätta `source: "manual"` på hundra kvitton skulle förstöra möjligheten
  att i efterhand räkna om samma urval.
- **Fel — rätta (F)** — panelen växlar till redigering, fält för fält, `Tab` mellan dem,
  `Enter` sparar och går vidare. `verdict: "corrected"`, och varje ändring hamnar i
  `corrections[]` med `fromConfidence` — det är krav 12:s råmaterial.
- **Oläslig (O)** — bilden går inte att bedöma. `verdict: "unreadable"`. Räknas separat och
  ingår **inte** i felfrekvensen, men antalet redovisas: ett urval med 30 oläsliga säger
  något viktigt om högen.
- **Ångra (Ctrl+Z)** — sista utfallet tas tillbaka och kvittot visas igen. Ett feltryck i en
  serie om hundra är att räkna med, och utan ångra blir det en tyst felaktig datapunkt.
- **Pausa (Esc)** — går ur, sparar var man är. Granskningen återupptas exakt där.

### 7.3 Regler i granskningsläget

1. **Fälten visas inte förrän bilden är laddad.** Panelen har en platshållare tills dess.
   Direkt följd av regel 3 i 6.4.
2. **Ordningen är slumpad**, inte kronologisk, så att ett pass inte blir en följd av
   likadana kvitton från samma butik samma dag.
3. **Bilden öppnas zoomad till evidensrutorna**, med hela kvittot ett tangenttryck bort
   (`Blanksteg` = växla mellan zoomat och helt). Man ska inte behöva panorera för att göra
   det man är där för.
4. **Efter 25 kvitton i rad:** en dämpad rad, inte en modal — "Du har granskat 25 i rad.
   Pausa gärna." Går att ignorera. *Osäkerhet: 25 är gissat. Det som avgör är om
   felfrekvensen i andra halvan av ett pass skiljer sig från första halvan, vilket M9 kan
   räkna ut ur `dwellMs` och ordningen.*
5. **Ett granskat kvitto granskas inte igen** i samma urval, men urvalet kan dras om senare
   som ett nytt urval med egen märkning — planen jämför backlogg och färska kvitton var för
   sig.

### 7.4 Tillstånd

| Tillstånd | Text |
| --- | --- |
| **Urval inte draget än** | "Granskningsurvalet dras när backloggen körts. 9 842 kvitton väntar fortfarande på tolkning." + **Dra ett urval ändå** (för den som vill börja tidigt; urvalet märks med sitt datum). |
| **Urval klart** | "Alla 100 är granskade. 91 rätt, 8 rättade, 1 oläslig." + **Visa sammanställningen** + **Dra ett nytt urval**. |
| **Mitt i, återkomst** | "Du har 88 kvar att granska." + **Fortsätt** |
| **Bilden saknas** | Tangenterna `Enter` och `F` är låsta; bara `O` (Oläslig) och `Ctrl+Z` är kvar. "Bilden kunde inte visas. Markera som oläslig eller hoppa över." |
| **Sparande misslyckas** | Utfallet köas lokalt och skickas om; raden "1 utfall väntar på att sparas". Granskningen fortsätter — den får inte stanna av ett nätfel. |

## 8. Snabbrättning (krav 14)

Utanför granskningsläget, i kvittovyn:

1. `1`, `2`, `3` hoppar till Butik, Datum, Totalbelopp. Fokus syns tydligt.
2. `E` (eller `Enter`) öppnar redigering av det fokuserade fältet, med **hela värdet markerat**
   så att inskrivning ersätter direkt.
3. `Enter` sparar, `Esc` ångrar, `Tab` sparar och går till nästa fält.
4. `Enter` på ett *ej* redigerat fält = **Bekräfta** (värdet blir fastställt utan ändring).
5. `N` / `P` = nästa/föregående kvitto i den lista man kom från, med rättningen sparad.

Fälten har typade inmatningar utan att vara stelbenta:

- **Datum:** accepterar `11/4`, `11 apr`, `2026-04-11`, `260411`. Visas alltid som
  `2026-04-11`. Årtal utelämnat ⇒ tas från kvittots fångstår, och det syns i förhandsvisning
  innan man sparar.
- **Belopp:** accepterar `4219`, `4 219,00`, `4219.00`, `4.219,00`. Visas som `4 219,00 kr`.
- **Butik:** fritext med förslag ur tidigare butiksnamn i arkivet (`receipts.store`),
  men **inget tvång** — förslag som väljs sätter samma sträng, ingenting normaliseras bakom
  ryggen.

Varje sparad rättning skriver `corrections[]` med `from`, `fromConfidence`, `to` och
tidpunkt, precis som planens format. Ett litet **Ångra** stannar kvar i 10 sekunder efter
varje sparande.

*Konflikt D3, avsnitt 11:* det finns ingen skriv-ändpunkt för fält än.

## 9. Tangentbordsgenvägar

Ett tak: **inga modifierartangenter för det som görs ofta**. Det som görs hundra gånger ska
kosta ett finger.

### Globalt

| Tangent | Gör |
| --- | --- |
| `/` | Fokusera sökfältet |
| `G` sedan `A` | Arbetslistan |
| `G` sedan `S` | Sök |
| `G` sedan `R` | Granskning |
| `G` sedan `U` | Underhåll |
| `Esc` | Stäng modal / lämna redigering / pausa granskning |
| `?` | Visa genvägslistan |

### Listor (arbetslista, sökträffar)

| Tangent | Gör |
| --- | --- |
| `J` / `↓` | Nästa rad |
| `K` / `↑` | Föregående rad |
| `Enter` | Öppna kvittot |
| `B` | Öppna originalbilden direkt (krav 29) |
| `Home` / `End` | Först / sist |

### Kvittovyn

| Tangent | Gör |
| --- | --- |
| `1` `2` `3` | Butik / Datum / Totalbelopp |
| `E` | Rätta fokuserat fält |
| `Enter` | Bekräfta fältet, eller spara pågående redigering |
| `Esc` | Avbryt redigering |
| `Tab` / `Shift+Tab` | Nästa / föregående fält, sparar |
| `N` / `P` | Nästa / föregående kvitto i listan |
| `,` / `.` | Föregående / nästa segment |
| `+` / `−` | Zooma |
| `0` | Zooma till hela bilden |
| `Blanksteg` | Växla zoomat evidensutsnitt ↔ hela bilden |
| `B` | Bilden i helskärm |
| `T` | Fäll ut hela råtexten |
| `Ctrl+Z` | Ångra senaste sparade rättning (10 s) |

### Granskningsläget

| Tangent | Gör |
| --- | --- |
| `Enter` | **Rätt** |
| `F` | **Fel — rätta** |
| `O` | **Oläslig** |
| `Blanksteg` | Växla zoom |
| `Ctrl+Z` | Ångra senaste utfall |
| `Esc` | Pausa |

Valet av just `Enter` och `F` är motiverat i 6.4 punkt 4 och är inte utbytbart mot två
angränsande tangenter: två tangenter bredvid varandra går att trumma på med en hand, och det
är precis beteendet designen finns för att förhindra.

## 10. Tillgänglighet

| Krav | Lösning |
| --- | --- |
| **Tangentbord först** | Hela datorläget går att köra utan mus, inklusive zoom och panorering av bilden. Det är inte en tillgänglighetseftergift utan grunddesignen — krav 14 handlar om snabbhet. |
| **Fokusmarkering** | 2 px ram med 3:1 kontrast mot bakgrunden, aldrig enbart en bakgrundsfärgändring. Fokus flyttas aldrig av sig självt utom vid `/` och vid nytt kvitto i granskningen. |
| **Kontrast** | Brödtext ≥ 4,5:1, konfidensstapeln och ramar ≥ 3:1. Konfidenssiffran skrivs alltid ut i text — stapeln är redundant. |
| **Färg ensam** | Används ingenstans. Kötillstånd, granskningsutfall och fälttillstånd har ord. Den enda färgen som bär betydelse är den röda banderollen vid lågt diskutrymme, och den har både ikon och text. |
| **Skärmläsare** | Fälten är `<dl>`-liknande med `aria-describedby` mot konfidensraden, så att "Totalbelopp, 4 218 kronor 50 öre, maskinläst, konfidens 0,61" läses som en enhet. Evidensutsnittet får `alt="Utsnitt ur segment 1, rad 41"` — aldrig en påhittad beskrivning av bildinnehållet. |
| **Direktuppdateringar** | SSE-uppdateringar i arbetslistan annonseras i en `aria-live="polite"`-region som en sammanfattning ("2 nya kvitton"), inte som en rad per händelse. En backloggkörning skulle annars göra skärmläsaren obrukbar. |
| **Rörelse** | `prefers-reduced-motion` ⇒ inga övergångar i listorna, framdriftsstaplar uppdateras stegvis. |
| **Textstorlek och zoom** | Layouten håller vid 200 % webbläsarzoom: fältpanelen lägger sig under bilden i stället för bredvid. |
| **Ljusläge** | Följer systemet. Bildpanelen har alltid neutralt grå bakgrund oavsett läge, eftersom en vit eller svart bakgrund ändrar hur ett fotograferat kvitto uppfattas. |
| **Två personer, ett arkiv** | Rättningar och granskningsutfall visar vem som gjorde dem om inloggning någonsin införs; tills dess står "Fastställd av dig", vilket är sant i ett tvåpersonershushåll utan konton men bör bytas mot namn den dag konton finns. |

## 11. Konflikter mot planen och mot servern som den ser ut i dag

**D1 — söksvaret räcker inte för träfflistan.**
`search()` i `server/src/store/index-db.ts` returnerar `{ id, capturedAt, segments, snippet }`.
Butik, datum och belopp finns redan som kolumner i `receipts`-tabellen men följer inte med.
Träfflistan i avsnitt 4 kan alltså inte byggas utan ett anrop per träff.
*Förslag:* lägg till `store`, `date`, `total`, `currency` i `SearchHit`. Ren utökning av en
befintlig `SELECT`.

**D2 — flerordssökning blir en fras.**
Rutten citerar hela frågan (`"${q}"`), vilket i FTS5 betyder frassökning. En sökning på
`kakel badrum` ger då noll träffar om orden inte står intill varandra, vilket är motsatsen
till vad en människa förväntar sig — och kravställningens egen slutprovsfråga
("vad kostade allt kakel till badrummet") är exakt en sådan.
*Förslag:* citera varje ord för sig och foga ihop med `AND`; behåll frassökning för
frågor som användaren själv skrivit inom citattecken. Gränssnittet visar då förklaringen
"Alla orden måste finnas" under sökfältet.

**D3 — det finns ingen ändpunkt för att skriva fält, rättningar eller granskningsutfall.**
Väntat i M7, men värt att skriva ner formen så att sidecaren inte behöver ändras sedan:
`PATCH /api/receipts/:id/fields` som sätter `value`, `source: "manual"` och lägger till i
`corrections[]` med `fromConfidence`; `POST /api/receipts/:id/review` som sätter
`{ sampled, reviewedAt, verdict, dwellMs, imageShown }`.

**D4 — `review`-typen är tunnare än planen.**
`sidecar.ts` har `review: { sampled: boolean }`, medan planens format har `sampled`,
`reviewedAt` och `verdict`. Den här designen behöver dessutom `dwellMs` och `imageShown`
(6.4 punkt 5) och ett tredje utfall `"unreadable"` (7.2).
*Detta är ett tillägg till planen, inte en avvikelse* — men det ska skrivas in där, för
`verdict`-domänen är en del av mätuttaget i M9.

**D5 — tumnaglarna går inte att hämta.**
`isSafeFileName` tillåter inga snedstreck, och tumnaglarna ligger i `derived/`. Både
arbetslistan och sökträfflistan behöver dem, och att skicka fullstora JPEG:er till en lista
med femtio rader är inte ett alternativ.
*Förslag:* `GET /api/receipts/:id/thumbs/:index` som egen rutt, hellre än att luckra upp
namnkontrollen.

**D6 — status finns inte i sidecaren.**
Planen beskriver `captured → interpreting → interpreted / needs_review`, men `Receipt` har
inget statusfält och indexet ingen statuskolumn. Arbetslistans tre sektioner (krav 37) kan
inte byggas utan det.
*Förslag:* härled status ur jobbkön (som byggs i M5) i stället för att lagra den i
sidecaren — jobbkön är rätt ägare av "bearbetas nu", och `needs_review` är en funktion av
sidecarens innehåll som ändå räknas om vid varje `reindex`. Då slipper sidecaren ett fält
som kan bli osant.

**D7 — SSE finns inte än.** Väntat (M7). Formen som behövs:
`GET /api/events` med händelserna `receipt.created`, `receipt.updated`, `job.progress`,
`health.changed`. Arbetslistan och kvittovyn lyssnar; sökträfflistan gör det inte —
en lista som ändrar sig medan man läser den är värre än en färsk lista.

## 12. Vad jag inte vet

- **Ingen användarforskning finns.** Allt om hur arbetet faktiskt går till är slutsatser ur
  kravställningen och planen.
- **Hur lång tid en granskning tar** är okänt. Hela avsnitt 7 är dimensionerat för ~10–20 s
  per kvitto; blir det 60 s är hundra kvitton ett för stort urval att orka med i ett svep
  och ska då delas i fyra pass om tjugofem.
- **Om evidensrutorna blir användbara** avgörs av M6:s fältutvinning. Pekar de ofta på fel
  rad är hela avsnitt 6.3 mindre värt, och då behövs i stället en tydligare väg in i
  råtexten. Det syns första gången granskningsläget körs skarpt.
- **Om `dwellMs` faktiskt avslöjar rubberstamping** vet jag inte. Det är en hypotes som M9
  kan pröva, inte en etablerad metod.
- **Datumsvagheten (74 % i M0)** kan visa sig göra "Datum saknas" till det vanligaste skälet
  i Kräver åtgärd, med hundratals kvitton i den sektionen. Blir det så behövs en
  massinmatningsvy för just datum — men den ska inte byggas innan M6 utrett svagheten, för
  den kan visa sig vara ett mönsterfel och inte ett bildfel.
