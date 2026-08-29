# UI-system — privat kvittoarkiv

Status: förslag, 2026-08-29. Gäller Angular 19 med standalone-komponenter.
Underlag: `~/.claude/plans/atomic-waddling-nautilus.md` (M0–M9), `web/src/`, `server/src/http/`.

Systemet har två ytor och en publik: två personer i ett hushåll, över tailnet, ingen okänd
användare. Innehållet är foton av vitt skrynkligt termopapper plus maskinläst text med
konfidensvärden. Gränssnittets uppgift är att **inte synas**. Allt nedan är underordnat det.

Om du bara läser ett avsnitt: läs **§5 Konfidens**. Det är systemets enda verkligt svåra beslut,
och resten av dokumentet finns i praktiken för att bära det.

---

## 1. Vägval för stilhantering

### Rekommendation

**Ren CSS med custom properties, inget ramverk.** Tokens i en global fil, komponentstilar i
Angulars inbyggda per-komponent-CSS. Inget Angular Material, ingen Tailwind, inget
utilityverktyg. Ett tillåtet undantag, i §1.4.

### 1.1 Varför

Tre egenskaper hos just det här projektet avgör, och de pekar alla åt samma håll.

**Det ska överleva år av lågintensivt underhåll av en person.** Den kostnaden är inte att
skriva CSS — det är att uppgradera. Angular Material följer Angulars major-kadens: ungefär två
versionshopp om året, var och en med en migrering att köra och släppnoter att läsa. Övergången
från Material 2:s till Material 3:s temasystem skrev om hela token-API:t en gång redan. Om
någon öppnar det här repot i februari 2029 efter att inte ha rört det på fjorton månader, är
skillnaden mellan att uppgradera Angular ensamt och att uppgradera Angular plus ett
komponentbibliotek plus dess temalager skillnaden mellan en eftermiddag och ett veckoslut. Ren
CSS har noll uppgraderingsyta: en `:root`-fil med custom properties fungerar likadant i alla
webbläsare som kommer att finnas 2029.

**Det körs på en liten burk.** ZimaBoard N150, passiv kylning. Servern är den som ska ha
marginalen — inte klienten — men bygget körs i samma Docker-image, och `anyComponentStyle`-budgeten
i `web/angular.json` står redan på 4 kB varning / 8 kB fel. Ett komponentbibliotek gör den
budgeten meningslös och lägger 250–350 kB på initialbunten som telefonen ska hämta över tailnet
i en butik med två streck. Ren CSS ger en total stilmängd i storleksordningen 8–12 kB.

**De svåra delarna finns inte i något bibliotek.** Gränssnittets tre egentliga
konstruktioner är kameraöverlägget med kvalitetsmätning, segmentremsan, och konfidensmarkören.
Ingen av dem har en motsvarighet i Material eller i något annat bibliotek — de skulle skrivas
för hand ändå. Det som ett bibliotek faktiskt hade gett bort är knapp, fält, kort och lista,
vilket är precis den del som tar en dag att skriva och sedan aldrig mer rörs. Man betalar
uppgraderingsräntan på hela biblioteket för att slippa den dagen.

Och en fjärde, mindre men reell: **den estetiska riktningen är motsatt Materials.** Material
är byggt för att gränssnittet ska synas — elevation, ripple, fyllda ytor, animerade
etiketter. Här ska bilden av kvittot och siffrorna synas. Att tona ned Material till stillhet
är mer arbete än att bygga stillhet från början, och resultatet blir ett bibliotek som man
slåss mot i varje ny vy.

### 1.2 Varför inte Tailwind

Tailwind löser två problem: namngivning av klasser och att döda CSS ackumuleras. Angular löser
båda redan. `ViewEncapsulation.Emulated` är på som standard, så komponentens CSS är scopad till
komponenten, och när komponenten tas bort försvinner dess stilar med filen. Kvar av Tailwinds
värde blir en klassvokabulär att komma ihåg — vilket är exakt det som blir dyrt efter fjorton
månaders uppehåll — plus ett byggsteg till i en pipeline som fungerar i dag.

### 1.3 Vad man ger upp, ärligt

Man ger upp färdiga och a11y-testade: dialog, meny, autocomplete, datumväljare, snackbar,
tooltip, tabell med sortering, virtuell scroll.

För det här systemet, år 2026, täcks nästan hela listan av webbläsaren:

| Behov | Plattformslösning |
| --- | --- |
| Dialog med fokusfälla och backdrop | `<dialog>` + `showModal()` |
| Meny / popover som stänger på Esc och klick utanför | `popover`-attributet |
| Tooltip | `popover` + `anchor-name`, eller bara låt bli |
| Snackbar / statusmeddelande | en `<output role="status">` i skalet |
| Formvalidering | `@angular/forms` (redan i beroendena) |
| Datumväljare | `<input type="date">` — här skrivs datum sällan, och då i ett känt format |

Den enda posten som inte täcks är **virtuell scroll**. Den blir aktuell först när arbetslistan
eller ett sökresultat visar tusentals rader samtidigt. Sökningen är redan `LIMIT 50`
(`server/src/store/index-db.ts`), och arbetslistan visar per definition bara det som inte är
klart. Blir det ett problem: se nästa avsnitt.

### 1.4 Det tillåtna undantaget

**`@angular/cdk` får läggas till styckvis, aldrig `@angular/material`.** CDK är beteende utan
stilar: `a11y` (fokusfälla, `LiveAnnouncer`), `overlay`, `scrolling` (virtuell scroll),
`drag-drop`. Det följer Angulars egen versionskadens, alltså ingen extra uppgraderingsaxel, och
det kan inte färga av sig på utseendet eftersom det inte har något utseende.

Regeln: CDK läggs till när ett konkret problem uppstått, med en rad i den här filen om vilket
problem. Inte i förväg.

### 1.5 Den regel som gör att valet håller

En enda konvention bär hela systemet över åren:

> **Komponent-CSS får aldrig innehålla ett literalt färgvärde, en literal pixelradie eller en
> literal övergångstid. Bara `var(--…)`.** Nya tokens läggs till i `tokens.css`, aldrig i en
> komponentfil.

Samma disciplin gäller täthet: mellanrum som täthetsaxeln styr skrivs `var(--d-*)`, aldrig som
literalt mått. Se §2.6.5 för den regeln och dess kontroll.

Det är de reglerna som gör mörkt läge och två tätheter gratis, gör en temajustering till en
femradersändring, och gör att en person som återvänder efter ett år kan ändra hela systemets
uttryck utan att läsa en enda komponent. Den går att kontrollera med ett `grep` i en pre-commit-hook:

```sh
# Ingen literal färg utanför tokens.css
! grep -rnE '#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(' web/src --include='*.css' \
    --exclude='tokens.css' \
  || { echo 'Literal färg utanför tokens.css'; exit 1; }
```

### 1.6 Filuppdelning

`web/angular.json` listar bara `src/styles.css`, så inget byggkonfigurationsbyte behövs:

```
web/src/
  styles.css            @import av de tre nedan, inget annat
  styles/tokens.css     alla custom properties, ljust + mörkt. Enda filen med färgvärden
  styles/base.css       reset, typografi, fokusring, :focus-visible, reduced motion
  styles/utilities.css  ~10 klasser, se §2.7. Växer inte till ett ramverk
```

```css
/* web/src/styles.css */
@import "./styles/tokens.css";
@import "./styles/base.css";
@import "./styles/utilities.css";
```

### 1.7 Om den befintliga vyn

`web/src/app/app.component.*` är en platshållare som visar `/api/health`. Förslaget är att den
görs om, men inte kastas: dess innehåll är den enda fråga driften ställer innan det finns
kvitton, och den frågan slutar aldrig vara relevant.

- Flytta den till en egen `DriftComponent` på rutten `/drift`.
- Lägg dess kärna — ledigt utrymme och `belowFloor` — som en **statusremsa längst ned i
  datorlägets skal**, en rad hög, i `--ink-faint`, som byter till `--danger` när
  `status === "degraded"`. `/api/health` svarar 503 vid lågt utrymme; det är det enda
  tillståndet i systemet som får bryta stillheten utan att användaren bett om något.
- `AppComponent` blir skalet: routerutlopp plus statusremsa, ingenting annat.

Vyn är också den naturliga första konsumenten av tokens — den innehåller redan en knapp, en
definitionslista med tabulära siffror, ett fel- och ett degraderat tillstånd.

---

## 2. Designtokens

### 2.1 Färg — grundtanke

> **Bekräftat av beställaren 2026-08-29.** Varma neutraler med dämpad blå accent är ett fattat
> beslut, inte en default som ärvts in. Motiveringen nedan lades fram och höll. Den som vill
> ändra riktningen ändrar ett beslut och bör säga det.

Neutralerna är **varma** (en aning gult i gråskalan), av ett skäl som är specifikt för det här
innehållet: kvittobilderna är vitt till gulvitt termopapper fotograferat i inomhusljus. Mot en
kall blågrå bakgrund ser papperet smutsigt och gulnat ut; mot en varm neutral ser det ut som
papper. Det är samma trick som gallerier använder — väggen är aldrig ren vit.

Accenten är en dämpad blå (`#1d5a7a`). Den är kall, alltså tydligt skild från papperet, och
mättad nog att bära vit text över AA med marginal, men inte så mättad att den drar blicken från
en bild.

**Semantiska färger används sparsamt och aldrig för konfidens.** Se §5.

### 2.2 tokens.css

```css
/* web/src/styles/tokens.css
 *
 * Enda filen i web/src som får innehålla literala färgvärden.
 *
 * Tre teman-tillstånd: ljust är standard på bar :root; mörkt läge när systemet vill det
 * och användaren inte sagt emot; mörkt läge när användaren valt det. Ett explicit val
 * skrivs som data-theme på <html>.
 */

:root {
  /* ---- Färg: ljust läge ---------------------------------------------- */

  /* Ytor. --bg är sidan, --surface är kort och paneler ovanpå den,
     --sunken är rännor och spår som ligger under (bildbakgrund, mätarspår). */
  --bg:            #f6f4f1;
  --surface:       #ffffff;
  --sunken:        #eceae6;

  /* Linjer. --line är dekorativ avgränsning, --line-strong är kanten på något
     man kan peka på (input, knapp) och håller 3:1 mot alla tre ytorna. */
  --line:          #dcd7d0;
  --line-strong:   #847b72;

  /* Bläck. Tre nivåer, inte fem: värde, etikett, fotnot. */
  --ink:           #1b1917;
  --ink-muted:     #57514a;
  --ink-faint:     #6e675e;

  /* Accent. --accent-soft är fyllnad bakom accentfärgad text, --sel är markerad rad. */
  --accent:        #1d5a7a;
  --accent-hover:  #164a66;
  --accent-soft:   #e4eef4;
  --on-accent:     #ffffff;
  --sel:           #dbe8f0;

  /* Semantik. Används för tillstånd i systemet, aldrig för konfidensgrad. */
  --ok:            #2c6b3f;
  --ok-soft:       #e6f1e9;
  --warn:          #8a5a08;
  --warn-soft:     #fbf0dc;
  --danger:        #a32b1c;
  --danger-soft:   #fbeae7;
  --on-danger:     #ffffff;

  /* Konfidens. Neutralt bläck med flit — se §5. */
  --conf-track:    #ddd8d1;
  --conf-fill:     var(--ink-muted);
  --conf-mark:     var(--line-strong);   /* punktlinjen under maskinläst värde */

  /* Bildyta. Bakom ett kvittofoto ligger något mörkare än sidan, så att papperets
     kant syns även när fotot är överexponerat i hörnen. */
  --image-bed:     #d9d5cf;

  /* Överlägg (kamera). Alltid mörkt, i båda lägena — se §4.8. */
  --scrim:         rgb(0 0 0 / 0.55);
  --scrim-strong:  rgb(0 0 0 / 0.78);
  --on-scrim:      #ffffff;
  --on-scrim-dim:  #d7d3ce;

  /* ---- Typografi ------------------------------------------------------ */

  /* Systemfont. Inget webbfontanrop: burken är offline-först och en fontfil är
     100–300 kB som telefonen inte ska hämta i en butik. */
  --font-sans:
    system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  /* Rå OCR-text visas monospaced: den är radbruten maskinutdata, inte prosa. */
  --font-mono:
    ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace;

  /* Skalan är 1,125 (major second) från 16 px. Ett stillsamt gränssnitt behöver
     små steg — den enda stora texten i systemet är ett belopp. */
  --text-xs:   0.75rem;    /* 12 px  fotnot, tidsstämpel, konfidenssiffra */
  --text-sm:   0.8125rem;  /* 13 px  etikett, metadata */
  --text-base: 1rem;       /* 16 px  brödtext, fältvärde. Aldrig under på mobil. */
  --text-lg:   1.125rem;   /* 18 px  kortrubrik */
  --text-xl:   1.375rem;   /* 22 px  vyrubrik */
  --text-2xl:  1.75rem;    /* 28 px  totalbelopp i kvittovyn */

  --leading-tight: 1.25;
  --leading-body:  1.55;

  --weight-normal: 400;
  --weight-medium: 500;
  --weight-bold:   600;   /* 700 används inte: för hårt mot det här innehållet */

  /* Etikettspårning: versalgemener med lite luft läser bättre i små storlekar. */
  --tracking-label: 0.02em;

  /* ---- Mellanrum ------------------------------------------------------ */
  /* 4 px-bas. Hoppet 6→8 är avsiktligt: mellan 40 och 64 px finns inget
     mellanrum som ser rätt ut. */
  --space-0:  0;
  --space-1:  0.25rem;   /*  4 */
  --space-2:  0.5rem;    /*  8 */
  --space-3:  0.75rem;   /* 12 */
  --space-4:  1rem;      /* 16 */
  --space-5:  1.5rem;    /* 24 */
  --space-6:  2rem;      /* 32 */
  --space-7:  2.5rem;    /* 40 */
  --space-8:  4rem;      /* 64 */

  /* ---- Radier --------------------------------------------------------- */
  --radius-xs:   3px;    /* konfidensremsa, taggar */
  --radius-sm:   6px;    /* knapp, input */
  --radius-md:   10px;   /* kort, panel */
  --radius-lg:   16px;   /* bildruta, ark på mobil */
  --radius-full: 999px;  /* avtryckare, räknarbricka */

  /* ---- Skuggor -------------------------------------------------------- */
  /* Sparsamt. Djup bärs i första hand av linje och yta, inte av skugga —
     skuggor på varm neutral gråar snabbt ned intrycket. */
  --shadow-none: none;
  --shadow-sm:   0 1px 2px rgb(28 25 23 / 0.06);
  --shadow-md:   0 2px 4px rgb(28 25 23 / 0.06), 0 6px 16px rgb(28 25 23 / 0.08);
  --shadow-lg:   0 8px 32px rgb(28 25 23 / 0.16);   /* endast dialog och överlägg */

  /* ---- Rörelse -------------------------------------------------------- */
  /* Fyra varaktigheter, och en av dem används nästan aldrig. */
  --dur-instant: 80ms;    /* nedtryckning, hover */
  --dur-fast:    140ms;   /* tillståndsbyte på plats */
  --dur-base:    220ms;   /* in-/utträde av panel eller ark */
  --dur-slow:    1600ms;  /* bara nyanländ-blinket, se §4.4 */

  --ease-out:  cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in:   cubic-bezier(0.7, 0, 0.84, 0);
  --ease-both: cubic-bezier(0.65, 0, 0.35, 1);

  /* ---- Fokus ---------------------------------------------------------- */
  --focus-color:  var(--accent);
  --focus-width:  2px;
  --focus-offset: 2px;

  /* ---- Mått ----------------------------------------------------------- */
  --tap-min:        44px;   /* absolut golv, WCAG 2.5.8 / 2.5.5 */
  --tap-comfort:    48px;   /* standard i mobilläget */
  --tap-primary:    56px;   /* enhandsprimär åtgärd */
  --shutter-size:   76px;
  --measure:        68ch;   /* max radlängd för löptext */
  --panel-fields:   26rem;  /* fältpanelens bredd i datorläget */
  --panel-worklist: 20rem;  /* arbetslistans bredd */
  --thumb-w:        56px;   /* segmentremsans miniatyr */
  --thumb-h:        74px;

  --z-sticky:  10;
  --z-overlay: 100;
  --z-dialog:  200;
  --z-toast:   300;

  color-scheme: light dark;
}

/* ---- Mörkt läge -------------------------------------------------------
 * Definieras två gånger med samma innehåll: en gång för systemets val (utan att
 * skriva över ett uttryckligt ljust val), en gång för användarens val. Det är
 * dubbleringen som gör att en växlare vinner åt båda hållen.
 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg:           #141316;
    --surface:      #1d1c20;
    --sunken:       #0f0e11;
    --line:         #33313a;
    --line-strong:  #767381;
    --ink:          #eae7e2;
    --ink-muted:    #a8a29a;
    --ink-faint:    #8d8780;
    --accent:       #8ec4e6;
    --accent-hover: #a8d4f0;
    --accent-soft:  #1a2c38;
    --on-accent:    #141316;
    --sel:          #22323d;
    --ok:           #83c99b;
    --ok-soft:      #17281d;
    --warn:         #e5b168;
    --warn-soft:    #2e2415;
    --danger:       #f0938a;
    --danger-soft:  #33191a;
    --on-danger:    #141316;
    --conf-track:   #3a3842;
    --image-bed:    #08080a;

    /* Skuggor bär inte djup mot mörk botten. Djupet bärs av ytan i stället:
       --surface är ljusare än --bg, och dialogen får en linje. */
    --shadow-sm: none;
    --shadow-md: 0 2px 8px rgb(0 0 0 / 0.4);
    --shadow-lg: 0 10px 40px rgb(0 0 0 / 0.6);
  }
}

:root[data-theme="dark"] {
  --bg:           #141316;
  --surface:      #1d1c20;
  --sunken:       #0f0e11;
  --line:         #33313a;
  --line-strong:  #767381;
  --ink:          #eae7e2;
  --ink-muted:    #a8a29a;
  --ink-faint:    #8d8780;
  --accent:       #8ec4e6;
  --accent-hover: #a8d4f0;
  --accent-soft:  #1a2c38;
  --on-accent:    #141316;
  --sel:          #22323d;
  --ok:           #83c99b;
  --ok-soft:      #17281d;
  --warn:         #e5b168;
  --warn-soft:    #2e2415;
  --danger:       #f0938a;
  --danger-soft:  #33191a;
  --on-danger:    #141316;
  --conf-track:   #3a3842;
  --image-bed:    #08080a;
  --shadow-sm: none;
  --shadow-md: 0 2px 8px rgb(0 0 0 / 0.4);
  --shadow-lg: 0 10px 40px rgb(0 0 0 / 0.6);
}
```

