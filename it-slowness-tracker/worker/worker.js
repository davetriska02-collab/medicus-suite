const ALLOWED_ORIGIN = 'https://davetriska02-collab.github.io';
const GITHUB_REPO = 'davetriska02-collab/medicus-suite';
const GITHUB_API = 'https://api.github.com';
const MAX_BODY_BYTES = 32768;
const MAX_INCIDENTS = 50;
const MAX_NARRATIVE_CHARS = 2000;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
      ...extraHeaders,
    },
  });
}

function formatDuration(seconds) {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  }
  return `${seconds}s`;
}

function containsPII(value) {
  if (typeof value !== 'string') return false;
  return /\bNHS\s*number\b/i.test(value) || /\b\d{10}\b/.test(value);
}

async function handleSubmit(request, env) {
  if (request.headers.get('Origin') !== ALLOWED_ORIGIN) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.startsWith('application/json')) {
    return jsonResponse({ error: 'Unsupported Media Type' }, 415);
  }

  const raw = await request.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'Payload Too Large' }, 413);
  }

  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { session } = parsed;

  if (!session || session.schemaVersion !== 1) {
    return jsonResponse({ error: 'Invalid session.schemaVersion' }, 400);
  }
  if (typeof session.sessionId !== 'string' || session.sessionId.trim() === '') {
    return jsonResponse({ error: 'Invalid session.sessionId' }, 400);
  }
  if (typeof session.site !== 'string' || session.site.trim() === '') {
    return jsonResponse({ error: 'Invalid session.site' }, 400);
  }
  if (typeof session.role !== 'string' || session.role.trim() === '') {
    return jsonResponse({ error: 'Invalid session.role' }, 400);
  }
  if (typeof session.sessionType !== 'string' || session.sessionType.trim() === '') {
    return jsonResponse({ error: 'Invalid session.sessionType' }, 400);
  }
  if (
    typeof session.startedAt !== 'string' ||
    !/^\d{4}/.test(session.startedAt) ||
    !session.startedAt.includes('T')
  ) {
    return jsonResponse({ error: 'Invalid session.startedAt' }, 400);
  }
  if (!Array.isArray(session.incidents) || session.incidents.length > MAX_INCIDENTS) {
    return jsonResponse({ error: 'Invalid session.incidents' }, 400);
  }
  if (
    session.narrative !== undefined &&
    (typeof session.narrative !== 'string' || session.narrative.length > MAX_NARRATIVE_CHARS)
  ) {
    return jsonResponse({ error: 'Invalid session.narrative' }, 400);
  }

  for (const [key, value] of Object.entries(session)) {
    if (containsPII(value)) {
      return jsonResponse({ error: 'PII detected — do not include patient identifiers' }, 422);
    }
  }

  const dateStr = session.startedAt.slice(0, 10);
  const incidentCount = session.incidentCount ?? session.incidents.length;
  const lostSeconds = session.totalLostSeconds ?? 0;
  const title = `session ${dateStr} ${session.site} ${session.role} ${session.sessionType} (${incidentCount} incidents, ${formatDuration(lostSeconds)} lost)`;
  const body = '```json\n' + JSON.stringify(session, null, 2) + '\n```';
  const labels = [
    'session',
    'site:' + session.site,
    'role:' + session.role,
    'sessiontype:' + session.sessionType,
  ];

  const githubHeaders = {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    'User-Agent': 'it-slowness-tracker-worker',
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  const createRes = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/issues`, {
    method: 'POST',
    headers: githubHeaders,
    body: JSON.stringify({ title, body, labels }),
  });

  if (createRes.status !== 201) {
    return jsonResponse({ ok: false, error: `GitHub API error: ${createRes.status}` }, 502);
  }

  const created = await createRes.json();
  const issueNumber = created.number;

  await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: githubHeaders,
    body: JSON.stringify({ state: 'closed' }),
  });

  return jsonResponse({ ok: true, issueNumber });
}

export default {
  async fetch(request, env) {
    const { method } = request;
    const url = new URL(request.url);
    const { pathname } = url;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (method === 'POST' && pathname === '/submit') {
      return handleSubmit(request, env);
    }

    return jsonResponse({ error: 'Not Found' }, 404);
  },
};
