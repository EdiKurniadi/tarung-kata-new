// One rules engine for local computer games and authoritative online games.
(function (root, factory) {
  const dictionaries = typeof module === 'object' && module.exports
    ? require('./database.js') : { indWords5, engWords5, engWords6 };
  const Match = factory(dictionaries);
  if (typeof module === 'object' && module.exports) module.exports = Match;
  else root.WordWarMatch = Match;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (dictionaries) {
  const modes = {
    'ID-5': [...new Set(dictionaries.indWords5)],
    'EN-5': [...new Set(dictionaries.engWords5)],
    'EN-6': [...new Set(dictionaries.engWords6)]
  };
  const wordSets = Object.fromEntries(Object.entries(modes).map(([mode, words]) => [mode, new Set(words)]));
  const colors = ['Hijau', 'Jingga', 'Merah', 'Hitam'];

  class Match {
    constructor({ id, gameType, players, firstWord, firstIndex = 0, turnMs = 60000, now = Date.now() }) {
      if (!modes[gameType] || !Array.isArray(players) || players.length !== 2 || players[0] === players[1]) {
        throw new Error('Konfigurasi permainan tidak valid.');
      }
      const words = modes[gameType];
      firstWord = firstWord || words[Math.floor(Math.random() * words.length)];
      if (!wordSets[gameType].has(firstWord) || !Number.isInteger(firstIndex) || firstIndex < 0 || firstIndex >= firstWord.length) {
        throw new Error('Kata awal tidak valid.');
      }
      this.state = {
        id, gameType, players: [...players], currentPlayer: players[0], phase: 'GUESS',
        turn: 0, revision: 0, turnMs, deadline: now + turnMs, draft: '', selected: [],
        rows: [{ word: firstWord, selected: [firstIndex] }],
        criteria: [{ color: colors[0], index: firstIndex, letter: firstWord[firstIndex] }],
        winner: null, loser: null, reason: null
      };
    }

    static words(gameType) { return modes[gameType] || []; }
    static colors() { return [...colors]; }
    static requiredRules(wordCount) { return Math.min(4, Math.max(1, Math.floor(wordCount / 2))); }
    static follows(word, criteria) {
      return criteria.every(({ color, index, letter }) => {
        if (color === 'Hijau') return word[index] === letter;
        if (color === 'Jingga') return word.includes(letter);
        if (color === 'Merah') return word[index] !== letter;
        if (color === 'Hitam') return !word.includes(letter);
        return false;
      });
    }
    static criteria(word, selected) {
      return selected.map((index, order) => ({ color: colors[order], index, letter: word[index] }));
    }
    static validSelection(word, selected) {
      if (new Set(selected).size !== selected.length || selected.length > 4 ||
          selected.some(index => !Number.isInteger(index) || index < 0 || index >= word.length)) return false;
      const rules = Match.criteria(word, selected);
      return !rules.some(rule => rule.color === 'Hitam' && rules.some(other =>
        (other.color === 'Hijau' || other.color === 'Jingga') && other.letter === rule.letter));
    }
    static rulePlans(word, count, prefix = []) {
      if (prefix.length === count) return [prefix];
      const plans = [];
      for (let index = 0; index < word.length; index++) {
        const next = [...prefix, index];
        if (Match.validSelection(word, next)) plans.push(...Match.rulePlans(word, count, next));
      }
      return plans;
    }

    snapshot(now = Date.now()) { return { ...JSON.parse(JSON.stringify(this.state)), serverNow: now }; }
    candidates() {
      const used = new Set(this.state.rows.map(row => row.word));
      return modes[this.state.gameType].filter(word => !used.has(word) && Match.follows(word, this.state.criteria));
    }
    finish(loser, reason) {
      if (this.state.phase === 'NOT PLAY' || !this.state.players.includes(loser)) return false;
      Object.assign(this.state, {
        phase: 'NOT PLAY', loser, winner: this.state.players.find(player => player !== loser),
        reason, deadline: null, revision: this.state.revision + 1
      });
      return true;
    }
    expire(now = Date.now()) {
      return this.state.phase === 'GUESS' && now >= this.state.deadline
        ? this.finish(this.state.currentPlayer, 'timeout') : false;
    }

    input(player, key, turn, now = Date.now()) {
      if (this.expire(now)) return { changed: true };
      const state = this.state;
      if (state.phase === 'NOT PLAY') return { error: 'Permainan sudah selesai.' };
      if (turn !== state.turn || player !== state.currentPlayer) return { error: 'Bukan giliranmu.' };
      if (typeof key !== 'string') return { error: 'Input tidak valid.' };
      const size = Number(state.gameType.slice(3));
      if (state.phase === 'GUESS') {
        if (/^[a-z]$/i.test(key) && state.draft.length < size) state.draft += key.toLowerCase();
        else if (key === 'Backspace' && state.draft.length) state.draft = state.draft.slice(0, -1);
        else if (key === 'Enter') {
          const word = state.draft;
          if (word.length !== size) return { error: `Masukkan ${size} huruf terlebih dahulu.` };
          if (!wordSets[state.gameType].has(word)) return { error: 'Kata tidak terdapat dalam kamus permainan.' };
          if (state.rows.some(row => row.word === word)) return { error: 'Kata sudah pernah digunakan.' };
          if (!Match.follows(word, state.criteria)) return { error: 'Kata tidak sesuai kriteria.' };
          state.rows.push({ word, selected: [] });
          state.draft = '';
          state.selected = [];
          state.phase = 'SETTING';
          state.deadline = null;
        } else return {};
      } else {
        const row = state.rows[state.rows.length - 1];
        const required = Match.requiredRules(state.rows.length);
        if (/^[1-6]$/.test(key)) {
          if (state.selected.length >= required) return {};
          const selected = [...state.selected, Number(key) - 1];
          if (!Match.validSelection(row.word, selected)) return { error: 'Pilih kotak berbeda; huruf hitam tidak boleh sama dengan hijau atau jingga.' };
          state.selected = selected;
          row.selected = [...selected];
        } else if (key === 'Backspace' && state.selected.length) {
          state.selected.pop();
          row.selected = [...state.selected];
        } else if (key === 'Enter') {
          if (state.selected.length !== required) return { error: `Pilih ${required} warna terlebih dahulu.` };
          state.criteria = Match.criteria(row.word, state.selected);
          state.selected = [];
          state.currentPlayer = state.players.find(other => other !== player);
          state.turn++;
          state.phase = 'GUESS';
          state.deadline = now + state.turnMs;
        } else return {};
      }
      state.revision++;
      return { changed: true };
    }
  }
  return Match;
});