### 2.3 Kontrastvärden

Uträknade med WCAG 2.x relativ luminans (sRGB), avrundat nedåt till två decimaler. Krav: **4,5:1**
för text under 24 px / 19 px fet, **3:1** för gränser på interaktiva komponenter och för
fokusmarkeringar (WCAG 1.4.11). Allt nedan klarar AA; det mesta klarar AAA (7:1).

**Ljust läge**

| Förgrund | Bakgrund | Värde | Krav | Marginal |
| --- | --- | --- | --- | --- |
| `--ink` #1b1917 | `--bg` #f6f4f1 | **15,97** | 4,5 | AAA |
| `--ink` | `--surface` #ffffff | **17,53** | 4,5 | AAA |
| `--ink` | `--sunken` #eceae6 | **14,59** | 4,5 | AAA |
| `--ink` | `--sel` #dbe8f0 | **14,03** | 4,5 | AAA |
| `--ink-muted` #57514a | `--bg` | **7,13** | 4,5 | AAA |
| `--ink-muted` | `--surface` | **7,83** | 4,5 | AAA |
| `--ink-muted` | `--sunken` | **6,52** | 4,5 | AA+ |
| `--ink-faint` #6e675e | `--bg` | **5,08** | 4,5 | AA |
| `--ink-faint` | `--surface` | **5,58** | 4,5 | AA |
| `--ink-faint` | `--sunken` | **4,64** | 4,5 | AA (knappt) |
| `--accent` #1d5a7a | `--bg` | **6,84** | 4,5 | AA+ |
| `--accent` | `--surface` | **7,51** | 4,5 | AAA |
| `--accent` | `--sunken` | **6,25** | 4,5 | AA+ |
| `--accent` | `--accent-soft` #e4eef4 | **6,38** | 4,5 | AA+ |
| `--accent` | `--sel` | **6,01** | 4,5 | AA+ |
| `--on-accent` #ffffff | `--accent` | **7,51** | 4,5 | AAA |
| `--on-accent` | `--accent-hover` #164a66 | **9,52** | 4,5 | AAA |
| `--ok` #2c6b3f | `--surface` | **6,40** | 4,5 | AA+ |
| `--ok` | `--ok-soft` #e6f1e9 | **5,52** | 4,5 | AA |
| `--warn` #8a5a08 | `--surface` | **5,92** | 4,5 | AA+ |
| `--warn` | `--warn-soft` #fbf0dc | **5,24** | 4,5 | AA |
| `--danger` #a32b1c | `--surface` | **7,19** | 4,5 | AAA |
| `--danger` | `--bg` | **6,55** | 4,5 | AA+ |
| `--danger` | `--danger-soft` #fbeae7 | **6,17** | 4,5 | AA+ |
| `--on-danger` #ffffff | `--danger` | **7,19** | 4,5 | AAA |
| `--line-strong` #847b72 | `--bg` | **3,78** | 3,0 | AA (icke-text) |
| `--line-strong` | `--surface` | **4,15** | 3,0 | AA (icke-text) |
| `--line-strong` | `--sunken` | **3,46** | 3,0 | AA (icke-text) |
| `--conf-fill` (=`--ink-muted`) | `--conf-track` #ddd8d1 | **5,53** | 3,0 | AA (icke-text) |
| `--focus-color` (=`--accent`) | `--bg` / `--surface` / `--sunken` | **6,84 / 7,51 / 6,25** | 3,0 | AA |

**Mörkt läge**

| Förgrund | Bakgrund | Värde | Krav | Marginal |
| --- | --- | --- | --- | --- |
| `--ink` #eae7e2 | `--bg` #141316 | **15,01** | 4,5 | AAA |
| `--ink` | `--surface` #1d1c20 | **13,74** | 4,5 | AAA |
| `--ink` | `--sunken` #0f0e11 | **15,60** | 4,5 | AAA |
| `--ink` | `--sel` #22323d | **10,70** | 4,5 | AAA |
| `--ink-muted` #a8a29a | `--bg` | **7,32** | 4,5 | AAA |
| `--ink-muted` | `--surface` | **6,70** | 4,5 | AA+ |
| `--ink-muted` | `--sunken` | **7,61** | 4,5 | AAA |
| `--ink-faint` #8d8780 | `--bg` | **5,21** | 4,5 | AA |
| `--ink-faint` | `--surface` | **4,77** | 4,5 | AA |
| `--ink-faint` | `--sunken` | **5,42** | 4,5 | AA |
| `--accent` #8ec4e6 | `--bg` | **9,86** | 4,5 | AAA |
| `--accent` | `--surface` | **9,03** | 4,5 | AAA |
| `--accent` | `--accent-soft` #1a2c38 | **7,66** | 4,5 | AAA |
| `--accent` | `--sel` | **7,03** | 4,5 | AAA |
| `--on-accent` #141316 | `--accent` | **9,86** | 4,5 | AAA |
| `--on-accent` | `--accent-hover` #a8d4f0 | **11,76** | 4,5 | AAA |
| `--ok` #83c99b | `--surface` | **8,71** | 4,5 | AAA |
| `--ok` | `--ok-soft` #17281d | **7,95** | 4,5 | AAA |
| `--warn` #e5b168 | `--surface` | **8,73** | 4,5 | AAA |
| `--warn` | `--warn-soft` #2e2415 | **7,84** | 4,5 | AAA |
| `--danger` #f0938a | `--surface` | **7,46** | 4,5 | AAA |
| `--danger` | `--danger-soft` #33191a | **7,14** | 4,5 | AAA |
| `--line-strong` #767381 | `--bg` | **4,00** | 3,0 | AA (icke-text) |
| `--line-strong` | `--surface` | **3,66** | 3,0 | AA (icke-text) |
| `--line-strong` | `--sunken` | **4,16** | 3,0 | AA (icke-text) |
| `--conf-fill` (=`--ink-muted`) | `--conf-track` #3a3842 | **4,55** | 3,0 | AA (icke-text) |
| `--focus-color` (=`--accent`) | `--bg` / `--surface` / `--sunken` | **9,86 / 9,03 / 10,25** | 3,0 | AAA |

Två anmärkningar för den som kontrollerar:

- `--ink-faint` på `--sunken` i ljust läge är **4,64** — den tunnaste marginalen i systemet.
  Den kombinationen är tillåten, men om någon någonsin mörknar `--sunken` faller den under
  gränsen. Behöver luft skapas: mörkna `--ink-faint` i stället.
- Kamerans överlägg ligger utanför tabellen därför att bakgrunden är videobilden, inte en
  token. Se §4.8 för hur den kontrasten garanteras i stället.

Ett skript som räknar om hela tabellen ur `tokens.css` är värt en halvtimme innan färgerna
justeras nästa gång; formeln är WCAG 2.x relativ luminans, sju rader.

### 2.4 base.css

```css
/* web/src/styles/base.css */

*, *::before, *::after { box-sizing: border-box; }

html {
  /* Ingen justering vid rotation, och ingen automatisk uppförstoring av
     text i landskap på iOS — kvittobilder roteras ofta. */
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--leading-body);
  -webkit-font-smoothing: antialiased;
}

/* Radavståndet är den enda typografiska storhet som täthetsaxeln får röra —
   se §2.6.2. Regeln sitter på ytans skal, så att den ärvs ned i hela trädet. */
[data-density] { line-height: var(--d-leading); }

h1, h2, h3, p, dl, dd, figure { margin: 0; }
h1, h2, h3 { line-height: var(--leading-tight); font-weight: var(--weight-bold); }

/* Alla siffror i systemet är belopp, datum eller konfidens. De ska ligga i kolumn. */
:is(td, th, dd, output, .num, [data-num]) { font-variant-numeric: tabular-nums; }

button, input, select, textarea { font: inherit; color: inherit; }

img, svg, video, canvas { display: block; max-width: 100%; }

/* En enda fokusstil i hela systemet. Aldrig outline: none utan ersättning. */
:focus-visible {
  outline: var(--focus-width) solid var(--focus-color);
  outline-offset: var(--focus-offset);
  border-radius: var(--radius-xs);
}
:focus:not(:focus-visible) { outline: none; }

/* OCR-text kan innehålla ordlängder som inte finns i svenska. Den får aldrig
   spränga sin behållare i sidled. */
.ocr-text {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* Endast för skärmläsare. Används av konfidensmarkören (§5) och av
   statusmeddelanden. */
.sr-only {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; border: 0;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
```

### 2.5 Rörelse — regeln

Fyra saker får röra sig, och inget annat:

1. Ark och paneler som träder in eller ut (`--dur-base`, `--ease-out`).
2. Tillståndsbyte på plats: knapptryck, hover, öppna/stäng (`--dur-fast` eller `--dur-instant`).
3. Framdrift i arbetslistan — det är det enda som får animera kontinuerligt.
4. Nyanländ-blinket när SSE levererar ett kvitto (`--dur-slow`, en gång).

Kamerans autoutlösningsring är ett femte fall men styrs av mätdata, inte av tid; se §4.8.
Inget i systemet rör sig för att vara trevligt.

### 2.6 Täthet

> **Bekräftat av beställaren 2026-08-29: tätt i datorläget, luftigt i mobilläget.**

Skälet är att situationerna skiljer sig. Mobilen används med en hand, i rörelse, ofta stående i
en butik med en pappershög under armen — där kostar en missad träffyta en omtagning. Datorläget
används för att beta av hundratals kvitton i följd — där kostar varje bortslösad rad en
rullning till.

Utan en uttalad täthetspolicy ärver komponenterna ingenting och var och en väljer sina egna
mellanrum. Det är precis så två ytor glider isär över åren. Täthet är därför en egen axel, vid
sidan av färg och mellanrumsskala, och den sätts en gång per yta.

#### Mekanismen: `data-density` på ytans skal

`data-density="compact" | "comfortable"` sätts **en gång, på ruttkomponentens värdelement**, och
definierar en uppsättning `--d-*`-tokens som ärvs ned genom hela trädet. En komponent skriver
`padding: var(--d-pad-y) var(--d-pad-x)` — samma rad i båda ytorna, olika resultat.

```ts
@Component({ selector: 'app-shell',   host: { 'data-density': 'compact' },     … })
@Component({ selector: 'app-capture', host: { 'data-density': 'comfortable' }, … })
```

**Varför ett attribut och inte en skalär.** Den frestande varianten är `--density: 0.75` som
multiplicerar varje mellanrum. Tre skäl att låta bli:

1. **Den skalar allt, även det som inte får skalas.** Ett 44 px träffgolv, en 1 px linje och
   konfidensremsans 3 px är absoluta mått. En multiplikator kan inte skilja dem från en padding
   utan att man ändå räknar upp undantagen — och då har man attributet, fast otydligare.
