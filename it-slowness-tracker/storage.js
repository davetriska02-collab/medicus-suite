const QUEUE_KEY = 'itslowness.queue';
const PAT_KEY   = 'itslowness.pat';

function formatDuration(seconds) {
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function loadQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // quota exceeded — silently ignore
  }
}

function enqueue(session) {
  const queue = loadQueue();
  queue.push(session);
  saveQueue(queue);
}

async function submitOne(session, config) {
  if (config.storageMode === 'worker') {
    return submitViaWorker(session, config);
  }
  if (config.storageMode === 'direct-pat') {
    return submitViaPat(session, config);
  }
  throw new Error(`Unknown storageMode: "${config.storageMode}"`);
}

async function submitViaWorker(session, config) {
  const res = await fetch(config.workerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session }),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    throw new Error(data.error || res.statusText || `HTTP ${res.status}`);
  }

  return { ok: true, issueNumber: data.issueNumber ?? null };
}

async function submitViaPat(session, config) {
  const pat = localStorage.getItem(PAT_KEY);
  if (!pat) {
    throw new Error('No PAT configured. Visit /admin/ to set one.');
  }

  const title = [
    'session',
    session.startedAt.slice(0, 10),
    session.site,
    session.role,
    session.sessionType,
    `(${session.incidentCount} incidents, ${formatDuration(session.totalLostSeconds)} lost)`,
  ].join(' ');

  const body = '```json\n' + JSON.stringify(session, null, 2) + '\n```';

  const labels = [
    'session',
    `site:${session.site}`,
    `role:${session.role}`,
    `sessiontype:${session.sessionType}`,
  ];

  const createRes = await fetch(
    `https://api.github.com/repos/${config.fallbackRepo}/issues`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ title, body, labels }),
    }
  );

  let issueData;
  try {
    issueData = await createRes.json();
  } catch {
    issueData = {};
  }

  if (createRes.status !== 201) {
    throw new Error(
      issueData.message || createRes.statusText || `HTTP ${createRes.status}`
    );
  }

  await fetch(issueData.url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${pat}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ state: 'closed' }),
  });

  return { ok: true, issueNumber: issueData.number };
}

async function drainQueue(config) {
  const queue = loadQueue();
  if (queue.length === 0) return;

  const remaining = [];
  for (const session of queue) {
    try {
      await submitOne(session, config);
    } catch {
      remaining.push(session);
    }
  }
  saveQueue(remaining);
}

export async function submit(session, config) {
  try {
    const result = await submitOne(session, config);
    await drainQueue(config);
    return result;
  } catch (err) {
    enqueue(session);
    return { ok: false, queued: true, error: err.message };
  }
}
