// Scipio - reCAPTCHA iframe handler
// Runs INSIDE the reCAPTCHA iframe because of all_frames + matches
(function() {
  'use strict';

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'solveCaptcha') {
      const checkbox = document.querySelector('.recaptcha-checkbox, #recaptcha-anchor, .rc-anchor');
      if (checkbox) {
        checkbox.click();
        console.log('[Scipio] Clicked reCAPTCHA checkbox inside iframe');
        sendResponse({ clicked: true });
      } else {
        sendResponse({ clicked: false });
      }
      return true;
    }
  });

  // Auto-click on load if we detect we're in a reCAPTCHA frame
  setTimeout(() => {
    const checkbox = document.querySelector('.recaptcha-checkbox, #recaptcha-anchor, .rc-anchor');
    if (checkbox && !checkbox.classList.contains('recaptcha-checkbox-checked')) {
      // Only auto-click if Scipio fill is active (check via storage)
      chrome.storage.local.get('scipio_autofill_active', (data) => {
        if (data.scipio_autofill_active) {
          checkbox.click();
          console.log('[Scipio] Auto-clicked reCAPTCHA checkbox');
          chrome.storage.local.set({ scipio_autofill_active: false });
        }
      });
    }
  }, 1000);
})();
