const express = require('express');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const Match = require('./public/match.js');

function createGameServer({ turnMs = 60000, reconnectMs = 15000, invitationMs = 30000 } = {}) {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' }, maxHttpBufferSize: 16384 });
  const sessions = new Map();
  const matches = new Map();
  const invitations = new Map();
  app.use(cors());
  app.use(express.json());
  const send = (session, event, data) => {
    if (session?.socketId) io.to(session.socketId).emit(event, data);
  };
  const participants = match => match.players.map(token => sessions.get(token));
  const broadcast = match => {
    const snapshot = match.engine.snapshot();
    participants(match).forEach(session => send(session, 'match-state', snapshot));
  };
  function clearInvitations(token) {
    for (const [id, invitation] of invitations) {
      if (invitation.from !== token && invitation.to !== token) continue;
      clearTimeout(invitation.timer);
      invitations.delete(id);
      send(sessions.get(invitation.from), 'invitation-closed', { id });
      send(sessions.get(invitation.to), 'invitation-closed', { id });
    }
  }
  function disposeMatch(match) {
    clearTimeout(match.timer);
    clearTimeout(match.setupTimer);
    participants(match).forEach(session => { if (session?.matchId === match.id) session.matchId = null; });
    matches.delete(match.id);
  }
  function publish(match) {
    clearTimeout(match.timer);
    broadcast(match);
    if (match.engine.state.phase === 'NOT PLAY') {
      participants(match).forEach(session => { if (session) session.lastResult = match.engine.snapshot(); });
      disposeMatch(match);
    } else if (match.engine.state.deadline) {
      match.timer = setTimeout(() => {
        match.engine.expire();
        publish(match);
      }, Math.max(1, match.engine.state.deadline - Date.now()));
    }
  }
  function cancelMatch(match, message) {
    participants(match).forEach(session => send(session, 'match-cancelled', { matchId: match.id, message }));
    disposeMatch(match);
  }
  function ready(session, match) {
    send(session, 'match-ready', {
      matchId: match.id, host: sessions.get(match.players[0]).username,
      opponent: participants(match).find(other => other.token !== session.token).username,
      started: !!match.engine
    });
    if (match.engine) send(session, 'match-state', match.engine.snapshot());
  }
  io.on('connection', socket => {
    const getSession = () => {
      const session = sessions.get(socket.data.token);
      if (!session || session.socketId !== socket.id) throw new Error('Buat username terlebih dahulu.');
      return session;
    };
    const getMatch = data => {
      const session = getSession();
      const match = matches.get(session.matchId);
      if (!match || !data || match.id !== data.matchId) throw new Error('Pertandingan sudah tidak aktif.');
      return { session, match };
    };
    const handle = (event, handler) => socket.on(event, (data, ack) => {
      const reply = typeof ack === 'function' ? ack : () => {};
      try { reply({ ok: true, ...handler(data || {}) }); }
      catch (error) { reply({ ok: false, error: error.message }); }
    });
    handle('join', ({ username, token }) => {
      if (typeof username !== 'string' || !/^[a-zA-Z0-9_-]{1,24}$/.test(username) || username.toLowerCase() === 'computer') {
        throw new Error('Username: 1–24 huruf, angka, _ atau -. Nama Computer khusus lawan komputer.');
      }
      if (typeof token !== 'string' || token.length < 16 || token.length > 128) throw new Error('Sesi tidak valid.');
      const sameName = [...sessions.values()].find(session => session.username.toLowerCase() === username.toLowerCase() && session.token !== token);
      if (sameName) throw new Error('Username sudah dipakai. Pilih nama lain.');
      let session = sessions.get(token);
      if (session && session.username !== username && session.matchId) throw new Error('Selesaikan pertandingan sebelum mengganti username.');
      if (!session) {
        session = { token, username, socketId: socket.id, matchId: null, busy: false };
        sessions.set(token, session);
      }
      if (session.socketId && session.socketId !== socket.id) io.sockets.sockets.get(session.socketId)?.disconnect(true);
      clearTimeout(session.disconnectTimer);
      Object.assign(session, { username, socketId: socket.id });
      socket.data.token = token;
      const match = matches.get(session.matchId);
      if (match) ready(session, match);
      else if (session.lastResult) send(session, 'match-state', session.lastResult);
      return { username, matchId: session.matchId };
    });
    handle('request-users-data', () => {
      const local = getSession();
      return { users: [...sessions.values()].filter(session => session.socketId && session !== local && !session.busy && !session.matchId).map(session => session.username) };
    });
    handle('set-availability', ({ busy }) => {
      const session = getSession();
      if (session.matchId && busy) throw new Error('Kamu masih dalam pertandingan teman.');
      session.busy = !!busy;
      if (session.busy) clearInvitations(session.token);
      return {};
    });
    handle('invite', ({ invited }) => {
      const from = getSession();
      const to = [...sessions.values()].find(session => session.username === invited && session.socketId);
      if (!to || to === from) throw new Error('Pemain tidak tersedia.');
      if (from.matchId || from.busy || to.matchId || to.busy) throw new Error('Salah satu pemain sedang bermain.');
      clearInvitations(from.token);
      const id = randomUUID();
      const invitation = { id, from: from.token, to: to.token };
      invitation.timer = setTimeout(() => {
        invitations.delete(id);
        send(from, 'invitation-closed', { id, message: 'Undangan berakhir. Silakan ajak kembali.' });
        send(to, 'invitation-closed', { id });
      }, invitationMs);
      invitations.set(id, invitation);
      send(to, 'invited', { id, inviter: from.username, invited: to.username });
      return { id };
    });
    handle('answer-invitation', ({ id, accept }) => {
      const to = getSession();
      const invitation = invitations.get(id);
      if (!invitation || invitation.to !== to.token) throw new Error('Undangan sudah tidak berlaku.');
      const from = sessions.get(invitation.from);
      clearTimeout(invitation.timer);
      invitations.delete(id);
      if (!accept) {
        send(from, 'invitation-closed', { id, message: `${to.username} menolak undangan.` });
        return {};
      }
      if (!from?.socketId || from.busy || to.busy || from.matchId || to.matchId) throw new Error('Pemain sudah tidak tersedia.');
      const match = { id: randomUUID(), players: [from.token, to.token], engine: null };
      matches.set(match.id, match);
      for (const session of [from, to]) {
        session.matchId = match.id;
        session.lastResult = null;
        clearInvitations(session.token);
        ready(session, match);
      }
      match.setupTimer = setTimeout(() => cancelMatch(match, 'Pemilihan mode permainan melewati batas waktu.'), 60000);
      return {};
    });
    handle('start-match', data => {
      const { session, match } = getMatch(data);
      if (match.players[0] !== session.token || match.engine) throw new Error('Hanya pengundang yang dapat memulai pertandingan.');
      if (!Match.words(data.gameType).length) throw new Error('Mode permainan tidak valid.');
      match.engine = new Match({ id: match.id, gameType: data.gameType,
        players: participants(match).map(player => player.username),
        firstIndex: Math.floor(Math.random() * Number(data.gameType.slice(3))), turnMs });
      clearTimeout(match.setupTimer);
      publish(match);
      return {};
    });
    handle('match-input', data => {
      const { session, match } = getMatch(data);
      if (!match.engine) throw new Error('Permainan belum dimulai.');
      const result = match.engine.input(session.username, data.key, data.turn);
      if (result.changed) publish(match);
      if (result.error) throw new Error(result.error);
      return {};
    });
    handle('sync-match', data => {
      const { session, match } = getMatch(data);
      ready(session, match);
      return {};
    });
    handle('leave-match', data => {
      const { session, match } = getMatch(data);
      if (match.engine) {
        match.engine.finish(session.username, 'leave');
        publish(match);
      } else cancelMatch(match, `${session.username} membatalkan pertandingan.`);
      return {};
    });
    handle('ack-result', ({ matchId }) => {
      const session = getSession();
      if (session.lastResult?.id === matchId) session.lastResult = null;
      return {};
    });
    socket.on('disconnect', () => {
      const session = sessions.get(socket.data.token);
      if (!session || session.socketId !== socket.id) return;
      session.socketId = null;
      clearInvitations(session.token);
      session.disconnectTimer = setTimeout(() => {
        const match = matches.get(session.matchId);
        if (match?.engine) {
          match.engine.finish(session.username, 'disconnect');
          publish(match);
        } else if (match) cancelMatch(match, 'Lawan terputus sebelum permainan dimulai.');
        sessions.delete(session.token);
      }, reconnectMs);
    });
  });
  app.get('/:language(ID|EN)/:word', async (req, res) => {
    const { language, word } = req.params;
    if (!/^[a-zA-Z]{5,6}$/.test(word)) return res.status(400).json({ error: 'Kata tidak valid.' });
    const url = language === 'ID' ? `https://kbbi.kemdikbud.go.id/entri/${word}` : `https://www.dictionary.com/browse/${word}`;
    try {
      const { data } = await axios.get(url, { timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0' } });
      const $ = cheerio.load(data);
      res.json({ definition: $('ol li').first().text() || 'Definisi tidak ditemukan.' });
    } catch { res.status(502).json({ error: 'Definisi tidak dapat dimuat.' }); }
  });
  app.use(express.static(path.join(__dirname, 'public')));
  async function close() {
    for (const invitation of invitations.values()) clearTimeout(invitation.timer);
    for (const match of matches.values()) { clearTimeout(match.timer); clearTimeout(match.setupTimer); }
    await new Promise(resolve => io.close(resolve));
    for (const session of sessions.values()) clearTimeout(session.disconnectTimer);
  }
  return { app, server, io, sessions, matches, close };
}
if (require.main === module) {
  const { server } = createGameServer();
  const port = process.env.PORT || 3001;
  server.listen(port, '0.0.0.0', () => console.log(`Tarung Kata: http://localhost:${port}`));
}
module.exports = { createGameServer };
