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

Det är den regeln som gör mörkt läge gratis, gör en temajustering till en femradersändring, och
gör att en person som återvänder efter ett år kan ändra hela systemets uttryck utan att läsa en
enda komponent. Den går att kontrollera med ett `grep` i en pre-commit-hook:

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
  styles/utilities.css  ~10 klasser, se §2.6. Växer inte till ett ramverk
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
  /* Grått rutnät under bilden ser bättre ut än vitt när fotot laddas. */
  -webkit-font-smoothing: antialiased;
}

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

### 2.6 utilities.css

Tio klasser, och listan får inte växa utan att någon frågar sig varför.

```css
/* web/src/styles/utilities.css */
.stack     { display: flex; flex-direction: column; gap: var(--stack-gap, var(--space-3)); }
.row       { display: flex; align-items: center; gap: var(--row-gap, var(--space-2)); }
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
  gap: var(--space-2);
  min-height: var(--tap-min);
  min-width: var(--tap-min);
  padding-inline: var(--space-4);
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
  background: transparent; color: var(--accent); padding-inline: var(--space-3);
}
.btn[data-variant="quiet"]:hover:not(:disabled) { background: var(--accent-soft); }

.btn[data-variant="danger"] {
  background: var(--danger); color: var(--on-danger);
}

/* Storlekar. --size="lg" är mobilens primära åtgärd. */
.btn[data-size="sm"] { min-height: 36px; padding-inline: var(--space-3);
                       font-size: var(--text-sm); }
.btn[data-size="lg"] { min-height: var(--tap-primary); padding-inline: var(--space-5);
                       font-size: var(--text-lg); border-radius: var(--radius-md); }

/* En sm-knapp är under 44 px hög. Den får bara användas i datorläget, och då
   med en osynlig träffyta som tar upp skillnaden. */
.btn[data-size="sm"]::after {
  content: ""; position: absolute; inset: -4px;
}
.btn[data-size="sm"] { position: relative; }

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
  readonly size    = input<'sm' | 'md' | 'lg'>('md');
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
/* field-row.component.css */
:host {
  display: grid;
  grid-template-columns: 5.5rem minmax(0, 1fr) auto;
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
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
  grid-template-columns: 64px minmax(0, 1fr);
  gap: var(--space-4);
  padding: var(--space-4);
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
  inline-size: 64px; block-size: 84px;
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

Tre tillstånd, som servern (`captured` → `interpreting` → `interpreted` / `needs_review`).

```
väntar
┌──────────────────────────────────────────────────────────┐
│ ○  01K5F8…  18:22   2 segment                     väntar │
└──────────────────────────────────────────────────────────┘

bearbetas
┌──────────────────────────────────────────────────────────┐
│ ◐  01K5F8…  18:22   segment 2 av 2                       │
│    ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░                          │
└──────────────────────────────────────────────────────────┘

kräver åtgärd
┌──────────────────────────────────────────────────────────┐
│ ▲  01K5F8…  18:22   totalbelopp saknas       [Öppna]     │
└──────────────────────────────────────────────────────────┘

Listfot (krav 47):
  14 väntar · 1 bearbetas · 3 kräver åtgärd
  Genomströmning senaste timmen: 132 kvitton · 2,4 s per bild
```

```css
/* work-item.component.css */
:host {
  display: grid;
  grid-template-columns: 1.25rem minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--tap-min);
  padding: var(--space-2) var(--space-3);
  border-block-end: 1px solid var(--line);
}

.state-dot { inline-size: 10px; block-size: 10px; border-radius: var(--radius-full);
             justify-self: center; }
:host([data-state="waiting"])   .state-dot { border: 2px solid var(--line-strong); }
:host([data-state="running"])   .state-dot { background: var(--accent); }
:host([data-state="attention"]) .state-dot { background: var(--warn); }

/* Framdriftsspåret sitter under raden och är en grid-radspann, så att raden
   inte hoppar i höjd när den byter tillstånd — spåret finns alltid, tomt. */
.progress {
  grid-column: 2 / -1;
  block-size: 3px;
  border-radius: var(--radius-xs);
  background: var(--conf-track);
  overflow: hidden;
}
.progress__fill {
  block-size: 100%; background: var(--accent);
  inline-size: var(--progress, 0%);
  transition: inline-size var(--dur-base) var(--ease-out);
}

/* Kön vet hur många segment som återstår, men inte hur långt in i ett segment
   OCR:en har kommit. Under ett segment blir stapeln obestämd. */
