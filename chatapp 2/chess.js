// Chess Thing: server side.
// Games live in chess_games.json next to the other data files, saved the same way as rooms.
// The server checks every move with the same rules file the browser uses (chess-engine.js),
// so nobody can move out of turn, move for someone else, or play an illegal move.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const E = require('./chess-engine');

module.exports = function createChess({ io, DATA_DIR, censor, notify, lookupAccount }) {
  lookupAccount = lookupAccount || (n => ({ name: n }));
  const FILE = path.join(DATA_DIR, 'chess_games.json');
  const MAX_CHAT = 200;
  const WAITING_TTL = 12 * 3600 * 1000;   // an empty table disappears after 12 hours
  const OVER_TTL = 3 * 24 * 3600 * 1000;  // finished games are kept for 3 days
  const IDLE_TTL = 14 * 24 * 3600 * 1000; // a game nobody has touched for 2 weeks is cleared
  const MAX_ACTIVE_PER_PERSON = 6;

  // games[id] = { id, white, black, status: 'waiting'|'playing'|'over', moves: ['e2e4', ...],
  //               result: 'white'|'black'|'draw'|null, reason, drawOffer: 'white'|'black'|null,
  //               chat: [{ id, name, text, ts }], created, updated }
  let games = {};
  try {
    if (fs.existsSync(FILE)) games = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (e) {
    console.error('Could not read chess games, starting fresh:', e.message);
    games = {};
  }
  let saveQueued = false;
  function save() {
    if (saveQueued) return;
    saveQueued = true;
    setTimeout(() => {
      saveQueued = false;
      fs.writeFile(FILE, JSON.stringify(games), err => {
        if (err) console.error('Failed to save chess games:', err.message);
      });
    }, 300);
  }

  function prune() {
    const now = Date.now();
    let changed = false;
    Object.values(games).forEach(g => {
      const age = now - (g.updated || g.created || 0);
      if ((g.status === 'waiting' && age > WAITING_TTL) || (g.status === 'over' && age > OVER_TTL) || age > IDLE_TTL) {
        delete games[g.id];
        changed = true;
      }
    });
    if (changed) { save(); lobbyChanged(); }
  }
  prune();
  const pruneTimer = setInterval(prune, 30 * 60 * 1000);
  if (pruneTimer.unref) pruneTimer.unref();

  const same = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
  function colorOf(g, name) { return same(g.white, name) ? 'white' : same(g.black, name) ? 'black' : null; }
  function isMine(g, name) { return !!colorOf(g, name); }
  function turnOf(g) { return g.moves.length % 2 === 0 ? 'white' : 'black'; }

  // ---- Sign-in handoff ----
  // The chat page asks for a token after you log in and keeps it for this browser tab. The Chess Thing page
  // shows that token to prove who you are, so there is no second login. Tokens live in memory only.
  const SESSION_TTL = 12 * 3600 * 1000;
  const tokens = new Map(); // token -> { name, exp }
  function issueToken(name) {
    const mine = [...tokens.entries()].filter(([, v]) => same(v.name, name));
    while (mine.length >= 5) tokens.delete(mine.shift()[0]);
    const t = crypto.randomBytes(24).toString('hex');
    tokens.set(t, { name, exp: Date.now() + SESSION_TTL });
    return t;
  }
  function nameForToken(t) {
    const v = tokens.get(String(t || ''));
    if (!v) return null;
    if (v.exp < Date.now()) { tokens.delete(String(t)); return null; }
    v.exp = Date.now() + SESSION_TTL;
    return v.name;
  }
  // sockets that belong to the Chess Thing page, by lowercase name, so it can hear "your move" etc.
  const pages = new Map();
  function ping(name, event, payload) {
    notify(name, event, payload);
    (pages.get(String(name).toLowerCase()) || []).forEach(s => s.emit(event, payload));
  }

  function publicGame(g) {
    return { id: g.id, white: g.white || null, black: g.black || null, status: g.status, moves: g.moves, result: g.result || null, reason: g.reason || null, drawOffer: g.drawOffer || null, created: g.created, updated: g.updated };
  }
  function summary(g, name) {
    const c = colorOf(g, name);
    return { id: g.id, white: g.white || null, black: g.black || null, status: g.status, moves: g.moves.length, updated: g.updated, yourMove: !!c && g.status === 'playing' && turnOf(g) === c };
  }
  function lobbyChanged() { io.to('chess-lobby').emit('chess-lobby-changed'); }
  function broadcastState(g) { io.to('chess:' + g.id).emit('chess-state', { game: publicGame(g) }); }
  function touch(g) { g.updated = Date.now(); save(); }

  function sendLobby(socket, name) {
    const now = Date.now(), mine = [], open = [], live = [];
    Object.values(games).forEach(g => {
      if (g.status === 'over') return;
      if (isMine(g, name)) mine.push(summary(g, name));
      else if (g.status === 'waiting') open.push(summary(g, name));
      else if (g.status === 'playing' && now - g.updated < 6 * 3600 * 1000) live.push(summary(g, name));
    });
    const byNew = (a, b) => b.updated - a.updated;
    socket.emit('chess-lobby', { mine: mine.sort(byNew), open: open.sort(byNew), live: live.sort(byNew) });
  }

  function finish(g, result, reason) {
    g.status = 'over';
    g.result = result;
    g.reason = reason;
    g.drawOffer = null;
    touch(g);
    broadcastState(g);
    lobbyChanged();
  }

  // Called from the admin "delete account" route: tidy up that person's games.
  function onAccountDeleted(name) {
    [...tokens.entries()].forEach(([t, v]) => { if (same(v.name, name)) tokens.delete(t); });
    (pages.get(String(name).toLowerCase()) || []).forEach(s => s.emit('chess-auth-failed'));
    Object.values(games).forEach(g => {
      const c = colorOf(g, name);
      if (!c) return;
      if (g.status === 'waiting') {
        delete games[g.id];
        io.to('chess:' + g.id).emit('chess-state', { gone: true, id: g.id });
      } else if (g.status === 'playing') {
        finish(g, c === 'white' ? 'black' : 'white', 'resign');
      }
    });
    save();
    lobbyChanged();
  }

  function attach(socket, getChatName) {
    let viewing = null;
    let tokenName = null;
    const getName = () => getChatName() || tokenName;
    let lastChatAt = 0;
    const err = msg => socket.emit('chess-error', msg);

    function leaveView() {
      if (viewing) { socket.leave('chess:' + viewing); viewing = null; }
    }
    function myGame(id, needPlaying) {
      const name = getName();
      const g = games[String(id || '')];
      if (!name || !g) { err('That table has been cleared.'); return null; }
      if (!colorOf(g, name)) { err("You're not playing in that game."); return null; }
      if (needPlaying && g.status !== 'playing') return null;
      return g;
    }

    socket.on('session-token', () => {
      const name = getChatName(); if (!name) return;
      socket.emit('session-token', { token: issueToken(name) });
    });
    socket.on('end-session', ({ token }) => { tokens.delete(String((token) || '')); });
    socket.on('chess-auth', ({ token }) => {
      const n = nameForToken(token);
      const acct = n && lookupAccount(n);
      if (!acct) { socket.emit('chess-auth-failed'); return; }
      tokenName = acct.name;
      const key = acct.name.toLowerCase();
      if (!pages.has(key)) pages.set(key, new Set());
      pages.get(key).add(socket);
      socket.emit('chess-auth-ok', { name: acct.name, avatar: acct.avatar || null });
    });

    socket.on('chess-lobby-enter', () => {
      const name = getName(); if (!name) return;
      socket.join('chess-lobby');
      sendLobby(socket, name);
    });
    socket.on('chess-lobby-leave', () => socket.leave('chess-lobby'));
    socket.on('chess-list', () => { const name = getName(); if (name) sendLobby(socket, name); });

    socket.on('chess-create', () => {
      const name = getName(); if (!name) return;
      const mine = Object.values(games).filter(g => g.status !== 'over' && isMine(g, name));
      const waiting = mine.find(g => g.status === 'waiting');
      if (waiting) { err('You already have a table waiting.'); socket.emit('chess-go', { id: waiting.id }); return; }
      if (mine.length >= MAX_ACTIVE_PER_PERSON) { err('You have a lot of games going. Finish one first.'); return; }
      const id = crypto.randomBytes(5).toString('hex');
      const white = crypto.randomInt(2) === 0;
      const now = Date.now();
      games[id] = { id, white: white ? name : null, black: white ? null : name, status: 'waiting', moves: [], result: null, reason: null, drawOffer: null, chat: [], created: now, updated: now };
      save();
      lobbyChanged();
      socket.emit('chess-go', { id });
    });

    socket.on('chess-join', ({ id }) => {
      const name = getName(); if (!name) return;
      const g = games[String(id || '')];
      if (!g || g.status !== 'waiting') { err('That table was just taken.'); socket.emit('chess-list-refresh'); return; }
      if (isMine(g, name)) { socket.emit('chess-go', { id: g.id }); return; }
      const active = Object.values(games).filter(x => x.status !== 'over' && isMine(x, name)).length;
      if (active >= MAX_ACTIVE_PER_PERSON) { err('You have a lot of games going. Finish one first.'); return; }
      const creator = g.white || g.black;
      if (g.white) g.black = name; else g.white = name;
      g.status = 'playing';
      touch(g);
      broadcastState(g);
      lobbyChanged();
      ping(creator, 'chess-joined', { id: g.id, name });
      socket.emit('chess-go', { id: g.id });
    });

    socket.on('chess-open', ({ id }) => {
      const name = getName(); if (!name) return;
      const g = games[String(id || '')];
      if (!g) { err('That table has been cleared.'); socket.emit('chess-state', { gone: true, id: String(id || '') }); return; }
      leaveView();
      socket.join('chess:' + g.id);
      viewing = g.id;
      socket.emit('chess-state', { game: publicGame(g), chat: g.chat.slice(-100) });
    });
    socket.on('chess-close', () => leaveView());

    socket.on('chess-move', ({ id, move }) => {
      const name = getName(); if (!name) return;
      const g = games[String(id || '')];
      if (!g || g.status !== 'playing') return;
      const c = colorOf(g, name);
      if (!c || turnOf(g) !== c) { socket.emit('chess-state', { game: publicGame(g) }); return; }
      const mv = String(move || '').toLowerCase();
      if (!/^[a-h][1-8][a-h][1-8][nbrq]?$/.test(mv)) { socket.emit('chess-state', { game: publicGame(g) }); return; }
      const next = g.moves.concat(mv);
      const rp = E.replay(next);
      if (!rp.ok) { err("That move isn't allowed."); socket.emit('chess-state', { game: publicGame(g) }); return; }
      g.moves = next;
      g.drawOffer = null;
      const st = rp.g.status();
      if (st.over) {
        finish(g, st.winner === 1 ? 'white' : st.winner === -1 ? 'black' : 'draw', st.kind);
      } else {
        touch(g);
        broadcastState(g);
        lobbyChanged();
      }
      // Someone looking at a different screen still hears that it's their turn.
      const other = c === 'white' ? g.black : g.white;
      if (other && !st.over) ping(other, 'chess-your-move', { id: g.id, from: name });
    });

    socket.on('chess-resign', ({ id }) => {
      const g = myGame(id, true); if (!g) return;
      const c = colorOf(g, getName());
      finish(g, c === 'white' ? 'black' : 'white', 'resign');
    });

    socket.on('chess-draw-offer', ({ id }) => {
      const g = myGame(id, true); if (!g) return;
      const c = colorOf(g, getName());
      if (g.drawOffer) return;
      g.drawOffer = c;
      touch(g);
      broadcastState(g);
    });
    socket.on('chess-draw-accept', ({ id }) => {
      const g = myGame(id, true); if (!g) return;
      const c = colorOf(g, getName());
      if (!g.drawOffer || g.drawOffer === c) return;
      finish(g, 'draw', 'agreement');
    });
    socket.on('chess-draw-decline', ({ id }) => {
      const g = myGame(id, true); if (!g) return;
      if (!g.drawOffer) return;
      g.drawOffer = null;
      touch(g);
      broadcastState(g);
    });

    socket.on('chess-cancel', ({ id }) => {
      const name = getName(); if (!name) return;
      const g = games[String(id || '')];
      if (!g || g.status !== 'waiting' || !isMine(g, name)) return;
      delete games[g.id];
      save();
      io.to('chess:' + g.id).emit('chess-state', { gone: true, id: g.id });
      lobbyChanged();
    });

    socket.on('chess-chat', ({ id, text }) => {
      const name = getName(); if (!name) return;
      const g = games[String(id || '')];
      if (!g || viewing !== g.id) return;
      const clean = String(text || '').trim().slice(0, 300);
      if (!clean) return;
      const now = Date.now();
      if (now - lastChatAt < 400) return; // gentle flood guard
      lastChatAt = now;
      const message = { id: crypto.randomBytes(6).toString('hex'), name, text: censor(clean), ts: now };
      g.chat.push(message);
      if (g.chat.length > MAX_CHAT) g.chat = g.chat.slice(-MAX_CHAT);
      save();
      io.to('chess:' + g.id).emit('chess-chat', { id: g.id, message });
    });

    socket.on('disconnect', () => {
      viewing = null;
      if (tokenName) { const set = pages.get(tokenName.toLowerCase()); if (set) set.delete(socket); }
    });
  }

  return { attach, onAccountDeleted, nameForToken, _games: () => games };
};
