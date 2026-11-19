const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dictionaries = require('../public/database.js');
const source = name => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const storage = () => {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
};
function clock() {
  let now = 100000;
  let id = 0;
  const tasks = new Map();
  const add = (fn, delay, interval = false) => { tasks.set(++id, { fn, delay, at: now + delay, interval }); return id; };
  return {
    now: () => now,
    setTimeout: (fn, delay) => add(fn, delay),
    setInterval: (fn, delay) => add(fn, delay, true),
    clear: task => tasks.delete(task),
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const [taskId, task] = [...tasks].sort((a, b) => a[1].at - b[1].at)[0] || [];
        if (!task || task.at > target) break;
        now = task.at;
        if (task.interval) task.at += task.delay; else tasks.delete(taskId);
        task.fn();
        await new Promise(resolve => setImmediate(resolve));
      }
      now = target;
      await new Promise(resolve => setImmediate(resolve));
    }
  };
}
function harness() {
  const time = clock();
  const localStorage = storage();
  const sessionStorage = storage();
  localStorage.setItem('localUsername', 'Alice');
  const ui = { last: null, render(state) { this.last = JSON.parse(JSON.stringify(state)); },
    updateInfoGame() {}, updateInfoPlayer() {}, showInfoPlayer() {}, hideInfoPlayer() {}, setUsername() {}, escape: String };
  const notifications = { wins: 0, losses: 0, close() {}, showShortMessage() {},
    win() { this.wins++; }, lose() { this.losses++; }, showGameTypeOptions() {} };
  const seen = new Set();
  const stats = { played: 0, wins: 0, recordPlayed(id) { if (!seen.has(`p:${id}`)) { seen.add(`p:${id}`); this.played++; } },
    recordResult(id, won) { if (seen.has(`r:${id}`)) return false; seen.add(`r:${id}`); if (won) this.wins++; return true; }, updateUsedWords() {} };
  const handlers = {};
  const network = { isActive: true, on(name, fn) { handlers[name] = fn; }, setBusy: async () => {}, request: async () => ({}), join: async () => {} };
  const context = vm.createContext({ ...dictionaries, localStorage, sessionStorage, network,
    elementUI: ui, notification: notifications, gameStats: stats,
    timer: { watch() {}, clear() {} },
    input: { onHandleKeyPressed() {}, isGameKey: key => /^[a-z1-6]$|^Enter$|^Backspace$/i.test(key) },
    wordsManager: { applyState() {}, findTheMissWord: () => [] },
    winSound: { play() {} }, loseSound: { play() {} }, unlockSound: { play() {} },
    window: { addEventListener() {} },
    Date: class extends Date { static now() { return time.now(); } },
    setTimeout: time.setTimeout, setInterval: time.setInterval, clearInterval: time.clear, clearTimeout: time.clear
  });
  for (const name of ['match.js', 'userManager.js', 'ai.js', 'game.js', 'history.js']) vm.runInContext(source(name), context, { filename: name });
  return { context, time, localStorage, sessionStorage, ui, notifications, stats, network, handlers,
    game: vm.runInContext('game', context), Match: context.WordWarMatch,
    user: vm.runInContext('userManager', context), history: vm.runInContext('gameHistory', context) };
}
function computerTurn(f, phase = 'GUESS', count = 1) {
  const match = new f.Match({ id: `test-${count}`, gameType: 'EN-5', players: ['Alice', 'Computer'], firstWord: 'apple', now: f.time.now() });
  match.state.currentPlayer = 'Computer';
  match.state.phase = phase;
  if (phase === 'SETTING') {
    match.state.rows = Array.from({ length: count }, (_, i) => ({ word: i === count - 1 ? 'level' : 'apple', selected: [] }));
    match.state.deadline = null;
  }
  f.game.isVsAI = true;
  f.game.localMatch = match;
  f.game.applyState(match.snapshot());
  return match;
}

