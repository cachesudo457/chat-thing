var Engine = (function () {
  var P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var KNIGHT = [-33, -31, -18, -14, 14, 18, 31, 33];
  var KINGD = [-17, -16, -15, -1, 1, 15, 16, 17];
  var BISH = [-17, -15, 15, 17];
  var ROOK = [-16, -1, 1, 16];
    var F_EP = 1, F_CASTLE = 2, F_DBL = 4;
  var MASK = new Int8Array(128);
  for (var i = 0; i < 128; i++) MASK[i] = 15;
  MASK[116] = 12; MASK[119] = 14; MASK[112] = 13;
  MASK[4] = 3; MASK[7] = 11; MASK[0] = 7;

  function alg(s) { return 'abcdefgh'.charAt(s & 7) + (8 - (s >> 4)); }
  function fromAlg(a) { return (8 - parseInt(a.charAt(1), 10)) * 16 + 'abcdefgh'.indexOf(a.charAt(0)); }

  function Chess(fen) {
    this.b = new Int8Array(128);
    this.ks = [0, 0];
    this.hist = [];
    this.keys = [];
    this.load(fen || START);
  }

  Chess.prototype.load = function (fen) {
    var parts = fen.split(' '), rows = parts[0].split('/');
    this.b.fill(0);
    for (var r = 0; r < 8; r++) {
      var c = 0;
      for (var k = 0; k < rows[r].length; k++) {
        var ch = rows[r].charAt(k);
        if (ch >= '1' && ch <= '8') { c += parseInt(ch, 10); continue; }
        var low = ch.toLowerCase(), t = 'pnbrqk'.indexOf(low) + 1;
        var s = r * 16 + c;
        this.b[s] = ch === low ? -t : t;
        if (t === K) this.ks[ch === low ? 1 : 0] = s;
        c++;
      }
    }
    this.turn = parts[1] === 'b' ? -1 : 1;
    var cs = parts[2] || '-';
    this.castle = (cs.indexOf('K') >= 0 ? 1 : 0) | (cs.indexOf('Q') >= 0 ? 2 : 0) | (cs.indexOf('k') >= 0 ? 4 : 0) | (cs.indexOf('q') >= 0 ? 8 : 0);
    this.ep = parts[3] && parts[3] !== '-' ? fromAlg(parts[3]) : -1;
    this.half = parseInt(parts[4], 10) || 0;
    this.full = parseInt(parts[5], 10) || 1;
    this.hist = [];
    this.keys = [this.key()];
  };

  Chess.prototype.fen = function () {
    var out = [];
    for (var r = 0; r < 8; r++) {
      var row = '', e = 0;
      for (var c = 0; c < 8; c++) {
        var p = this.b[r * 16 + c];
        if (!p) { e++; continue; }
        if (e) { row += e; e = 0; }
        var l = 'pnbrqk'.charAt(Math.abs(p) - 1);
        row += p > 0 ? l.toUpperCase() : l;
      }
      if (e) row += e;
      out.push(row);
    }
    var cs = (this.castle & 1 ? 'K' : '') + (this.castle & 2 ? 'Q' : '') + (this.castle & 4 ? 'k' : '') + (this.castle & 8 ? 'q' : '');
    return out.join('/') + ' ' + (this.turn === 1 ? 'w' : 'b') + ' ' + (cs || '-') + ' ' + (this.ep >= 0 ? alg(this.ep) : '-') + ' ' + this.half + ' ' + this.full;
  };

  Chess.prototype.key = function () {
    var s = '';
    for (var r = 0; r < 8; r++) for (var c = 0; c < 8; c++) s += String.fromCharCode(this.b[r * 16 + c] + 70);
    return s + this.turn + this.castle + this.ep;
  };

  Chess.prototype.attacked = function (sq, by) {
    var b = this.b, s, d, i;
    var p1 = by === 1 ? sq + 15 : sq - 15, p2 = by === 1 ? sq + 17 : sq - 17;
    if (!(p1 & 0x88) && b[p1] === by * P) return true;
    if (!(p2 & 0x88) && b[p2] === by * P) return true;
    for (i = 0; i < 8; i++) { s = sq + KNIGHT[i]; if (!(s & 0x88) && b[s] === by * N) return true; }
    for (i = 0; i < 8; i++) { s = sq + KINGD[i]; if (!(s & 0x88) && b[s] === by * K) return true; }
    for (i = 0; i < 4; i++) {
      d = BISH[i]; s = sq + d;
      while (!(s & 0x88)) {
        if (b[s]) { if (b[s] === by * B || b[s] === by * Q) return true; break; }
        s += d;
      }
    }
    for (i = 0; i < 4; i++) {
      d = ROOK[i]; s = sq + d;
      while (!(s & 0x88)) {
        if (b[s]) { if (b[s] === by * R || b[s] === by * Q) return true; break; }
        s += d;
      }
    }
    return false;
  };

  Chess.prototype.inCheck = function () {
    return this.attacked(this.ks[this.turn === 1 ? 0 : 1], -this.turn);
  };

  function mv(f, t, p, c, pr, fl) { return { f: f, t: t, p: p, c: c, pr: pr, fl: fl, s: 0 }; }

  Chess.prototype.moves = function (capsOnly) {
    var out = [], b = this.b, us = this.turn, them = -us, s, i, d, to, tp, pr;
    var PR = [Q, R, B, N];
    for (s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      var p = b[s];
      if (!p || (p > 0 ? 1 : -1) !== us) continue;
      var t = p > 0 ? p : -p;
      if (t === P) {
        var dir = us === 1 ? -16 : 16, startRow = us === 1 ? 6 : 1, promoRow = us === 1 ? 0 : 7;
        to = s + dir;
        if (!(to & 0x88) && b[to] === 0) {
          if ((to >> 4) === promoRow) { for (pr = 0; pr < 4; pr++) out.push(mv(s, to, p, 0, PR[pr], 0)); }
          else if (!capsOnly) {
            out.push(mv(s, to, p, 0, 0, 0));
            if ((s >> 4) === startRow && b[to + dir] === 0) out.push(mv(s, to + dir, p, 0, 0, F_DBL));
          }
        }
        for (i = -1; i <= 1; i += 2) {
          to = s + dir + i;
          if (to & 0x88) continue;
          tp = b[to];
          if (tp && (tp > 0 ? 1 : -1) === them) {
            if ((to >> 4) === promoRow) { for (pr = 0; pr < 4; pr++) out.push(mv(s, to, p, tp, PR[pr], 0)); }
            else out.push(mv(s, to, p, tp, 0, 0));
          } else if (!tp && to === this.ep) {
            out.push(mv(s, to, p, -us * P, 0, F_EP));
          }
        }
      } else if (t === N || t === K) {
        var dl = t === N ? KNIGHT : KINGD;
        for (i = 0; i < 8; i++) {
          to = s + dl[i];
          if (to & 0x88) continue;
          tp = b[to];
          if (!tp) { if (!capsOnly) out.push(mv(s, to, p, 0, 0, 0)); }
          else if ((tp > 0 ? 1 : -1) === them) out.push(mv(s, to, p, tp, 0, 0));
        }
        if (t === K && !capsOnly) {
          if (us === 1 && s === 116) {
            if ((this.castle & 1) && !b[117] && !b[118] && b[119] === R && !this.attacked(116, -1) && !this.attacked(117, -1) && !this.attacked(118, -1)) out.push(mv(116, 118, p, 0, 0, F_CASTLE));
            if ((this.castle & 2) && !b[115] && !b[114] && !b[113] && b[112] === R && !this.attacked(116, -1) && !this.attacked(115, -1) && !this.attacked(114, -1)) out.push(mv(116, 114, p, 0, 0, F_CASTLE));
          } else if (us === -1 && s === 4) {
            if ((this.castle & 4) && !b[5] && !b[6] && b[7] === -R && !this.attacked(4, 1) && !this.attacked(5, 1) && !this.attacked(6, 1)) out.push(mv(4, 6, p, 0, 0, F_CASTLE));
            if ((this.castle & 8) && !b[3] && !b[2] && !b[1] && b[0] === -R && !this.attacked(4, 1) && !this.attacked(3, 1) && !this.attacked(2, 1)) out.push(mv(4, 2, p, 0, 0, F_CASTLE));
          }
        }
      } else {
        var dirs = t === B ? BISH : t === R ? ROOK : KINGD;
        for (i = 0; i < dirs.length; i++) {
          d = dirs[i]; to = s + d;
          while (!(to & 0x88)) {
            tp = b[to];
            if (!tp) { if (!capsOnly) out.push(mv(s, to, p, 0, 0, 0)); }
            else { if ((tp > 0 ? 1 : -1) === them) out.push(mv(s, to, p, tp, 0, 0)); break; }
            to += d;
          }
        }
      }
    }
    return out;
  };

  Chess.prototype.make = function (m) {
    var b = this.b, us = this.turn, idx = us === 1 ? 0 : 1;
    this.hist.push({ m: m, castle: this.castle, ep: this.ep, half: this.half });
    b[m.t] = m.pr ? us * m.pr : m.p;
    b[m.f] = 0;
    if (m.fl & F_EP) b[m.t - (us === 1 ? -16 : 16)] = 0;
    if (m.fl & F_CASTLE) {
      if (m.t > m.f) { b[m.t - 1] = b[m.t + 1]; b[m.t + 1] = 0; }
      else { b[m.t + 1] = b[m.t - 2]; b[m.t - 2] = 0; }
    }
    if (m.p === K || m.p === -K) this.ks[idx] = m.t;
    this.castle &= MASK[m.f] & MASK[m.t];
    this.ep = (m.fl & F_DBL) ? (m.f + m.t) >> 1 : -1;
    if (m.p === P || m.p === -P || m.c) this.half = 0; else this.half++;
    if (us === -1) this.full++;
    this.turn = -us;
    if (this.attacked(this.ks[idx], -us)) { this.undo(); return false; }
    return true;
  };

  Chess.prototype.undo = function () {
    var u = this.hist.pop(), m = u.m, b = this.b;
    this.turn = -this.turn;
    var us = this.turn, idx = us === 1 ? 0 : 1;
    b[m.f] = m.p;
    b[m.t] = (m.fl & F_EP) ? 0 : (m.c || 0);
    if (m.fl & F_EP) b[m.t - (us === 1 ? -16 : 16)] = -us * P;
    if (m.fl & F_CASTLE) {
      if (m.t > m.f) { b[m.t + 1] = b[m.t - 1]; b[m.t - 1] = 0; }
      else { b[m.t - 2] = b[m.t + 1]; b[m.t + 1] = 0; }
    }
    if (m.p === K || m.p === -K) this.ks[idx] = m.f;
    this.castle = u.castle; this.ep = u.ep; this.half = u.half;
    if (us === -1) this.full--;
  };

  Chess.prototype.legal = function () {
    var ms = this.moves(), out = [];
    for (var i = 0; i < ms.length; i++) { if (this.make(ms[i])) { this.undo(); out.push(ms[i]); } }
    return out;
  };

  Chess.prototype.san = function (m, legalList) {
    if (m.fl & F_CASTLE) return m.t > m.f ? 'O-O' : 'O-O-O';
    var t = Math.abs(m.p), s = '';
    if (t === P) {
      if (m.c) s += 'abcdefgh'.charAt(m.f & 7) + 'x';
      s += alg(m.t);
      if (m.pr) s += '=' + 'PNBRQK'.charAt(m.pr - 1);
      return s;
    }
    s += 'PNBRQK'.charAt(t - 1);
    var sameFile = false, sameRank = false, other = false;
    for (var i = 0; i < legalList.length; i++) {
      var o = legalList[i];
      if (o.f !== m.f && o.t === m.t && o.p === m.p) {
        other = true;
        if ((o.f & 7) === (m.f & 7)) sameFile = true;
        if ((o.f >> 4) === (m.f >> 4)) sameRank = true;
      }
    }
    if (other) {
      if (!sameFile) s += 'abcdefgh'.charAt(m.f & 7);
      else if (!sameRank) s += (8 - (m.f >> 4));
      else s += alg(m.f);
    }
    if (m.c) s += 'x';
    return s + alg(m.t);
  };

  Chess.prototype.play = function (m) {
    var legal = this.legal();
    var san = this.san(m, legal);
    this.make(m);
    this.keys.push(this.key());
    var chk = this.inCheck();
    if (chk) san += this.legal().length === 0 ? '#' : '+';
    return { san: san, check: chk };
  };

  Chess.prototype.insufficient = function () {
    var minors = 0;
    for (var s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      var t = Math.abs(this.b[s]);
      if (t === P || t === R || t === Q) return false;
      if (t === N || t === B) minors++;
    }
    return minors <= 1;
  };

  Chess.prototype.status = function () {
    var legal = this.legal();
    if (legal.length === 0) {
      if (this.inCheck()) return { over: true, kind: 'checkmate', winner: -this.turn };
      return { over: true, kind: 'stalemate', winner: 0 };
    }
    if (this.insufficient()) return { over: true, kind: 'material', winner: 0 };
    if (this.half >= 100) return { over: true, kind: 'fifty', winner: 0 };
    var k = this.keys[this.keys.length - 1], n = 0;
    for (var i = 0; i < this.keys.length; i++) if (this.keys[i] === k) n++;
    if (n >= 3) return { over: true, kind: 'repetition', winner: 0 };
    return { over: false };
  };

  Chess.prototype.perft = function (d) {
    if (d === 0) return 1;
    var n = 0, ms = this.moves();
    for (var i = 0; i < ms.length; i++) {
      if (this.make(ms[i])) { n += d === 1 ? 1 : this.perft(d - 1); this.undo(); }
    }
    return n;
  };

  // Rebuilds a game from a list of moves like "e2e4" or "e7e8q". Stops at the first move that is not legal.
  function replay(moves) {
    var g = new Chess(), sans = [], last = null, ok = true;
    for (var i = 0; i < moves.length; i++) {
      var s = String(moves[i]), f = fromAlg(s.substr(0, 2)), t = fromAlg(s.substr(2, 2)), pr = s.length > 4 ? 'pnbrqk'.indexOf(s.charAt(4)) + 1 : 0;
      var m = g.legal().filter(function (x) { return x.f === f && x.t === t && (x.pr || 0) === pr; })[0];
      if (!m) { ok = false; break; }
      sans.push(g.play(m).san); last = { f: f, t: t };
    }
    return { g: g, sans: sans, last: last, ok: ok };
  }
  return { Chess: Chess, START: START, alg: alg, fromAlg: fromAlg, replay: replay };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
