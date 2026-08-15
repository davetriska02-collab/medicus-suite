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

// A fresh random salt, base64. One of the two non-deterministic exports (the
// other is newRecoveryCode).
export function newSalt() {
  const buf = new Uint8Array(SALT_BYTES);
  globalThis.crypto.getRandomValues(buf);
  return bytesToB64(buf);
}

// ── Recovery code ────────────────────────────────────────────────────────────
//
// WHY: a forgotten passcode used to have exactly one way out — wipe every
// rota.* key from Settings → Data and start again (hazard H-064). The recovery
// code is the non-destructive way back: it is generated when the passcode is
// set, shown ONCE, and stored only as a second PBKDF2 hash beside the passcode
// hash. Entering it on the unlock screen REMOVES the gate so a fresh passcode
// can be set. It never reveals the old passcode, and it does not make any of
// this secure — the honest framing in the header still applies, unchanged.
//
// Human-transcribable on purpose: this gets written on paper and read back by
// somebody else, so the alphabet drops the characters that are misread by hand
// (0/O, 1/I/L) and the code is grouped for reading aloud.
export const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_LENGTH = 10;
const RECOVERY_GROUP = 5;

// A fresh recovery code in display form ('ABCDE-FGHJK'). Rejection sampling,
// not `% alphabet.length` on a raw byte: 256 is not a multiple of 30, so the
// naive modulo would make the first 16 letters of the alphabet more likely.
export function newRecoveryCode() {
  const n = RECOVERY_ALPHABET.length;
  const limit = 256 - (256 % n);
  const chars = [];
  const buf = new Uint8Array(RECOVERY_LENGTH * 2);
  while (chars.length < RECOVERY_LENGTH) {
    globalThis.crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && chars.length < RECOVERY_LENGTH; i++) {
      if (buf[i] >= limit) continue;
      chars.push(RECOVERY_ALPHABET[buf[i] % n]);
    }
  }
  const groups = [];
  for (let i = 0; i < chars.length; i += RECOVERY_GROUP) {
    groups.push(chars.slice(i, i + RECOVERY_GROUP).join(''));
  }
  return groups.join('-');
}

// What is actually hashed: the code with its reading aids removed. Somebody
// reading a code off a sheet types the spaces and dashes where they fall and
// may not use capitals, and none of that should be a failed recovery. A
// non-string is '' — the callers treat that as "no code given", never as a
// match.
export function normaliseRecoveryCode(code) {
  if (typeof code !== 'string') return '';
  return code.replace(/[\s-]+/g, '').toUpperCase();
}

// PBKDF2 over the NORMALISED code, so verification and generation agree about
// what the code is. Own salt, same iteration count as the passcode.
export async function hashRecoveryCode(code, saltB64, iterations) {
  const normalised = normaliseRecoveryCode(code);
  if (normalised === '') throw new Error('A recovery code cannot be empty');
  return hashPasscode(normalised, saltB64, iterations);
}

// Does this stored record carry a usable recovery code? BOTH halves must be
// present and non-empty: a record with only one of them is a record no code can
// satisfy, and the unlock screen must not offer a route that cannot work.
// False for a legacy record written before recovery codes existed — which is
// how those records keep behaving exactly as they always did.
export function hasRecoveryCode(access) {
  return (
    Boolean(access) &&
    typeof access === 'object' &&
    !Array.isArray(access) &&
    typeof access.recoverySalt === 'string' &&
    access.recoverySalt !== '' &&
    typeof access.recoveryHash === 'string' &&
    access.recoveryHash !== ''
  );
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

// True only when the recovery code reproduces the stored recovery hash. Same
// fail-closed discipline as verifyPasscode, and for the same reason: a
// truncated or tampered record is a FAILED recovery, not a crash. A record
// with no recovery hash at all (every record written before v3.233.0) is
// simply false — there is nothing to verify against.
export async function verifyRecoveryCode(code, access) {
  try {
    if (!hasRecoveryCode(access)) return false;
    if (typeof access.iterations !== 'number' || !Number.isFinite(access.iterations) || access.iterations <= 0) {
      return false;
    }
    if (access.kdf !== undefined && access.kdf !== KDF) return false;
    const normalised = normaliseRecoveryCode(code);
    if (normalised === '') return false;
    const candidate = await hashPasscode(normalised, access.recoverySalt, access.iterations);
    return slowEquals(candidate, access.recoveryHash);
  } catch {
    return false;
  }
}

// Attach (or replace) the recovery half of a record. Replacing is what
// invalidates the previous code: its hash is overwritten, so the sheet in the
// safe stops working the moment a new code is issued.
export async function withRecoveryCode(access, code) {
  if (!access || typeof access !== 'object' || Array.isArray(access)) {
    throw new Error('withRecoveryCode needs an access record');
  }
  const iterations = Number(access.iterations) > 0 ? Math.floor(Number(access.iterations)) : DEFAULT_ITERATIONS;
  const recoverySalt = newSalt();
  return {
    ...access,
    recoverySalt,
    recoveryHash: await hashRecoveryCode(code, recoverySalt, iterations),
    recoverySetAt: new Date().toISOString(),
  };
}

// Carry an already-issued recovery code across a passcode CHANGE. The two are
// independent: changing the passcode must not silently invalidate a code the
// practice has already written down and filed. Returns the new record untouched
// when the previous one had no recovery code to carry.
export function carryRecoveryCode(access, previous) {
  if (!access || typeof access !== 'object' || Array.isArray(access)) return access;
  if (!hasRecoveryCode(previous)) return access;
  return {
    ...access,
    recoverySalt: previous.recoverySalt,
    recoveryHash: previous.recoveryHash,
    recoverySetAt: typeof previous.recoverySetAt === 'string' ? previous.recoverySetAt : '',
  };
}

// The full stored shape for rota.access. `enabled` is always true here —
// removing protection stores null, it does not store a disabled record with a
// hash still in it.
//
// opts.recoveryCode is the caller's plaintext recovery code (from
// newRecoveryCode()). It is passed IN rather than generated here so the one
// place that has to show it to a human owns it: this function only ever returns
// hashes.
export async function makeAccess(passcode, opts) {
  const o = opts || {};
  const salt = newSalt();
  const iterations = Number(o.iterations) > 0 ? Math.floor(Number(o.iterations)) : DEFAULT_ITERATIONS;
  const access = {
    enabled: true,
    strict: Boolean(o.strict),
    kdf: KDF,
    iterations,
    salt,
    hash: await hashPasscode(passcode, salt, iterations),
    hint: typeof o.hint === 'string' ? o.hint : '',
    updatedAt: new Date().toISOString(),
  };
  if (typeof o.recoveryCode === 'string' && normaliseRecoveryCode(o.recoveryCode) !== '') {
    return withRecoveryCode(access, o.recoveryCode);
  }
  return access;
}

// Everything the UI is allowed to know about the stored config — deliberately
// no salt, hash or iteration count, so a summary can be rendered anywhere
// without carrying the credential material along with it. hasRecovery is what
// the unlock screen uses to decide whether a "Forgotten passcode?" route exists
// at all on this record.
export function accessSummary(access) {
  const ok = Boolean(access) && typeof access === 'object' && !Array.isArray(access);
  return {
    enabled: ok && Boolean(access.enabled),
    strict: ok && Boolean(access.strict),
    hasHint: ok && typeof access.hint === 'string' && access.hint.trim() !== '',
    hasRecovery: hasRecoveryCode(access),
  };
}
