const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'messages.json');
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
const MAX_HISTORY = 500;

const PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // no 0/O/1/l/I
function generatePassword(length = 10) {
  return Array.from(crypto.randomFillSync(new Uint8Array(length)))
    .map(b => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length])
    .join('');
}

// ---- Admin ----
// Set ADMIN_PASSWORD as an environment variable on your host. If it's not
// set, a random one is generated each startup and printed to the server
// logs — fine for quick local testing, but set a real one in production.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (() => {
  const generated = generatePassword(14);
  console.log('No ADMIN_PASSWORD set — generated one for this session:', generated);
  console.log('Set ADMIN_PASSWORD as an environment variable to keep it stable across restarts.');
  return generated;
})();

// ---- Accounts: pick a name, get an auto-generated password ----
// The first time someone types a name, an account is created for it and a
// random password is generated and shown to them once. Typing that same
// name again requires that password. No email or third-party sign-in.
let accounts = {};
try {
  if (fs.existsSync(ACCOUNTS_FILE)) {
    accounts = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
  }
} catch (e) {
  console.error('Could not read accounts, starting fresh:', e.message);
  accounts = {};
}

let accountsSaveQueued = false;
function saveAccounts() {
  if (accountsSaveQueued) return;
  accountsSaveQueued = true;
  setTimeout(() => {
    accountsSaveQueued = false;
    fs.writeFile(ACCOUNTS_FILE, JSON.stringify(accounts), err => {
      if (err) console.error('Failed to save accounts:', err.message);
    });
  }, 300);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, hash) {
  const attempt = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return attempt.length === expected.length && crypto.timingSafeEqual(attempt, expected);
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
app.use(express.json());

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

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5 * 1024 * 1024 // allow up to ~5MB payloads for file attachments
});

// name -> socket id, so we know who is currently online / typing
const typingUsers = new Map(); // name -> timeout handle
const activeSockets = new Map(); // name -> currently connected socket (for kicking on ban)
const RESERVED_NAMES = ['admin', 'announcement']; // can't be claimed as a regular account name

io.on('connection', socket => {
  let authedName = null;

  // Person types a name. New name -> create an account and hand them a
  // freshly generated password. Existing name -> ask for that password.
  socket.on('claim-or-login', ({ name }) => {
    const clean = String(name || '').trim().slice(0, 24);
    if (!clean) {
      socket.emit('login-error', 'Enter a name to use in the chat.');
      return;
    }
    const key = clean.toLowerCase();
    if (RESERVED_NAMES.includes(key)) {
      socket.emit('login-error', 'That name is reserved. Please pick another.');
      return;
    }
    const existing = accounts[key];

    if (!existing) {
      const password = generatePassword();
      const salt = crypto.randomBytes(16).toString('hex');
      accounts[key] = {
        name: clean,
        salt,
        hash: hashPassword(password, salt),
        createdAt: Date.now(),
        banned: false
      };
      saveAccounts();
      authedName = clean;
      socket.data.name = clean;
      activeSockets.set(clean, socket);
      socket.emit('account-created', { name: clean, password });
      socket.emit('login-success', { name: clean, history: history.slice(-MAX_HISTORY) });
      return;
    }

    if (existing.banned) {
      socket.emit('login-error', 'This account has been banned.');
      return;
    }

    socket.emit('need-password', { name: existing.name });
  });

  socket.on('login-with-password', ({ name, password }) => {
    const key = String(name || '').trim().toLowerCase();
    const account = accounts[key];
    if (!account || !verifyPassword(String(password || ''), account.salt, account.hash)) {
      socket.emit('login-error', "That name and password don't match.");
      return;
    }
    if (account.banned) {
      socket.emit('login-error', 'This account has been banned.');
      return;
    }
    authedName = account.name;
    socket.data.name = account.name;
    activeSockets.set(account.name, socket);
    socket.emit('login-success', { name: account.name, history: history.slice(-MAX_HISTORY) });
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
      if (activeSockets.get(authedName) === socket) {
        activeSockets.delete(authedName);
      }
    }
  });
});

