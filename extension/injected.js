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

  // Hook fetch to detect registration POSTs
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = async function(input, init) {
      const method = (init && init.method ? init.method : 'GET').toUpperCase();
      let url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      const is42 = /\.intra\.(42|fr)\.|intra\.42\./.test(url) || /projects\.intra\.42\.fr/.test(url);
      const looksLikeRegister = /\/(events|events_users)\//.test(url) || /(register|subscribe|enroll|inscrire)/i.test(url);
      const res = await origFetch.apply(this, arguments);
      try {
        if (is42 && looksLikeRegister && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
          const m = url.match(/\/events\/(\d+)/);
          const eventId = m ? Number(m[1]) : null;
          window.postMessage({ __ics: true, kind: 'ics_reg_success', eventId, url, status: res.status }, '*');
        }
      } catch {}
      return res;
    };
  }

  // Hook XHR as well
  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR) {
    const open = OrigXHR.prototype.open;
    const send = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function(method, url) {
      try { this.__ics = { method: String(method).toUpperCase(), url: String(url) }; } catch {}
      return open.apply(this, arguments);
    };
    OrigXHR.prototype.send = function(body) {
      this.addEventListener('load', function() {
        try {
          const info = this.__ics || {};
          const is42 = info.url && (/\.intra\.(42|fr)\.|intra\.42\./.test(info.url) || /projects\.intra\.42\.fr/.test(info.url));
          const looksLikeRegister = info.url && (/\/(events|events_users)\//.test(info.url) || /(register|subscribe|enroll|inscrire)/i.test(info.url));
          if (is42 && looksLikeRegister && (info.method === 'POST' || info.method === 'PUT' || info.method === 'PATCH')) {
            const m = info.url.match(/\/events\/(\d+)/);
            const eventId = m ? Number(m[1]) : null;
            window.postMessage({ __ics: true, kind: 'ics_reg_success', eventId, url: info.url, status: this.status }, '*');
          }
        } catch {}
      });
      return send.apply(this, arguments);
    };
  }
})();
