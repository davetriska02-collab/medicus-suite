# Triage queue next — mocks

Static visual spec for the three Wednesday-morning moves on the request queue.
Not loaded by the extension.

- **[PLAN.md](./PLAN.md)** — constraints, composition rules, hazards, build order
- **[mock.html](./mock.html)** — nine frames; open in a browser, or `?shot=pulse-scan`

Frames: `today` · `pulse-scan` · `pulse-why` · `act-stage` · `act-confirm` · `thread` · `silent` · `composed` · `colorblind`

To recapture PNGs (needs `playwright-core` + Chrome):

```
node docs/design/triage-queue-next/screenshot.mjs /tmp/triage-shots
```
