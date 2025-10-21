## Summary
- Add Chrome MV3 extension (`extension/`) for automatic 42→Google Calendar sync
- Background service handles OAuth (42, Google), token refresh, polling new registrations
- Content script detects registration clicks and shows inline prompt in English
- Prompt page allows confirmation and triggers Google Calendar insertion with duplicate checks
- Options page to input OAuth client IDs/secrets and connect flows; shows redirect URIs

## Test plan
1) In Chrome: chrome://extensions → Enable Developer Mode → Load unpacked → select `extension/`
2) Open Options → enter 42 + Google OAuth credentials → copy the shown redirect URIs into both apps
3) Click "Connect 42" and "Connect Google" to complete auth flows
4) Visit projects.intra.42.fr, register on an event → inline popup "Sync to Google Calendar?" appears → click Add to Calendar
5) Alternatively wait for background polling (15 min) to detect new future registrations and prompt
