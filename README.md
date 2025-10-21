# 📅 42 Calendar Sync Tool (Local Service)

This application is a local Node.js service designed to synchronize your future event registrations from the 42 Intra API to your Google Calendar.

# 🚀 Quick Start Guide

Prerequisite: You must have Node.js and Git installed on your Linux machine.

## 1. Clone the repository:

git clone [YOUR_REPO_URL]

cd [YOUR_REPO_NAME]


## 2. Run the setup script:

chmod +x setup.sh

./setup.sh

-> This installs dependencies and creates the necessary .env file.


## 3. Insert API Keys (Crucial Step):

Follow the detailed instructions in the [SETUP_GUIDE](SETUP_GUIDE.md) to generate your personal 42 Intra and Google Calendar API keys. 

You must open the .env file and replace the placeholders.


## 4. Start the Service:

node server.js

-> Open the displayed URL in your browser to begin the synchronization process.


# ⚙️ Core Features (Minimalist View)

-> This tool provides a complete and stable synchronization experience by focusing on these key aspects:


✅ Targeted Events

Synchronizes only events you are registered for (fetched via the events_users endpoint).

➡️ Future-Proof

Only events with a start date in the future are synchronized to keep your calendar clean.

🔄 Dual Sync Mode

You choose: Fully Automatic (all future events at once with duplicate checking) or Manual (web-based selection).

🛡️ Data Integrity

The system uses duplicate checking and solves API issues (like pagination and the missing date filter) to ensure a complete sync.


## 🧩 Browser Extension (Automatic Sync & Prompts)

For a seamless experience without manually starting the Node server, you can use the included Chrome extension in `extension/`. It watches for new registrations on 42 Intra, prompts you to add them to Google Calendar, and can periodically check for new future events.

### Install the extension (Chrome MV3)

1. Open Chrome and go to `chrome://extensions/`
2. Enable Developer Mode (top-right)
3. Click "Load unpacked" and select the `extension/` folder

### Configure OAuth once

1. Open the extension's Options (click the extension icon > gear or via the card on chrome://extensions)
2. Paste your credentials:
   - 42 Client ID (UID) and Secret
   - Google Client ID and Secret
3. Copy the shown Redirect URIs and configure them in your 42 and Google OAuth app settings
4. Click "Connect 42" and then "Connect Google" to authorize

### Use

- When you register for a 42 event, you'll see a prompt asking to add it to your Google Calendar.
- The background service also periodically checks your future registrations and can prompt you to add newly detected events.
- All prompts and UI are in English.

