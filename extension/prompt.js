async function getPending() {
  const data = await chrome.storage.local.get('pending_sync_event');
  return data.pending_sync_event || null;
}

async function main() {
  const info = document.getElementById('info');
  const pending = await getPending();
  if (!pending) {
    info.textContent = 'No pending event to sync.';
    return;
  }
  if (pending.type === 'add') {
    info.textContent = `${pending.name} – ${new Date(pending.begin_at).toLocaleString()}`;
  } else if (pending.type === 'remove') {
    info.textContent = `You unsubscribed from an event. Remove it from Google Calendar?`;
    document.getElementById('add').textContent = 'Remove from Calendar';
  }

  document.getElementById('add').addEventListener('click', () => {
    if (pending.type === 'add') {
      chrome.runtime.sendMessage({ type: 'sync_event', eventId: pending.id }, (res) => {
        if (res?.ok && res?.created) {
          info.textContent = 'Event added to Google Calendar.';
        } else if (res?.ok && res?.skipped) {
          info.textContent = 'Event already exists in Google Calendar.';
        } else {
          info.textContent = `Failed: ${res?.error || 'unknown error'}`;
        }
      });
    } else if (pending.type === 'remove') {
      chrome.runtime.sendMessage({ type: 'delete_event', eventId: pending.id }, (res) => {
        if (res?.ok && res?.deleted) {
          info.textContent = 'Event removed from Google Calendar.';
        } else {
          info.textContent = `Failed: ${res?.error || 'unknown error'}`;
        }
      });
    }
  });

  document.getElementById('cancel').addEventListener('click', () => {
    window.close();
  });
}

main();
