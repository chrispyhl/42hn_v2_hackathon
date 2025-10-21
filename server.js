import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { google } from 'googleapis';

dotenv.config();

// 42 Intra Credentials
const UID_42 = process.env.UID_42;
const SECRET_42 = process.env.SECRET_42;
const INTRA_REDIRECT_URI = process.env.REDIRECT_URI;
const INTRA_TOKEN_URL = 'https://api.intra.42.fr/oauth/token';

// Google Calendar Credentials
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback/google'; 
const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/calendar', 'https://www.googleapis.com/auth/calendar.events'];

// Google OAuth client setup
const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
);

const app = express();
const PORT = 3000;

// --- HELPER FUNCTION FOR DUPLICATE CHECK ---

/**
 * Checks if a 42 event already exists in Google Calendar based on the 42 event ID.
 * The 42 event ID is stored in the Google Calendar event's source URL field.
 */
async function eventExists(calendar, eventId42) {
    const urlFilter = `https://projects.intra.42.fr/events/${eventId42}`;
    try {
        const response = await calendar.events.list({
            calendarId: 'primary',
            q: urlFilter, 
            maxResults: 1, 
            showDeleted: false, 
        });
        return response.data.items && response.data.items.length > 0;
    } catch (error) {
        console.error('Error checking for existing event:', error.message);
        return false; 
    }
}

// -----------------------------------------------------------
// --- 42 INTRA AUTH FLOW ---
// -----------------------------------------------------------

// Starting point: Redirect the User to 42-signin
app.get('/login/42', (req, res) => {
    // Determine auto_sync status
    const autoSyncFlag = req.query.auto_sync === 'true' ? 'true' : 'false';
    const authUrl = `https://api.intra.42.fr/oauth/authorize?client_id=${UID_42}&redirect_uri=${INTRA_REDIRECT_URI}&response_type=code&state=${autoSyncFlag}`;
    res.redirect(authUrl);
});

// Callback-Endpoint: Receives the 42-Authorization Code
app.get('/callback', async (req, res) => {
    const code = req.query.code;
    const autoSyncFlag = req.query.state || 'false'; 

    if (!code) {
        return res.status(400).send('Authorization code missing from 42.');
    }

    try {
        // 1. Exchange the 42 Code for an Access Token
        const response = await axios.post(INTRA_TOKEN_URL, {
            grant_type: 'authorization_code',
            client_id: UID_42,
            client_secret: SECRET_42,
            code: code,
            redirect_uri: INTRA_REDIRECT_URI
        });

        const accessToken42 = response.data.access_token;
        const stateData = `${accessToken42}|${autoSyncFlag}`;

        // 2. Initiate Google OAuth Flow, passing the combined state
        const googleAuthUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline', // Request a refresh token for long-term sync
            scope: GOOGLE_SCOPES,
            state: stateData
        });

        res.redirect(googleAuthUrl);

    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error('Error during 42 token exchange:', errorData);
        res.status(500).send('Error during 42 authorization.');
    }
});

// -----------------------------------------------------------
// --- GOOGLE CALENDAR AUTH & SYNC FLOW ---
// -----------------------------------------------------------