// ---- Admin API ----
// Simple header-based check — fine for a small group's private tool.
// Every admin request must include: x-admin-password: <ADMIN_PASSWORD>
function requireAdmin(req, res, next) {
  const supplied = req.get('x-admin-password') || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(ADMIN_PASSWORD);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    res.status(401).json({ error: 'Wrong admin password.' });
    return;
  }
  next();
}

const adminIndexCandidates = [
  path.join(__dirname, 'public', 'admin.html'),
  path.join(__dirname, 'admin.html')
];
const adminIndexPath = adminIndexCandidates.find(p => fs.existsSync(p));

app.get('/admin', (req, res) => {
  if (!adminIndexPath) {
    res.status(500).send('admin.html not found.');
    return;
  }
  res.sendFile(adminIndexPath);
});

app.post('/admin/api/check', requireAdmin, (req, res) => {
  res.json({ ok: true });
});

app.get('/admin/api/users', requireAdmin, (req, res) => {
  const users = Object.values(accounts).map(a => ({
    name: a.name,
    createdAt: a.createdAt || null,
    banned: !!a.banned,
    online: activeSockets.has(a.name)
  })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json({ users });
});

app.post('/admin/api/ban', requireAdmin, (req, res) => {
  const key = String(req.body.name || '').trim().toLowerCase();
  const account = accounts[key];
  if (!account) {
    res.status(404).json({ error: 'No account with that name.' });
    return;
  }
  account.banned = true;
  saveAccounts();
  const activeSocket = activeSockets.get(account.name);
  if (activeSocket) {
    activeSocket.emit('banned');
    activeSocket.disconnect(true);
    activeSockets.delete(account.name);
  }
  res.json({ ok: true });
});

app.post('/admin/api/unban', requireAdmin, (req, res) => {
  const key = String(req.body.name || '').trim().toLowerCase();
  const account = accounts[key];
  if (!account) {
    res.status(404).json({ error: 'No account with that name.' });
    return;
  }
  account.banned = false;
  saveAccounts();
  res.json({ ok: true });
});

app.post('/admin/api/reset-password', requireAdmin, (req, res) => {
  const key = String(req.body.name || '').trim().toLowerCase();
  const account = accounts[key];
  if (!account) {
    res.status(404).json({ error: 'No account with that name.' });
    return;
  }
  const newPassword = generatePassword();
  const salt = crypto.randomBytes(16).toString('hex');
  account.salt = salt;
  account.hash = hashPassword(newPassword, salt);
  saveAccounts();
  res.json({ ok: true, password: newPassword });
});

// Post a message into the chat as "Admin" — shows up like a normal message
// from everyone else's point of view, just under that name.
app.post('/admin/api/message', requireAdmin, (req, res) => {
  const clean = String(req.body.text || '').trim().slice(0, 2000);
  if (!clean) {
    res.status(400).json({ error: 'Message text is required.' });
    return;
  }
  const payload = {
    id: crypto.randomBytes(8).toString('hex'),
    name: 'Admin',
    text: censor(clean),
    ts: Date.now(),
    admin: true
  };
  history.push(payload);
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  saveHistory();
  io.emit('message', payload);
  res.json({ ok: true });
});

// Post an announcement — rendered as a prominent banner in the chat rather
// than a normal bubble, and stays in history so late joiners see it too.
app.post('/admin/api/announcement', requireAdmin, (req, res) => {
  const clean = String(req.body.text || '').trim().slice(0, 500);
  if (!clean) {
    res.status(400).json({ error: 'Announcement text is required.' });
    return;
  }
  const payload = {
    id: crypto.randomBytes(8).toString('hex'),
    name: 'Announcement',
    text: censor(clean),
    ts: Date.now(),
    announcement: true
  };
  history.push(payload);
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  saveHistory();
  io.emit('message', payload);
  res.json({ ok: true });
});

server.listen(PORT, () => {
  console.log(`Chat server running on port ${PORT}`);
});
