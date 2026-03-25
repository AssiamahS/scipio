// Scipio - reCAPTCHA iframe handler
// Runs INSIDE the reCAPTCHA iframe because of all_frames + matches
(function() {
  'use strict';

  function tryClick() {
    const checkbox = document.querySelector('.recaptcha-checkbox, #recaptcha-anchor, .rc-anchor');
    if (checkbox && !checkbox.classList.contains('recaptcha-checkbox-checked')) {
      chrome.storage.local.get('scipio_autofill_active', (data) => {
        if (data.scipio_autofill_active) {
          checkbox.click();
          console.log('[Scipio] Auto-clicked reCAPTCHA checkbox inside iframe');
          chrome.storage.local.set({ scipio_autofill_active: false });
        }
      });
    }
  }

  // Poll every 2 seconds for up to 30 seconds
  // The flag gets set when Auto-Fill runs, which may happen after this script loads
  let attempts = 0;
  const interval = setInterval(() => {
    tryClick();
    attempts++;
    if (attempts > 15) clearInterval(interval);
  }, 2000);

  // Also respond to direct messages
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'solveCaptcha') {
      const checkbox = document.querySelector('.recaptcha-checkbox, #recaptcha-anchor, .rc-anchor');
      if (checkbox) {
        checkbox.click();
        console.log('[Scipio] Clicked reCAPTCHA checkbox via message');
        sendResponse({ clicked: true });
      } else {
        sendResponse({ clicked: false });
      }
      return true;
    }
  });
})();