:host([data-progress="indeterminate"]) .progress__fill {
  inline-size: 35%;
  animation: indet 1400ms var(--ease-both) infinite;
}
@keyframes indet {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(285%); }
}
@media (prefers-reduced-motion: reduce) {
  :host([data-progress="indeterminate"]) .progress__fill { inline-size: 100%; opacity: 0.4; }
}
```

Ordning i listan: **kräver åtgärd överst, sedan bearbetas, sedan väntar**, och inom varje grupp
äldst först. Backloggen är tiotusen rader i "väntar" och får aldrig trycka undan de tre rader
som faktiskt vill ha en människa. Gruppen "väntar" visas hopfälld med en räknare
(`14 233 väntar — visa`) tills någon ber om den.

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
  align-items: center; gap: var(--space-2);
  min-height: var(--tap-comfort);
  padding-inline: var(--space-3);
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
  padding-block: var(--space-3);
  font-size: var(--text-base);
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
│                            │          │  kvitton är ännu inte      │
│      [ Visa QR-kod ]       │          │  tolkade.                  │
└────────────────────────────┘          └────────────────────────────┘

Arbetslistan tom (bra nyhet)            Kvitto utan OCR ännu
┌────────────────────────────┐          ┌────────────────────────────┐
│  Inget väntar.             │          │  Bilderna finns.           │
│  Senast tolkat 14:02.      │          │  Tolkningen ligger i kön,  │
└────────────────────────────┘          │  plats 43 av 212.          │
                                        └────────────────────────────┘
```

Regeln: **ett tomt tillstånd säger vad läget beror på och vad man gör åt det.** Det tredje ovan
är en positiv utsaga, inte ett tomrum. Det fjärde är avgörande — utan det ser ett nyfångat
kvitto ut som ett trasigt kvitto i flera timmar under backloggkörningen.

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

/* Segment som ännu inte kvitterats av servern. Se §3.10 — samma språk. */
.seg[data-pending="true"] img { opacity: 0.55; }
```

Ett borttaget segment tas bort **lokalt före uppladdning**, aldrig efteråt: planen säger att
bilderna är oåterkalleliga och att ingenting gallras automatiskt (krav 36). Har segmentet redan
nått servern är krysset borta och miniatyren låst.

### 3.10 Köräknare

Krav 3: en räknare visar vad som väntar tills servern kvitterat. Den bor i mobillägets topprad
och nämns här för att den delar språk med §3.9.

```
   ↑ 4 väntar          (bricka, --warn-soft, sitter i toppraden)
   ✓ allt uppe         (två sekunder, sedan borta)
```

Den försvinner när kön är tom. En permanent "0 väntar" är brus.

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
/* shell.component.css */
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

| Yta | Golv | Standard |
| --- | --- | --- |
| Mobilläget, allt | 44 px | 48 px (`--tap-comfort`) |
| Mobilläget, primär åtgärd | 56 px (`--tap-primary`) | avtryckaren 76 px |
| Datorläget, pekbart | 44 px | 44 px |
| Datorläget, tät lista med tangentbordsstöd | 36 px synligt | 44 px träffyta via `::after` |

Mönstret när det visuella är mindre än träffytan:

```css
.tight-target { position: relative; }
.tight-target::after {
  content: "";
  position: absolute;
  inset: 50% auto auto 50%;
  translate: -50% -50%;
  min-inline-size: var(--tap-min);
  min-block-size: var(--tap-min);
  inline-size: 100%; block-size: 100%;
}
```

Avstånd mellan två träffytor: minst 8 px (`--space-2`). I segmentremsan och i kamerans
åtgärdsrad minst 16 px, eftersom de används i rörelse med en hand.

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
      case 'missing':   return 'saknas i tolkningen';
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

## 6. Ordning att bygga i

1. `styles/tokens.css` + `base.css` + `utilities.css`, och `AppComponent` omgjord till skal med
   statusremsa (§1.7). Ingen ny funktion — bara att kedjan färgas.
2. Knapp, felruta, tomt tillstånd (§3.1, §3.7, §3.6). Tre komponenter, alla behövs av allt annat.
3. Kameraöverlägg + segmentremsa + köräknare (§3.8–3.10) → **M4**.
4. Fältrad + konfidens + kvittokort (§3.2, §5, §3.3) → **M6/M7**.
5. Arbetslista + sök (§3.4, §3.5) → **M7**.

Punkt 4 är den enda som bör läsas om i sin helhet innan den byggs, och den enda där ett
gränssnittsbeslut kan låsa fast ett produktbeslut som planen med flit lämnat öppet.
