// Renders the availability setup canvas with fictional names and saves PNGs.
// Not part of the extension. No patient data.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const setup = await import(pathToFileURL(join(root, 'shared/availability-setup-core.js')).href);
const canvas = await import(pathToFileURL(join(root, 'availability/setup-canvas.js')).href);
const core = await import(pathToFileURL(join(root, 'shared/availability-board-core.js')).href);

function slot(id, type, session, clinician) {
  return {
    id,
    startMs: 1,
    endMs: 2,
    slotType: type,
    sessionName: session,
    sessionHaystack: `${session} ${type} ${clinician}`,
    clinician,
    roleHints: [],
    site: 'Example Surgery',
    delivery: 'face to face',
  };
}

function many(n, build) {
  return Array.from({ length: n }, (_, i) => build(i));
}

const tiles = [
  {
    id: 'otd-gp',
    label: 'On-the-day GP',
    matchOrder: 0,
    displayOrder: 1,
    subtitle: 'On the day',
    showOnToday: true,
    match: { types: ['same day gp'], sessions: ['duty'], roles: [] },
  },
  {
    id: 'nursing',
    label: 'Nursing / HCA',
    matchOrder: 1,
    displayOrder: 2,
    subtitle: 'Nurse and HCA',
    showOnToday: true,
    match: { types: ['practice nurse'], sessions: [], roles: ['nurse'] },
  },
  {
    id: 'registrar',
    label: 'Registrar',
    matchOrder: 2,
    displayOrder: 3,
    subtitle: 'Registrar list',
    showOnToday: true,
    weekLane: 'routine',
    match: { types: ['book ahead clinic'], sessions: [], roles: [] },
  },
  {
    id: 'routine-gp',
    label: 'Routine GP',
    matchOrder: 3,
    displayOrder: 4,
    subtitle: 'Pre-bookable',
    showOnToday: true,
    weekLane: 'routine',
    match: { types: ['book ahead clinic', 'routine review'], sessions: [], roles: [] },
  },
];

const slots = [
  ...many(6, (i) => slot(`a${i}`, 'Same-day GP', 'Duty', 'Dr Example')),
  ...many(4, (i) => slot(`b${i}`, 'Practice nurse', 'Morning list', 'Nurse Example')),
  ...many(3, (i) => slot(`c${i}`, 'Asthma clinic', 'Morning list', 'Dr Example')),
  slot('d0', 'Baby clinic', 'Afternoon list', 'Dr Example'),
  ...many(2, (i) => slot(`e${i}`, 'Routine review', 'Afternoon list', 'Dr Example')),
  ...many(2, (i) => slot(`f${i}`, 'Book ahead clinic', 'Afternoon list', 'Registrar Example')),
];

const observed = {
  slotTypes: ['Same-day GP', 'Practice nurse', 'Asthma clinic', 'Baby clinic', 'Routine review', 'Book ahead clinic', 'GP'],
  sessions: ['Duty', 'Morning list', 'Afternoon list'],
  clinicians: ['Dr Example', 'Nurse Example', 'Registrar Example'],
};

const config = core.normaliseConfig({ confirmed: true, pollMinutes: 5, tiles });
const view = setup.setupView(config, observed, slots, { query: '', kind: 'all' });
const outDir = process.argv[2] || '/opt/cursor/artifacts/availability-setup';
mkdirSync(outDir, { recursive: true });

function page(theme, colorblind, body) {
  const cb = colorblind ? ` data-colorblind="true"` : '';
  return `<!doctype html>
<html lang="en" data-theme="${theme}"${cb}>
  <head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="${pathToFileURL(join(root, 'design-system/src/tokens.css')).href}" />
    <link rel="stylesheet" href="${pathToFileURL(join(root, 'availability/wall.css')).href}" />
    <style>
      html, body { height: 100%; margin: 0; background: var(--bg-deep); }
    </style>
  </head>
  <body>
    <div class="av-editor">
      <div class="av-editor-card" role="dialog" aria-labelledby="avEditorTitle">
        <h2 id="avEditorTitle">Tile mapping</h2>
        <p class="av-editor-lead">Drag a slot type, a session, or a diary onto one tile. Or choose the tile under Move. Each name belongs on one tile. Pattern rules stay available for names that are not in the list. The wall does not change until you press Save.</p>
        ${body}
        <p class="av-editor-status" role="status"></p>
        <div class="av-editor-actions">
          <button type="button" class="av-btn">Add tile</button>
          <button type="button" class="av-btn">Suggested names</button>
          <button type="button" class="av-btn">Undo</button>
          <button type="button" class="av-btn av-btn-primary">Save</button>
          <button type="button" class="av-btn">Close</button>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

const asthma = view.palette.find((chip) => chip.name === 'Asthma clinic');
const shots = [
  ['light-mapped-unmapped', 'light', false, view, ['rules:nursing']],
  ['dark-mapped-unmapped', 'dark', false, view, ['rules:nursing']],
  ['light-mid-drag', 'light', false, { ...view, draggingId: asthma && asthma.id, dragOver: 'nursing' }, []],
  ['dark-mid-drag', 'dark', false, { ...view, draggingId: asthma && asthma.id, dragOver: 'nursing' }, []],
  ['light-colorblind', 'light', true, view, []],
];

for (const [name, theme, colorblind, state, openDetails] of shots) {
  const htmlPath = join(outDir, `${name}.html`);
  const pngPath = join(outDir, `${name}.png`);
  writeFileSync(htmlPath, page(theme, colorblind, canvas.renderSetup({ ...state, openDetails })));
  const shot = spawnSync(
    '/opt/google/chrome/chrome',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--user-data-dir=/tmp/av-setup-chrome-profile`,
      '--window-size=1440,1100',
      `--screenshot=${pngPath}`,
      pathToFileURL(htmlPath).href,
    ],
    { encoding: 'utf8', timeout: 20000 }
  );
  if (shot.status !== 0) {
    console.error(shot.stdout);
    console.error(shot.stderr);
    process.exit(shot.status || 1);
  }
  console.log(pngPath);
}
