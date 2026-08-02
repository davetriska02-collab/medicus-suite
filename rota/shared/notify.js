// Best-effort browser notifications: chrome.notifications in the extension
// (permission declared in the manifest), web Notification API in a plain
// dev tab. Never throws — a missed notification must not break the app.

export async function notify(title, message) {
  try {
    if (typeof chrome !== 'undefined' && chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
        title,
        message,
      });
      return;
    }
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'default') await Notification.requestPermission();
      if (Notification.permission === 'granted') new Notification(title, { body: message });
    }
  } catch {
    /* best effort only */
  }
}
