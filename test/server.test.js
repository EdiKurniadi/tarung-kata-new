const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const io = require('../public/socket-lib.js');
const { createGameServer } = require('../index.js');
const Match = require('../public/match.js');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function event(socket, name) {
  return new Promise((resolve, reject) => {
    const handler = data => { clearTimeout(timeout); resolve(data); };
    const timeout = setTimeout(() => { socket.off(name, handler); reject(new Error(`Missing event ${name}`)); }, 3000);
    socket.once(name, handler);
  });
}
function request(socket, name, data = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`No ack for ${name}`)), 3000);
    socket.emit(name, data, result => { clearTimeout(timeout); resolve(result); });
  });
}
async function fixture(t, options = {}) {
  const game = createGameServer(options);
  await new Promise(resolve => game.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${game.server.address().port}`;
  const clients = [];
  t.after(async () => { clients.forEach(socket => socket.disconnect()); await game.close(); });
  async function client(username, token = randomUUID()) {
    const socket = io(url, { transports: ['websocket'], autoConnect: false, reconnection: false, forceNew: true });
    clients.push(socket);
    const connected = event(socket, 'connect');
    socket.connect();
    await connected;
    assert.equal((await request(socket, 'join', { username, token })).ok, true);
    return { socket, username, token };
  }
  const a = await client('Alice');
  const b = await client('Bob');
  async function pair(mode = 'EN-5') {
    const invited = event(b.socket, 'invited');
    const invitation = await request(a.socket, 'invite', { invited: b.username });
    assert.equal(invitation.ok, true);
    assert.equal((await invited).id, invitation.id);
    const readyA = event(a.socket, 'match-ready');
    const readyB = event(b.socket, 'match-ready');
    assert.equal((await request(b.socket, 'answer-invitation', { id: invitation.id, accept: true })).ok, true);
    const [one, two] = await Promise.all([readyA, readyB]);
    assert.equal(one.matchId, two.matchId);
    const stateA = event(a.socket, 'match-state');
    const stateB = event(b.socket, 'match-state');
    assert.equal((await request(a.socket, 'start-match', { matchId: one.matchId, gameType: mode })).ok, true);
    const [first, second] = await Promise.all([stateA, stateB]);
    assert.deepEqual(first, second);
    return first;
  }
  return { ...game, a, b, pair, client, url };
}

test('server serves the complete game from the same origin', async t => {
  const f = await fixture(t);
  assert.match(await (await fetch(f.url)).text(), /match.js/);
  assert.equal((await fetch(`${f.url}/match.js`)).status, 200);
  assert.equal((await fetch(`${f.url}/database.js`)).status, 200);
  for (const file of ['/package.json', '/test/server.test.js', '/.git/config']) {
    assert.equal((await fetch(`${f.url}${file}`)).status, 404);
  }
});
test('username ownership, duplicate names, and computer presence are enforced', async t => {
  const f = await fixture(t);
  assert.equal((await request(f.b.socket, 'join', { username: 'alice', token: f.b.token })).ok, false);
  assert.equal((await request(f.b.socket, 'join', { username: 'Computer', token: f.b.token })).ok, false);
  assert.deepEqual((await request(f.a.socket, 'request-users-data')).users, ['Bob']);
  await request(f.b.socket, 'set-availability', { busy: true });
  assert.deepEqual((await request(f.a.socket, 'request-users-data')).users, []);
  assert.equal((await request(f.a.socket, 'invite', { invited: 'Bob' })).ok, false);
  await request(f.b.socket, 'set-availability', { busy: false });
  assert.deepEqual((await request(f.a.socket, 'request-users-data')).users, ['Bob']);
});
test('expired, rejected, and unauthorized invitations cannot start games', async t => {
  const f = await fixture(t, { invitationMs: 100 });
  const invite = await request(f.a.socket, 'invite', { invited: 'Bob' });
  assert.equal((await request(f.a.socket, 'answer-invitation', { id: invite.id, accept: true })).ok, false);
  assert.equal((await request(f.b.socket, 'answer-invitation', { id: invite.id, accept: false })).ok, true);
  assert.equal((await request(f.b.socket, 'answer-invitation', { id: invite.id, accept: true })).ok, false);
  const next = await request(f.a.socket, 'invite', { invited: 'Bob' });
  await wait(120);
  assert.equal((await request(f.b.socket, 'answer-invitation', { id: next.id, accept: true })).ok, false);
  assert.equal(f.matches.size, 0);
});
test('online game validates sender, mode, turn, and broadcasts identical state', async t => {
  const f = await fixture(t);
  const state = await f.pair('EN-6');
  assert.equal(state.currentPlayer, 'Alice');
  assert.equal(state.gameType, 'EN-6');
  assert.equal((await request(f.b.socket, 'start-match', { matchId: state.id, gameType: 'EN-5' })).ok, false);
  assert.equal((await request(f.b.socket, 'match-input', { matchId: state.id, turn: 0, key: 'a' })).ok, false);
  assert.equal((await request(f.a.socket, 'match-input', { matchId: 'other', turn: 0, key: 'a' })).ok, false);
  const aState = event(f.a.socket, 'match-state');
  const bState = event(f.b.socket, 'match-state');
  await request(f.a.socket, 'match-input', { matchId: state.id, turn: 0, key: 'a' });
  const [one, two] = await Promise.all([aState, bState]);
  assert.deepEqual(one, two);
  assert.equal(one.draft, 'a');
  assert.equal(one.deadline, state.deadline);
  const c = await f.client('Charlie');
  assert.equal((await request(c.socket, 'match-input', { matchId: state.id, turn: 0, key: 'b' })).ok, false);
  assert.equal((await request(c.socket, 'invite', { invited: 'Alice' })).ok, false);
});
test('server changes turns after a valid guess and complete rule selection', async t => {
  const f = await fixture(t);
  const state = await f.pair();
  const engine = f.matches.get(state.id).engine;
  const word = engine.candidates()[0];
  for (const key of word + '\n') {
    assert.equal((await request(f.a.socket, 'match-input', { matchId: state.id, turn: 0, key: key === '\n' ? 'Enter' : key })).ok, true);
  }
  assert.equal(engine.state.phase, 'SETTING');
  const plan = Match.rulePlans(word, Match.requiredRules(engine.state.rows.length))[0];
  for (const index of plan) await request(f.a.socket, 'match-input', { matchId: state.id, turn: 0, key: String(index + 1) });
  await request(f.a.socket, 'match-input', { matchId: state.id, turn: 0, key: 'Enter' });
  assert.equal(engine.state.currentPlayer, 'Bob');
  assert.equal(engine.state.turn, 1);
  assert.equal((await request(f.a.socket, 'match-input', { matchId: state.id, turn: 0, key: 'a' })).ok, false);
  assert.equal((await request(f.b.socket, 'match-input', { matchId: state.id, turn: 1, key: 'a' })).ok, true);
});
test('server deadline declares exactly one winner and permits a rematch', async t => {
  const f = await fixture(t, { turnMs: 150 });
  const state = await f.pair();
  const endedA = event(f.a.socket, 'match-state');
  const endedB = event(f.b.socket, 'match-state');
  const [one, two] = await Promise.all([endedA, endedB]);
  assert.deepEqual(one, two);
  assert.equal(one.phase, 'NOT PLAY');
  assert.equal(one.winner, 'Bob');
  assert.equal(one.loser, 'Alice');
  assert.equal(f.matches.size, 0);
  assert.equal((await request(f.a.socket, 'match-input', { matchId: state.id, turn: 0, key: 'Enter' })).ok, false);
  const rematch = await f.pair();
  assert.notEqual(rematch.id, state.id);
});
test('reconnect restores the server state and original deadline', async t => {
  const f = await fixture(t);
  const state = await f.pair();
  await request(f.a.socket, 'match-input', { matchId: state.id, turn: 0, key: 'z' });
  f.a.socket.disconnect();
  await wait(30);
  const socket = io(f.url, { transports: ['websocket'], reconnection: false, autoConnect: false, forceNew: true });
  t.after(() => socket.disconnect());
  const connected = event(socket, 'connect'); socket.connect(); await connected;
  const restored = event(socket, 'match-state');
  assert.equal((await request(socket, 'join', { username: f.a.username, token: f.a.token })).ok, true);
  const snapshot = await restored;
  assert.equal(snapshot.id, state.id);
  assert.equal(snapshot.draft, 'z');
  assert.equal(snapshot.deadline, state.deadline);
});
test('disconnect beyond grace period ends match and releases the remaining player', async t => {
  const f = await fixture(t, { reconnectMs: 70 });
  await f.pair();
  const ended = event(f.b.socket, 'match-state');
  f.a.socket.disconnect();
  const state = await ended;
  assert.equal(state.reason, 'disconnect');
  assert.equal(state.winner, 'Bob');
  assert.equal(f.matches.size, 0);
  assert.equal((await request(f.b.socket, 'set-availability', { busy: true })).ok, true);
});
test('leaving ends the game; delayed old packets cannot affect a new match', async t => {
  const f = await fixture(t);
  const old = await f.pair();
  const ended = event(f.b.socket, 'match-state');
  await request(f.a.socket, 'leave-match', { matchId: old.id });
  assert.equal((await ended).winner, 'Bob');
  const next = await f.pair('ID-5');
  assert.equal((await request(f.a.socket, 'match-input', { matchId: old.id, turn: 0, key: 'x' })).ok, false);
  assert.equal(f.matches.get(next.id).engine.state.draft, '');
});
