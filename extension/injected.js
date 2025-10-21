(function() {
  // Instrument ActionCable subscribe/confirm messages by wrapping WebSocket
  if (!window.WebSocket) return;
  const NativeWS = window.WebSocket;
  const HOOK_FLAG = '__ics_ws_hooked__';
  if (window[HOOK_FLAG]) return;
  window[HOOK_FLAG] = true;

  function safeParse(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function log(...args) {
    try { console.debug('[42 Calendar Sync][WS]', ...args); } catch {}
  }

  window.WebSocket = function(url, protocols) {
    const ws = new NativeWS(url, protocols);

    const origSend = ws.send;
    ws.send = function(data) {
      try {
        const payload = typeof data === 'string' ? data : (data && data.toString ? data.toString() : '');
        const parsed = safeParse(payload);
        if (parsed && (parsed.command === 'subscribe' || parsed.type === 'subscribe' || Array.isArray(parsed) && parsed[0] === 'subscribe')) {
          log('Outbound subscribe', parsed);
          window.postMessage({ __ics: true, kind: 'subscribe', data: parsed }, '*');
        }
      } catch {}
      return origSend.apply(this, arguments);
    };

    ws.addEventListener('message', (ev) => {
      try {
        const parsed = safeParse(ev.data);
        if (parsed && (parsed.type === 'confirm_subscription' || parsed.type === 'reject_subscription')) {
          log('Inbound', parsed);
          window.postMessage({ __ics: true, kind: parsed.type, data: parsed }, '*');
        }
        if (parsed && parsed.message && parsed.identifier && parsed.type === 'message') {
          // Generic ActionCable message payload
          window.postMessage({ __ics: true, kind: 'message', data: parsed }, '*');
        }
      } catch {}
    });

    return ws;
  };
})();
