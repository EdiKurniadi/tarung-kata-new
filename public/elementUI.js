class ElementUI {
  constructor() {
    this.containerWords = document.getElementById('container-words');
    this.usernameElement = document.getElementById('username');
    this.infoPlayer = document.querySelector('.info-player');
    this.infoPlayerText = document.querySelector('.info-player-text');
    this.infoGame = document.querySelector('.info-game');
  }
  escape(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  render(state) {
    const rows = state.rows.map(row => ({ word: row.word, selected: row.selected }));
    if (state.phase === 'GUESS') rows.push({ word: state.draft, selected: [], draft: true });
    const size = Number(state.gameType.slice(3));
    const colors = WordWarMatch.colors();
    const shown = rows.slice(-5);
    this.containerWords.replaceChildren();
    shown.forEach((row, rowIndex) => {
      const element = document.createElement('div');
      element.className = 'word';
      const choosing = state.phase === 'SETTING' && rowIndex === shown.length - 1;
      for (let index = 0; index < size; index++) {
        const box = document.createElement('span');
        box.className = 'box-letter';
        box.innerText = (row.word[index] || '?').toUpperCase();
        if (row.word[index]) box.classList.add('box-letter-filled');
        const colorIndex = row.selected.indexOf(index);
        if (colorIndex !== -1) box.classList.add(colors[colorIndex]);
        if (choosing && userManager.isMyTurn()) {
          box.style.cursor = 'pointer';
          box.addEventListener('click', () => game.handleKeyPress(String(index + 1)));
        }
        element.appendChild(box);
      }
      if (!row.draft && !choosing) element.addEventListener('click', async () => {
        const definition = await wordsManager.addMeaningWords(row.word);
        notification.showDefinition(row.word, definition);
      });
      this.containerWords.appendChild(element);
    });
    this.updateInfoPlayer(`Giliran ${state.currentPlayer.toUpperCase()}:`);
    if (state.phase === 'NOT PLAY') {
      this.hideInfoPlayer();
      const won = state.winner === userManager.localUsername;
      const reason = state.reason === 'disconnect' ? ' Lawan terputus.' : state.reason === 'leave' ? ' Pemain keluar.' : '';
      this.infoGame.innerText = `${won ? 'Kamu menang!' : 'Kamu kalah.'}${reason}`;
    } else {
      this.showInfoPlayer();
      if (state.phase === 'GUESS') {
        this.infoGame.innerText = userManager.isMyTurn()
          ? (state.draft.length === size ? 'Tekan Enter untuk memasukkan jawaban.' : 'Silakan tebak kata.')
          : `Menunggu ${state.currentPlayer} menebak kata...`;
      } else {
        const required = WordWarMatch.requiredRules(state.rows.length);
        this.infoGame.innerText = userManager.isMyTurn()
          ? (state.selected.length === required ? 'Tekan Enter untuk mengirim aturan.' : `Pilih kotak untuk warna ${colors[state.selected.length]}. (${state.selected.length}/${required})`)
          : `Menunggu ${state.currentPlayer} memilih aturan...`;
      }
    }
  }
  createEnemiesList(usernames) {
    return usernames.filter(name => name !== userManager.localUsername).map(name =>
      `<button class="enemy-button" data-enemy="${this.escape(name)}">${this.escape(name)}</button>`).join('');
  }
  handleEnemyButtonClick(username) { notification.close(); network.invite(username); }
  setUsername(name) { this.usernameElement.innerText = name; }
  updateInfoPlayer(info) { this.infoPlayerText.innerText = info; }
  updateInfoGame(info) { this.infoGame.innerHTML = info; }
  showInfoPlayer() { this.infoPlayer.style.display = 'block'; }
  hideInfoPlayer() { this.infoPlayer.style.display = 'none'; }
  createMissWordElements() {
    return wordsManager.findTheMissWord().map(word => `<span class="remaining-word">${this.escape(word)}</span>`).join('');
  }
}
let elementUI = new ElementUI();
document.addEventListener('click', event => {
  const button = event.target.closest('[data-enemy]');
  if (button) elementUI.handleEnemyButtonClick(button.dataset.enemy);
});
