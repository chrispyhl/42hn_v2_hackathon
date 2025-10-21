// Content script to detect 42 event registrations and show inline prompt

(function() {
  const TRY_TEXTS = ['register', 'subscribe', 'anmelden', 'teilnehmen', "s'inscrire", 'inscrire'];

  function extractEventIdFromUrl() {
    const m = location.pathname.match(/\/events\/(\d+)/);
    return m ? m[1] : null;
  }

  function findRegisterCandidates() {
    const elements = Array.from(document.querySelectorAll('button, a, input[type="submit"]'));
    return elements.filter(el => {
      const text = (el.innerText || el.value || '').trim().toLowerCase();
      return TRY_TEXTS.some(t => text.includes(t));
    });
  }

  function createOverlayPrompt(eventId) {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(0,0,0,0.45)';
    overlay.style.zIndex = '999999';

    const box = document.createElement('div');
    box.style.position = 'absolute';
    box.style.left = '50%';
    box.style.top = '30%';
    box.style.transform = 'translate(-50%, -30%)';
    box.style.background = '#fff';
    box.style.color = '#111';
    box.style.padding = '20px';
    box.style.borderRadius = '8px';
    box.style.width = 'min(420px, 90vw)';
    box.style.boxShadow = '0 10px 30px rgba(0,0,0,0.2)';

    const title = document.createElement('div');
    title.textContent = 'Sync to Google Calendar?';
    title.style.fontSize = '18px';
    title.style.fontWeight = '600';

    const subtitle = document.createElement('div');
    subtitle.textContent = 'We detected a new 42 registration. Add this event to your calendar now?';
    subtitle.style.margin = '10px 0 14px 0';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '12px';
    actions.style.justifyContent = 'flex-end';

    const yes = document.createElement('button');
    yes.textContent = 'Add to Calendar';
    yes.style.background = '#1a73e8';
    yes.style.color = '#fff';
    yes.style.border = 'none';
    yes.style.padding = '8px 12px';
    yes.style.borderRadius = '6px';
    yes.style.cursor = 'pointer';

    const no = document.createElement('button');
    no.textContent = 'Not now';
    no.style.background = '#eee';
    no.style.color = '#333';
    no.style.border = 'none';
    no.style.padding = '8px 12px';
    no.style.borderRadius = '6px';
    no.style.cursor = 'pointer';

    actions.append(yes, no);
    box.append(title, subtitle, actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    yes.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'sync_event', eventId }, (res) => {
        // Ignore result in content page, just close
        document.body.removeChild(overlay);
      });
    });
    no.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
  }

  function attach() {
    const candidates = findRegisterCandidates();
    if (candidates.length === 0) return;
    const eventId = extractEventIdFromUrl();

    for (const el of candidates) {
      el.addEventListener('click', () => {
        // Inform background we saw a registration click (for robustness/polling)
        if (eventId) {
          chrome.runtime.sendMessage({ type: 'content_register_click', eventId });
          // Show inline prompt immediately
          createOverlayPrompt(eventId);
        }
      }, { capture: true });
    }
  }

  // Observe DOM for late-loaded buttons as well
  const obs = new MutationObserver(() => attach());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  // Initial attach
  attach();
})();
