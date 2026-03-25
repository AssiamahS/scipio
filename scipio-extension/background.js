// Scipio - Background Service Worker
// Auto-reload extension during development

const DEV_MODE = true; // Set to false for production
const RELOAD_INTERVAL = 2000; // Check every 2 seconds

if (DEV_MODE) {
  // Periodically check if content.js has changed by fetching it
  let lastHash = '';

  async function checkForChanges() {
    try {
      const response = await fetch(chrome.runtime.getURL('content.js'));
      const text = await response.text();
      // Simple hash: length + first/last chars
      const hash = text.length + '_' + text.slice(0, 100) + text.slice(-100);
      if (lastHash && hash !== lastHash) {
        console.log('[Scipio] File change detected, reloading extension...');
        chrome.runtime.reload();
      }
      lastHash = hash;
    } catch (e) {
      // ignore
    }
  }

  setInterval(checkForChanges, RELOAD_INTERVAL);
  console.log('[Scipio] Dev mode: auto-reload enabled (checking every ' + RELOAD_INTERVAL + 'ms)');
}