2. **Den producerar brutna pixlar.** `calc(0.75 * 13px)` blir 9,75 px; en rad blir 35,5 px hög
   och en 1 px-linje ritas som en suddig 2 px-grå på en skärm utan HiDPI — vilket 1080p-skärmen
   i §2.6.4 är.
3. **Den låser relationerna.** I tätt läge ska innerpaddingen krympa *mer* än avståndet mellan
   grupper, annars blir raderna täta men sidan lika lång. Två uttryckliga block går att läsa
   bredvid varandra och rätta; en multiplikator går bara att gissa på.

**Varför på skalet och inte på `<html>`.** Attributet ärver, alltså kan en delyta sätta om det.
Det utnyttjas på exakt ett ställe, med flit (§2.6.3). Sitter det på roten är den möjligheten
borta, och mobilläget skulle behöva skriva på `<html>` från en komponent — en sidoeffekt utanför
sitt eget träd, och just den sortens sak som är svår att hitta tre år senare.

#### 2.6.1 Tokens och värden

```css
/* tokens.css, efter måtten.
 *
 * :root är luftigt. En komponent som renderas utanför båda skalen — i en test,
 * i en framtida vy som ännu inte fått ett skal — ska bli för rymlig, aldrig för
 * trång. Fel åt det hållet går att se; fel åt andra hållet gör en knapp omöjlig
 * att träffa på en telefon.
 */
:root {
  --d-row-h:       56px;               /* listradens totala höjd, linjen inräknad */
  --d-pad-y:       0.75rem;            /* 12 — komponentens innerpadding, block */
  --d-pad-x:       1rem;               /* 16 — innerpadding, inline */
  --d-gap:         var(--space-3);     /* 12 — .stack och .row utan eget värde */
  --d-gap-tight:   var(--space-2);     /*  8 — inom en grupp */
  --d-card-pad:    var(--space-4);     /* 16 */
  --d-section-gap: var(--space-5);     /* 24 — mellan grupper i en panel */
  --d-leading:     var(--leading-body);   /* 1,55 — se §2.6.2 */
  --d-control-h:   var(--tap-comfort); /* 48 — synlig höjd på knapp, fält, listrad */
  --d-thumb-w:     64px;
  --d-thumb-h:     84px;
}

[data-density="compact"] {
  --d-row-h:       36px;
  --d-pad-y:       0.375rem;           /*  6 */
  --d-pad-x:       0.75rem;            /* 12 */
  --d-gap:         var(--space-2);     /*  8 */
  --d-gap-tight:   var(--space-1);     /*  4 */
  --d-card-pad:    var(--space-3);     /* 12 */
  --d-section-gap: var(--space-4);     /* 16 */
  --d-leading:     1.45;               /* enda typografiska storhet täthet får röra */
  --d-control-h:   36px;
  --d-thumb-w:     48px;
  --d-thumb-h:     64px;
}

/* Skrivs ut trots att det är identiskt med :root. Utan det kan en lokal
   återställning inuti ett compact-träd (§2.6.3) inte fungera. */
[data-density="comfortable"] {
  --d-row-h:       56px;
  --d-pad-y:       0.75rem;
  --d-pad-x:       1rem;
  --d-gap:         var(--space-3);
  --d-gap-tight:   var(--space-2);
  --d-card-pad:    var(--space-4);
  --d-section-gap: var(--space-5);
  --d-leading:     var(--leading-body);
  --d-control-h:   var(--tap-comfort);
  --d-thumb-w:     64px;
  --d-thumb-h:     84px;
}
```

| Token | luftigt | tätt | Styr |
| --- | --- | --- | --- |
| `--d-row-h` | 56 px | 36 px | arbetslisterad, sökträffrad, granskningsrad |
| `--d-pad-y` / `--d-pad-x` | 12 / 16 | 6 / 12 | all innerpadding i rader, paneler, rutor |
| `--d-gap` | 12 px | 8 px | `.stack`, `.row`, rutnätsluckor |
| `--d-gap-tight` | 8 px | 4 px | mellanrum inom en grupp (etikett + värde) |
| `--d-card-pad` | 16 px | 12 px | kvittokortets insida |
| `--d-section-gap` | 24 px | 16 px | mellan grupper i fältpanelen och i skalet |
| `--d-leading` | 1,55 (`--leading-body`) | 1,45 | radavstånd på brödtext |
| `--d-control-h` | 48 px | 36 px | synlig höjd på knapp, sökfält, listrad |
| `--d-thumb-w` / `--d-thumb-h` | 64 / 84 | 48 / 64 | kvittokortets tumnagel |

#### 2.6.2 Vad tätheten inte får styra

Listan är lika viktig som tokens, och den är avsiktligt kort och sluten.

| Får aldrig stå i ett `[data-density]`-block | Varför |
| --- | --- |
| `--tap-min` (44 px) | Mobilgolvet. Absolut, i alla lägen. Se nedan. |
| `--text-xs … --text-2xl` | **Textstorlek krymper aldrig av täthet.** Att pressa in fler rader genom mindre text är ett annat beslut — det handlar om läsbarhet, inte om luft — och ska fattas för sig och medvetet. I tätt läge blir raden kortare för att padding och radavstånd krymper, inte för att texten gör det. |
| `--focus-width`, `--focus-offset` | En tunnare fokusring i tätt läge försämrar just den yta där tangentbordet används mest. |
| Linjebredder, `--conf-track`-remsans 3 × 56 px, evidensrutans 2 px | Optiska mått. En 2 px punktlinje under ett maskinläst värde ska se likadan ut överallt — det är §5:s hela poäng. |
| `--shutter-size`, `--thumb-w` / `--thumb-h` (kamerans segmentremsa) | Mobilytan är luftig ändå, men de namnges här så att ingen råkar täthetsskala kameran. Notera att kamerans `--thumb-*` och kortets `--d-thumb-*` är två olika saker. |
| Tomma tillstånd (§3.7) | De är sällsynta och ska andas i båda ytorna. |

**Om 44 px-golvet, exakt.** I mobilläget är `--d-control-h` 48 px och får aldrig underskrida
`--tap-min`. I datorläget är `--d-control-h` 36 px, och det är ett medvetet avsteg som är värt
att skriva ut: WCAG **2.5.8 Target Size (Minimum), nivå AA**, kräver 24 × 24 CSS-pixlar — 36 px
klarar det med marginal. Talet 44 kommer från **2.5.5, nivå AAA**. Det behålls som husregel i
mobilläget, där handen är i rörelse, och släpps i datorlägets täta lista, där pekdonet är en mus
och raderna ligger kant i kant.

Följdregeln, som är den som faktiskt bränns: **en träffyta får aldrig växa in i grannradens
yta.** Mönstret i §4.3 som lånar utrymme utanför sig själv gäller därför bara där det finns
minst 8 px fritt runt om — aldrig i en tät lista, där en 44 px träffyta på en 36 px rad skulle
göra varannan klickning fel. Ett litet mål är bättre än ett stort som träffar fel rad.

#### 2.6.3 Det enda lokala undantaget

**Fältpanelen (§3.2) sätter `data-density="comfortable"` på sig själv, inuti det täta
datorskalet.**

```html
<aside class="field-panel" data-density="comfortable"> … </aside>
```

Skälet: panelen är den enda ytan i systemet där en människa **bedömer** i stället för att skanna.
Där sitter punktlinjen, konfidensremsan och totalbeloppet i 28 px, och där fattas beslutet som
hela §5 handlar om. Tre fältrader tar inget utrymme som gör skillnad, och en trång
bedömningsyta ger sämre bedömningar — vilket är dyrare än en rullning.

Det är också demonstrationen av varför mekanismen är ett ärvande attribut i stället för en
global inställning: undantaget kostar en rad HTML och noll rader CSS.

Fler undantag ska inte finnas. Läggs ett till, skrivs skälet här — annars har systemet i
praktiken ingen täthetspolicy igen.

#### 2.6.4 Rimlighetskontroll: rader per skärm

Beställarens skäl var att kunna beta av en hög. Då är radantalet poängen, inte tätheten i sig.

1920 × 1080, maximerat fönster, 100 % skalning:

```
1080   skärmens höjd
 -40   aktivitetsfält
 -88   webbläsarens flikrad + adressfält
 ────
 952   synlig yta
 -28   statusremsa (§1.7)
 -40   kolumnhuvud i arbetslistan
 -44   listfot: genomströmning, krav 47
 ────
 840   kvar till rader
```

| Läge | `--d-row-h` | Rader per skärm |
| --- | --- | --- |
| **compact** (datorläget) | 36 px | **23** |
| comfortable | 56 px | 15 |

**23 rader mot 15 — drygt halva listan till på samma skärm, utan att en enda bokstav krympt.**
Det är hela vinsten med axeln, och den räcker som motivering.

Vad det betyder i den här högen: M0 mätte datum till 74 %, systemets svagaste fältutvinning. Går
den siffran oförändrad in i M6 hamnar i storleksordningen 2 600 av tiotusen kvitton i
`needs_review` — omkring **113 skärmar i tätt läge mot 174 i luftigt**. Sextio skärmars rullning
i skillnad. Det är just den sortens skillnad som avgör om en hög betas av eller läggs undan, och
det är därför beslutet är riktigt.

Kontrollen bör göras om när `--d-row-h` ändras. Räkningen är fem rader och står ovan.

#### 2.6.5 Disciplinen

Samma regel som för färg (§1.5): **komponent-CSS får inte innehålla ett literalt mått för något
som täthetsaxeln styr.** `padding`, `gap` och radhöjd skrivs `var(--d-*)`. Literala pixlar är
tillåtna bara för optiska detaljer under 4 px och för de mått §2.6.2 uttryckligen undantar.

```sh
# Literalt mellanrum i komponent-CSS
! grep -rnE '^\s*(padding|gap|row-gap|column-gap|min-height|min-block-size)\s*:\s*[0-9]' \
    web/src --include='*.component.css' \
  || { echo 'Literalt mellanrum i komponent-CSS — använd var(--d-*)'; exit 1; }
```

### 2.7 utilities.css

Tio klasser, och listan får inte växa utan att någon frågar sig varför.

```css
/* web/src/styles/utilities.css */
.stack     { display: flex; flex-direction: column; gap: var(--stack-gap, var(--d-gap)); }
.row       { display: flex; align-items: center; gap: var(--row-gap, var(--d-gap-tight)); }
.row--wrap { flex-wrap: wrap; }
.push      { margin-inline-start: auto; }      /* skjut resten åt höger */
.measure   { max-width: var(--measure); }
.muted     { color: var(--ink-muted); }
.faint     { color: var(--ink-faint); font-size: var(--text-xs); }
.label     { font-size: var(--text-sm); color: var(--ink-muted);
             letter-spacing: var(--tracking-label); }
.truncate  { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scroll-x  { overflow-x: auto; overscroll-behavior-x: contain; }
```

---

## 3. Komponenter

Konvention för alla: **standalone-komponent**, tillstånd som `host`-bindningar (inte
`:host-context`), CSS i `styleUrl`, ingen literal färg. Interaktiva tillstånd sätts med
`data-*`-attribut i stället för klassnamnssträngar, så att CSS-väljarna blir läsbara.

### 3.1 Knapp

Fyra varianter, tre storlekar. Fler behövs inte.

```
primär          sekundär          tyst              fara
┌───────────┐   ┌───────────┐     ┌───────────┐     ┌───────────┐
│  Spara    │   │  Avbryt   │     │  Visa mer │     │  Ta bort  │
└───────────┘   └───────────┘     └───────────┘     └───────────┘
 fylld accent    linje + yta       bara text         fylld danger
```

```css
/* button.component.css */
:host { display: inline-flex; }

.btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: var(--d-gap-tight);
  /* Höjden kommer från täthetsaxeln: 48 px i mobilläget, 36 i datorläget.
     Aldrig från komponenten själv — se §2.6. */
  min-block-size: var(--d-control-h);
  min-inline-size: var(--d-control-h);
  padding-inline: var(--d-pad-x);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: var(--text-base);
  font-weight: var(--weight-medium);
  line-height: 1;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    background-color var(--dur-fast) var(--ease-out),
    border-color     var(--dur-fast) var(--ease-out),
    transform        var(--dur-instant) var(--ease-out);
}

/* Nedtryckning: 1 px, inte en skalning. Skalning på en knapp bredvid ett
   kvittofoto ser ut som att bilden skakar. */
.btn:active:not(:disabled) { transform: translateY(1px); }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }

.btn[data-variant="primary"] {
  background: var(--accent); color: var(--on-accent);
}
.btn[data-variant="primary"]:hover:not(:disabled) { background: var(--accent-hover); }

.btn[data-variant="secondary"] {
  background: var(--surface); color: var(--ink); border-color: var(--line-strong);
}
.btn[data-variant="secondary"]:hover:not(:disabled) { background: var(--sunken); }

.btn[data-variant="quiet"] {
  background: transparent; color: var(--accent); padding-inline: var(--d-gap);
}
.btn[data-variant="quiet"]:hover:not(:disabled) { background: var(--accent-soft); }

.btn[data-variant="danger"] {
  background: var(--danger); color: var(--on-danger);
}

/* Två storlekar, inte tre.
 *
 * REVIDERAT efter täthetsbeslutet: `sm` är borttagen. Den var täthet förklädd
 * till storlek — dess enda syfte var att göra knappar mindre i datorläget, och
 * det gör täthetsaxeln nu, för alla komponenter samtidigt och på ett ställe.
 *
 * `md` (standard) följer `--d-control-h`. `lg` är fast 56 px: det är mobilens
 * primära åtgärd och den ska inte krympa av något skäl. */
.btn[data-size="lg"] {
  min-block-size: var(--tap-primary);
  padding-inline: var(--space-5);
  font-size: var(--text-lg);
  border-radius: var(--radius-md);
}

/* Fristående knapp i datorläget är 36 px synlig men får låna 4 px åt varje håll
   till träffytan. Gäller bara där det finns fritt utrymme runt om — aldrig i en
   tät lista, se §2.6.2. */
.btn[data-reach="extended"] { position: relative; }
.btn[data-reach="extended"]::after { content: ""; position: absolute; inset: -4px; }

/* Väntande knapp: texten står kvar, ett spår fylls under den. Ingen spinner
   som byter ut etiketten — man ska kunna se vad man tryckte på. */
.btn[data-busy="true"] { pointer-events: none; position: relative; overflow: hidden; }
.btn[data-busy="true"]::before {
  content: ""; position: absolute; inset-block-end: 0; inset-inline: 0;
  block-size: 2px; background: currentColor; opacity: 0.5;
  animation: btn-sweep 900ms var(--ease-both) infinite;
}
@keyframes btn-sweep {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

Angular-sida:

```ts
@Component({
  selector: 'app-button',
  template: `<button class="btn" [attr.data-variant]="variant()"
                     [attr.data-size]="size()" [attr.data-busy]="busy()"
                     [disabled]="disabled() || busy()" [type]="type()">
               <ng-content />
               @if (busy()) { <span class="sr-only">Arbetar …</span> }
             </button>`,
  styleUrl: './button.component.css',
})
export class ButtonComponent {
  readonly variant = input<'primary' | 'secondary' | 'quiet' | 'danger'>('secondary');
  readonly size    = input<'md' | 'lg'>('md');
  readonly busy    = input(false);
  readonly disabled = input(false);
  readonly type    = input<'button' | 'submit'>('button');
}
```

### 3.2 Fältrad med konfidensmarkör

Systemets viktigaste komponent. Full motivering i §5; här är formen.

```
Fält                                              2 av 3 bekräftade
‥‥‥ under värdet = maskinläst, ännu inte bekräftat
┌────────────────────────────────────────────────────────────────┐
│ Butik    Bauhaus Kungens Kurva                                 │
├────────────────────────────────────────────────────────────────┤
│ Datum    2026-04-11                                            │
├────────────────────────────────────────────────────────────────┤
│ Total    4 218,50 kr                        ▓▓▓▓▓▓░░░░  0,61   │
│          ‥‥‥‥‥‥‥‥‥‥‥‥‥                                          │
└────────────────────────────────────────────────────────────────┘
   ↑         ↑                                    ↑         ↑
 etikett   värde                          konfidensremsa  siffra
                                          (bara maskinläst)
