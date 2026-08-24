const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'messages.json');
const MAX_HISTORY = 500;

// ---- Google Sign-In ----
// Create an OAuth Client ID at https://console.cloud.google.com/apis/credentials
// (Application type: Web application) and set it as GOOGLE_CLIENT_ID in your
// hosting platform's environment variables. See README.md for full steps.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

async function verifyGoogleToken(idToken) {
  if (!googleClient) throw new Error('Server is missing GOOGLE_CLIENT_ID configuration.');
  const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
  return ticket.getPayload(); // { sub, email, name, given_name, picture, ... }
}

// ---- Profanity filter ----
const SWEAR_WORDS = [
  'fuck', 'fucks', 'fucking', 'fucked', 'fucker', 'fuckers', 'fuckface', 'motherfucker', 'motherfuckers', 'fuk', 'fuking', 'fukin',
  'shit', 'shits', 'shitty', 'shitting', 'shitted', 'bullshit', 'horseshit', 'sh1t', 'shite',
  'bitch', 'bitches', 'bitching', 'b1tch',
  'bastard', 'bastards',
  'asshole', 'assholes', 'ass', 'asses', 'a55', 'jackass', 'dumbass',
  'dick', 'dicks', 'dickhead', 'dickheads',
  'piss', 'pissed', 'pissing',
  'crap', 'crappy', 'crapped',
  'damn', 'damned', 'dammit', 'goddamn', 'goddammit', 'goddamned',
  'bollocks', 'bollix',
  'bugger', 'buggered', 'buggering',
  'wanker', 'wankers', 'wanking',
  'twat', 'twats',
  'slut', 'sluts', 'slutty',
  'whore', 'whores', 'whoring',
  'douche', 'douchebag', 'douchebags',
  'prick', 'pricks',
  'cock', 'cocks', 'cocksucker', 'cocksuckers',
  'arse', 'arsehole'
];
const swearPattern = new RegExp('\\b(' + SWEAR_WORDS.join('|') + ')\\b', 'gi');
function censor(text) {
  return text.replace(swearPattern, m => '*'.repeat(m.length));
}

// ---- Message history persistence ----
let history = [];
try {
  if (fs.existsSync(DATA_FILE)) {
    history = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  }
} catch (e) {
  console.error('Could not read message history, starting fresh:', e.message);
  history = [];
}

let saveQueued = false;
function saveHistory() {
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(() => {
    saveQueued = false;
    fs.writeFile(DATA_FILE, JSON.stringify(history), err => {
      if (err) console.error('Failed to save history:', err.message);
    });
  }, 300);
}

// ---- Server setup ----
const app = express();

// Serve the chat page explicitly, checking a couple of likely locations —
// some hosting platforms don't preserve the public/ subfolder exactly when
// files are uploaded or pasted in through a browser editor.
const indexCandidates = [
  path.join(__dirname, 'public', 'index.html'),
  path.join(__dirname, 'index.html')
];
const indexPath = indexCandidates.find(p => fs.existsSync(p));

app.get('/', (req, res) => {
  if (!indexPath) {
    res.status(500).send('index.html not found. Make sure index.html is in this project (in a "public" folder, or at the project root).');
    return;
  }
  res.sendFile(indexPath);
});

// Still serve the public/ folder normally in case other assets are added later.
app.use(express.static(path.join(__dirname, 'public')));

// Lets the client know which Google Client ID to use for Sign In With Google.
app.get('/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5 * 1024 * 1024 // allow up to ~5MB payloads for file attachments
});

// name -> socket id, so we know who is currently online / typing
const typingUsers = new Map(); // name -> timeout handle

io.on('connection', socket => {
  let authedName = null;
  let googleEmail = null;

  socket.on('google-login', async ({ idToken }) => {
    try {
      const payload = await verifyGoogleToken(idToken);
      googleEmail = payload.email;
      socket.emit('google-verified', { suggestedName: payload.given_name || payload.name || '' });
    } catch (e) {
      console.error('Google verification failed:', e.message);
      socket.emit('login-error', "Couldn't verify that Google sign-in. Try again.");
    }
  });

  socket.on('set-name', ({ name }) => {
    if (!googleEmail) {
      socket.emit('login-error', 'Please sign in with Google first.');
      return;
    }
    const clean = String(name || '').trim().slice(0, 24);
    if (!clean) {
      socket.emit('name-error', 'Enter a name to use in the chat.');
      return;
    }
    authedName = clean;
    socket.data.name = clean;
    socket.emit('login-success', { name: clean, history: history.slice(-MAX_HISTORY) });
  });

  socket.on('message', ({ text, attachment }) => {
    if (!authedName) return;
    const clean = (text || '').toString().slice(0, 2000);
    if (!clean.trim() && !attachment) return;
    const payload = {
      id: crypto.randomBytes(8).toString('hex'),
      name: authedName,
      text: clean ? censor(clean) : '',
      ts: Date.now()
    };
    if (attachment && attachment.dataUrl && attachment.filename) {
      // basic sanity limit on stored attachment size
      if (attachment.dataUrl.length < 7 * 1024 * 1024) {
        payload.attachment = {
          filename: String(attachment.filename).slice(0, 200),
          mime: String(attachment.mime || 'application/octet-stream').slice(0, 100),
          dataUrl: attachment.dataUrl
        };
      }
    }
    history.push(payload);
    if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
    saveHistory();
    io.emit('message', payload);
  });

  socket.on('delete', ({ id }) => {
    if (!authedName) return;
    const msg = history.find(m => m.id === id);
    if (!msg || msg.name !== authedName) return;
    history = history.filter(m => m.id !== id);
    saveHistory();
    io.emit('deleted', { id });
  });

  socket.on('typing', () => {
    if (!authedName) return;
    socket.broadcast.emit('typing', { name: authedName });
  });

  socket.on('stop-typing', () => {
    if (!authedName) return;
    socket.broadcast.emit('stop-typing', { name: authedName });
  });

  socket.on('disconnect', () => {
    if (authedName) {
      socket.broadcast.emit('stop-typing', { name: authedName });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
