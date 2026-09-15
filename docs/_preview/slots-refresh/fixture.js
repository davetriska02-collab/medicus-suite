'use strict';

const LOOKS = {
  baseline: { file: 'looks/baseline.css', label: 'Baseline — current Slots', theme: 'light' },
  a: { file: 'looks/a.css', label: 'Option A — Clean Swiss', theme: 'light' },
  b: { file: 'looks/b.css', label: 'Option B — Dense dashboard', theme: 'light' },
  c: { file: 'looks/c.css', label: 'Option C — Soft modern', theme: 'light' },
  d: { file: 'looks/d.css', label: 'Option D — Clinical dark', theme: 'dark' },
  e: { file: 'looks/e.css', label: 'Option E — Paper ledger', theme: 'light' },
};

const params = new URLSearchParams(location.search);
const key = (params.get('look') || 'baseline').toLowerCase();
const look = LOOKS[key] || LOOKS.baseline;

document.documentElement.dataset.look = LOOKS[key] ? key : 'baseline';
document.documentElement.dataset.theme = look.theme;
document.getElementById('lookSheet').href = look.file;
document.getElementById('lookBanner').textContent = look.label;
document.title = look.label + ' — Slots refresh';

if (params.get('shot') === '1') {
  document.documentElement.dataset.shot = '1';
}

document.querySelectorAll('.look-switcher a').forEach((a) => {
  const hrefLook = new URL(a.href, location.href).searchParams.get('look');
  if (hrefLook === key || (key === 'baseline' && hrefLook === 'baseline')) {
    a.classList.add('is-current');
  }
});