```

Rad i redigeringsläge (Enter på markerad rad):

```
┌────────────────────────────────────────────────────────────────┐
│ Total   ┌──────────────────────────┐   [Spara]  [Avbryt]       │
│         │ 4 219,00               ⌫ │   Enter          Esc      │
│         └──────────────────────────┘                           │
│         Var 4 218,50 · maskinläst 0,61                         │
└────────────────────────────────────────────────────────────────┘
```

```css
/* field-row.component.css
 *
 * Panelen runt de här raderna sätter data-density="comfortable" på sig själv,
 * även inuti det täta datorskalet (§2.6.3): det här är systemets enda
 * bedömningsyta, och den ska inte vara trång. Raden själv vet inget om det —
 * den läser bara sina --d-tokens. */
:host {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--d-gap);
  padding: var(--d-pad-y) var(--d-pad-x);
  border-block-end: 1px solid var(--line);
  cursor: default;
  transition: background-color var(--dur-fast) var(--ease-out);
}
:host(:hover), :host([data-active="true"]) { background: var(--sel); }
:host(:last-of-type) { border-block-end: none; }

.label {
  font-size: var(--text-sm); color: var(--ink-muted);
  letter-spacing: var(--tracking-label);
}

/* Värdet ser likadant ut i alla tillstånd: samma storlek, vikt och färg.
   Det är hela poängen — se §5. */
.value {
  font-size: var(--text-base);
  color: var(--ink);
  overflow-wrap: anywhere;
}
.value[data-emphasis="total"] {
  font-size: var(--text-2xl); font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums;
}

/* Enda skillnaden mellan maskinläst och bekräftat: punktlinjen. Den ligger
   under baslinjen och rör inte glyfernas kontrast. */
.value[data-state="machine"] {
  text-decoration: underline dotted var(--conf-mark);
  text-decoration-thickness: 2px;
  text-underline-offset: 0.28em;
  text-decoration-skip-ink: none;
}
.value[data-state="confirmed"] { text-decoration: none; }

.value[data-state="missing"] {
  color: var(--ink-faint);
  font-style: italic;
  border-block-end: 2px dashed var(--line-strong);
}

/* Panelen är luftig även i det täta skalet — det lokala undantaget i §2.6.3. */
.field-panel { display: flex; flex-direction: column; gap: var(--d-section-gap); }

/* Sammanfattningen som gör frånvaron av markör entydig. Står i panelhuvudet. */
.field-panel__summary { font-size: var(--text-sm); color: var(--ink-muted); }
.field-panel__legend  { font-size: var(--text-xs); color: var(--ink-faint); }
```

Tillgänglighet: raden är en `<div role="group">` med `aria-labelledby` mot etiketten, värdet
får `aria-describedby` mot en `.sr-only` som säger `"maskinläst, konfidens 61 procent, ännu inte
bekräftat"` eller `"bekräftat av dig 12 mars"`. Skärmläsaren får aldrig bara punktlinjen.

Tangentbord (krav 14), i kvittovyn:

| Tangent | Verkan |
| --- | --- |
| `↑` / `↓` eller `j` / `k` | flytta mellan fältrader |
| `Enter` | öppna raden för rättning |
| `Esc` | avbryt rättning, värdet står kvar |
| `Space` | bekräfta värdet som det är |
| `→` | hoppa till evidensrutan i bilden |

### 3.3 Kvittokort

Används i sökresultat, i "senast fångade", och i granskningsläget.

```
┌──────────────────────────────────────────────────────┐
│ ┌──────┐  Bauhaus Kungens Kurva          4 218,50 kr │
│ │      │  2026-04-11 · 2 segment                     │
│ │ foto │  ● ● ○                                      │
│ │      │  butik datum total                          │
│ └──────┘                                             │
└──────────────────────────────────────────────────────┘
   ↑ 64×84 tumnagel ur derived/    ↑ fältstämpel, se §5.4
```

```css
/* receipt-card.component.css */
:host {
  display: grid;
  grid-template-columns: var(--d-thumb-w) minmax(0, 1fr);
  gap: var(--d-card-pad);
  padding: var(--d-card-pad);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  text-decoration: none;
  color: inherit;
  transition: border-color var(--dur-fast) var(--ease-out);
}
:host(:hover) { border-color: var(--line-strong); }
:host(:focus-visible) { outline: var(--focus-width) solid var(--focus-color);
                        outline-offset: var(--focus-offset); }

.thumb {
  inline-size: var(--d-thumb-w); block-size: var(--d-thumb-h);
  object-fit: cover; object-position: top center;   /* butiksnamnet står överst */
  background: var(--image-bed);
  border-radius: var(--radius-sm);
}

.body { min-width: 0; }                 /* utan denna spränger långa namn rutnätet */
.store { font-size: var(--text-lg); font-weight: var(--weight-medium); }
.meta  { font-size: var(--text-sm); color: var(--ink-muted); }
.total {
  font-size: var(--text-lg); font-weight: var(--weight-medium);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}

/* Nyanländ via SSE: en enda blinkning, ingen inglidning. Rader som glider in
   flyttar det man håller på att läsa. */
:host([data-fresh="true"]) { animation: arrive var(--dur-slow) var(--ease-out) 1; }
@keyframes arrive {
  from { background: var(--sel); }
  to   { background: var(--surface); }
}
```

När butik saknas (OCR inte kört, eller fältet tomt) visar kortet `capturedAt` som rubrik i
`--ink-muted` i stället för att visa en tom rad — aldrig ett skelett som blir permanent.

### 3.4 Arbetslisterad med framdrift

Raderna visar **spår 2, läsningen** (§6.2). Orden och tecknen kommer därifrån — den här
komponenten hittar inga egna.

```
inte läst än
┌──────────────────────────────────────────────────────────┐
│ ○  Ica Maxi  ·  11 apr  ·  2 bilder          inte läst än │
└──────────────────────────────────────────────────────────┘

läses nu  — spåret ligger i radens underkant, raden växer inte
┌──────────────────────────────────────────────────────────┐
│ ◐  Ica Maxi  ·  11 apr  ·  bild 2 av 2          Läses · 4 s│
└──▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░─┘

saknar en uppgift — fältet namnges, aldrig "kräver åtgärd"
┌──────────────────────────────────────────────────────────┐
│ ▲  Ica Maxi  ·  11 apr  ·  saknar datum        [Öppna]   │
└──────────────────────────────────────────────────────────┘

Listfot (krav 47):
  14 olästa · 1 läses · 3 saknar en uppgift
  132 kvitton senaste timmen · 2,4 s per bild

Radhöjd: 36 px i datorläget (tätt), 56 px luftigt. Se §2.6 och räkningen i §2.6.4.
```

Tre saker i skissen är resultat av §6 och inte fria val:

- **Raden börjar med butik och datum, inte med en ULID.** `01K5F8…` är systemets namn på
  kvittot, inte människans. Saknas butiken än (den läses ju just nu) står fångsttiden där.
- **`saknar datum`, inte `kräver åtgärd`.** Sidecaren vet vilket fält som fattas. Att skriva ut
  det gör raden till en instruktion i stället för en kategori, och kostar ingenting.
- **`Läses · 4 s`.** Sekundräknaren är den enda framdrift som finns när systemet inte vet hur
  långt in i en bild det har kommit. Se §6.8 — regeln är att ingen animation får stå utan ett
  tal bredvid sig.

```css
/* work-item.component.css */
:host {
  display: grid;
  grid-template-columns: 1.25rem minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--d-gap);
  /* Täthetens tydligaste utslag i hela systemet: 56 px luftigt, 36 px tätt.
     Höjden är *satt*, inte härledd ur innehållet — det är förutsättningen för
     att räkningen i §2.6.4 ska gå att lita på, och för att raden inte ska
     hoppa när tillståndet byts. Linjen ingår i måttet. */
  block-size: var(--d-row-h);
  padding-inline: var(--d-pad-x);
  border-block-end: 1px solid var(--line);
  position: relative;
}

.state-dot { inline-size: 10px; block-size: 10px; border-radius: var(--radius-full);
             justify-self: center; }
/* Teckengrammatiken i §6.3, i CSS. Fyllnadsgrad = hur långt kvittot kommit;
   triangeln är det enda tecken som betyder "en människa behövs". */
:host([data-state="unread"])  .state-dot { border: 2px solid var(--line-strong); }
:host([data-state="reading"]) .state-dot {
  border: 2px solid var(--accent);
  background: linear-gradient(to right, var(--accent) 50%, transparent 50%);
}
:host([data-state="read"])    .state-dot { background: var(--ink-muted);
                                           border: 2px solid var(--ink-muted); }
:host([data-state="missing"]) .state-dot {
  /* Triangel, inte prick: formen bär betydelsen även i gråskala. */
  inline-size: 0; block-size: 0; border-radius: 0;
  border-inline: 6px solid transparent;
  border-block-end: 10px solid var(--warn);
}

/* REVIDERAT efter täthetsbeslutet. Spåret låg tidigare i en egen rutnätsrad,
   vilket lade 5 px på *varje* rad i listan — nära tre rader mindre per skärm i
   tätt läge, för en detalj som syns på högst en rad i taget. Nu ligger det
   absolut placerat i radens underkant, ovanpå linjen. Höjden hålls konstant
   mellan tillstånden lika bra, och 3 px är ett optiskt mått som inte
   täthetsskalas (§2.6.2). */
.progress {
  position: absolute;
  inset-block-end: 0;
  inset-inline: var(--d-pad-x) 0;
  block-size: 3px;
  background: var(--conf-track);
  overflow: hidden;
  opacity: 0;
}
:host([data-state="running"]) .progress { opacity: 1; }
.progress__fill {
  block-size: 100%; background: var(--accent);
  inline-size: var(--progress, 0%);
  transition: inline-size var(--dur-base) var(--ease-out);
}

/* REVIDERAT efter §6.8. Den obestämda stapeln svepte tidigare från vänster till
   höger — vilket är en snurra i stapelform: ett svep färdas mot ett slut och
   antyder därmed en framdrift som systemet inte känner till. Nu pulserar den i
   stället: "lever, avstånd okänt", vilket är sant. Informationen bärs av
   sekundräknaren bredvid, inte av animationen. */
:host([data-progress="indeterminate"]) .progress__fill {
  inline-size: 100%;
  animation: puls 1800ms var(--ease-both) infinite;
}
@keyframes puls {
  0%, 100% { opacity: 0.25; }
  50%      { opacity: 0.60; }
}
/* Under reduced motion försvinner animationen helt utan att något går förlorat —
   det är följdvinsten av att talet, inte rörelsen, bär informationen. */
@media (prefers-reduced-motion: reduce) {
  :host([data-progress="indeterminate"]) .progress__fill { animation: none; opacity: 0.35; }
}
```

Ordning i listan: **saknar en uppgift överst, sedan läses nu, sedan olästa**, och inom varje
grupp äldst först. Backloggen är tiotusen olästa rader och får aldrig trycka undan de tre som
faktiskt vill ha en människa. Gruppen olästa visas hopfälld med en räknare
(`14 233 olästa — visa`) tills någon ber om den.

Statuspolling: SSE enligt planen (krav 45). Under en backloggkörning fylls listan snabbare än
den kan läsas — därför uppdateras **räknarna** i realtid men **radlistan** högst var femte
sekund. Ett flimrande fönster är inte information.

### 3.5 Sökfält och sökträff

`GET /api/search?q=` returnerar `{ hits: [{ id, capturedAt, segments, snippet }] }` där
`snippet` är FTS5:s utdata med `[` `]` runt träffen och `…` som avkortning.

```
┌────────────────────────────────────────────────────────────┐
│ ⌕  kakel badrum                                      ⌫     │
└────────────────────────────────────────────────────────────┘
   18 träffar · sökningen struntar i skillnaden mellan å, ä, ö och a, o

┌────────────────────────────────────────────────────────────┐
│ ┌────┐  Bauhaus Kungens Kurva                  4 218,50 kr │
│ │foto│  2026-04-11                                         │
│ └────┘  …KLINKER GOLV ⟦KAKEL⟧ VIT 25X40 … 12 KVM…          │
└────────────────────────────────────────────────────────────┘
```

Två saker som måste stå i gränssnittet, båda följder av mätningen i M0:

1. **Diakritikfoldningen ska förklaras**, en gång, i en rad under fältet. Den som söker
   "återköp" och får träff på "äterköp" ska inte tro att systemet är trasigt.
2. **Träffen markeras, inte bara snuttas.** `snippet()` ger `[`/`]`; de byts mot ett
   `<mark>` i klienten.

```ts
/** FTS5 ger [ ] runt träffen. Texten är maskinläst OCR-utdata, alltså opålitlig —
 *  den byggs som textnoder, aldrig via innerHTML. */
segments(snippet: string): { text: string; hit: boolean }[] {
  return snippet.split(/(\[[^\]]*\])/).filter(Boolean).map((part) =>
    part.startsWith('[') && part.endsWith(']')
      ? { text: part.slice(1, -1), hit: true }
      : { text: part, hit: false });
}
```

