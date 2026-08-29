# The Room — real-time chat web app

A small real-time group chat. Type any name to join — if it's new, you get
a password generated for you automatically (shown once); if that name's
already taken, you'll need its password. No email, no third-party sign-in.
Built with Node.js, Express, and Socket.io. Messages, typing indicators,
file/image attachments, a swear-word censor, and message deletion all work
live between anyone who has the site open.

## Running it locally

```bash
npm install
node server.js
```

Then open http://localhost:3000 in a browser. Open it in a couple of tabs
to see messages sync live between them.

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
5. Deploy. Render gives you a URL like `https://your-app.onrender.com`
   — that's the link everyone uses to join the chat.

Other options that work the same way: Glitch, Koyeb, Railway, Fly.io, or a
VPS. Avoid static-only hosts like GitHub Pages or Netlify's free tier —
they can't run a persistent server process, which this app needs.

## How accounts work

- Type a name that's never been used → an account is created instantly and
  a random password is shown once on screen. There's no email step and
  nothing to configure — save that password somewhere, since it's the only
  time it's shown.
- Type a name that's already taken → you'll be asked for its password.
- Passwords are stored as salted hashes in `accounts.json` on the server,
  never in plain text.
- There's no "forgot password" flow — if someone loses theirs, the
  simplest fix is picking a new name (or you editing `accounts.json`
  directly on the server to remove the old entry).

## Admin panel

Go to `/admin` on your deployed site (e.g. `https://your-app.onrender.com/admin`)
to ban/unban accounts, reset passwords, and see who's currently online.

Set an `ADMIN_PASSWORD` environment variable on your host — same place you'd
set any other environment variable (Render's Environment tab, etc.). If you
don't set one, a random password is generated each time the server starts
and printed to the server logs, which is fine for quick local testing but
inconvenient in production (it changes every restart).

What you can do from the admin panel:
- **Send a message** — posts into the chat as "Admin", with a small "staff"
  badge next to it, alongside everyone else's normal messages.
- **Post an announcement** — shows as a highlighted banner in the chat,
  separate from the normal message flow, and stays visible in history for
  anyone who joins later.
- **View any chat** — read-only access to Public Chat and every custom
  room, including private ones, so you can see what's actually being said
  without needing to join.
- **Delete an account permanently** — kicks them immediately if they're
  online, deletes any rooms they own (removing everyone else from those
  too), removes them from other people's friends lists, and frees up their
  name for anyone (including them) to claim again right away. Their past
  messages stay in chat history, still attributed to their old name — only
  the account and its access are removed. There is no ban/unban; deletion
  is permanent and immediate.
- **Reset password** — generates a brand new password for that name and
  shows it once. Their old password stops working immediately. You'd need
  to pass the new one along to them yourself (there's no email step).

The names "Admin" and "Announcement" are reserved — nobody can create a
regular account using either, so no one can impersonate the admin panel's
messages.

## Keeping it awake (optional)

Render's free tier spins your service down after ~15 minutes with no
traffic, and the next visitor has to wait about a minute for it to wake
back up. To avoid that, the server can ping itself just under that window
so it never goes idle long enough to sleep.

To turn this on, add an environment variable:

```
APP_URL=https://your-app.onrender.com
```

(use your actual live URL). If `APP_URL` isn't set, self-pinging is simply
disabled — nothing extra happens, and local development is unaffected.

Worth knowing: this is a widely-used but unofficial workaround, not
something Render guarantees will always work, and Render can still restart
a free service at any time regardless. It also counts as ongoing usage
against the free plan's 750 monthly instance hours — keeping one service
awake 24/7 uses around 720–744 hours a month, which fits within that limit,
but leaves little room if you run additional free services too.

## Dashboard, profiles, and suggestions

Signing in now lands on a personal dashboard instead of dropping straight
into the chat:

- **Profile** — pick an avatar from a set of preset kaomoji, or upload your
  own small image (under 300KB) instead. Also a background color you can
  pick and save (defaults to the app's cream tone). Both persist across
  sessions and apply as soon as you log in.
- **Public Chat** — the shared room everyone's in, one button away.
- **Suggestions** — a box for sending feedback straight to the admin, who
  can read every submission from the admin panel.
- **Notifications** — currently a placeholder; this is the first stage of a
  larger set of changes (friends, private rooms, and updated admin controls
  are planned for later stages, not included yet).
- **Friends** — send a request by typing someone's name. If they've
  already sent you one, sending yours back instantly accepts it (no need
  to separately confirm). Accept, decline, cancel a pending request, or
  remove an existing friend, all live — both sides see updates
  immediately if they're online.
- **Rooms** — create a named chat that's either public (anyone can browse
  and join it) or private (only people the owner adds can see or enter
  it). Each room has its own message history, separate from Public Chat.
  Room owners can add or remove members, or permanently delete the room,
  from the "Manage" option next to their room on the dashboard.
- **Notifications** — if you're not actively viewing a room when a message
  arrives there, it shows up as an unread count on your dashboard instead.
  Opening the room clears it.

## Notes

- Message history is saved to `messages.json`, and accounts to
  `accounts.json`, both on the server — a restart won't wipe either
  (unless your host wipes disk on sleep, which some free tiers do).
- Attachments are capped at 3MB per file.
- This is a lightweight setup meant for a small group, not a
  production-grade security posture — there's no rate limiting on login
  attempts, and HTTPS depends on your host providing it (most do,
  including Render).
