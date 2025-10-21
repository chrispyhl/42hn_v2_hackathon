// Content script to detect 42 event registrations and show inline prompt

(function() {
  // Early smoke log
  try { console.debug('[42 Calendar Sync] content script loaded on', location.href); } catch {}

  // Inject page-level WS hook to capture ActionCable subscribe/confirm
  try {
    const src = chrome.runtime.getURL('injected.js');
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    (document.head || document.documentElement).appendChild(s);
    s.parentNode && s.parentNode.removeChild(s);
    window.addEventListener('message', (ev) => {
      if (!ev?.data || ev.source !== window) return;
      if (!ev.data.__ics) return;
      if (ev.data.kind === 'reject_subscription') {
        try { console.warn('[42 Calendar Sync] Subscription rejected', ev.data); } catch {}
      }
      if (ev.data.kind === 'confirm_subscription') {
        try { console.debug('[42 Calendar Sync] Subscription confirmed', ev.data); } catch {}
      }
    });
  } catch {}
  const TRY_TEXTS = [
    'register', 'subscribe', 'join', 'participate', 'sign up', 'apply',
    'anmelden', 'teilnehmen', "s'inscrire", 'inscrire'
  ];

  function extractEventIdFromUrl() {
    const m = location.pathname.match(/\/events\/(\d+)/);
    return m ? m[1] : null;
  }

  function extractEventIdFromElement(el) {
    // Look at element href
    if (el && typeof el.getAttribute === 'function') {
      const href = el.getAttribute('href');
      if (href) {
        const m = href.match(/\/events\/(\d+)/);
        if (m) return m[1];
      }
    }
    // Look at closest anchor
    const a = el?.closest && el.closest('a[href*="/events/"]');
    if (a && a.href) {
      const m = a.href.match(/\/events\/(\d+)/);
      if (m) return m[1];
    }
    // Look at enclosing form action
    const form = el?.closest && el.closest('form[action]');
    if (form && form.action) {
      const m = form.action.match(/\/events\/(\d+)/);
      if (m) return m[1];
    }
    // Fallback: scan any event link on page
    const any = document.querySelector('a[href*="/events/"]');
    if (any && any.href) {
      const m = any.href.match(/\/events\/(\d+)/);
      if (m) return m[1];
    }
    return null;
  }

  function findRegisterCandidates() {
    const elements = Array.from(
      document.querySelectorAll(
        'button, a, input[type="submit"], [role="button"], .button, .btn, [class*="register"], [class*="subscribe"], [data-action*="register"]'
      )
    );
    return elements.filter(el => {
      const text = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase();
      return text && TRY_TEXTS.some(t => text.includes(t));
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
      try {
        chrome.runtime.sendMessage({ type: 'sync_event', eventId }, (res) => {
          document.body.removeChild(overlay);
        });
      } catch (e) {
        try { console.error('Send sync_event failed', e); } catch {}
        document.body.removeChild(overlay);
      }
    });
    no.addEventListener('click', () => {
      document.body.removeChild(overlay);
    });
  }

  function attach() {
    const candidates = findRegisterCandidates();
    if (candidates.length === 0) return;
    for (const el of candidates) {
      el.addEventListener('click', (evt) => {
        const fromUrl = extractEventIdFromUrl();
        const fromEl = extractEventIdFromElement(evt.target);
        const eventId = fromEl || fromUrl;
        if (eventId && chrome?.runtime?.id) {
          chrome.runtime.sendMessage({ type: 'content_register_click', eventId });
          createOverlayPrompt(eventId);
        }
      }, { capture: true });
    }
  }

  // Observe DOM for late-loaded buttons as well
  const obs = new MutationObserver(() => attach());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  // Initial attach (delay for SPAs)
  setTimeout(attach, 500);
})();
