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
import { verifyPasscode, verifyRecoveryCode, accessSummary } from '../../engine/access.js';

// Long enough that repeated guessing is tedious, short enough that a fat-
// fingered manager is not punished. This is friction, not rate limiting: see
// the honesty note in engine/access.js.
const RETRY_PAUSE_MS = 1500;

// The way back in when the passcode is forgotten (hazard H-064). Only rendered
// when the stored record actually carries a recovery hash — offering the route
// on a record that has none would be a dead end dressed up as an answer.
//
// The code CLEARS the gate rather than revealing the passcode: the passcode is
// a one-way hash and nothing here can undo that. The copy says so, and says
// what the consequence is, before anything is pressed.
const RECOVERY_HTML = `
  <div class="mt12">
    <button id="u-forgot">Forgotten the passcode?</button>
  </div>
  <div id="u-recovery" class="mt8" hidden>
    <p class="sub">
      A recovery code was shown once when this passcode was set, to be written down and kept
      where a second manager can reach it. Enter it here to remove the passcode from this rota.
      It does not show you the old passcode, and you will need to set a new passcode from
      Settings afterwards.
    </p>
    <div class="toolbar mt8">
      <input type="text" id="u-reccode" autocomplete="off" spellcheck="false"
        placeholder="Recovery code" style="width:240px">
      <button id="u-recgo" class="primary">Use recovery code</button>
    </div>
    <p class="warn-line" id="u-recmsg" hidden></p>
    <p class="sub mt8">
      No recovery code? The rota data can be wiped from Settings → Data, which clears the
      passcode along with everything else.
    </p>
  </div>
`;

const RECOVERY_CONFIRM =
  'Use the recovery code? This removes the passcode from this rota. ' +
  'Until you set a new one from Settings, anyone with this browser profile can edit the rota, ' +
  'and if this machine is connected to the practice shared folder the change is shared with it.';

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
          ${
            summary.hasRecovery
              ? 'The passcode itself cannot be recovered: it is stored as a one-way hash.'
              : `Forgotten the passcode? It cannot be recovered: it is stored as a one-way hash.
                 This rota has no recovery code, so the only ways back in are the passcode itself,
                 restoring a backup taken with a passcode somebody still knows, or wiping the rota
                 data from Settings → Data, which clears everything else with it.`
          }
        </p>
        ${summary.hasRecovery ? RECOVERY_HTML : ''}
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

    // ── Recovery code ────────────────────────────────────────────────────────
    const forgot = root.querySelector('#u-forgot');
    if (!forgot) return;
    const panel = root.querySelector('#u-recovery');
    const recInput = root.querySelector('#u-reccode');
    const recButton = root.querySelector('#u-recgo');
    const recMsg = root.querySelector('#u-recmsg');

    forgot.onclick = () => {
      panel.hidden = false;
      forgot.hidden = true;
      recInput.focus();
    };

    // A wrong recovery code fails the same way a wrong passcode does: visibly,
    // and with the same soft pause so it cannot be held down on the Enter key.
    const recFail = (text) => {
      recMsg.textContent = text;
      recMsg.hidden = false;
      recInput.select();
      recButton.disabled = true;
      setTimeout(() => {
        recButton.disabled = false;
      }, RETRY_PAUSE_MS);
    };

    const recover = async () => {
      const code = recInput.value;
      if (!code.trim()) {
        recFail('Enter the recovery code');
        return;
      }
      recMsg.hidden = true;
      recButton.disabled = true;
      const ok = await verifyRecoveryCode(code, state.access);
      recButton.disabled = false;
      if (!ok) {
        recFail('That recovery code is not correct');
        return;
      }
      // Confirmed AFTER verification, so a wrong code never gets as far as
      // asking, and the question names the consequence rather than the action.
      if (!confirm(RECOVERY_CONFIRM)) return;
      recInput.value = '';
      await ctx.recoverAccess();
      ctx.toast('Passcode removed — set a new one in Settings');
    };

    recButton.onclick = recover;
    recInput.onkeydown = (ev) => {
      if (ev.key === 'Enter' && !recButton.disabled) recover();
    };
  },
};