```css
/* search.component.css */
.search-field {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center; gap: var(--d-gap-tight);
  min-block-size: var(--d-control-h);
  padding-inline: var(--d-pad-x);
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
}
.search-field:focus-within {
  outline: var(--focus-width) solid var(--focus-color);
  outline-offset: var(--focus-offset);
  border-color: var(--accent);
}
.search-field input {
  border: none; background: none; outline: none;
  padding-block: var(--d-pad-y);
  font-size: var(--text-base);   /* aldrig täthetsskalad — se §2.6.2 */
}
/* iOS zoomar in på fokus om fältet är under 16 px. Aldrig mindre än --text-base. */

.hit__snippet {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  color: var(--ink-muted);
  overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.hit__snippet mark {
  background: var(--warn-soft);
  color: var(--ink);
  border-radius: var(--radius-xs);
  padding-inline: 2px;
  /* Understruken markering överlever forced-colors, där bakgrunden kastas bort. */
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
```

Tangentbord: `/` fokuserar sökfältet var man än står, `Esc` tömmer det, `↓` går ned i
träfflistan, `Enter` öppnar. Fördröjning innan sökning: 200 ms — FTS5 mot tiotusen rader svarar
på under en millisekund, och burken tål det.

### 3.6 Tomt tillstånd

Fyra tomma tillstånd finns, och de betyder helt olika saker. De får inte se likadana ut.

```
Arkivet är tomt (första start)          Sökning utan träff
┌────────────────────────────┐          ┌────────────────────────────┐
│      Inga kvitton ännu     │          │  Inget kvitto matchar      │
│                            │          │  "kakel badrum"            │
│  Öppna mobilläget på       │          │                            │
│  telefonen för att fånga   │          │  Söker i all maskinläst    │
│  det första.               │          │  text. 412 av 10 233       │
│                            │          │  kvitton är inte lästa än. │
│      [ Visa QR-kod ]       │          │                            │
└────────────────────────────┘          └────────────────────────────┘

Arbetslistan tom (bra nyhet)            Kvitto som inte lästs än
┌────────────────────────────┐          ┌────────────────────────────┐
│  Ingenting behöver dig nu. │          │  I arkivet, inte läst än.  │
│  Senast läst 14:02.        │          │  Plats 43 av 212 i kön.    │
└────────────────────────────┘          └────────────────────────────┘
```

Regeln: **ett tomt tillstånd säger vad läget beror på och vad man gör åt det.** Det tredje ovan
är en positiv utsaga, inte ett tomrum. Det fjärde är avgörande — utan det ser ett nyfångat
kvitto ut som ett trasigt kvitto i flera timmar under backloggkörningen. Notera att det säger
**var kvittot är** ("I arkivet") innan det säger vad som inte hänt ännu: det är ordningen i §6.1,
och det är den ordningen som gör att man kan släppa papperet.

```css
.empty {
  display: grid; place-items: center; gap: var(--space-3);
  padding: var(--space-8) var(--space-5);
  text-align: center;
  color: var(--ink-muted);
  max-width: 36ch; margin-inline: auto;
}
.empty__head { font-size: var(--text-lg); color: var(--ink); }
/* Ingen illustration, ingen ikon. Bilderna på skärmen ska vara kvitton. */
```

### 3.7 Felruta

Två slag, och de ska inte blandas: **fel som användaren kan åtgärda** och **fel i systemet**.

```
Åtgärdbart (inline, vid orsaken)
┌────────────────────────────────────────────────────────────┐
│ ▲  Segment 2 finns redan med annat innehåll.               │
│    Servern svarade 409. Ta om bilden eller lägg den som    │
│    segment 3.                          [Ta om]  [Som nytt] │
└────────────────────────────────────────────────────────────┘

Systemfel (i skalet, kvarstår)
┌────────────────────────────────────────────────────────────┐
│ ▲  Servern svarar inte.                                    │
│    Senaste kontakt 14:02. Kön har 4 kvitton kvar att       │
│    skicka — ingenting är förlorat.             [Försök nu] │
└────────────────────────────────────────────────────────────┘
```

Den andra meningen i systemfelet är den viktigaste i hela gränssnittet: **när nätet fallerar
måste rutan säga att bilderna finns kvar.** Planens bärande asymmetri är att bilderna är
oåterkalleliga; en felruta som lämnar tveksamhet om det får någon att fotografera om ett kvitto
som redan är slängt.

Serverns felkroppar är kända (`server/src/http/receipts.ts`): `invalid_id`, `not_an_image`,
`conflict`, `internal`, `missing_id`, `missing_file`, `not_found`, `missing_query`. De översätts
i en enda tabell i klienten — ingen komponent formulerar sin egen text för `conflict`.

```css
.alert {
  display: grid; grid-template-columns: 1.5rem minmax(0, 1fr);
  gap: var(--space-3);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid;
  font-size: var(--text-sm);
}
.alert[data-tone="warn"]   { background: var(--warn-soft);
                             border-color: var(--warn);   color: var(--ink); }
.alert[data-tone="danger"] { background: var(--danger-soft);
                             border-color: var(--danger); color: var(--ink); }
.alert__title { font-weight: var(--weight-medium); }
/* Ikonen bär ingen betydelse ensam — texten säger allt. Färg + linje + ikon
   + text är fyra kanaler, varav tre fungerar i gråskala. */
```

Rutan är `role="alert"` när den dyker upp av sig själv, `role="status"` när den är följden av
något användaren just gjorde. Skillnaden avgör om skärmläsaren avbryter.

### 3.8 Kameraöverlägg

Enda vyn som inte följer temat: **den är alltid mörk**, oavsett läge. Videobilden är
utgångspunkten, och ljus krom över en ljus bild av vitt papper är oläsbar.

```
┌──────────────────────────────────────────┐  ← safe-area-inset-top
│  ×               fångar 3        ○ auto  │  40 px krom, --scrim
├──────────────────────────────────────────┤
│                                          │
│      ┌────────────────────────────┐      │
│      │                            │      │
│      │      live videobild        │      │  hela ytan, object-fit: cover
│      │                            │      │
│      │  ┌──┐                ┌──┐  │      │  hörnmarkörer, inte en ram:
│      │  └  ┘                └  ┘  │      │  ramen skymmer papperskanten
│      │                            │      │
│      │  ┌  ┐                ┌  ┐  │      │
│      │  └──┘                └──┘  │      │
│      └────────────────────────────┘      │
│                                          │
│         Texthöjd 14 px — kom närmare     │  status, en rad, --on-scrim
│         ▓▓▓▓▓▓▓▓░░░░░░░░░░░  14/18       │  kvalitetsmätare
│                                          │
├──────────────────────────────────────────┤
│ ┌──┐┌──┐┌──┐                             │  segmentremsa (§3.9)
│ │1 ││2 ││3 │                             │  74 px hög
│ └──┘└──┘└──┘                             │
│                                          │
│    [Klart]        ((( ● )))     [Nästa]  │  76 px avtryckare, centrerad
│                                          │  ← safe-area-inset-bottom
└──────────────────────────────────────────┘
```

**Kvalitetsindikatorn** visar planens faktiska mått: mediantexthöjd i pixlar, skalad till
stillbildens upplösning. Den visar **inte** en procentsats, för det finns ingen procent — det
finns en uppmätt höjd och ett mål.

Tre nivåer i språk, en enda i färg:

| Läge | Text | Mätare | Ring runt avtryckaren |
| --- | --- | --- | --- |
| under mål | `Texthöjd 14 px — kom närmare` | `--warn`, fyllnad efter mätvärde | tom |
| på mål, ostabil | `Texthöjd 19 px — håll stilla` | `--ok` | fylls, 0–3 bildrutor |
| på mål, stabil × 3 | *(utlöses)* | `--ok`, full | full, kort blixt |

```css
/* camera-overlay.component.css */
:host {
  position: fixed; inset: 0; z-index: var(--z-overlay);
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: #000;
  color: var(--on-scrim);
  /* Alltid mörk krom, oavsett tema — se ovan. */
  padding-block-start: env(safe-area-inset-top);
  padding-block-end: env(safe-area-inset-bottom);
  /* Ingen sidoscroll, ingen pull-to-refresh mitt i en fångst. */
  overscroll-behavior: none;
  touch-action: manipulation;
  user-select: none;
}

.video { inline-size: 100%; block-size: 100%; object-fit: cover; }

/* Hörnmarkörer i stället för ram: kvittot är avlångt och en fast ram
   får en användare att beskära bort början eller slutet. */
.corner {
  position: absolute; inline-size: 26px; block-size: 26px;
  border: 3px solid var(--on-scrim); opacity: 0.85;
  filter: drop-shadow(0 0 2px rgb(0 0 0 / 0.6));  /* syns mot vitt papper */
}

.status {
  text-align: center; font-size: var(--text-base);
  text-shadow: 0 1px 3px rgb(0 0 0 / 0.8);   /* kontrast mot videobild */
  padding-block: var(--space-2);
}
.quality {
  inline-size: min(60vw, 240px); block-size: 4px; margin-inline: auto;
  background: rgb(255 255 255 / 0.25); border-radius: var(--radius-xs);
}
.quality__fill {
  block-size: 100%; border-radius: inherit;
  inline-size: var(--q, 0%);
  background: var(--quality-tone, var(--warn));
  transition: inline-size var(--dur-fast) linear;   /* linjärt: det är en mätare */
}

/* Avtryckaren. 76 px, centrerad, alltid på samma plats — muskelminne bär
   fångsten när ögat är på papperet, inte på skärmen. */
.shutter {
  inline-size: var(--shutter-size); block-size: var(--shutter-size);
  border-radius: var(--radius-full);
  border: 4px solid var(--on-scrim);
  background: var(--on-scrim);
  box-shadow: 0 0 0 2px rgb(0 0 0 / 0.4);   /* syns mot vitt papper */
  justify-self: center;
}
.shutter:active { transform: scale(0.94); }

/* Autoutlösningsringen är inte en tidsanimering: den är tre bildrutor.
   stroke-dashoffset styrs från komponenten, 3 → 2 → 1 → 0. */
.shutter__ring circle {
  fill: none; stroke: var(--ok); stroke-width: 4; stroke-linecap: round;
  transition: stroke-dashoffset var(--dur-fast) linear;
}

/* Sidoknapparna sitter inom tumräckvidd, avtryckaren i mitten.
   Klart till vänster: den ska inte träffas av misstag av en högerhand. */
.actions {
  display: grid; grid-template-columns: 1fr auto 1fr;
  align-items: center; gap: var(--space-4);
  padding: var(--space-4) var(--space-5) var(--space-5);
  background: linear-gradient(to top, var(--scrim-strong), transparent);
}
```

Två regler ur kravställningen som formen måste bära:

- **Kvalitetsvarningen blockerar aldrig** (krav 7). Den manuella avtryckaren fungerar vid
  texthöjd 9 px lika väl som vid 24. Mätaren informerar, den grindar inte.
- **"Klart → nästa" ska rymmas i tre sekunder** (krav 1). Därför ligger ingen
  nätverksoperation i den vägen, och därför visas ingen bekräftelseskärm efter "Klart" — kameran
  är levande igen omedelbart, och kvittot glider ned i remsan som en sidoeffekt. Det som
  bekräftar att det gick vägen är räknaren `fångar 3` i toppraden och kön i §3.10.

### 3.9 Segmentremsa

```
┌────┬────┬────┬────────────────────────────┐
│ ┌┐ │ ┌┐ │ ┌┐ │                            │
│ ││1│ ││2│ ││3│      ← rullar i sidled     │
│ └┘ │ └┘ │ └┘ │                            │
│  × │  × │  × │                            │
└────┴────┴────┴────────────────────────────┘
  56 × 74 px, gap 8, senaste till höger
```

```css
/* segment-strip.component.css */
:host {
  display: flex; gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  overflow-x: auto;
  overscroll-behavior-x: contain;      /* dra inte med hela vyn i sidled */
  scroll-snap-type: x proximity;
  scrollbar-width: none;
}
:host::-webkit-scrollbar { display: none; }

.seg {
  position: relative; flex: 0 0 auto;
  inline-size: var(--thumb-w); block-size: var(--thumb-h);
  border-radius: var(--radius-sm);
  overflow: hidden;
  scroll-snap-align: end;
  background: var(--image-bed);
}
.seg img { inline-size: 100%; block-size: 100%; object-fit: cover; }

/* Numret ligger på bilden, inte bredvid: remsan är trång och siffran måste
   överleva ett foto av vitt papper. */
.seg__n {
  position: absolute; inset-block-start: 2px; inset-inline-start: 2px;
  min-inline-size: 18px; padding-inline: 4px;
  border-radius: var(--radius-xs);
  background: var(--scrim-strong); color: var(--on-scrim);
  font-size: var(--text-xs); text-align: center;
}

/* Ta bort-krysset måste vara 44 px trots att miniatyren är 56 bred —
   den osynliga träffytan lånar utrymme nedåt, utanför bilden. */
.seg__remove {
  position: absolute; inset-block-end: 0; inset-inline-end: 0;
  inline-size: 28px; block-size: 28px;
  display: grid; place-items: center;
  background: var(--scrim-strong); color: var(--on-scrim);
  border: none; border-start-start-radius: var(--radius-sm);
}
.seg__remove::after { content: ""; position: absolute; inset: -8px; }

/* Var segmentet är. Tecknet kommer ur grammatiken i §6.3 och ligger i nedre
   vänstra hörnet, mittemot numret. Dämpningen ensam räcker inte — den läses som
   "laddar bild", inte som "finns bara i telefonen". */
.seg[data-place="phone"]   img { opacity: 0.55; }
.seg[data-place="sending"] img { opacity: 0.75; }
.seg__place {
  position: absolute; inset-block-end: 2px; inset-inline-start: 2px;
  inline-size: 14px; block-size: 14px;
  display: grid; place-items: center;
  border-radius: var(--radius-full);
  background: var(--scrim-strong); color: var(--on-scrim);
  font-size: 9px; line-height: 1;
}
```

Ett borttaget segment tas bort **lokalt före uppladdning**, aldrig efteråt: planen säger att
bilderna är oåterkalleliga och att ingenting gallras automatiskt (krav 36). Har segmentet redan
nått servern är krysset borta och miniatyren låst.

### 3.10 Räknaren i mobillägets topprad

> **Underkänd i sin första form.** Den sa `4 väntar` och `Allt är uppladdat` — kösystemets
> tillstånd i kösystemets språk, till någon som står med ett papper i handen. Hela resonemanget
> och den nya vokabulären står i §6; här är formen.

Krav 3 kräver en räknare som står kvar tills servern kvitterat. Kravet uppfylls, men i
**platsspråk**: räknaren säger var kvittona *är*, inte hur djup kön är.

```
   ◌  3 kvitton ligger kvar i telefonen      inget nät just nu
   ◐  1 kvitto skickas                       transient, någon sekund
      (ingenting alls)                       allt är i arkivet
```

Tre regler:

1. **Noll visas inte.** `Allt är uppladdat` och `0 väntar` är samma sak: en upplysning om att
   ingenting har hänt. Frånvaron av räknare är den upplysningen, gratis och tystare.
