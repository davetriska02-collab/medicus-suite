// Pure id helper — kept out of store.js so rota/engine/ can import it
// without pulling chrome.storage / localStorage.

let counter = 0;
export function uid() {
  counter = (counter + 1) % 1296;
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + counter.toString(36);
}
