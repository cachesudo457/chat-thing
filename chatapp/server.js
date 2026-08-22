const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'messages.json');
const MAX_HISTORY = 500;

// ---- Accounts ----
// Passwords can be overridden with environment variables in production
// (e.g. ALFIE_PASSWORD=... on your hosting platform) instead of editing this file.
const ACCOUNTS = {
  Alfie: process.env.ALFIE_PASSWORD || 'n4F6gJwaks',
  Finn: process.env.FINN_PASSWORD || 'Zsp8SXqkty',
  Aryan: process.env.ARYAN_PASSWORD || 'xAMXs75q7D',
  Sammy: process.env.SAMMY_PASSWORD || 'U4FHWxCm3p'
};

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
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 5 * 1024 * 1024 // allow up to ~5MB payloads for file attachments
});

// name -> socket id, so we know who is currently online / typing
const typingUsers = new Map(); // name -> timeout handle

io.on('connection', socket => {
  let authedName = null;

  socket.on('login', ({ name, password }) => {
    const match = Object.keys(ACCOUNTS).find(n => n.toLowerCase() === String(name || '').trim().toLowerCase());
    if (!match || ACCOUNTS[match] !== password) {
      socket.emit('login-error', "Name or password isn't right.");
      return;
    }
    authedName = match;
    socket.data.name = match;
    socket.emit('login-success', { name: match, history: history.slice(-MAX_HISTORY) });
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