2. **"Ligger kvar i telefonen", inte "väntar".** *Väntar* är något kön gör. *Ligger i telefonen*
   är något kvittot gör, och det är också exakt det som avgör om papperet får slängas.
3. **Räknaren svarar aldrig på frågan "kom mitt kvitto fram?"** Den är ett aggregat, och den
   frågan gäller ett enskilt kvitto. Svaret hör hemma på kvittot självt — §6.4.

```css
/* queue-badge.component.css */
:host { display: inline-flex; align-items: center; gap: var(--d-gap-tight);
        min-block-size: var(--tap-min);
        padding-inline: var(--d-pad-x);
        font-size: var(--text-sm); }
/* Ingen färgvarning. Att tre kvitton ligger i telefonen är ett normalt läge på
   dålig täckning, inte ett fel — och en gul bricka i toppraden vid varje
   butiksbesök blir tapet inom en vecka (samma resonemang som §5.3). */
:host { color: var(--ink-muted); }
:host([hidden]) { display: none; }
```

---

## 4. Layoutregler

### 4.1 Två ytor, valda på rutt — inte på bredd

`/fanga` är mobilläget. `/` och allt annat är datorläget. En telefon i landskapsläge blir inte
plötsligt ett datorläge, och en smal webbläsare på skrivbordet blir inte en kamera. Brytpunkter
används inom respektive yta, inte för att välja mellan dem.

```
Brytpunkter (skrivs alltid som min-width — mobil först)
  --bp-sm:  600px    en kolumn → två i datorläget
  --bp-md:  900px    fältpanelen får plats bredvid bilden
  --bp-lg: 1200px    arbetslistan får en egen kolumn
```

Angular: `web/src/app/app.routes.ts` är i dag tom. Förslag:

```ts
export const routes: Routes = [
  { path: '',       loadComponent: () => import('./desktop/shell.component')
                                          .then(m => m.ShellComponent),
    children: [
      { path: '',            loadComponent: () => import('./desktop/worklist.component')… },
      { path: 'sok',         loadComponent: () => import('./desktop/search.component')… },
      { path: 'kvitto/:id',  loadComponent: () => import('./desktop/receipt.component')… },
      { path: 'granska',     loadComponent: () => import('./desktop/review.component')… },
      { path: 'drift',       loadComponent: () => import('./desktop/drift.component')… },
    ] },
  { path: 'fanga', loadComponent: () => import('./mobile/capture.component')… },
];
```

Mobilläget laddas separat, så att telefonen inte hämtar datorlägets kod innan den kan
fotografera.

Täthetsaxeln (§2.6) hänger på samma delning, och det är hela skälet till att den bor på
ruttkomponentens värdelement:

```ts
@Component({ selector: 'app-shell',   host: { 'data-density': 'compact' },     … })
@Component({ selector: 'app-capture', host: { 'data-density': 'comfortable' }, … })
```

Ingen annan komponent i systemet sätter attributet, med det enda undantag §2.6.3 räknar upp.

### 4.2 Datorlägets rutnät

```
≥1200 px
┌──────────┬────────────────────────────────┬────────────────┐
│ arbets-  │                                │ fält           │
│ lista    │        kvittobild              │ ────────────── │
│ 20rem    │        (fyller resten)         │ Butik  …       │
│          │                                │ Datum  …       │
│ ──────── │        segment 1 av 2  ‹ ›      │ Total  …       │
│ ▲ 3 kräv │                                │                │
│ ◐ 1 bear │                                │ ──────────────  │
│ ○ 14 vän │                                │ rå text        │
├──────────┴────────────────────────────────┴────────────────┤
│ /data på ZFS · 412 GB ledigt · v0.1.0                      │  statusremsa
└────────────────────────────────────────────────────────────┘

900–1199 px: arbetslistan blir ett utfällbart ark från vänster
600–899 px:  fältpanelen hamnar under bilden
<600 px:     en kolumn; bild, fält, text under varandra
```

```css
/* shell.component.css — värdelementet bär data-density="compact" (§2.6) */
.shell {
  display: grid;
  grid-template-rows: 1fr auto;
  block-size: 100dvh;      /* dvh, inte vh: annars gömmer mobilens adressfält foten */
}
.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;           /* utan denna kan inre scroll inte fungera i en grid */
  overflow: hidden;
}
@media (min-width: 900px) {
  .workspace { grid-template-columns: minmax(0, 1fr) var(--panel-fields); }
}
@media (min-width: 1200px) {
  .workspace {
    grid-template-columns: var(--panel-worklist) minmax(0, 1fr) var(--panel-fields);
  }
}

/* Varje kolumn scrollar för sig. Sidan som helhet scrollar aldrig. */
.workspace > * { overflow-y: auto; min-width: 0; overscroll-behavior: contain; }
```

`min-width: 0` på varje rutnätsbarn är inte kosmetik: ett grid-spår har `min-width: auto` som
standard, och en lång butiksnamnssträng eller en bred OCR-rad tvingar då hela sidan att rulla i
sidled. Det är den enskilt vanligaste orsaken till sidoscroll i den här typen av layout.

### 4.3 Träffytor

Träffytor är den plats där täthetsaxeln (§2.6) möter ett hårt krav, så tabellen skiljer på vad
som *syns* och vad som går att *träffa*.

| Yta | Synligt | Träffyta | Grund |
| --- | --- | --- | --- |
| Mobilläget, allt | 48 px (`--d-control-h`) | 48 px | husregel, över 2.5.5 AAA (44) |
| Mobilläget, primär åtgärd | 56 px (`--tap-primary`) | 56 px | avtryckaren 76 px |
| Datorläget, fristående kontroll | 36 px (`--d-control-h`) | 44 px via `::after` | 2.5.5 AAA där utrymmet finns |
| Datorläget, rad i tät lista | 36 px (`--d-row-h`) | 36 px, hela raden | 2.5.8 AA (24 px) med marginal |
| Fältpanelen, lokalt luftig (§2.6.3) | 48 px | 48 px | bedömningsyta, inte skanningsyta |

**Mobilläget sjunker aldrig under 44 px.** `--tap-min` står utanför täthetsaxeln och får inte
förekomma i ett `[data-density]`-block (§2.6.2).

Mönstret när det visuella är mindre än träffytan:

```css
[data-reach="extended"] { position: relative; }
[data-reach="extended"]::after {
  content: "";
  position: absolute;
  inset: 50% auto auto 50%;
  translate: -50% -50%;
  min-inline-size: var(--tap-min);
  min-block-size: var(--tap-min);
  inline-size: 100%; block-size: 100%;
}
```

**Villkoret för att få använda det:** minst 8 px fritt runt kontrollen. I en tät lista, där
36 px-rader ligger kant i kant, skulle en 44 px träffyta växa in i grannraden och göra
varannan klickning fel. Där är hela raden målet och 36 px är rätt svar — ett litet mål är
bättre än ett stort som träffar fel rad.

Avstånd mellan två fristående träffytor: minst `--d-gap-tight`. I segmentremsan och i kamerans
åtgärdsrad minst 16 px, eftersom de används i rörelse med en hand — de måtten är
täthetsoberoende och står i §3.9 respektive §3.8.

### 4.4 Enhandsräckvidd på mobil

```
┌──────────────────────┐  0–25 %  läsyta. Räknare, status, stäng.
│  ░░░░░░░░░░░░░░░░░░  │           Inget som måste träffas i en rörelse.
│  ░░░░░░░░░░░░░░░░░░  │
├──────────────────────┤
│                      │  25–65 %  bild. Rörs inte med fingret.
│                      │
│                      │
├──────────────────────┤
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │  65–100 % åtgärdsyta. Allt som trycks
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  │           ofta ligger här.
└──────────────────────┘
```

Fyra regler:

1. **Ingen destruktiv åtgärd i åtgärdsytan.** "Ta bort segment" sitter på miniatyren, inte som
   en stor knapp bredvid avtryckaren.
2. **Avtryckaren är centrerad**, inte högerställd. Två personer använder systemet; en av dem kan
   vara vänsterhänt, och centrerat är det enda som inte gynnar den ena.
3. **`env(safe-area-inset-bottom)` respekteras**, annars hamnar avtryckaren under iPhones
   hemindikator.
4. **Toppradens `×` är enda undantaget** — den ligger utom räckhåll med flit. Att avbryta en
   fångst ska kräva en avsiktlig omgreppning.

### 4.5 En stor kvittobild utan sidoscroll

Problemet: ett kvittofoto är 3024 × 4032, extremt avlångt när det är upprätat, och ska kunna
zoomas för att läsa en rad. Tre nivåer, och den kritiska regeln är att zoomen bor i en **egen
scrollcontainer** som inte kan smitta sidan.

```css
/* receipt-image.component.css */
.viewport {
  /* Egen scrollcontainer. `contain` gör att en zoomad bild aldrig kan
     få föräldern att rulla i sidled. */
  position: relative;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--image-bed);
  border-radius: var(--radius-lg);
  min-width: 0;                       /* se §4.2 */
  block-size: 100%;
  /* Låt webbläsaren sköta nypzoom där det går; den är alltid mjukare
     än en egen implementation, och den fungerar med assistiv teknik. */
  touch-action: pinch-zoom;
}

/* Standardläge: hela kvittot syns, bredden är aldrig större än viewporten. */
.image {
  display: block;
  inline-size: auto;
  max-inline-size: 100%;
  block-size: auto;
  margin-inline: auto;
  /* Ett upprätat kvitto är högre än rutan — höjden får rulla, aldrig bredden. */
}

/* Zoomat läge: bilden får bli bredare än viewporten, som då rullar internt. */
.viewport[data-zoom="fit-width"] .image { inline-size: 100%; max-inline-size: none; }
.viewport[data-zoom="actual"]    .image { inline-size: auto; max-inline-size: none; }

/* Evidensruta ur receipt.json: fields.*.evidence.box = [x, y, w, h] i bildens
   egna pixlar. Procent gör att rutan följer med i alla zoomlägen utan uträkning. */
.evidence {
  position: absolute;
  inset-block-start: calc(var(--ev-y) * 100%);
  inset-inline-start: calc(var(--ev-x) * 100%);
  inline-size:  calc(var(--ev-w) * 100%);
  block-size:   calc(var(--ev-h) * 100%);
  border: 2px solid var(--accent);
  border-radius: var(--radius-xs);
  box-shadow: 0 0 0 9999px rgb(0 0 0 / 0.28);   /* allt utom rutan dämpas */
  pointer-events: none;
  transition: opacity var(--dur-fast) var(--ease-out);
}
```

Fyra garantier mot sidoscroll, som alla behövs:

1. `min-width: 0` på varje rutnätsbarn (§4.2).
2. `max-inline-size: 100%` på `img` globalt (§2.4).
3. `overflow: auto` + `overscroll-behavior: contain` på bildens egen viewport.
4. `overflow-wrap: anywhere` på all OCR-text (§2.4) — den innehåller strängar som `0RG.NR:5566778899-01234` som inget mjukt radbrott delar.

En femte, som säkerhetsnät under utveckling:

```css
/* Sätts tillfälligt när något rullar i sidled och orsaken inte är hittad. */
html.debug-overflow * { outline: 1px solid var(--danger); }
```

### 4.6 Rullning och tangentbord i datorläget

Sidan som helhet rullar aldrig (`block-size: 100dvh` + `overflow: hidden` på skalet). Varje
kolumn rullar för sig. Följden är att tangentbordsnavigering aldrig tappar bort fokus utanför
skärmen, och det är förutsättningen för snabbrättningen i krav 14.

`scroll-margin-block: var(--space-5)` på varje fältrad och listrad, så att `.scrollIntoView()`
vid tangentbordsförflyttning inte klistrar raden mot kanten.

---

## 5. Konfidens — hur osäkerhet visas

### 5.1 Vad som gör beslutet svårt

Tre krav drar åt olika håll.

- **Krav 13** kräver att ett osäkert värde är synligt osäkert.
- **Planen förbjuder en tröskel i Steg 1.** Konfidensen mäts och lagras men styr ingenting;
  var gränsen går avgörs först i Steg 2 ur granskningsurvalet om hundra kvitton. Varje
  färgkodning — grönt över 0,9, gult under — *är* en tröskel. Den skulle smyga in exakt det
  beslut planen med flit skjuter upp, och den skulle göra det i det lager som är svårast att
  ändra: användarens vana.
- **Skalan är tiotusen kvitton.** Markören sitter på i praktiken varje värde i arkivet i
  månader. Allt som skriker blir tapet inom en vecka, och då är kravet uppfyllt på papperet och
  brutet i praktiken.

Dessutom: färg ensam duger inte (WCAG 1.4.1), och konfidensvärdet är ett **kalibreringsobjekt** —
M0 mätte median 0,95 och p10 0,75, men om måttet är *kalibrerat* vet ingen ännu. Ett gränssnitt
som får siffran att se auktoritativ ut ljuger om vad den är.

### 5.2 Beslutet

> **Härkomst är kategorisk och visas som textur på värdet. Konfidens är kontinuerlig och visas
> som längd plus siffra, bredvid värdet. De två blandas aldrig, och ingen av dem använder färg.**

Två oberoende saker, i två oberoende kanaler.

**Kanal 1 — härkomst.** Tre lägen, och bara tre:

| Läge | Vad det betyder | Hur det ser ut |
| --- | --- | --- |
| `machine` | `source: "ocr"`, ingen människa har sett det | **punktad understrykning** under värdet |
| `confirmed` | rättat, eller bekräftat av en människa | **ingenting** |
| `missing` | fältet finns inte i sidecaren | streckad tom ruta + ordet *saknas* |

**Kanal 2 — konfidensvärdet.** Bara på `machine`-rader. En 3 px hög remsa, 56 px bred, linjärt
skalad 0–1, plus talet med två decimaler i `--text-xs`. Neutralt bläck, samma färg vid 0,4 som
vid 0,99.

### 5.3 Varför just så

**Varför punktlinje och inte färg, ikon eller fet stil.** Punktad understrykning är den
befintliga idiomatiken för *maskinens förslag, inte människans ord* — stavningskontroll och
autokorrigering har lärt varje användare vad den betyder utan att någon förklarat det. Den
sitter dessutom **under baslinjen**, alltså rör den inte glyfernas kontrast. Det är avgörande
här: det som ska läsas är siffror på ett kvitto, och varje behandling som gör siffrorna gråare,
tunnare eller mindre gör systemet sämre på sitt enda jobb. Värdet har **identisk storlek, vikt
och färg i alla tre lägena.** Bara ornamentet skiljer. Det är den enskilda regeln som gör att
gränssnittet kan markera tiotusen osäkra värden utan att skrika.

