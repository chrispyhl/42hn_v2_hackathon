const K = {
  cfg42ClientId: 'cfg_42_client_id',
  cfg42ClientSecret: 'cfg_42_client_secret',
  cfgGoogleClientId: 'cfg_google_client_id',
  cfgGoogleClientSecret: 'cfg_google_client_secret'
};

async function load() {
  const vals = await chrome.storage.local.get(Object.values(K));
  document.getElementById('f42id').value = vals[K.cfg42ClientId] || '';
  document.getElementById('f42secret').value = vals[K.cfg42ClientSecret] || '';
  document.getElementById('gcid').value = vals[K.cfgGoogleClientId] || '';
  document.getElementById('gcsecret').value = vals[K.cfgGoogleClientSecret] || '';

  // show redirect URIs for configuring providers
  const redir42 = await chrome.identity.getRedirectURL('forty2');
  const redirG = await chrome.identity.getRedirectURL('google');
  document.getElementById('redir42').textContent = redir42;
  document.getElementById('redirG').textContent = redirG;
}

async function save42() {
  const id = document.getElementById('f42id').value.trim();
  const secret = document.getElementById('f42secret').value.trim();
  await chrome.storage.local.set({ [K.cfg42ClientId]: id, [K.cfg42ClientSecret]: secret });
  const el = document.getElementById('msg42');
  el.textContent = 'Saved 42 OAuth settings.';
  el.className = 'note ok';
}

async function saveG() {
  const id = document.getElementById('gcid').value.trim();
  const secret = document.getElementById('gcsecret').value.trim();
  await chrome.storage.local.set({ [K.cfgGoogleClientId]: id, [K.cfgGoogleClientSecret]: secret });
  const el = document.getElementById('msgG');
  el.textContent = 'Saved Google OAuth settings.';
  el.className = 'note ok';
}

async function connect42() {
  const el = document.getElementById('msg42');
  el.textContent = 'Opening 42 login...';
  el.className = 'note';
  chrome.runtime.sendMessage({ type: 'options_connect_42' }, (res) => {
    if (res?.ok) {
      el.textContent = '42 connected successfully.';
      el.className = 'note ok';
    } else {
      el.textContent = `42 connect failed: ${res?.error || 'unknown error'}`;
      el.className = 'note err';
    }
  });
}

async function connectG() {
  const el = document.getElementById('msgG');
  el.textContent = 'Opening Google login...';
  el.className = 'note';
  chrome.runtime.sendMessage({ type: 'options_connect_google' }, (res) => {
    if (res?.ok) {
      el.textContent = 'Google connected successfully.';
      el.className = 'note ok';
    } else {
      el.textContent = `Google connect failed: ${res?.error || 'unknown error'}`;
      el.className = 'note err';
    }
  });
}

addEventListener('DOMContentLoaded', () => {
  load();
  document.getElementById('save42').addEventListener('click', save42);
  document.getElementById('saveG').addEventListener('click', saveG);
  document.getElementById('connect42').addEventListener('click', connect42);
  document.getElementById('connectG').addEventListener('click', connectG);

  const scanBtn = document.getElementById('scanNow');
  const msgScan = document.getElementById('msgScan');
  const enableHook = document.getElementById('enableHook');
  if (scanBtn) {
    scanBtn.addEventListener('click', () => {
      msgScan.textContent = 'Scanning…';
      msgScan.className = 'note';
      chrome.runtime.sendMessage({ type: 'debug_force_poll' }, (res) => {
        if (res?.ok) {
          msgScan.textContent = 'Scan requested. If new future registrations are found, a confirmation tab will open.';
          msgScan.className = 'note ok';
        } else {
          msgScan.textContent = `Scan failed: ${res?.error || 'unknown error'}`;
          msgScan.className = 'note err';
        }
      });
    });
  }

  if (enableHook) {
    chrome.storage.local.get('ics_enable_hook', (v) => {
      enableHook.checked = !!v.ics_enable_hook;
    });
    enableHook.addEventListener('change', () => {
      chrome.storage.local.set({ ics_enable_hook: enableHook.checked });
    });
  }
});