test('actual computer controller guesses, chooses rules, and returns the turn', async () => {
  const f = harness();
  const match = computerTurn(f);
  f.game.handleAITurn();
  await f.time.advance(5000);
  assert.equal(match.state.phase, 'GUESS');
  assert.equal(match.state.currentPlayer, 'Alice');
  assert.equal(match.state.rows.length, 2);
  assert.equal(match.state.criteria.length, 1);
  assert.equal(f.notifications.wins + f.notifications.losses, 0);
});
test('actual computer controller completes one through four required rules without stalling', async () => {
  for (const [count, colors] of [[2, 1], [4, 2], [6, 3], [8, 4]]) {
    const f = harness();
    const match = computerTurn(f, 'SETTING', count);
    f.game.handleAITurn();
    await f.time.advance(5000);
    assert.equal(match.state.phase, 'GUESS');
    assert.equal(match.state.currentPlayer, 'Alice');
    assert.equal(match.state.criteria.length, colors);
  }
});
test('cancelling a pending computer turn prevents stale moves in the next game', async () => {
  const f = harness();
  const old = computerTurn(f);
  f.game.handleAITurn();
  await f.time.advance(100);
  await f.game.leave();
  assert.equal(old.state.phase, 'NOT PLAY');
  f.game.state = null;
  f.game.isVsAI = true;
  f.game.chooseGameType('EN-6');
  const next = f.game.localMatch;
  await f.time.advance(5000);
  assert.equal(old.state.rows.length, 1);
  assert.equal(next.state.currentPlayer, 'Alice');
  assert.equal(next.state.draft, '');
  assert.equal(next.state.rows.length, 1);
});
test('a timeout during computer animation ends exactly once and stale typing stops', async () => {
  const f = harness();
  const match = computerTurn(f);
  match.state.deadline = f.time.now() + 550;
  f.game.handleAITurn();
  await f.time.advance(5000);
  assert.equal(match.state.phase, 'NOT PLAY');
  assert.equal(match.state.winner, 'Alice');
  assert.equal(f.notifications.wins, 1);
  assert.equal(f.notifications.losses, 0);
  assert.equal(f.stats.wins, 1);
  assert.equal(match.state.rows.length, 1);
  f.game.applyState(match.snapshot());
  assert.equal(f.notifications.wins, 1);
  assert.equal(f.stats.wins, 1);
});
test('computer checkmate awards the human a single win', async () => {
  const f = harness();
  const match = computerTurn(f);
  match.state.criteria = [{ color: 'Hijau', index: 0, letter: '!' }];
  f.game.handleAITurn();
  await f.time.advance(2000);
  assert.equal(match.state.reason, 'no-words');
  assert.equal(f.notifications.wins, 1);
  assert.equal(f.stats.wins, 1);
});
test('saved computer mode restores phase, selected colors, and absolute deadline', () => {
  const f = harness();
  const match = computerTurn(f, 'SETTING', 8);
  match.input('Computer', '1', 0);
  f.history.save(match);
  const restored = f.history.restore();
  assert.equal(restored.state.phase, 'SETTING');
  assert.equal(restored.state.currentPlayer, 'Computer');
  assert.equal(restored.state.selected.length, 1);
  assert.equal(restored.state.selected[0], 0);
  restored.state.phase = 'GUESS';
  restored.state.deadline = f.time.now() + 12000;
  f.history.save(restored);
  assert.equal(f.history.restore().state.deadline, restored.state.deadline);
  assert.equal(f.stats.played, 1);
});
test('reloading an expired saved computer match cannot extend the turn', async () => {
  const f = harness();
  const match = computerTurn(f);
  match.state.currentPlayer = 'Alice';
  match.state.deadline = f.time.now() + 1000;
  f.history.save(match);
  await f.time.advance(1200);
  await f.game.init();
  assert.equal(f.game.state.phase, 'NOT PLAY');
  assert.equal(f.game.state.winner, 'Computer');
  assert.equal(f.notifications.losses, 1);
});
test('in-flight online acceptance wins cleanly over simultaneous computer selection', async () => {
  const f = harness();
  let rejectBusy;
  f.network.setBusy = () => new Promise((resolve, reject) => { rejectBusy = reject; });
  const settingUp = f.game.setupAiGame();
  f.game.handleMatchReady({ matchId: 'online', host: 'Bob', opponent: 'Bob', started: false });
  rejectBusy(new Error('Kamu masih dalam pertandingan teman.'));
  await settingUp;
  assert.equal(f.game.isVsAI, false);
  assert.equal(f.game.waitingMatch.matchId, 'online');
  assert.equal(f.game.currentState, 'WAITING');
});
test('server restart clears stale waiting matches instead of leaving the UI blocked', () => {
  const f = harness();
  f.game.waitingMatch = { matchId: 'gone' };
  f.network.onConnect({ matchId: null });
  assert.equal(f.game.waitingMatch, null);
  assert.equal(f.game.currentState, 'NOT PLAY');
});
test('reconnecting during offline computer play releases an old online match', async () => {
  const f = harness();
  computerTurn(f);
  const calls = [];
  f.network.request = async (event, data) => { calls.push({ event, data }); return {}; };
  f.network.setBusy = async busy => { calls.push({ busy }); };
  f.game.handleMatchReady({ matchId: 'old-online', host: 'Bob', opponent: 'Bob', started: true });
  assert.equal(f.game.waitingMatch, null);
  f.network.onConnect({ matchId: 'old-online' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls[0].event, 'leave-match');
  assert.equal(calls[0].data.matchId, 'old-online');
  assert.equal(calls[1].busy, true);
  assert.equal(f.game.isVsAI, true);
  assert.equal(f.game.localMatch.state.id, 'test-1');
});
test('each tab retains its own username after another tab changes the saved name', () => {
  const f = harness();
  assert.equal(f.user.localUsername, 'Alice');
  f.localStorage.setItem('localUsername', 'Bob');
  const restoredName = vm.runInContext('new UserManager().localUsername', f.context);
  assert.equal(restoredName, 'Alice');
});
test('timer uses an absolute deadline, expires once, and leaves unrelated intervals intact', async () => {
  const time = clock();
  const elements = { minute: {}, second: {} };
  let unrelated = 0;
  let expired = 0;
  const context = vm.createContext({
    document: { getElementById: name => elements[name] },
    setInterval: time.setInterval, clearInterval: time.clear
  });
  vm.runInContext(source('timer.js'), context);
  const timer = vm.runInContext('timer', context);
  time.setInterval(() => unrelated++, 100);
  timer.watch(time.now() + 1000, time.now, () => expired++);
  await time.advance(550);
  timer.watch(101000, time.now, () => expired++);
  await time.advance(1000);
  assert.equal(expired, 1);
  assert.equal(elements.minute.innerText, '00');
  assert.equal(elements.second.innerText, '00');
  assert.ok(unrelated >= 15);
});
test('Enter used to dismiss a dialog is not replayed as game input on keyup', () => {
  let dialogOpen = true;
  const handlers = {};
  const context = vm.createContext({ document: {
    querySelectorAll: () => [], querySelector: () => dialogOpen,
    addEventListener: (event, handler) => { handlers[event] = handler; }
  } });
  vm.runInContext(source('input.js'), context);
  const input = vm.runInContext('input', context);
  let keys = 0;
  input.onHandleKeyPressed(() => keys++);
  handlers.keydown({ key: 'Enter' });
  dialogOpen = false;
  handlers.keyup({ key: 'Enter' });
  assert.equal(keys, 0);
  handlers.keydown({ key: 'a', preventDefault() {} });
  handlers.keyup({ key: 'a' });
  assert.equal(keys, 1);
});
test('shared-browser statistics count each player result once, including the winner', () => {
  const base = storage();
  const localStorage = new Proxy(base, {
    get(target, key) { return key in target ? target[key] : target.getItem(key); },
    set(target, key, value) { target.setItem(key, value); return true; }
  });
  const elements = { '.number-played': {}, '.win-amount': {}, '.list-used-word': {} };
  const userManager = { localUsername: 'Alice' };
  const context = vm.createContext({ localStorage, userManager,
    window: { addEventListener() {} }, document: { querySelector: selector => elements[selector] } });
  vm.runInContext(source('statistic.js'), context);
  const stats = vm.runInContext('gameStats', context);
  stats.recordPlayed('match'); stats.recordPlayed('match');
  assert.equal(localStorage.numberPlayed, '1');
  assert.equal(stats.recordResult('match', false), true);
  userManager.localUsername = 'Bob';
  stats.recordPlayed('match');
  assert.equal(localStorage.numberPlayed, '2');
  assert.equal(stats.recordResult('match', true), true);
  assert.equal(localStorage.winAmount, '1');
  assert.equal(stats.recordResult('match', true), false);
  assert.equal(localStorage.winAmount, '1');
});