**Varför det bekräftade läget är helt omarkerat.** Frestelsen är en grön bock. Motargumentet är
räkneövningen: 10 000 kvitton × 3 fält, och när arbetet väl är gjort är skärmen en vägg av
bockar — mot vilken punktlinjerna, det enda som betyder något, drunknar. Frånvaro som signal
fungerar här därför att **utgångsläget är maskinläst**. Arkivet börjar helt ornamenterat och
tystnar allteftersom. Ett gränssnitt som blir tystare ju mer arbete som är gjort är rätt
gränssnitt för ett arkiv man ska leva med i tio år.

Frånvaro är dock tvetydig om ingenting säger vad den betyder. Det löses en gång, i panelhuvudet,
inte per rad:

```
Fält                                      2 av 3 bekräftade
‥‥‥ = maskinläst, ännu inte bekräftat
```

Räkningen `2 av 3 bekräftade` gör tomrummet entydigt utan att kosta en enda pixel per rad.

**Varför en kontinuerlig remsa och ingen indelning i nivåer.** Varje indelning i låg/medel/hög
är en tröskel med annan dräkt. Remsan påstår ingenting: den visar talet som finns i
`receipt.json`, i full skala, och överlåter tolkningen. Den är också ärlig om måttets
osäkerhet — en avläsare kan se att 0,61 ligger under det mesta i arkivet utan att systemet
antyder att 0,61 vore fel.

**Varför inte hue någonstans.** Tre skäl, i fallande ordning: (1) hue **är** ett omdöme, och
omdömet finns inte förrän Steg 2; (2) ungefär en av tolv män ser inte skillnaden rött/grönt,
och hushållet är två personer varav den ena kan vara en av dem; (3) skärmen är full av foton av
vitt papper i varmt inomhusljus, och en gul markör på det ser ut som en fläck på kvittot.

**Vad som faktiskt avgör om ett värde är rätt.** Inte siffran — bilden. Därför är fältraden
kopplad till evidensrutan (§4.5): fokus eller pekare på raden ritar rutan i kvittobilden, och
allt utanför dämpas. Konfidenssiffran säger vad maskinen tyckte; evidensrutan låter en människa
avgöra på en halv sekund. Den kopplingen är mer värd än varje förfining av markören.

### 5.4 Fältstämpeln — konfidens i en lista

Punktlinjen är för fin för listtäthet. I kvittokort, sökträffar och arbetslistrader ersätts den
av tre punkter i fast ordning: **butik, datum, total**.

```
● ● ○     två bekräftade, totalen maskinläst
● ○ ⊘     datum maskinläst, total saknas
○ ○ ○     inget bekräftat ännu (normalläget under backloggen)
```

Fylld = bekräftad. Ihålig = maskinläst. Genomstruken = saknas. Ordningen är fast, alltid samma
tre fält, så att stämpeln går att läsa som ett mönster utan att läsas som text. Skärmläsare får
`"butik bekräftat, datum maskinläst, totalbelopp saknas"`.

### 5.5 CSS

```css
/* confidence.css — tokens ligger i tokens.css, formen här. */

/* ---- Punktlinjen (fältrad) ------------------------------------------- */
.value[data-state="machine"] {
  text-decoration: underline dotted var(--conf-mark);
  text-decoration-thickness: 2px;
  text-underline-offset: 0.28em;
  text-decoration-skip-ink: none;   /* hoppa inte över nedstaplar: linjen ska vara hel */
}
.value[data-state="confirmed"] { text-decoration: none; }
.value[data-state="missing"] {
  color: var(--ink-faint); font-style: italic;
  border-block-end: 2px dashed var(--line-strong);
  padding-inline: var(--space-2);
}

/* ---- Konfidensremsan -------------------------------------------------- */
.conf {
  display: inline-flex; align-items: center; gap: var(--space-2);
  font-size: var(--text-xs); color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}
.conf__track {
  position: relative;
  inline-size: 56px; block-size: 3px;
  background: var(--conf-track);
  border-radius: var(--radius-xs);
  overflow: hidden;
}
.conf__fill {
  block-size: 100%;
  inline-size: calc(var(--conf) * 100%);   /* --conf: 0–1, satt från komponenten */
  background: var(--conf-fill);
  border-radius: inherit;
}

/* Tomt spår för Steg 2. --conf-threshold är avsiktligt odefinierad i Steg 1;
   när kalibreringen ur granskningsurvalet ger ett tal sätts den i tokens.css
   och hårstrecket dyker upp i hela systemet utan att en komponent rörs. */
.conf__track::after {
  content: "";
  position: absolute; inset-block: 0;
  inset-inline-start: calc(var(--conf-threshold, 0) * 100%);
  inline-size: 1px;
  background: var(--ink);
  opacity: var(--conf-threshold-shown, 0);
}

/* Höga kontrastlägen kastar bort bakgrundsfärger. Remsan görs om till en ram,
   som överlever. */
@media (forced-colors: active) {
  .conf__track { border: 1px solid CanvasText; forced-color-adjust: none;
                 background: Canvas; }
  .conf__fill  { background: CanvasText; }
  .value[data-state="machine"] { text-decoration-color: CanvasText; }
}

/* ---- Fältstämpeln ------------------------------------------------------ */
.stamp { display: inline-flex; gap: 5px; align-items: center; }
.stamp__dot {
  inline-size: 7px; block-size: 7px; border-radius: var(--radius-full);
  border: 1.5px solid var(--line-strong);
}
.stamp__dot[data-state="confirmed"] { background: var(--ink-muted);
                                      border-color: var(--ink-muted); }
.stamp__dot[data-state="machine"]   { background: transparent; }
.stamp__dot[data-state="missing"]   {
  border-color: var(--line-strong);
  background:
    linear-gradient(to bottom right,
      transparent calc(50% - 1px), var(--line-strong) calc(50% - 1px),
      var(--line-strong) calc(50% + 1px), transparent calc(50% + 1px));
}
```

### 5.6 Angular-sidan

```ts
type FieldState = 'machine' | 'confirmed' | 'missing';

/** Ett fält ur receipt.json. `source` finns per fält enligt planens sidecar-format. */
type Field = {
  value: unknown;
  confidence?: number;
  source?: 'ocr' | 'manual';
  evidence?: { segment: number; box: [number, number, number, number] };
};

@Component({
  selector: 'app-field-row',
  template: `
    <span class="label" [id]="labelId">{{ label() }}</span>

    <span class="value" [attr.data-state]="state()"
          [attr.data-emphasis]="emphasis()" [attr.aria-describedby]="descId">
      {{ display() }}
    </span>

    @if (state() === 'machine' && confidence() !== undefined) {
      <span class="conf" [style.--conf]="confidence()" aria-hidden="true">
        <span class="conf__track"><span class="conf__fill"></span></span>
        {{ confidence()!.toFixed(2).replace('.', ',') }}
      </span>
    }

    <span class="sr-only" [id]="descId">{{ spokenState() }}</span>
  `,
  styleUrls: ['./field-row.component.css', '../styles/confidence.css'],
})
export class FieldRowComponent {
  readonly label = input.required<string>();
  readonly field = input<Field | undefined>();
  readonly emphasis = input<'total' | null>(null);

  readonly labelId = `lbl-${crypto.randomUUID()}`;
  readonly descId  = `dsc-${crypto.randomUUID()}`;

  readonly state = computed<FieldState>(() => {
    const f = this.field();
    if (!f || f.value === null || f.value === undefined || f.value === '') return 'missing';
    // Krav 13 utan tröskel: "osäkert" = ännu inte bekräftat av en människa.
    // Konfidensvärdet påverkar inte tillståndet. Det är hela poängen.
    return f.source === 'manual' ? 'confirmed' : 'machine';
  });

  readonly confidence = computed(() => this.field()?.confidence);

  readonly spokenState = computed(() => {
    const c = this.confidence();
    switch (this.state()) {
      case 'missing':   return 'gick inte att läsa ur bilderna';
      case 'confirmed': return 'bekräftat av en människa';
      case 'machine':   return c === undefined
        ? 'maskinläst, ännu inte bekräftat'
        : `maskinläst, konfidens ${Math.round(c * 100)} procent, ännu inte bekräftat`;
    }
  });
}
```

### 5.7 En lucka i sidecar-formatet som designen blottar

Gränssnittet ovan behöver veta **per fält** om en människa har sett värdet. Sidecaren i
`server/src/store/sidecar.ts` bär i dag:

- `corrections[]` — visar att ett fält *ändrats*, alltså implicit bekräftat.
- `review: { sampled, reviewedAt?, verdict? }` — bekräftelse på **kvittonivå**, ur
  granskningsurvalet.
- `fields.*.source` — `"ocr" | "manual"` enligt planen, men inte typad i `sidecar.ts` ännu
  (`fields` är `Record<string, unknown>`).

Det som saknas är fallet **"jag tittade på totalen, den var rätt, jag rörde ingenting"**. Det ger
varken en `correction` eller en `review`, och fältet står kvar som maskinläst för alltid. Det är
just den handlingen `Space` i §3.2 utför, och den som gör att arkivet kan tystna.

Förslaget är minsta möjliga tillägg när M6/M7 byggs, nämnt här därför att designen inte fungerar
utan det — inte som ett beslut som fattas i den här filen:

```jsonc
"fields": {
  "total": {
    "value": 4218.50, "confidence": 0.61, "source": "ocr",
    "confirmedAt": "2026-08-29T09:14:02Z"   // ← nytt, valfritt
  }
}
```

Regeln blir då: `state = confirmedAt || source === "manual" ? 'confirmed' : 'machine'`. Fältet är
additivt, bryter inget befintligt `receipt.json`, och `reindex` behöver inte veta om det.

Det är också en datapunkt planen vill ha: ett `confirmedAt` **utan** en `correction` betyder
"maskinen hade rätt vid konfidens 0,61", vilket är precis den observation krav 12 efterfrågar
och som annars bara samlas i det slumpmässiga granskningsurvalet.

### 5.8 Vad som avfärdades, och varför

| Alternativ | Varför inte |
| --- | --- |
| Färgskala grön→gul→röd | Är en tröskel i förklädnad; bryter mot planen. Färg ensam duger inte (1.4.1). Ser ut som en fläck på papperet. |
| Genomskinlighet efter konfidens | Gör det osäkraste värdet svårast att läsa — precis tvärtemot. Bryter kontrastkravet. |
| Kursiv eller lättare vikt på maskinläst | Ändrar glyfernas form och tyngd. Siffror ska läsas likadant oavsett härkomst. |
| Bock på bekräftade fält | Blir 30 000 bockar. Drunknar signalen den var tänkt att lyfta. |
| Procent i klartext på varje rad utan remsa | Fungerar, men går inte att skanna. Remsan finns för blicken, siffran för avläsningen. |
| Rita konfidensen på bilden, ovanpå evidensrutan | Skymmer det man ska bedöma. Rutan visar *var*, panelen visar *hur säkert*. |
| Sortera fält efter konfidens | Fältens ordning är ett minne. Butik, datum, total står alltid i samma ordning. |

---

## 6. Statusspråk

### 6.1 Vad som var fel, och vad metaforen är

Statusremsan sa **"Allt är uppladdat"** och **"1 kvitto väntar"**. Båda är sanna och båda är
oanvändbara, av samma skäl: de beskriver **kösystemets** tillstånd med **kösystemets** ord, till
någon som håller ett papper i handen och ska bestämma om han vågar lägga ned det.

*Väntar* är något en kö gör. *Uppladdad* är något en fil är. Ingendera är något ett kvitto är.
Och "allt" är ett aggregat — frågan i handen gäller ett enda kvitto, det som just fotograferades.

**Metaforen är en plats, inte en process.** Kvittot är på väg från handen till arkivet, och
statusen svarar på *var det är just nu*:

```
   i handen   →   i telefonen   →   i arkivet
   (papper)       (kan tappas)      (ligger säkert)
```

Tre platser. En människa vet redan vad det betyder att något *är någonstans*; ingen behöver lära
sig vad en kö är. Och platsen är dessutom exakt det som avgör den enda fråga som spelar roll när
man står vid pappershögen: **kan jag släppa det här papperet?**

### 6.2 Två spår, inte en kedja

Planens bärande asymmetri är att **bilderna är oåterkalleliga, tolkningen är det inte.** Den
asymmetrin måste finnas i språket, annars konkurrerar en sak som aldrig kan bli fel om
uppmärksamheten med en sak som kan bli katastrofalt fel.

| | **Spår 1 — Förvaring** | **Spår 2 — Läsning** |
| --- | --- | --- |
| Handlar om | var bilderna finns | vad som står på dem |
| Går fel | oåterkalleligt | aldrig — kan köras om mot lagrade bilder |
| Brådskar | ja, papperet ligger i handen | nej, timmar eller dagar spelar ingen roll |
| Ton | den enda yta som får vara högljudd | tyst |
| Visas i | mobilläget **och** datorläget | **bara** datorläget |

**Följd: mobilläget visar aldrig spår 2.** Att en bild "tolkas" eller "är utläst" är brus vid
köksbordet med högen framför sig — det är information för den som sitter vid datorn och rättar.
Mobillägets enda jobb är att svara på om kvittot är framme.

#### Spår 1 — Förvaring

| Tillstånd | Tecken | Rad (några ord) | Mening (egen vy) |
| --- | --- | --- | --- |
| Bara i telefonen | `○` | **Bara i telefonen** | "Bilderna finns bara här i telefonen. Behåll papperet." |
| Skickas nu | `◐` | **Skickas** | "Skickar bild 2 av 3 till arkivet." |
| Ligger kvar, inget nät | `◌` | **Väntar på nät** | "Ingen kontakt med arkivet just nu. Kvittot ligger kvar i telefonen och skickas av sig självt när nätet kommer tillbaka." |
| **I arkivet** | `●` | **I arkivet** | "Kvittot ligger i arkivet, med 2 bilder." |
| Kom inte fram | `▲` | **Kom inte fram** | "Servern nekade bild 2 — det finns redan en annan bild med det numret. Kvittot ligger kvar i telefonen." |

Den sista raden är serverns `409 conflict` (`server/src/http/receipts.ts`) översatt en gång, på
ett ställe. Notera att den, liksom "Väntar på nät", **avslutas med var bilderna är**. En
felmening som lämnar tvivel om det får någon att fotografera om ett kvitto som redan är slängt.

#### Spår 2 — Läsning

| Tillstånd | Tecken | Rad | Mening |
| --- | --- | --- | --- |
| Inte läst än | `○` | **Inte läst än** | "Bilderna ligger i arkivet. Läsningen görs i bakgrunden — plats 43 av 212 i kön." |
| Läses nu | `◐` | **Läses · 4 s** | "Läser bild 2 av 3." |
| Läst | `●` | **Läst** | "Butik, datum och belopp är utlästa ur bilderna. Ingenting är bekräftat av en människa än." |
| Saknar en uppgift | `▲` | **Saknar datum** | "Datum gick inte att läsa ur bilderna. Butik och belopp finns." |
| Gick inte att läsa | `⊘` | **Gick inte att läsa** | "Läsningen misslyckades tre gånger. Bilderna är oskadda och läsningen kan köras om." |

