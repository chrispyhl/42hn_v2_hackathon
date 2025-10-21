// Background service worker for 42 Calendar Sync (MV3)

const STORAGE_KEYS = {
  cfg42ClientId: 'cfg_42_client_id',
  cfg42ClientSecret: 'cfg_42_client_secret',
  cfgGoogleClientId: 'cfg_google_client_id',
  cfgGoogleClientSecret: 'cfg_google_client_secret',
  tok42Access: 'tok_42_access_token',
  tok42Refresh: 'tok_42_refresh_token',
  tok42Expiry: 'tok_42_expiry',
  tokGoogleAccess: 'tok_google_access_token',
  tokGoogleRefresh: 'tok_google_refresh_token',
  tokGoogleExpiry: 'tok_google_expiry',
  knownEventIds: 'known_event_ids',
  pendingSync: 'pending_sync_event'
};
// Detect popup/child windows navigating to event pages (e.g., modal windows or separate popups)
chrome.webNavigation.onCommitted.addListener(async (details) => {
  try {
    if (details.frameId !== 0) return; // only top-level of that tab
    const url = new URL(details.url);
    if (!/\.intra\.42\.fr$/.test(url.hostname) && !/intra\.42\.fr$/.test(url.hostname)) return;
    const m = url.pathname.match(/\/events\/(\d+)/);
    if (m) {
      const eventId = m[1];
      // prepare prompt immediately when we see user land on an event popup
      await setStored({ [STORAGE_KEYS.pendingSync]: { id: Number(eventId) } });
    }
  } catch {}
});

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events'
];

// ---------- Storage helpers ----------
async function getStored(keys) {
  return await chrome.storage.local.get(keys);
}
async function setStored(obj) {
  return await chrome.storage.local.set(obj);
}
async function removeStored(keys) {
  return await chrome.storage.local.remove(keys);
}

// ---------- OAuth Helpers ----------
function buildQuery(params) {
  return new URLSearchParams(params).toString();
}

async function getRedirectURL(suffix) {
  return chrome.identity.getRedirectURL(suffix);
}