app.get('/callback/google', async (req, res) => {
    const googleCode = req.query.code;
    const stateParts = req.query.state ? req.query.state.split('|') : [];
    const accessToken42 = stateParts[0];
    const autoSync = stateParts.length > 1 ? stateParts[1] === 'true' : false; 

    if (!googleCode || !accessToken42) {
        return res.status(400).send('Missing authorization data (Google Code or 42 Token).');
    }

    try {
        // 1. Exchange the Google Code for Access and Refresh Tokens
        const { tokens } = await oauth2Client.getToken(googleCode);
        oauth2Client.setCredentials(tokens);
        const googleAccessToken = tokens.access_token;
        
        const intraApi = axios.create({
            baseURL: 'https://api.intra.42.fr/v2',
            headers: { Authorization: `Bearer ${accessToken42}` }
        });

        const userResponse = await intraApi.get('/me');
        const userId = userResponse.data.id;
        
        let allEvents42 = [];
        let page = 1;
        let hasMorePages = true;
        
        // Setup Date Range: Start 2 years ago, End 10 years in the future (avoids 'open range' error)
        const relevantStart = new Date();
        relevantStart.setFullYear(relevantStart.getFullYear() - 2); 
        const relevantEnd = new Date();
        relevantEnd.setFullYear(relevantEnd.getFullYear() + 10); 
        
        // Format: YYYY-MM-DD,YYYY-MM-DD
        const relevantDateRangeString = `${relevantStart.toISOString().split('T')[0]},${relevantEnd.toISOString().split('T')[0]}`;

        // 2. Fetch user-specific event registrations (Paginated)
        while (hasMorePages && page < 20) { 
            
            const events42Response = await intraApi.get(`/users/${userId}/events_users`, {
                params: {
                    'page[size]': 100, 
                    'page[number]': page,
                    // FIX: Use the allowed 'created_at' filter to fetch a broad range of registrations
                    'range[created_at]': relevantDateRangeString 
                }
            });
            
            const currentPageEvents = events42Response.data;
            allEvents42 = allEvents42.concat(currentPageEvents);

            // Break if the last page was not full
            if (currentPageEvents.length < 100) {
                 hasMorePages = false; 
            }
            page++;
        }
        
        // Extract the actual event objects and filter out nulls
        let events42 = allEvents42.map(eventUser => eventUser.event).filter(e => e !== null);
        
        console.log(`Successfully fetched ${events42.length} user-specific events.`);
        
        // --- 3. Process and Convert Events for Google Calendar (FUTURE EVENTS ONLY) ---
        
        const now = new Date(); 

        const calendarEvents = events42
            .filter(event42 => {
                const eventDate = new Date(event42.begin_at);
                
                // Keep ONLY future events. Past events are ignored.
                return eventDate > now;
            })
            .map(event42 => {
                const durationHours = event42.duration ? event42.duration / 3600 : 'N/A';
                
                const description = `Duration: ${durationHours} hours.\nLocation: ${event42.location || 'N/A'}\n\n${event42.description || ''}`;

                return {
                    summary: `42: ${event42.name}`, 
                    location: event42.location || 'N/A',
                    description: description,
                    start: {
                        dateTime: event42.begin_at, 
                        timeZone: 'UTC', 
                    },
                    end: {
                        dateTime: event42.end_at, 
                        timeZone: 'UTC',
                    },
                    reminders: { useDefault: true },
                    source: {
                        title: '42 Intra',
                        url: `https://projects.intra.42.fr/events/${event42.id}`,
                    }
                };
            })
            .sort((a, b) => new Date(a.start.dateTime) - new Date(b.start.dateTime));

        // --- 4. Decision: Sync or Show Confirmation ---
        
        if (autoSync) {
            // AUTOMATIC MODE: Insert all events immediately with Duplicate Check
            const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
            let createdCount = 0;
            let skippedCount = 0; 

            for (const event of calendarEvents) {
                const eventId42 = event.source.url.split('/').pop();
                
                if (await eventExists(calendar, eventId42)) {
                    console.log(`Skipping duplicate event: ${event.summary}`);
                    skippedCount++;
                    continue; 
                }

                try {
                    await calendar.events.insert({
                        calendarId: 'primary',
                        resource: event,
                    });
                    createdCount++;
                } catch (insertError) {
                    console.warn(`Event creation failed for ${event.summary}:`, insertError.message);
                }
            }
            
            res.send(`Success! ${createdCount} 42 events have been synced automatically to your Google Calendar. (${skippedCount} duplicates skipped)`);
        
        } else {
            // INTERACTIVE MODE
            
            if (calendarEvents.length === 0) {
                 return res.send('No future 42 events found that require syncing.');
            }
            
            const eventListHtml = calendarEvents.map(event => {
                const eventId = event.source.url.split('/').pop(); 
                const isoStart = event.start.dateTime;
                const isoEnd = event.end.dateTime;
                const location = event.location && event.location !== 'N/A' ? event.location : '';
                const desc = event.description ? event.description.replace(/\n/g, '<br>') : '';
                return `
                <li class="card">
                  <div class="card-head">
                    <div class="card-title">${event.summary}</div>
                    ${location ? `<div class="card-location">${location}</div>` : ''}
                  </div>
                  <div class="card-meta">
                    <span class="date" data-iso="${isoStart}">${isoStart}</span>
                    <span> → </span>
                    <span class="date" data-iso="${isoEnd}">${isoEnd}</span>
                  </div>
                  ${desc ? `<div class="card-desc">${desc}</div>` : ''}
                  <div class="card-actions">
                    <a class="btn" href="/sync/single?token=${accessToken42}&event_id=${eventId}&google_access_token=${googleAccessToken}">Add to Google Calendar</a>
                    <a class="btn-secondary" target="_blank" rel="noreferrer" href="${event.source.url}">Open in 42 Intra</a>
                  </div>
                </li>`
            }).join('');
            
            res.send(`<!doctype html>
              <html>
              <head>
                <meta charset="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>42 → Google Calendar – Confirm Sync</title>
                <style>
                  :root { --bg:#0b1020; --card:#121a35; --muted:#9aa3b2; --text:#e6ebf5; --brand:#1a73e8; --brand-2:#27496d; --ok:#16a34a; }
                  * { box-sizing: border-box; }
                  body { margin:0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, "Helvetica Neue", Arial, "Noto Sans"; background: var(--bg); color: var(--text); }
                  .wrap { max-width: 960px; margin: 32px auto; padding: 0 20px; }
                  .header { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom: 18px; }
                  h1 { font-size: 22px; margin: 0; }
                  p.lead { color: var(--muted); margin: 6px 0 0 0; }
                  .actions { display:flex; gap:10px; flex-wrap: wrap; }
                  .btn, .btn-secondary { display:inline-block; padding:8px 12px; border-radius:8px; text-decoration:none; font-weight:600; }
                  .btn { background: var(--brand); color:white; }
                  .btn-secondary { background: transparent; color: var(--text); border:1px solid #2a345a; }
                  ul.cards { list-style:none; padding:0; margin: 18px 0 0 0; display:grid; grid-template-columns: repeat(auto-fill, minmax(280px,1fr)); gap:12px; }
                  .card { background: var(--card); border:1px solid #1c2547; border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:10px; }
                  .card-head { display:flex; flex-direction:column; gap:4px; }
                  .card-title { font-size: 16px; font-weight:700; line-height:1.2; }
                  .card-location { font-size: 12px; color: var(--muted); }
                  .card-meta { font-size: 12px; color: var(--muted); }
                  .card-desc { font-size: 13px; color: #cfd6e6; max-height: 7.5em; overflow: auto; }
                  .card-actions { display:flex; gap:8px; flex-wrap:wrap; }
                  .footer { margin-top: 20px; color: var(--muted); font-size: 13px; }
                </style>
              </head>
              <body>
                <div class="wrap">
                  <div class="header">
                    <div>
                      <h1>Confirm events to sync</h1>
                      <p class="lead">${calendarEvents.length} future 42 events detected. Add individually or sync all at once.</p>
                    </div>
                    <div class="actions">
                      <a class="btn" href="/login/42?auto_sync=true">Sync all events now</a>
                    </div>
                  </div>
                  <ul class="cards">${eventListHtml}</ul>
                  <div class="footer">Tip: Times are shown in your local timezone.</div>
                </div>
                <script>
                  // Format ISO times into local readable strings
                  const opts = { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' };
                  document.querySelectorAll('.date').forEach(el => {
                    const iso = el.getAttribute('data-iso');
                    if (!iso) return;
                    try { el.textContent = new Date(iso).toLocaleString([], opts); } catch {}
                  });
                </script>
              </body>
              </html>`);
        }

    } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        console.error('Error during Google token exchange or event sync:', errorData);
        res.status(500).send('Error during Google authorization or calendar sync.');
    }
});

