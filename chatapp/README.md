# The Room — real-time chat web app

A small real-time group chat for Alfie, Finn, Aryan, and Sammy. Built with
Node.js, Express, and Socket.io. Messages, typing indicators, file/image
attachments, a swear-word censor, and message deletion all work live between
anyone who has the site open — no Claude connection required.

## Running it locally

```bash
npm install
node server.js
```

Then open http://localhost:3000 in a browser. Open it in a couple of browser
tabs (or on your phone too) to see messages sync live between them.

## Deploying so anyone can reach it from a real URL

This app needs a place to actually run continuously — it can't live as a
static file, because the server process needs to stay running to relay
messages between people. Render.com is a good free option with no command
line required:

1. Put this project in a GitHub repository (create one and push these files
   — ask Claude Code or GitHub Desktop for help if you're not familiar with
   git).
2. Go to https://render.com, sign up, and choose "New Web Service."
3. Connect your GitHub repo.
4. Set:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
5. Deploy. Render will give you a URL like `https://your-app.onrender.com`
   — that's the link everyone uses to join the chat.

Other options that work the same way: Railway.app, Fly.io, or a small VPS.
Avoid static-only hosts like GitHub Pages or Netlify's free tier — they
can't run a persistent server process, which this app needs.

## Changing the passwords

Passwords are set in `server.js`. For a real deployment, it's safer to set
them as environment variables on your hosting platform instead of editing
the file directly:

```
ALFIE_PASSWORD=your-new-password
FINN_PASSWORD=your-new-password
ARYAN_PASSWORD=your-new-password
SAMMY_PASSWORD=your-new-password
```

Most hosting platforms (including Render) have an "Environment" tab where
you can set these without touching code.

## Notes

- Message history is saved to `messages.json` on the server, so a restart
  won't wipe the conversation.
- Attachments are capped at 3MB per file.
- This is a lightweight setup meant for a small group of friends, not a
  production-grade security posture — passwords are checked in plain text
  server-side rather than hashed, and there's no rate limiting or HTTPS
  configured here (most hosts like Render provide HTTPS automatically).
