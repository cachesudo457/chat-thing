# The Room — real-time chat web app

A small real-time group chat, open to anyone who signs in with Google and
picks a display name. Built with Node.js, Express, and Socket.io. Messages,
typing indicators, file/image attachments, a swear-word censor, and message
deletion all work live between anyone who has the site open.

## Setting up Google Sign-In (required)

The app needs a Google OAuth Client ID before sign-in will work. This is
free and takes a few minutes.

1. Go to https://console.cloud.google.com/apis/credentials (create a new
   project first if you don't have one — the dropdown at the top left).
2. Click **Create Credentials > OAuth client ID**.
3. If prompted, configure the OAuth consent screen first — choose
   **External**, fill in an app name and your email, and save. You don't
   need to submit it for verification for personal/small-group use.
4. Back on the credentials page, choose **Application type: Web
   application**.
5. Under **Authorized JavaScript origins**, add the URL(s) you'll actually
   use:
   - For local testing: `http://localhost:3000`
   - For your deployed site: `https://your-app.onrender.com` (or whatever
     your real domain is)
6. Click **Create**. Copy the **Client ID** it gives you (looks like
   `123456-abc.apps.googleusercontent.com`) — you don't need the secret.
7. Set it as an environment variable named `GOOGLE_CLIENT_ID` wherever you
   run this app (see below).

## Running it locally

```bash
npm install
GOOGLE_CLIENT_ID=your-client-id-here node server.js
```

Then open http://localhost:3000 in a browser.

## Deploying so anyone can reach it from a real URL

This app needs a place to actually run continuously — it can't live as a
static file, because the server process needs to stay running to relay
messages between people.

### Render.com (free)

1. Put this project in a GitHub repository.
2. Go to https://render.com, sign up, and choose **New > Web Service**
   (not "Static Site" — that can't run this app).
3. Connect your GitHub repo. If the project files live in a subfolder,
   set **Root Directory** to that folder's name.
4. Set:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
5. In the **Environment** tab, add `GOOGLE_CLIENT_ID` with the value from
   the Google Cloud steps above.
6. Deploy. Render gives you a URL like `https://your-app.onrender.com`.
7. Go back to Google Cloud Console and add that exact URL to your OAuth
   client's **Authorized JavaScript origins** (step 5 above) — Google
   sign-in will fail until the live domain is added there.

Other options that work the same way: Glitch, Koyeb, Railway, Fly.io, or a
VPS. Avoid static-only hosts like GitHub Pages or Netlify's free tier —
they can't run a persistent server process, which this app needs.

## Notes

- Message history is saved to `messages.json` on the server, so a restart
  won't wipe the conversation (unless your host wipes disk on sleep —
  some free tiers do).
- Attachments are capped at 3MB per file.
- Anyone with a Google account can join and pick any display name —
  there's no allowlist. If you want to restrict it to specific people
  later, that's a small code change (checking `payload.email` against a
  list) — just ask.
- This is a lightweight setup meant for a small group, not a
  production-grade security posture — there's no rate limiting, and
  HTTPS depends on your host providing it (most do, including Render).