// --- SINGLE SYNC ENDPOINT (UNCHANGED) ---

app.get('/sync/single', async (req, res) => {
    // This endpoint handles the manual, single event sync from the interactive list.
    const accessToken42 = req.query.token;
    const eventId = req.query.event_id;
    const googleAccessToken = req.query.google_access_token; 

    if (!accessToken42 || !eventId || !googleAccessToken) {
        return res.status(400).send('Missing required parameters for single sync.');
    }

    try {
        // Authorize Google client using the Access Token
        oauth2Client.setCredentials({ access_token: googleAccessToken });
        const calendar = google.calendar({ version: 'v3', auth: oauth2Client }); 

        // CHECK FOR DUPLICATES
        if (await eventExists(calendar, eventId)) {
            return res.send(`Event ID ${eventId} is already synced to your calendar. (Duplicate skipped)`);
        }

        // Fetch the single event data from 42 API
        const intraApi = axios.create({
            baseURL: 'https://api.intra.42.fr/v2',
            headers: { Authorization: `Bearer ${accessToken42}` }
        });

        const event42Response = await intraApi.get(`/events/${eventId}`);
        const event42 = event42Response.data;

        // Convert the single event
        const durationHours = event42.duration ? event42.duration / 3600 : 'N/A';
        const description = `Duration: ${durationHours} hours.\nLocation: ${event42.location || 'N/A'}\n\n${event42.description || ''}`;

        const calendarEvent = {
            summary: `42: ${event42.name}`,
            location: event42.location || 'N/A',
            description: description,
            start: {
                dateTime: event42.begin_at, 
                timeZone: 'UTC', 
            },
            end: {
                dateTime: event42.end_at,
                timeZone: 'UTC',
            },
            reminders: { useDefault: true },
            source: {
                title: '42 Intra',
                url: `https://projects.intra.42.fr/events/${event42.id}`,
            }
        };

        // Insert the single event into Google Calendar
        await calendar.events.insert({
            calendarId: 'primary',
            resource: calendarEvent,
        });

        res.send(`Success! Single event "${calendarEvent.summary}" has been synced to your Google Calendar.`);

    } catch (error) {
        console.error('Error during single event sync:', error.message);
        res.status(500).send(`Error syncing single event. Check console for details.`);
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}/login/42`);
    console.log(`For automatic sync: http://localhost:3000/login/42?auto_sync=true`);
});