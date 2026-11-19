class GameHistory {
  save(match) {
    if (match && match.state.phase !== 'NOT PLAY') {
      sessionStorage.setItem('wordWarComputerGame', JSON.stringify({ version: 1, state: match.snapshot() }));
    }
  }
  restore() {
    try {
      const saved = JSON.parse(sessionStorage.getItem('wordWarComputerGame'));
      const state = saved?.state;
      if (saved?.version !== 1 || !state || state.phase === 'NOT PLAY' ||
          state.players[0] !== userManager.localUsername || state.players[1] !== aiOpponent.name) return null;
      const match = new WordWarMatch({ id: state.id, gameType: state.gameType,
        players: state.players, firstWord: state.rows[0].word, firstIndex: state.rows[0].selected[0] });
      match.state = state;
      return match;
    } catch { this.remove(); return null; }
  }
  remove() { sessionStorage.removeItem('wordWarComputerGame'); localStorage.removeItem('gameHistory'); }
}
const gameHistory = new GameHistory();
window.addEventListener('beforeunload', () => { if (game.isVsAI) gameHistory.save(game.localMatch); });
