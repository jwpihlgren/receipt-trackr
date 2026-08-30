/**
 * Kön på disk i telefonen (krav 2). IndexedDB direkt, utan bibliotek: det är fyra
 * operationer, och ett beroende som ska överleva år av lågintensivt underhåll ska
 * bära mer än så.
 *
 * Två lager, och skillnaden är avsiktlig:
 *   segments — en post per bild, med bytesen. Skrivs innan användaren ser bilden i
 *              remsan, så att ingenting kan gå förlorat mellan avtryckare och disk.
 *   receipts — en post per kvitto, som säger hur många bilder det har när användaren
 *              tryckt "Klart". Utan den kan ett tappat segment inte upptäckas.
 */
const DB_NAME = 'receipt-trackr';
const DB_VERSION = 1;

export type QueuedSegment = {
  /** `${receiptId}:${index}` — gör en omtagen skrivning till en överskrivning. */
  key: string;
  receiptId: string;
  index: number;
  bytes: ArrayBuffer;
  sha256: string;
  capture: Record<string, unknown>;
  /** Sätts när servern svarat med samma sha256. Först då får bytesen kastas. */
  confirmedAt: number | null;
  createdAt: number;
};

export type QueuedReceipt = {
  id: string;
  createdAt: number;
  /** Antalet bilder, satt vid "Klart". `null` medan fångsten pågår. */
  segments: number | null;
  /** Sätts när servern kvitterat komplettsignalen. */
  completedAt: number | null;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('segments')) {
        const store = db.createObjectStore('segments', { keyPath: 'key' });
        store.createIndex('receiptId', 'receiptId');
      }
      if (!db.objectStoreNames.contains('receipts')) {
        db.createObjectStore('receipts', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB gick inte att öppna.'));
  });
}

/**
 * Anslutningen delas.
 *
 * `open()` per operation gav en ny anslutning var femtonde sekund som aldrig stängdes,
 * och varje öppen anslutning blockerar dessutom en framtida höjning av DB_VERSION.
 * `onversionchange` stänger vår anslutning när en annan flik vill uppgradera, och
 * nästa anrop öppnar en ny.
 */
let anslutning: Promise<IDBDatabase> | null = null;

function delad(): Promise<IDBDatabase> {
  anslutning ??= open().then((db) => {
    db.onversionchange = () => {
      db.close();
      anslutning = null;
    };
    db.onclose = () => {
      anslutning = null;
    };
    return db;
  });
  return anslutning;
}

async function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await delad();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = run(transaction.objectStore(store));
    // Vid skrivning väntar vi på transaktionen, inte på anropet: det är först när
    // transaktionen fullbordats som bytesen faktiskt ligger kvar efter en krasch.
    transaction.oncomplete = () => resolve(request.result);
    transaction.onerror = () => reject(transaction.error ?? new Error('Skrivningen misslyckades.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Skrivningen avbröts.'));
  });
}

export const putSegment = (segment: QueuedSegment): Promise<unknown> =>
  tx('segments', 'readwrite', (s) => s.put(segment));

export const putReceipt = (receipt: QueuedReceipt): Promise<unknown> =>
  tx('receipts', 'readwrite', (s) => s.put(receipt));

export const allSegments = (): Promise<QueuedSegment[]> =>
  tx('segments', 'readonly', (s) => s.getAll() as IDBRequest<QueuedSegment[]>);

export const allReceipts = (): Promise<QueuedReceipt[]> =>
  tx('receipts', 'readonly', (s) => s.getAll() as IDBRequest<QueuedReceipt[]>);

export const deleteSegment = (key: string): Promise<unknown> =>
  tx('segments', 'readwrite', (s) => s.delete(key));

export const deleteReceipt = (id: string): Promise<unknown> =>
  tx('receipts', 'readwrite', (s) => s.delete(id));
