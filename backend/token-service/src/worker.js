// Medicus Suite — Transactional API token service (Cloudflare Worker)
//
// This is the ONLY place the private signing key ever lives at runtime. It is
// injected as the secret `PRIVATE_KEY_PEM` (see README) — never committed, never
// shipped in the extension bundle.
//
// What it does (the "stamping" service):
//   1. Mints a short-lived signed JWT ("client assertion") with the private key.
//   2. Exchanges that assertion at Medicus's OAuth token endpoint for an
//      access token (OAuth 2.0 client_credentials + private_key_jwt).
//   3. Caches the access token in memory until shortly before it expires.
//   4. Returns the access token to a trusted caller (guarded by CALLER_TOKEN).
//
// The exact issuer/audience/scope values come from the Medicus Transactional API
// docs (the Zendesk "Transactional API" section). They're left as env vars below
// so nothing Medicus-specific is hard-coded — fill them in from the spec.

const CLOCK_SKEW_S = 60; // refresh this many seconds before the token actually expires

// ---- in-memory token cache (per Worker isolate; fine for our volume) ----
let _cached = null; // { accessToken, expiresAt (epoch ms) }

export default {
  async fetch(request, env) {
    // Only POST /token is supported.
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/token') {
      return json({ error: 'not_found' }, 404);
    }

    // --- Guard: this endpoint mints credentials, so it must not be open. ---
    // The caller (extension backend / your service) sends a shared secret.
    const auth = request.headers.get('authorization') || '';
    const presented = auth.replace(/^Bearer\s+/i, '');
    if (!env.CALLER_TOKEN || !timingSafeEqual(presented, env.CALLER_TOKEN)) {
      return json({ error: 'unauthorized' }, 401);
    }

    try {
      const token = await getAccessToken(env);
      return json(token);
    } catch (err) {
      return json({ error: 'token_error', detail: String(err && err.message || err) }, 502);
    }
  },
};

async function getAccessToken(env) {
  // Serve from cache if still fresh.
  if (_cached && Date.now() < _cached.expiresAt - CLOCK_SKEW_S * 1000) {
    return { access_token: _cached.accessToken, cached: true };
  }

  const assertion = await makeClientAssertion(env);

  // OAuth 2.0 client_credentials grant with private_key_jwt client auth.
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
  });
  if (env.SCOPE) body.set('scope', env.SCOPE);

  const resp = await fetch(env.TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`token endpoint ${resp.status}: ${JSON.stringify(data)}`);
  }

  const expiresInS = Number(data.expires_in) || 300;
  _cached = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInS * 1000,
  };
  return { access_token: data.access_token, cached: false };
}

// Build and sign the client-assertion JWT (RS256).
async function makeClientAssertion(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: env.KEY_ID };
  const claims = {
    iss: env.CLIENT_ID,            // who we are
    sub: env.CLIENT_ID,            // subject = the client itself
    aud: env.TOKEN_AUDIENCE,       // who must accept it (per Medicus docs)
    jti: crypto.randomUUID(),      // unique per assertion (replay protection)
    iat: now,
    exp: now + 300,                // short-lived: 5 minutes
  };

  const signingInput =
    base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claims));
  const key = await importPrivateKey(env.PRIVATE_KEY_PEM);
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput)
  );
  return signingInput + '.' + base64urlBytes(new Uint8Array(sig));
}

// ---- helpers ----

async function importPrivateKey(pem) {
  // Strip the PEM armour and base64-decode the PKCS#8 body.
  const b64 = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function base64url(str) {
  return base64urlBytes(new TextEncoder().encode(str));
}

function base64urlBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
