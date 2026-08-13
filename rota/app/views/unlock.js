// The unlock screen. Rendered by app.js's router in place of any route this
// tab is not allowed to reach while the passcode gate is engaged — so it has
// to explain WHERE the user is as well as ask for the passcode.
//
// Two shapes, matching the two modes:
//   staff view (strict=false) — the rest of the app is read-only; this screen
//     says what is still available (Rota, My week) so a receptionist who lands
//     here does not think the product is broken.
//   strict — nothing is available until the passcode goes in.
//
// Neither successful nor failed unlocks are audited. On a shared practice
// machine that is noise, and a record of failed attempts is a record of
// people's typing.

import { esc } from '../../shared/esc.js';
import { verifyPasscode, accessSummary } from '../../engine/access.js';

// Long enough that repeated guessing is tedious, short enough that a fat-
// fingered manager is not punished. This is friction, not rate limiting: see
// the honesty note in engine/access.js.
const RETRY_PAUSE_MS = 1500;

export default {
  render(root, ctx) {
    const { state } = ctx;
    const summary = accessSummary(state.access);
    const hint = state.access && typeof state.access.hint === 'string' ? state.access.hint.trim() : '';

    root.innerHTML = `
      <h1>Rota locked</h1>
      <div class="card unlockcard">
        <h2 class="mt0">Enter the practice passcode</h2>
        <p class="sub">
          ${
            summary.strict
              ? 'This rota is passcode-protected. Enter the passcode to open it.'
              : 'This page is for partners and managers. Enter the passcode to edit the rota, approve leave and change settings.'
          }
        </p>
        ${
          summary.strict
            ? ''
            : `<p class="sub">
                Without it you can still use <a href="#rota">Rota</a> to see the week and
                <a href="#me">My week</a> to check your sessions, request leave, propose a swap
                and export your calendar.
              </p>`
        }
        <div class="toolbar mt8">
          <input
            type="password"
            id="u-code"
            autocomplete="current-password"
            placeholder="Passcode"
            style="width:240px"
          >
          <button id="u-go" class="primary">Unlock</button>
        </div>
        ${hint ? `<p class="sub mt8">Hint: ${esc(hint)}</p>` : ''}
        <p class="warn-line" id="u-msg" hidden></p>
        <p class="sub mt12">
          Unlocking lasts for this browser tab only — close it and the rota locks again.
          Forgotten the passcode? It cannot be recovered: it is stored as a one-way hash.
          Wiping the rota data from Settings → Data resets it, and restoring a backup
          restores whatever passcode that backup was taken with.
        </p>
      </div>
    `;

    const input = root.querySelector('#u-code');
    const button = root.querySelector('#u-go');
    const msg = root.querySelector('#u-msg');

    const fail = (text) => {
      msg.textContent = text;
      msg.hidden = false;
      input.select();
      // Soft rate limit: the button goes dead briefly after a wrong answer, so
      // guessing cannot be held down on the Enter key.
      button.disabled = true;
      setTimeout(() => {
        button.disabled = false;
      }, RETRY_PAUSE_MS);
    };

    const attempt = async () => {
      const code = input.value;
      if (!code) {
        fail('Enter the passcode');
        return;
      }
      msg.hidden = true;
      button.disabled = true;
      const ok = await verifyPasscode(code, state.access);
      button.disabled = false;
      if (!ok) {
        fail('Incorrect passcode');
        return;
      }
      input.value = '';
      ctx.unlock();
      ctx.toast('Unlocked for this tab');
    };

    button.onclick = attempt;
    input.onkeydown = (ev) => {
      if (ev.key === 'Enter' && !button.disabled) attempt();
    };
    input.focus();
  },
};