**`Saknar datum`, aldrig `kräver åtgärd`.** Sidecaren vet vilket fält som fattas. Att skriva ut
namnet gör raden till en instruktion i stället för en kategori och kostar ingenting — och det är
skillnaden mellan en lista man betar av och en lista man öppnar rad för rad för att ta reda på
vad den menar.

#### Spår 3 — Bekräftelse (redan specificerat i §5)

Fältnivå, inte kvittonivå: **maskinläst** / **bekräftat** / **saknas**.

Verbfamiljen håller ihop de tre spåren och är värd att skriva ut, för den är hela
vokabulärens ryggrad:

> **Läsa är maskinens verb. Bekräfta är människans verb. Ligga är kvittots verb.**

Därför heter det aldrig "tolka", "bearbeta" eller "processa" (maskinord utan innebörd för en
människa), och aldrig "synka" (mot vad?).

### 6.3 Teckengrammatiken

Ett enda teckenspråk i hela systemet — samma sex tecken i remsan, i listan och i fältstämpeln
(§5.4). Fyllnadsgraden är hur långt kvittot kommit; formen bryts bara när en människa behövs.

| Tecken | Betyder | Används av |
| --- | --- | --- |
| `○` tom ring | har inte hänt än | Bara i telefonen · Inte läst än · maskinläst fält |
| `◌` streckad ring | pausat, systemet försöker igen självt | Väntar på nät |
| `◐` halvfylld ring | pågår just nu | Skickas · Läses nu |
| `●` fylld ring | klart | I arkivet · Läst · bekräftat fält |
| `▲` triangel | **en människa behövs** | Saknar datum · Kom inte fram |
| `⊘` överstruken ring | finns inte / gick inte | fält som saknas · Gick inte att läsa |

Två regler som gör grammatiken hållbar:

1. **Triangeln är reserverad.** Den är det enda tecken som betyder "gör något", och den får
   därför aldrig användas för att markera att systemet arbetar. Sätts den på något som löser sig
   självt slutar den betyda något inom en vecka.
2. **Formen bär betydelsen, inte färgen.** Alla sex går att skilja åt i gråskala och vid 7 px.
   Färg tillförs först ovanpå, och bara på triangeln.

### 6.4 Tröskeln: "I arkivet"

Av alla tillstånd ovan är **exakt ett** värt att vara högljudd om: övergången till *I arkivet*.
Det är där ansvaret flyttar från telefonen till arkivet, och det är den enda gräns bakom vilken
ett tappat, stulet eller vattenskadat telefonliv inte längre kostar ett kvitto.

Tre följder för formen:

- **Kvitteringen sitter på kvittot, inte på en räknare.** Den ska svara på "kom *det här* fram?".
  En aggregerad siffra i toppraden svarar aldrig på det (§3.10, regel 3).
- **Den använder systemets enda tillåtna blink** — `arrive`-nyckelbildrutan i §3.3, en gång,
  `--dur-slow`. Ingen animation som upprepas: den ska ses en gång per kvitto, inte pulsa.
- **Ordet är detsamma som knappen.** Om avslutsknappen i kameran heter *Lägg i arkivet* och
  kvitteringen heter *I arkivet* sluter språket cirkeln utan att någon behöver läsa. Knappordet
  ägs av UX-designern och flödet — förslaget härifrån är att inte kalla den "Klart", eftersom
  *klar* är tvetydigt i ett system med två spår.

**Om papperet.** Frestelsen är att skriva ut slutsatsen: *"Papperet kan slängas."* Den meningen
får inte stå där ännu. Planens M3-grind är att inget papper slängs förrän en riktig
återställningsövning är gjord, och ett gränssnitt som ger klartecken före den övningen upphäver
grinden i just det ögonblick den är svagast — när fångsten fungerar och högen ligger på bordet.

Förslaget är därför att meningen är **villkorad på en verifierad återställning**, inte på
uppladdningen:

```
före övningen:   "Kvittot ligger i arkivet, med 2 bilder."
efter övningen:  "Kvittot ligger i arkivet, med 2 bilder. Papperet kan slängas."
```

Det kräver att servern rapporterar när en återställning senast verifierades — rimligen ett fält
i `/api/health` bredvid `backupDir`. Det är ett serverbeslut och fattas inte här; noterat som
följdkrav om formuleringen ska användas.

### 6.5 Ord som inte får förekomma

| Förbjuden sträng | Varför | Ersätts av |
| --- | --- | --- |
| `Allt är uppladdat` | Beskriver kön. Och en upplysning om att ingenting har hänt är inte information. | *ingenting alls* |
| `N väntar` | Kön väntar; kvittot *ligger* någonstans. | `N kvitton ligger kvar i telefonen` |
| `0 väntar` | Se ovan. | *ingenting alls* |
| `Synkar` / `Synkroniserar` | Maskinord. Mot vad, och åt vilket håll? | `Skickas` |
| `Klar` / `Klart` / `OK` som **status** | Klar med vad? Systemet har två spår. (Som **knapptext** är "klart" en åtgärd, inte en status — men se §6.4.) | `I arkivet` eller `Läst` |
| `Uppladdning misslyckades` | Låter som att bilden är borta. Den är kvar i telefonen. | `Väntar på nät. Kvittot ligger kvar i telefonen.` |
| `Bearbetas` / `Tolkas` / `Processas` | Maskinens verb om sig själv. | `Läses nu` |
| `Kräver åtgärd` | Vilken åtgärd? | `Saknar datum` |
| `Fel` utan objekt | Vad gick fel, och vad hände med bilden? | mening ur §6.2 |

Listan är avsedd att gå att söka efter i koden när M4 och M7 är byggda.

### 6.6 Krav 3, uppfyllt i platsspråk

Kravet lyder att en räknare visar vad som väntar tills servern kvitterat. Det uppfylls fullt ut —
räknaren finns, står kvar tills kvittensen kommit, och försvinner då. Det som ändras är att den
räknar **kvitton på en plats** i stället för **poster i en kö**: `3 kvitton ligger kvar i
telefonen`. Samma tal, samma livslängd, ett ord som betyder något för den som läser det.

---

### 6.7 Framdrift: regeln

> **Ingen animation utan ett tal bredvid sig.**

En snurra ljuger genom att se likadan ut vid en sekund och vid fyra minuter. På den här burken är
det inte ett teoretiskt problem: planen budgeterar ~1,2 s uppräting + ~1,3 s läsning per bild,
men skriver också ut att **uthållighetstestet över en timme aldrig kördes och att strypningen vid
passiv kylning är omätt**. En snurra döljer exakt det symptom som skulle avslöja det.

Och den andra halvan av regeln:

> **Framdrift räknas i något användaren kan räkna själv: bilder och kvitton. Aldrig i byte,
> aldrig i procent, aldrig i tid.**

*Bild 2 av 3* går att kontrollera mot remsan. *67 %* går inte att kontrollera mot någonting.

### 6.8 Tre former, efter vad systemet faktiskt vet

| Vad systemet vet | Form | Text |
| --- | --- | --- |
| Position i ett känt antal | bestämd stapel + siffra | `Bild 2 av 3` |
| Att det pågår, men inte hur långt | **pulserande** stapel + **stigande sekundräknare** | `Läses · 6 s` |
| Att inget pågår | ingenting | |

Mittenraden är den som brukar bli fel. Två åtgärder, båda billiga:

**Sekundräknaren kan inte ljuga.** Den är en observation, inte en förutsägelse. Och den gör
gränssnittet till ett instrument: när `Läses · 41 s` står på ett jobb som budgeterats till 2,5 s
är det strypningslarmet planen saknar, utan att någon byggt ett larm.

**Pulsen, inte svepet.** Ett svep färdas från vänster till höger och antyder därmed en riktning
mot ett slut som systemet inte känner till — det är en snurra i stapelform. En puls säger "lever,
avstånd okänt", vilket är sant. CSS:en står i §3.4 och är markerad som reviderad där.

Följdvinsten: eftersom **talet** bär informationen och inte rörelsen, kan animationen tas bort
helt under `prefers-reduced-motion` utan att något går förlorat.

### 6.9 Backloggen — framdrift över timmar

Tiotusen kvitton är ~14 timmar enligt planens kalla budget. Där är enheten kvitton, och skattningen
måste vila på **mätt** genomströmning (krav 47), inte på en budget:

```
Backloggen
▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░  1 412 av 10 233 lästa
132 kvitton senaste timmen · 2,4 s per bild
Ungefär 15 timmar kvar i den här takten
```

Tre regler för skattningen:

1. **Frasen "i den här takten" är obligatorisk.** Det är den som gör siffran ärlig när kortet
   stryper sig — och strypningen är omätt.
2. **Den visas inte förrän genomströmning mätts i minst femton minuter.** En skattning ur tre
   kvitton är en gissning med falsk auktoritet.
3. **Den räknar inte ned jämnt.** Den beräknas om ur mätningen och får hoppa. **En skattning som
   hoppar är ärlig; en som tickar mjukt är påhittad.**

Detta är också den enda vyn där siffrorna får uppdateras i realtid under en backloggkörning —
radlistan gör det inte (§3.4).

---

## 7. Ordning att bygga i

1. `styles/tokens.css` (färg, mått **och täthet**) + `base.css` + `utilities.css`, och
   `AppComponent` omgjord till skal med statusremsa (§1.7) och `data-density="compact"` på
   värdelementet. Ingen ny funktion — bara att kedjan färgas och tätheten får en ägare.
2. Knapp, felruta, tomt tillstånd (§3.1, §3.7, §3.6). Tre komponenter, alla behövs av allt annat.
   Statusvokabulären (§6.2) läggs samtidigt som **en fil med de faktiska strängarna** — inte som
   text spridd i mallarna. Det är den enda formen som gör §6.5 sökbar, och som håller när samma
   tillstånd ska visas som ett tecken, några ord och en mening.
3. Kameraöverlägg + segmentremsa + köräknare (§3.8–3.10) → **M4**.
4. Fältrad + konfidens + kvittokort (§3.2, §5, §3.3) → **M6/M7**. Fältpanelen får sitt lokala
   `data-density="comfortable"` här, inte senare (§2.6.3).
5. Arbetslista + sök (§3.4, §3.5) → **M7**. Kontrollera radantalet mot §2.6.4 när listan står
   på en riktig 1080p-skärm — räkningen är gjord på papper.

Punkt 4 är den enda som bör läsas om i sin helhet innan den byggs, och den enda där ett
gränssnittsbeslut kan låsa fast ett produktbeslut som planen med flit lämnat öppet.

---

## 8. Fyra frågor till beställaren

Följande är valda åt dig i det här dokumentet utan att någon frågat. Vart och ett av svaren
nedan **ändrar designen** — de går inte att härleda ur planen eller koden, och de är därför inte
mina att avgöra. Frågorna är rangordnade efter hur mycket som hänger på svaret.

### Fråga 1 — Hur ser en backloggsession ut, och när slängs papperet?

Fotograferar du fyrtio kvitton i rad vid bordet och slänger bunten efteråt, eller ett i taget med
papperet direkt i soporna?

- **Bunt efteråt:** kvitteringen per kvitto blir en liten perifer markering i remsan, och
  tyngdpunkten flyttas till en **avstämning i slutet** — "40 fångade, 40 i arkivet" — som blir
  den enda högljudda ytan i mobilläget. Efter fyrtio upprepningar är en tydlig kvittering per
  kvitto inte trygghet, den är plåga.
- **Ett i taget, papperet direkt i soporna:** kvitteringen måste vara omöjlig att missa **per
  kvitto**, och kameran får inte laddas om för nästa innan servern svarat — annars hinner du
  slänga ett papper vars bild ligger kvar i telefonen. Det gör krav 1:s tre sekunder till en
  hårdare gräns än planen räknat med, eftersom nätet då ligger inne i den mätta vägen.

Detta är den fråga som styr mest i hela §6.

### Fråga 2 — Tittar du på skärmen när du trycker av?

Med en hand, stående, papperet i den andra — är blicken på papperet eller på telefonen i det
ögonblick bilden tas och kvitteringen kommer?

- **På papperet:** den visuella kvitteringen når dig inte, och den ska då vara liten. Den riktiga
  kanalen är **vibration** — en kort stöt när bilden är tagen, en annan när kvittot är i arkivet.
  `navigator.vibrate()` fungerar på en S25. Då designas kvitteringen om från grunden: ljud och
  känsel primärt, syn sekundärt.
- **På skärmen:** den visuella kvitteringen bär ensam, och den måste ligga där blicken redan är —
  vid avtryckaren, inte i toppraden där jag placerat räknaren.

### Fråga 3 — Rättar du fält på telefonen, eller alltid vid datorn?

När ett belopp blir fel — vill du kunna rätta det direkt efter fotot, medan papperet fortfarande
är i handen, eller är rättning alltid ett datorjobb?

- **Alltid vid datorn:** allt i §6.2 står kvar. Mobilläget visar bara spår 1 och blir så enkelt
  som det är designat.
- **På telefonen också:** då bryts en av dokumentets bärande gränser, och två saker följer. Dels
  behöver mobilläget en fältvy, alltså spår 2 (§3.2 på en 48 px-yta med tumtangentbord). Dels
  måste det just fångade kvittot **läsas inom sekunder**, inte ligga bakom tiotusen backloggposter
  i kön — det kräver en förtursfil i jobbkön, vilket är ett serverbeslut i M5. Papperet i handen
  är den enda gången sanningen finns tillgänglig, så argumentet för det är starkt; priset är
  också det.

### Fråga 4 — Vill du se maskinen jobba, eller ska den vara osynlig?

Du är ensam byggare och underhållare i åratal, och den passiva kylningen är omätt. Ska burkens
arbetsläge — genomströmning, kölängd, sekunder per bild — synas på den skärm du använder varje
dag, eller bara när du går och letar efter det?

- **Synligt:** statusremsan (§1.7) bär genomströmning bredvid diskutrymmet, och §6.9 blir en
  permanent yta. Sekundräknaren i §6.8 blir då ditt tidigaste strypningslarm utan extra bygge.
- **Osynligt:** backloggen lyfts ur arbetslistan helt — inte hopfälld som i §3.4, utan till en
  egen vy — och statusremsan säger ingenting om den. Arbetslistan innehåller då bara det som
  faktiskt vill ha en människa, vilket är tre rader i stället för tiotusen.

Skillnaden syns knappt i kod och styr vad du ser varje dag i två år.
