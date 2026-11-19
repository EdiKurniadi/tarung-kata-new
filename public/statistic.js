class GameStatistics {
  constructor() {
    this.numberPlayed = document.querySelector('.number-played');
    this.winAmount = document.querySelector('.win-amount');
    this.usedWords = document.querySelector('.list-used-word');
    this.initializeLocalStorage();
    this.updateDisplay();
    window.addEventListener('storage', event => {
      if (event.key === 'numberPlayed' || event.key === 'winAmount') this.updateDisplay();
    });
  }

  initializeLocalStorage() {
    if (!localStorage.numberPlayed) {
      localStorage.setItem('numberPlayed', 0);
    }
    if (!localStorage.winAmount) {
      localStorage.setItem('winAmount', 0);
    }
  }

  incrementNumberPlayed() {
    localStorage.numberPlayed = parseInt(localStorage.numberPlayed) + 1;
    this.updateDisplay();
  }

  updateWinAmount() {
    localStorage.winAmount = parseInt(localStorage.winAmount) + 1;
    this.updateDisplay();
  }

  recordPlayed(matchId) {
    matchId = `${matchId}:${userManager.localUsername}`;
    const played = JSON.parse(localStorage.getItem('wordWarPlayedMatches') || '[]');
    if (played.includes(matchId)) { this.updateDisplay(); return; }
    localStorage.setItem('wordWarPlayedMatches', JSON.stringify([...played, matchId].slice(-100)));
    this.incrementNumberPlayed();
  }

  recordResult(matchId, won) {
    matchId = `${matchId}:${userManager.localUsername}`;
    const finished = JSON.parse(localStorage.getItem('wordWarFinishedMatches') || '[]');
    if (finished.includes(matchId)) return false;
    localStorage.setItem('wordWarFinishedMatches', JSON.stringify([...finished, matchId].slice(-100)));
    if (won) this.updateWinAmount();
    return true;
  }

  updateDisplay() {
    this.numberPlayed.innerHTML = localStorage.numberPlayed + 'x';
    this.winAmount.innerHTML = localStorage.winAmount;
  }

  updateUsedWords() {
  	let listUsedWordsElement = wordsManager.usedWords.map(word => `<li>${word}</li>`).join('');
	this.usedWords.innerHTML = listUsedWordsElement;
  }

  removeUsedWords() {
  	this.usedWords.innerHTML = '';
  }

}

// Penggunaan
const gameStats = new GameStatistics();