// 42 OAuth
async function authorize42Interactive() {
  const { [STORAGE_KEYS.cfg42ClientId]: clientId, [STORAGE_KEYS.cfg42ClientSecret]: clientSecret } = await getStored([STORAGE_KEYS.cfg42ClientId, STORAGE_KEYS.cfg42ClientSecret]);
  if (!clientId || !clientSecret) throw new Error('42 OAuth not configured. Set Client ID/Secret in Options.');
  const redirectUri = await getRedirectURL('forty2');

  const authUrl = `https://api.intra.42.fr/oauth/authorize?${buildQuery({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'public'
  })}`;

  const redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const code = new URL(redirect).searchParams.get('code');
  if (!code) throw new Error('42 OAuth: No code returned');

  const tokenResp = await fetch('https://api.intra.42.fr/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });
  if (!tokenResp.ok) throw new Error(`42 token exchange failed: ${tokenResp.status}`);
  const tokenData = await tokenResp.json();
  const expiryTs = Date.now() + (tokenData.expires_in || 7200) * 1000 - 60000; // minus 60s buffer
  await setStored({
    [STORAGE_KEYS.tok42Access]: tokenData.access_token,
    [STORAGE_KEYS.tok42Refresh]: tokenData.refresh_token,
    [STORAGE_KEYS.tok42Expiry]: expiryTs
  });
  return tokenData.access_token;
}

async function ensure42AccessToken() {
  const { [STORAGE_KEYS.tok42Access]: access, [STORAGE_KEYS.tok42Refresh]: refresh, [STORAGE_KEYS.tok42Expiry]: expiry,
          [STORAGE_KEYS.cfg42ClientId]: clientId, [STORAGE_KEYS.cfg42ClientSecret]: clientSecret } = await getStored([
    STORAGE_KEYS.tok42Access,
    STORAGE_KEYS.tok42Refresh,
    STORAGE_KEYS.tok42Expiry,
    STORAGE_KEYS.cfg42ClientId,
    STORAGE_KEYS.cfg42ClientSecret
  ]);
  if (access && expiry && Date.now() < expiry) return access;
  if (refresh && clientId && clientSecret) {
    const redirectUri = await getRedirectURL('forty2');
    const resp = await fetch('https://api.intra.42.fr/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh,
        redirect_uri: redirectUri
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      const expiryTs = Date.now() + (data.expires_in || 7200) * 1000 - 60000;
      await setStored({ [STORAGE_KEYS.tok42Access]: data.access_token, [STORAGE_KEYS.tok42Expiry]: expiryTs });
      return data.access_token;
    }
  }
  return await authorize42Interactive();
}

// Google OAuth via launchWebAuthFlow
async function authorizeGoogleInteractive() {
  const { [STORAGE_KEYS.cfgGoogleClientId]: clientId, [STORAGE_KEYS.cfgGoogleClientSecret]: clientSecret } = await getStored([
    STORAGE_KEYS.cfgGoogleClientId,
    STORAGE_KEYS.cfgGoogleClientSecret
  ]);
  if (!clientId || !clientSecret) throw new Error('Google OAuth not configured. Set Client ID/Secret in Options.');
  const redirectUri = await getRedirectURL('google');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${buildQuery({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent'
  })}`;

  const redirect = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true });
  const code = new URL(redirect).searchParams.get('code');
  if (!code) throw new Error('Google OAuth: No code returned');

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildQuery({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });
  if (!tokenResp.ok) throw new Error(`Google token exchange failed: ${tokenResp.status}`);
  const tokenData = await tokenResp.json();
  const expiryTs = Date.now() + (tokenData.expires_in || 3600) * 1000 - 60000;
  await setStored({
    [STORAGE_KEYS.tokGoogleAccess]: tokenData.access_token,
    [STORAGE_KEYS.tokGoogleRefresh]: tokenData.refresh_token,
    [STORAGE_KEYS.tokGoogleExpiry]: expiryTs
  });
  return tokenData.access_token;
}

async function ensureGoogleAccessToken() {
  const { [STORAGE_KEYS.tokGoogleAccess]: access, [STORAGE_KEYS.tokGoogleRefresh]: refresh, [STORAGE_KEYS.tokGoogleExpiry]: expiry,
          [STORAGE_KEYS.cfgGoogleClientId]: clientId, [STORAGE_KEYS.cfgGoogleClientSecret]: clientSecret } = await getStored([
    STORAGE_KEYS.tokGoogleAccess,
    STORAGE_KEYS.tokGoogleRefresh,
    STORAGE_KEYS.tokGoogleExpiry,
    STORAGE_KEYS.cfgGoogleClientId,
    STORAGE_KEYS.cfgGoogleClientSecret
  ]);
  if (access && expiry && Date.now() < expiry) return access;
  if (refresh && clientId && clientSecret) {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: buildQuery({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refresh
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      const expiryTs = Date.now() + (data.expires_in || 3600) * 1000 - 60000;
      await setStored({ [STORAGE_KEYS.tokGoogleAccess]: data.access_token, [STORAGE_KEYS.tokGoogleExpiry]: expiryTs });
      return data.access_token;
    }
  }
  return await authorizeGoogleInteractive();
}

// ---------- API helpers ----------
async function fortyTwoFetch(path) {
  const token = await ensure42AccessToken();
  const resp = await fetch(`https://api.intra.42.fr/v2${path}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`42 API ${path} failed: ${resp.status}`);
  return await resp.json();
}

async function googleApi(path, method = 'GET', body) {
  const token = await ensureGoogleAccessToken();
  const init = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) init.body = JSON.stringify(body);
  const resp = await fetch(`https://www.googleapis.com/calendar/v3${path}`, init);
  if (!resp.ok) throw new Error(`Google API ${path} failed: ${resp.status}`);
  return await resp.json();
}

function toGoogleEvent(event42) {
  const durationHours = event42.duration ? event42.duration / 3600 : undefined;
  const descriptionParts = [];
  if (durationHours !== undefined) descriptionParts.push(`Duration: ${durationHours} hours.`);
  if (event42.location) descriptionParts.push(`Location: ${event42.location}`);
  if (event42.description) descriptionParts.push('', event42.description);
  return {
    summary: `42: ${event42.name}`,
    location: event42.location || undefined,
    description: descriptionParts.join('\n'),
    start: { dateTime: event42.begin_at, timeZone: 'UTC' },
    end: { dateTime: event42.end_at, timeZone: 'UTC' },
    reminders: { useDefault: true },
    source: { title: '42 Intra', url: `https://projects.intra.42.fr/events/${event42.id}` }
  };
}

async function eventExistsInGoogle(eventId42) {
  const query = encodeURIComponent(`https://projects.intra.42.fr/events/${eventId42}`);
  try {
    const data = await googleApi(`/calendars/primary/events?q=${query}&maxResults=1&showDeleted=false`);
    return Array.isArray(data.items) && data.items.length > 0;
  } catch (e) {
    // If Calendar API search fails, assume not existing to allow user to add
    return false;
  }
}

async function insertGoogleEvent(googleEvent) {
  return await googleApi(`/calendars/primary/events`, 'POST', googleEvent);
}

// ---------- Registration detection & prompting ----------
async function getFutureEventsList() {
  const events = await fortyTwoFetch('/me/events');
  const now = new Date();
  return events.filter(e => new Date(e.begin_at) > now);
}

