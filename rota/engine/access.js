// Passcode access gate — the PURE half.
//
// WHAT THIS IS HONESTLY FOR: a workflow gate. The practice owner's ask was
// "really just partners and managers should be using it, otherwise chaos" —
// this stops a receptionist casually editing the rota on a shared machine. It
// is NOT cryptographic protection: the whole app is a Chrome extension whose
// state lives in chrome.storage.local, and anyone with devtools on this browser
// profile can read every rota.* key, including this one. The settings UI says
// so in those words; do not let the copy drift into claiming more.
//
// What the hashing DOES buy: the passcode itself is never stored, so it cannot
// be read out of a backup file or the practice's shared sync folder and reused
// on another machine (or, more realistically, on the many other places people
// reuse passcodes).
//
// PURE: no DOM, no chrome.*, no fetch. globalThis.crypto.subtle is a platform
// primitive available in both the browser and node >= 18, so this module is
// importable and testable in node exactly like the rest of rota/engine/.

// Read once, lazily-guarded: a context without WebCrypto should fail loudly at
// the call, not blow up at import time and take the whole app's module graph
// with it.
const subtle = globalThis.crypto && globalThis.crypto.subtle;

export const KDF = 'PBKDF2-SHA256';
export const DEFAULT_ITERATIONS = 150000;
const SALT_BYTES = 16;
const HASH_BITS = 256;

function bytesToB64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64ToBytes(b64) {
  const binary = atob(String(b64));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// A fresh random salt, base64. The one non-deterministic export.
export function newSalt() {
  const buf = new Uint8Array(SALT_BYTES);
  globalThis.crypto.getRandomValues(buf);
  return bytesToB64(buf);
}

// PBKDF2-SHA-256 over the UTF-8 bytes of the passcode. TextEncoder means a
// unicode passcode ("günther-🔑") hashes by its bytes, not by a lossy
// charCode truncation.
export async function hashPasscode(passcode, saltB64, iterations) {
  if (!subtle) throw new Error('WebCrypto is not available in this context');
  const rounds = Number(iterations) > 0 ? Math.floor(Number(iterations)) : DEFAULT_ITERATIONS;
  const material = await subtle.importKey('raw', new TextEncoder().encode(String(passcode)), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations: rounds, hash: 'SHA-256' },
    material,
    HASH_BITS
  );
  return bytesToB64(new Uint8Array(bits));
}

// Length-independent compare over the two base64 strings.
//
// HONEST LIMITATION: this is "constant-time-ish", not constant-time. It always
// walks the longer string and accumulates rather than returning early, which
// removes the obvious first-differing-character timing signal — but JS string
// indexing, engine optimisation and the surrounding UI make real constant-time
// comparison unachievable here. That is acceptable for this threat model: an
// attacker who can time this function already has script execution in the
// extension's own context, at which point they can simply read the passcode
// config (or the rota) out of chrome.storage.local directly.
function slowEquals(a, b) {
  const x = String(a);
  const y = String(b);
  const n = Math.max(x.length, y.length);
  // charCodeAt past the end is NaN; `| 0` folds that to 0 so the walk never
  // short-circuits on the shorter string. The length XOR keeps "same prefix,
  // different length" a mismatch.
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) | 0) ^ (y.charCodeAt(i) | 0);
  return diff === 0;
}

// True only when the passcode reproduces the stored hash. Never throws: a
// tampered, truncated or wrong-typed access object is a FAILED verification,
// not a crash — an exception here would be a way to get past the gate by
// corrupting storage.
export async function verifyPasscode(passcode, access) {
  try {
    if (!access || typeof access !== 'object' || Array.isArray(access)) return false;
    if (typeof access.salt !== 'string' || typeof access.hash !== 'string') return false;
    if (typeof access.iterations !== 'number' || !Number.isFinite(access.iterations) || access.iterations <= 0) {
      return false;
    }
    if (access.kdf !== undefined && access.kdf !== KDF) return false;
    if (typeof passcode !== 'string' || passcode === '') return false;
    const candidate = await hashPasscode(passcode, access.salt, access.iterations);
    return slowEquals(candidate, access.hash);
  } catch {
    return false;
  }
}

// The full stored shape for rota.access. `enabled` is always true here —
// removing protection stores null, it does not store a disabled record with a
// hash still in it.
export async function makeAccess(passcode, opts) {
  const o = opts || {};
  const salt = newSalt();
  const iterations = Number(o.iterations) > 0 ? Math.floor(Number(o.iterations)) : DEFAULT_ITERATIONS;
  return {
    enabled: true,
    strict: Boolean(o.strict),
    kdf: KDF,
    iterations,
    salt,
    hash: await hashPasscode(passcode, salt, iterations),
    hint: typeof o.hint === 'string' ? o.hint : '',
    updatedAt: new Date().toISOString(),
  };
}

// Everything the UI is allowed to know about the stored config — deliberately
// no salt, hash or iteration count, so a summary can be rendered anywhere
// without carrying the credential material along with it.
export function accessSummary(access) {
  const ok = Boolean(access) && typeof access === 'object' && !Array.isArray(access);
  return {
    enabled: ok && Boolean(access.enabled),
    strict: ok && Boolean(access.strict),
    hasHint: ok && typeof access.hint === 'string' && access.hint.trim() !== '',
  };
}
