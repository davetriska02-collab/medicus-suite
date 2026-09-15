# Slots refresh — visual exploration

Throwaway fixtures. Same Slots information architecture, six looks.

Fake clinic data only. No patient records.

## Looks

| File | Name |
|---|---|
| `baseline.png` | Current Slots |
| `a.png` | Option A — Clean Swiss |
| `b.png` | Option B — Dense dashboard |
| `c.png` | Option C — Soft modern |
| `d.png` | Option D — Clinical dark |
| `e.png` | Option E — Paper ledger |

## Rerun

```bash
npm install --no-save playwright@1.56.1
node docs/_preview/slots-refresh/shoot.mjs
```

Open `fixture.html?look=a` (or `baseline` / `b` / `c` / `d` / `e`) in a 400px frame.
Add `&shot=1` to hide the switcher.

Product CSS is linked, not copied. Look forks live in `looks/*.css` only.
