const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Match = require('../public/match.js');
const context = vm.createContext({ WordWarMatch: Match });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/ai.js'), 'utf8') + '\nglobalThis.ai = aiOpponent;', context);
const ai = context.ai;
const create = (gameType = 'EN-5') => new Match({ id: 'test', gameType, players: ['Alice', 'Computer'], now: 1000 });
function type(match, word, now = 2000) {
  for (const key of word) assert.equal(match.input(match.state.currentPlayer, key, match.state.turn, now).error, undefined);
  return match.input(match.state.currentPlayer, 'Enter', match.state.turn, now);
}

test('all three modes use unique words of the requested length', () => {
  for (const mode of ['ID-5', 'EN-5', 'EN-6']) {
    const words = Match.words(mode);
    assert.ok(words.length > 2000);
    assert.equal(new Set(words).size, words.length);
    assert.ok(words.every(word => word.length === Number(mode.slice(3))));
  }
});
test('green, orange, red, and black preserve the documented meanings', () => {
  const rules = [
    { color: 'Hijau', index: 0, letter: 'a' },
    { color: 'Jingga', index: 2, letter: 'b' },
    { color: 'Merah', index: 3, letter: 'c' },
    { color: 'Hitam', index: 4, letter: 'd' }
  ];
  assert.ok(Match.follows('abcef', rules));
  for (const word of ['bbcef', 'accef', 'abbcf', 'abdef']) assert.equal(Match.follows(word, rules), false);
  assert.ok(Match.follows('abcef', [{ color: 'Jingga', index: 1, letter: 'b' }]));
});
test('rejects unsupported modes, duplicate players, and invalid initial configurations', () => {
  assert.throws(() => create('ID-6'));
  assert.throws(() => new Match({ id: 'x', gameType: 'EN-5', players: ['A', 'A'] }));
  assert.throws(() => new Match({ id: 'x', gameType: 'EN-5', players: ['A', 'B'], firstIndex: 6 }));
});
test('only current player and current turn may change state', () => {
  const match = create();
  assert.match(match.input('Computer', 'a', 0, 2000).error, /giliran/);
  assert.match(match.input('Alice', 'a', -1, 2000).error, /giliran/);
  assert.equal(match.state.draft, '');
  assert.equal(match.input('Alice', {}, 0, 2000).error, 'Input tidak valid.');
});
test('rejects incomplete, unknown, repeated, and incompatible guesses', () => {
  const match = new Match({ id: 'x', gameType: 'EN-5', players: ['Alice', 'Computer'], firstWord: 'apple', now: 1000 });
  assert.match(match.input('Alice', 'Enter', 0, 2000).error, /5 huruf/);
  assert.match(type(match, 'zzzzz').error, /kamus/);
  for (let i = 0; i < 5; i++) match.input('Alice', 'Backspace', 0, 2000);
  assert.match(type(match, 'apple').error, /digunakan/);
  for (let i = 0; i < 5; i++) match.input('Alice', 'Backspace', 0, 2000);
  assert.match(type(match, 'world').error, /kriteria/);
  assert.equal(match.state.phase, 'GUESS');
});
test('first turn starts immediately, deadline is exact, finish is idempotent', () => {
  const match = create();
  assert.equal(match.state.deadline, 61000);
  assert.equal(match.expire(60999), false);
  assert.equal(match.expire(61000), true);
  assert.equal(match.state.winner, 'Computer');
  assert.equal(match.state.loser, 'Alice');
  assert.equal(match.finish('Computer', 'leave'), false);
  assert.equal(match.state.winner, 'Computer');
});
test('input arriving at or after the deadline cannot submit a winning word', () => {
  const match = create();
  assert.ok(match.input('Alice', 'a', 0, 61000).changed);
  assert.equal(match.state.phase, 'NOT PLAY');
  assert.equal(match.state.draft, '');
});
test('AI supplies every required color and avoids repeated-letter conflicts', () => {
  for (const [count, required] of [[2, 1], [4, 2], [6, 3], [8, 4], [20, 4]]) {
    const match = create();
    match.state.phase = 'SETTING';
    match.state.rows = Array.from({ length: count }, () => ({ word: 'level', selected: [] }));
    const plan = ai.determineRules(match);
    assert.equal(plan.length, required);
    assert.ok(Match.validSelection('level', plan));
    assert.equal(new Set(plan).size, required);
    for (const index of plan) assert.equal(match.input('Alice', String(index + 1), 0, 2000).error, undefined);
    assert.equal(match.input('Alice', 'Enter', 0, 2000).error, undefined);
    assert.equal(match.state.phase, 'GUESS');
    assert.equal(match.state.currentPlayer, 'Computer');
    assert.equal(match.state.deadline, 62000);
  }
});
test('rules can be undone and partial selections cannot end a turn', () => {
  const match = create();
  match.state.phase = 'SETTING';
  match.state.rows = Array.from({ length: 8 }, () => ({ word: 'level', selected: [] }));
  match.state.deadline = null;
  match.input('Alice', '1', 0, 2000);
  assert.match(match.input('Alice', '1', 0, 2000).error, /kotak berbeda/);
  assert.match(match.input('Alice', 'Enter', 0, 2000).error, /4 warna/);
  match.input('Alice', 'Backspace', 0, 2000);
  assert.deepEqual(match.state.selected, []);
  assert.equal(match.state.deadline, null);
});
test('black cannot exclude a repeated letter already selected green or orange', () => {
  assert.equal(Match.validSelection('level', [0, 1, 2, 4]), false);
  assert.equal(Match.validSelection('level', [0, 1, 4, 3]), false);
  assert.equal(Match.validSelection('level', [0, 1, 4, 2]), true);
});
test('snapshot is independent of live state and AI recognizes checkmate', () => {
  const match = create();
  const snapshot = match.snapshot(2000);
  snapshot.rows[0].word = 'xxxxx';
  assert.notEqual(match.state.rows[0].word, 'xxxxx');
  match.state.criteria = [{ color: 'Hijau', index: 0, letter: '!' }];
  assert.equal(ai.guessWord(match), null);
});
for (const mode of ['ID-5', 'EN-5', 'EN-6']) {
  test(`${mode}: alternating turns continue through all four rule stages`, () => {
    const match = create(mode);
    for (let round = 0; round < 12; round++) {
      const word = match.candidates()[0];
      assert.ok(word, `playable word at round ${round}`);
      assert.equal(type(match, word).error, undefined);
      const required = Match.requiredRules(match.state.rows.length);
      const used = new Set(match.state.rows.map(row => row.word));
      const plan = Match.rulePlans(word, required).find(indices => {
        const criteria = Match.criteria(word, indices);
        return Match.words(mode).some(candidate => !used.has(candidate) && Match.follows(candidate, criteria));
      });
      assert.ok(plan);
      const player = match.state.currentPlayer;
      const turn = match.state.turn;
      for (const index of plan) match.input(player, String(index + 1), turn, 2000);
      assert.equal(match.input(player, 'Enter', turn, 2000).error, undefined);
      assert.notEqual(match.state.currentPlayer, player);
      assert.equal(match.state.turn, turn + 1);
      assert.equal(match.state.criteria.length, required);
      assert.match(match.input(player, 'a', turn, 2000).error, /giliran/);
    }
    assert.equal(match.state.criteria.length, 4);
  });
}
