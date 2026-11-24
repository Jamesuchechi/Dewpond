import { validateRecipeJson, type Recipe } from '@dewpond/recipe';
import { wipeServiceWorkerCaches } from './swClient';

const IDB_NAME = 'dewpond-workspace-v1';
const IDB_STORE = 'recipes';
const IDB_KEY = 'active-session';
const OPFS_DIR_NAME = 'dewpond-snapshots';
const OPFS_RECIPE_FILE = 'workspace-snapshot.dew.json';

export interface PersistedWorkspaceSnapshot {
  recipe: Recipe;
  tableName: string | null;
  demoRows?: number;
  savedAt: number;
}

export interface OpfsCapability {
  available: boolean;
  reason?: string;
}

function openWorkspaceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable in this browser context.'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB.'));
  });
}

export async function saveRecipeToIndexedDb(snapshot: PersistedWorkspaceSnapshot): Promise<void> {
  try {
    const db = await openWorkspaceDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(snapshot, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed.'));
    });
    db.close();
  } catch {
    // Non-fatal in restricted/private-mode contexts
  }
}

export async function loadRecipeFromIndexedDb(): Promise<PersistedWorkspaceSnapshot | null> {
  try {
    const db = await openWorkspaceDb();
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed.'));
    });
    db.close();

    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Partial<PersistedWorkspaceSnapshot>;
    const validated = validateRecipeJson(record.recipe);
    if (!validated.ok) return null;

    return {
      recipe: validated.recipe,
      tableName: typeof record.tableName === 'string' ? record.tableName : null,
      demoRows: typeof record.demoRows === 'number' ? record.demoRows : undefined,
      savedAt: typeof record.savedAt === 'number' ? record.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function detectOpfsCapability(): Promise<OpfsCapability> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    return { available: false, reason: 'OPFS API unavailable; running in :memory: mode.' };
  }
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR_NAME, { create: true });
    const probe = await dir.getFileHandle('.probe', { create: true });
    const w = await probe.createWritable();
    await w.write('ok');
    await w.close();
    await dir.removeEntry('.probe');
    return { available: true };
  } catch {
    return {
      available: false,
      reason: 'OPFS blocked (e.g. private window); using :memory: + IndexedDB fallback.',
    };
  }
}

export async function saveOpfsSnapshot(snapshot: PersistedWorkspaceSnapshot): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR_NAME, { create: true });
    const file = await dir.getFileHandle(OPFS_RECIPE_FILE, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(snapshot, null, 2));
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export async function loadOpfsSnapshot(): Promise<PersistedWorkspaceSnapshot | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR_NAME, { create: false });
    const file = await dir.getFileHandle(OPFS_RECIPE_FILE, { create: false });
    const text = await (await file.getFile()).text();
    const parsed = JSON.parse(text) as Partial<PersistedWorkspaceSnapshot>;
    const validated = validateRecipeJson(parsed.recipe);
    if (!validated.ok) return null;
    return {
      recipe: validated.recipe,
      tableName: typeof parsed.tableName === 'string' ? parsed.tableName : null,
      demoRows: typeof parsed.demoRows === 'number' ? parsed.demoRows : undefined,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export async function wipeAllLocalPersistence(): Promise<void> {
  await wipeServiceWorkerCaches();

  if (typeof indexedDB !== 'undefined') {
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(IDB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  }

  if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(OPFS_DIR_NAME, { recursive: true });
    } catch {
      // Directory may not exist
    }
  }
}