async function detectNewRegistrationViaDiff(waitMs = 7000) {
  const before = await getFutureEventsList();
  const beforeIds = new Set(before.map(e => e.id));
  await new Promise(r => setTimeout(r, waitMs));
  const after = await getFutureEventsList();
  const added = after.find(e => !beforeIds.has(e.id));
  if (added) {
    await setStored({ [STORAGE_KEYS.pendingSync]: { id: added.id, name: added.name, begin_at: added.begin_at } });
    const url = chrome.runtime.getURL('prompt.html');
    await chrome.tabs.create({ url });
    return { found: true, eventId: added.id };
  }
  return { found: false };
}
async function handleNewRegistration(eventId) {
  try {
    const event42 = await fortyTwoFetch(`/events/${eventId}`);
    // Open prompt page to ask user confirmation
    // Prevent duplicate prompts for the same event within 60s
    const dedupeKey = `dedupe_${event42.id}`;
    const stash = await getStored([dedupeKey]);
    const now = Date.now();
    if (stash[dedupeKey] && now - stash[dedupeKey] < 60000) {
      return;
    }
    await setStored({ [dedupeKey]: now });
    await setStored({ [STORAGE_KEYS.pendingSync]: { id: event42.id, name: event42.name, begin_at: event42.begin_at } });
    const url = chrome.runtime.getURL('prompt.html');
    await chrome.tabs.create({ url });
  } catch (e) {
    console.warn('Failed to fetch event for prompt:', e.message);
  }
}

// Poll for newly registered events
async function pollForNewEvents() {
  try {
    const events = await fortyTwoFetch('/me/events');
    const now = new Date();
    const futureEvents = events.filter(e => new Date(e.begin_at) > now);
    const { [STORAGE_KEYS.knownEventIds]: known = [] } = await getStored([STORAGE_KEYS.knownEventIds]);
    const knownSet = new Set(known);

    const newOnes = [];
    for (const e of futureEvents) {
      if (!knownSet.has(e.id)) newOnes.push(e);
    }

    if (newOnes.length > 0) {
      // Update known set immediately to avoid repeated prompts
      const updated = Array.from(new Set([...known, ...futureEvents.map(e => e.id)]));
      await setStored({ [STORAGE_KEYS.knownEventIds]: updated });
      // Prompt for the first new event
      await setStored({ [STORAGE_KEYS.pendingSync]: { id: newOnes[0].id, name: newOnes[0].name, begin_at: newOnes[0].begin_at } });
      const url = chrome.runtime.getURL('prompt.html');
      await chrome.tabs.create({ url });
    }
  } catch (e) {
    // Silently ignore transient failures
    console.debug('Poll failed:', e.message);
  }
}

// Setup alarms for polling
chrome.runtime.onInstalled.addListener(async () => {
  // initial cleanup
  await removeStored([STORAGE_KEYS.pendingSync]);
  // run once after install
  pollForNewEvents();
  // then every 15 minutes
  chrome.alarms.create('poll42', { periodInMinutes: 15 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('poll42', { periodInMinutes: 15 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'poll42') {
    pollForNewEvents();
  }
});

// Message handling from options and content scripts
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'debug_ping') {
      sendResponse({ ok: true, at: Date.now(), sender });
      return;
    }
    if (msg?.type === 'content_register_click' && msg.eventId) {
      await handleNewRegistration(msg.eventId);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'debug_force_poll') {
      await pollForNewEvents();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'options_connect_42') {
      await authorize42Interactive();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'options_connect_google') {
      await authorizeGoogleInteractive();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === 'sync_event' && msg.eventId) {
      const event42 = await fortyTwoFetch(`/events/${msg.eventId}`);
      if (await eventExistsInGoogle(event42.id)) {
        sendResponse({ ok: true, skipped: true, reason: 'duplicate' });
        return;
      }
      const gEvent = toGoogleEvent(event42);
      await insertGoogleEvent(gEvent);
      sendResponse({ ok: true, created: true });
      return;
    }
    if (msg?.type === 'delete_event' && msg.eventId) {
      // Find the corresponding Google event by source URL and delete it
      const query = encodeURIComponent(`https://projects.intra.42.fr/events/${msg.eventId}`);
      try {
        const data = await googleApi(`/calendars/primary/events?q=${query}&maxResults=5&showDeleted=false`);
        if (Array.isArray(data.items)) {
          for (const it of data.items) {
            try {
              await googleApi(`/calendars/primary/events/${encodeURIComponent(it.id)}`, 'DELETE');
            } catch {}
          }
        }
        sendResponse({ ok: true, deleted: true });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
      return;
    }
    if (msg?.type === 'ics_ws') {
      // Page-level WebSocket instrument messages can be forwarded here in future if needed
      sendResponse({ ok: true });
      return;
    }
  })().catch((e) => {
    sendResponse({ ok: false, error: e?.message || String(e) });
  });
  return true; // keep port open for async
});
