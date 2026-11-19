class WordsManager {
  constructor() {
    this.usedWords = [];
    this.meaningWords = {};
    this.pendingDefinitions = new Map();
    this.criteria = [];
  }
  applyState(state) {
    this.gameType = state.gameType;
    this.language = state.gameType.slice(0, 2);
    this.words = WordWarMatch.words(state.gameType);
    this.usedWords = state.rows.map(row => row.word);
    this.criteria = state.criteria;
  }
  async addMeaningWords(word) {
    const language = this.language;
    const key = `${language}/${word}`;
    if (this.meaningWords[key]) return this.meaningWords[key];
    if (!network.isActive) return 'Definisi membutuhkan koneksi ke server.';
    if (!this.pendingDefinitions.has(key)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5500);
      const request = fetch(`${network.server}/${language}/${encodeURIComponent(word)}`, { signal: controller.signal })
        .then(response => { if (!response.ok) throw new Error(); return response.json(); })
        .then(data => { this.meaningWords[key] = data.definition || 'Definisi tidak ditemukan.'; return this.meaningWords[key]; })
        .catch(() => 'Definisi tidak dapat dimuat.')
        .finally(() => { clearTimeout(timeout); this.pendingDefinitions.delete(key); });
      this.pendingDefinitions.set(key, request);
    }
    return this.pendingDefinitions.get(key);
  }
  findTheMissWord() {
    const used = new Set(this.usedWords);
    return (this.words || []).filter(word => !used.has(word) && WordWarMatch.follows(word, this.criteria));
  }
}
let wordsManager = new WordsManager();
