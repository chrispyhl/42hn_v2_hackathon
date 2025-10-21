// Content script simplified: no click detection or in-page overlays.
// All prompting is handled by background polling based on /me/events diffs.

(function() {
  try {
    console.debug('[42 Calendar Sync] content script (simple) on', location.href);
  } catch {}

  // Optional page-level instrumentation is opt-in via options toggle
  try {
    chrome.storage.local.get('ics_enable_hook', (v) => {
      if (!v || !v.ics_enable_hook) return;
      const src = chrome.runtime.getURL('injected.js');
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      (document.head || document.documentElement).appendChild(s);
      s.parentNode && s.parentNode.removeChild(s);
    });
  } catch {}
})();
