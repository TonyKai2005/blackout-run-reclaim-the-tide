import type { GameState } from './state';
import type { BotSnapshot, WorldPose } from './world';

export interface SaveEnvelope {
  version: 1;
  savedAt: string;
  state: GameState;
  playerPose: WorldPose;
  robots: BotSnapshot[];
}

export type SaveSlot = 'resume' | 'checkpoint';

const DB_NAME = 'reclaim-the-tide-campaign';
const STORE = 'saves';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open browser save storage.'));
  });
}

export async function readSave(slot: SaveSlot): Promise<SaveEnvelope | null> {
  const db = await openDatabase();
  try {
    return await new Promise<SaveEnvelope | null>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(slot);
      request.onsuccess = () => resolve((request.result as SaveEnvelope | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('Could not read browser save.'));
    });
  } finally {
    db.close();
  }
}

export async function writeSave(slot: SaveSlot, envelope: SaveEnvelope): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(envelope, slot);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not write browser save.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Browser save was interrupted.'));
    });
  } finally {
    db.close();
  }
}
