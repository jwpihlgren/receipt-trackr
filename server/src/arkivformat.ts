/**
 * Krav 55: arkivet ska gå att förstå av en människa som hittar disken om tio år,
 * utan tillgång till koden. Filen skrivs därför *in i arkivet*, inte i repot, och
 * skrivs om vid varje start så att den aldrig beskriver en äldre version än den som
 * faktiskt körs. Den skiljer noga på vad formatet är och vad den här versionen
 * hunnit skriva — en beskrivning av något som inte finns är värre än ingen alls.
 */
import { writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { VERSION } from "./version.js";

export const ARKIVFORMAT_FILE = "ARKIVFORMAT.md";

function document(): string {
  return `# Arkivformat

Skrivet automatiskt av receipt-trackr ${VERSION}. Ändringar här skrivs över vid nästa
start — beskrivningen hör ihop med koden som körs.

Det här är ett privat kvittoarkiv. **Bilderna är oåterkalleliga, tolkningen är det inte.**
Papperet är slängt; texten, fälten och taggarna kan alltid räknas om från bilderna.

## Var saker ligger

\`\`\`
receipts/<år>/<månad>/<ULID>/
    segment-01.jpg      exakta bytes från kameran, orörda
    segment-02.jpg      långa kvitton fotograferas i flera segment
    receipt.json        sanningen om kvittot: fält, konfidens, rättelser, råtext
    derived/            tumnaglar och annat härlett — får slängas när som helst
index.sqlite            härlett sökindex, byggs om från receipts/ med \`reindex\`
\`\`\`

Katalognamnet är en ULID: sorterbar i tidsordning, och tidpunkten är när kvittot
fångades. Ingenting utanför \`receipts/\` är sanning — försvinner \`index.sqlite\` byggs
det om, och inget går förlorat.

## Om du bara vill läsa arkivet

Varje \`receipt.json\` är vanlig JSON i UTF-8 och går att öppna i vilken texteditor som
helst. Fältet \`text\` innehåller hela den utlästa texten radbruten, vilket räcker för
att söka med \`grep\` om ingen mjukvara finns kvar:

\`\`\`sh
grep -rl "kakel" receipts/ | head
\`\`\`

Bilderna är vanliga JPEG-filer och kräver ingenting alls.

## Skrivordningen, om du någonsin ska reparera något

\`receipt.json\` skrivs alltid först, och atomiskt: till en temporärfil, som synkas
mot disken och därefter byts in med \`rename\`. Först när det gått igenom uppdateras
\`index.sqlite\`. Kraschar maskinen däremellan är disken korrekt och indexet
efterblivet — kör om indexeringen, så är de i takt igen. Det omvända kan inte inträffa.

## Vad den här versionen skriver

Version ${VERSION} lagrar kvitton: segmentbilder, sidecar, tumnaglar och sökindex.
Fälten (\`fields\`) och råtexten (\`text\`) fylls först när textutläsningen finns på
plats, så de står tomma tills vidare.
`;
}

/** Atomiskt: tmp → rename. Aldrig en halvskriven beskrivning av arkivet. */
export async function writeArkivformat(dataDir: string): Promise<string> {
  const target = join(dataDir, ARKIVFORMAT_FILE);
  const tmp = `${target}.tmp-${process.pid}`;
  await writeFile(tmp, document(), "utf8");
  await rename(tmp, target);
  return target;
}
