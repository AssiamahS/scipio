// Scipio - Background Service Worker
// Auto-reload extension during development using chrome.alarms (survives MV3 sleep)

const DEV_MODE = true; // Set to false for production

if (DEV_MODE) {
  let lastHash = '';

  async function checkForChanges() {
    try {
      // Fetch content.js + manifest.json from extension bundle
      const [contentRes, manifestRes] = await Promise.all([
        fetch(chrome.runtime.getURL('content.js')),
        fetch(chrome.runtime.getURL('manifest.json'))
      ]);
      const content = await contentRes.text();
      const manifest = await manifestRes.text();
      const hash = content.length + '_' + manifest.length + '_' + content.slice(-200);

      if (lastHash && hash !== lastHash) {
        console.log('[Scipio] File change detected, reloading...');
        chrome.runtime.reload();
      }
      lastHash = hash;
    } catch (e) { /* ignore */ }
  }

  // Use chrome.alarms to stay alive in MV3
  chrome.alarms.create('scipio-dev-reload', { periodInMinutes: 0.05 }); // ~3 seconds
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'scipio-dev-reload') checkForChanges();
  });

  // Also check immediately on startup
  checkForChanges();
  console.log('[Scipio] Dev mode: auto-reload enabled via alarms API');
}

// Listen for version bump messages (from MCP or popup)
chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'reload') {
    chrome.runtime.reload();
    sendResponse({ status: 'reloading' });
  }
});
