// Practice sync over a shared-drive folder (File System Access API).
// Every GP practice has a shared drive; the rota lives there as a single
// versioned JSON file. Each client reads on a poll and writes after local
// changes (read-modify-write, last writer wins, version monotonically
// increasing). No server, no third party — the data never leaves the
// practice's own storage.

const FILE_NAME = 'medicus-rota-sync.json';
const DB_NAME = 'rota-sync';
const DB_STORE = 'handles';

let dirHandle = null;
let lastVersion = 0;
let pollTimer = null;
let pushTimer = null;

/* tiny IndexedDB promise helpers (directory handles are structured-cloneable) */
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(DB_STORE).objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDel(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export function isSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function status() {
  return { connected: Boolean(dirHandle), version: lastVersion };
}

// User gesture required: pick the shared folder once per machine.
export async function connect() {
  dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  await idbSet('dir', dirHandle);
  return true;
}

// On startup: restore the stored handle. Returns true (ready),
// 'needs-permission' (handle stored but Chrome wants a gesture), or false.
export async function restore() {
  try {
    const stored = await idbGet('dir');
    if (!stored) return false;
    dirHandle = stored;
    const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return true;
    return 'needs-permission';
  } catch {
    return false;
  }
}

export async function requestPermission() {
  if (!dirHandle) return false;
  return (await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted';
}

export async function disconnect() {
  dirHandle = null;
  lastVersion = 0;
  stopPolling();
  await idbDel('dir');
}

async function readRemote() {
  try {
    const fh = await dirHandle.getFileHandle(FILE_NAME);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null; // no file yet, or unreadable
  }
}

// Push local data: read-modify-write so the version always increments
// past whatever is currently in the folder.
export async function push(scopes, by) {
  if (!dirHandle) return null;
  const remote = await readRemote();
  const version = ((remote && remote.version) || lastVersion) + 1;
  const fh = await dirHandle.getFileHandle(FILE_NAME, { create: true });
  const writable = await fh.createWritable();
  await writable.write(
    JSON.stringify({
      format: 1,
      product: 'medicus-rota-manager',
      version,
      updatedAt: new Date().toISOString(),
      updatedBy: by || '',
      scopes,
    })
  );
  await writable.close();
  lastVersion = version;
  return version;
}

// Pull: returns the remote document only when it is newer than what this
// client has already seen.
export async function pull() {
  if (!dirHandle) return null;
  const remote = await readRemote();
  if (remote && remote.version > lastVersion) {
    lastVersion = remote.version;
    return remote;
  }
  return null;
}

export function markSeen(version) {
  if (version > lastVersion) lastVersion = version;
}

export function schedulePush(fn, delayMs = 1500) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(fn, delayMs);
}

export function startPolling(fn, seconds = 15) {
  stopPolling();
  pollTimer = setInterval(fn, seconds * 1000);
}

export function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}
