class Game {
  constructor() {
    this.currentState = 'NOT PLAY';
    this.isVsAI = false;
    this.state = null;
    this.localMatch = null;
    this.waitingMatch = null;
    this.aiRun = 0;
    this.aiRunning = false;
    this.clockOffset = 0;
    this.pendingInvitation = null;
    network.on('invited', data => this.handleInvitation(data));
    network.on('invitation-closed', data => {
      if (this.pendingInvitation === data.id) { this.pendingInvitation = null; notification.close(); }
      if (data.message && !this.isPlaying()) elementUI.updateInfoGame(data.message);
    });
    network.on('match-ready', data => this.handleMatchReady(data));
    network.on('match-state', state => {
      if (!state.players.includes(userManager.localUsername)) return;
      if (this.isVsAI || (this.waitingMatch?.matchId === 'ai' && this.aiOfflineSelection)) {
        if (state.phase === 'NOT PLAY') {
          gameStats.recordResult(state.id, state.winner === userManager.localUsername);
          network.request('ack-result', { matchId: state.id }).catch(() => {});
        }
        return;
      }
      this.applyState(state);
    });
    network.on('match-cancelled', data => {
      if (this.waitingMatch?.matchId !== data.matchId) return;
      this.waitingMatch = null;
      this.currentState = 'NOT PLAY';
      userManager.clearOpponentUsername();
      userManager.clearCurrentPlayer();
      notification.close();
      elementUI.hideInfoPlayer();
      elementUI.updateInfoGame(data.message);
    });
    network.onConnect = result => {
      if (this.isVsAI || this.waitingMatch?.matchId === 'ai') {
        // The player may have selected offline computer play while an earlier
        // online match was still in the reconnect grace period.
        const leave = result.matchId ? network.request('leave-match', { matchId: result.matchId }) : Promise.resolve();
        leave.then(() => network.setBusy(true)).catch(() => {});
        return;
      }
      network.setBusy(false).catch(() => {});
      const expectingOnline = !this.isVsAI && (this.isPlaying() || (this.waitingMatch && this.waitingMatch.matchId !== 'ai'));
      if (expectingOnline && !result.matchId) this.cancelLostMatch('Server tidak lagi menyimpan pertandingan ini.');
    };
    network.onDisconnect = () => {
      if (!this.isVsAI && (this.isPlaying() || this.waitingMatch)) {
        elementUI.updateInfoGame('Koneksi terputus. Menghubungkan kembali; waktu permainan tetap berjalan.');
      }
    };
    network.onRegistrationError = error => {
      if (!this.isVsAI) elementUI.updateInfoGame(error.message);
    };
    input.onHandleKeyPressed(key => this.handleKeyPress(key));
    window.addEventListener('DOMContentLoaded', () => this.init());
  }
  isPlaying() { return !!this.state && this.state.phase !== 'NOT PLAY'; }
  async init() {
    const restored = gameHistory.restore();
    if (restored) {
      this.isVsAI = true;
      this.localMatch = restored;
      this.localMatch.expire();
      this.applyState(this.localMatch.snapshot());
      this.handleAITurn();
    }
    if (!this.validUsername(userManager.localUsername)) await this.createLocalUsernameAndJoin();
    else {
      elementUI.setUsername(userManager.localUsername);
      network.join().catch(error => { if (!this.isPlaying()) elementUI.updateInfoGame(error.message); });
    }
    if (!restored && userManager.localUsername) elementUI.updateInfoGame('Pilih ikon pemain untuk melawan teman atau komputer.');
  }
  validUsername(username) {
    return typeof username === 'string' && /^[a-zA-Z0-9_-]{1,24}$/.test(username) && username.toLowerCase() !== aiOpponent.name.toLowerCase();
  }
  async createLocalUsernameAndJoin() {
    if (this.isPlaying() || this.waitingMatch) {
      notification.showShortMessage('Selesaikan pertandingan sebelum mengganti username.');
      return;
    }
    const username = await notification.getInputText('Buat username', value =>
      this.validUsername(value.trim()) ? undefined : 'Gunakan 1–24 huruf, angka, _ atau -. Computer khusus komputer.');
    if (!username) return;
    userManager.setLocalUsername(username.trim());
    elementUI.setUsername(userManager.localUsername);
    try { await network.join(); }
    catch (error) { elementUI.updateInfoGame(`${error.message} Pilih ikon pemain untuk melawan komputer.`); }
  }
  async findEnemy() {
    if (!userManager.localUsername) { await this.createLocalUsernameAndJoin(); if (!userManager.localUsername) return; }
    if (this.isPlaying() || this.waitingMatch) {
      notification.showConfirmation({
        message: 'Keluar dari pertandingan ini? Keluar saat bermain dihitung kalah.',
        onConfirm: async () => { if (await this.leave()) this.findEnemy(); }, onDeny: () => {}
      });
      return;
    }
    let users = [];
    let info = '';
    try { users = await network.getUsers(); }
    catch (error) { info = `<p>${elementUI.escape(error.message)}</p>`; }
    // A reconnect may have restored an online match while fetching the list.
    if (this.isPlaying() || this.waitingMatch) return;
    notification.showClickableOptions('Pilih lawan', `<button class="enemy-button" onclick="game.setupAiGame()">Lawan Komputer</button>${info}${elementUI.createEnemiesList(users) || '<p>Belum ada teman yang tersedia.</p>'}`);
  }
  async handleInvitation(data) {
    if (this.isPlaying() || this.waitingMatch || this.isVsAI || this.pendingInvitation) {
      network.request('answer-invitation', { id: data.id, accept: false }).catch(() => {});
      return;
    }
    this.pendingInvitation = data.id;
    notification.showConfirmation({
      message: `${data.inviter} mengajak kamu bermain. Terima?`,
      onConfirm: () => this.answerInvitation(data.id, true),
      onDeny: () => this.answerInvitation(data.id, false)
    });
  }
  async answerInvitation(id, accept) {
    if (this.pendingInvitation !== id) return;
    this.pendingInvitation = null;
    try { await network.request('answer-invitation', { id, accept }); }
    catch (error) { notification.showShortMessage(error.message); }
  }
  handleMatchReady(data) {
    if (this.isVsAI || (this.waitingMatch?.matchId === 'ai' && this.aiOfflineSelection)) return;
    const alreadyWaiting = this.waitingMatch?.matchId === data.matchId;
    this.waitingMatch = data;
    userManager.setOpponentUsername(data.opponent);
    if (data.started) return;
    this.currentState = 'WAITING';
    if (!alreadyWaiting) notification.close();
    if (data.host === userManager.localUsername && !alreadyWaiting) this.showGameType();
    else elementUI.updateInfoGame(`Menunggu ${data.host} memilih mode permainan...`);
  }
  showGameType() {
    notification.showGameTypeOptions(type => this.chooseGameType(type), () => this.leave());
  }
  async chooseGameType(gameType) {
    if (!WordWarMatch.words(gameType).length) return;
    if (this.isVsAI) {
      this.localMatch = new WordWarMatch({ id: `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        gameType, players: [userManager.localUsername, aiOpponent.name],
        firstIndex: Math.floor(Math.random() * Number(gameType.slice(3))) });
      this.waitingMatch = null;
      this.applyState(this.localMatch.snapshot());
    } else if (this.waitingMatch) {
      try { await network.request('start-match', { matchId: this.waitingMatch.matchId, gameType }); }
      catch (error) { notification.showShortMessage(error.message); }
    }
  }
  async setupAiGame() {
    if (this.isPlaying() || this.waitingMatch) return;
    notification.close();
    if (!userManager.localUsername) return;
    this.aiOfflineSelection = !network.isActive;
    this.waitingMatch = { matchId: 'ai' };
    try { await network.setBusy(true); }
    catch (error) {
      if (this.waitingMatch?.matchId === 'ai') {
        this.waitingMatch = null;
        notification.showShortMessage(error.message);
      }
      return;
    }
    if (this.waitingMatch?.matchId !== 'ai') return;
    this.cancelAI();
    this.isVsAI = true;
    this.state = null;
    this.currentState = 'WAITING';
    this.showGameType();
  }
  handleKeyPress(key) {
    if (!this.isPlaying() || !userManager.isMyTurn() || !input.isGameKey(key)) return;
    if (this.isVsAI) this.playLocal(key);
    else if (network.isActive) network.sendKey(this.state.id, this.state.turn, key);
  }
  playLocal(key) {
    const result = this.localMatch.input(this.localMatch.state.currentPlayer, String(key), this.localMatch.state.turn);
    if (result.error) notification.showShortMessage(result.error, 1000);
    if (result.changed) {
      this.applyState(this.localMatch.snapshot());
      this.handleAITurn();
    }
  }
  applyState(state) {
    if (this.state?.id === state.id && state.revision < this.state.revision) return;
    const previous = this.state;
    const first = !previous || previous.id !== state.id;
    this.state = state;
    this.gameType = state.gameType;
    this.currentState = state.phase;
    this.waitingMatch = null;
    this.clockOffset = this.isVsAI ? 0 : state.serverNow - Date.now();
    userManager.setCurrentPlayer(state.currentPlayer);
    userManager.setOpponentUsername(state.players.find(name => name !== userManager.localUsername));
    wordsManager.applyState(state);
    elementUI.render(state);
    if (first) { notification.close(); gameStats.recordPlayed(state.id); }
    gameStats.updateUsedWords();
    if (previous?.phase !== state.phase && !first && state.phase !== 'NOT PLAY') unlockSound.play();
    timer.watch(state.deadline, () => Date.now() + this.clockOffset, () => {
      if (this.isVsAI && this.localMatch?.expire()) this.applyState(this.localMatch.snapshot());
    });
    if (state.phase === 'NOT PLAY') this.finish(state);
    else if (this.isVsAI) gameHistory.save(this.localMatch);
  }
  finish(state) {
    this.cancelAI();
    timer.clear();
    userManager.clearCurrentPlayer();
    userManager.clearOpponentUsername();
    gameHistory.remove();
    const wasAI = this.isVsAI;
    this.isVsAI = false;
    network.setBusy(false).catch(() => {});
    if (!wasAI) network.request('ack-result', { matchId: state.id }).catch(() => {});
    if (!gameStats.recordResult(state.id, state.winner === userManager.localUsername)) return;
    const won = state.winner === userManager.localUsername;
    const opponent = state.players.find(name => name !== userManager.localUsername);
    if (won) winSound.play(); else loseSound.play();
    const again = () => { if (wasAI) this.setupAiGame(); else network.invite(opponent); };
    notification[won ? 'win' : 'lose']({ opponent, confirm: again, deny: () => this.findEnemy() });
    if (!won && state.reason === 'timeout') this.handleMissWord();
  }
  handleMissWord() {
    const words = wordsManager.findTheMissWord();
    elementUI.updateInfoGame(words.length
      ? `Waktu habis. Masih ada ${words.length} kata, misalnya <b>${words[0]}</b>. <button class="remaining-words-button" onclick="notification.showMissWord(elementUI.createMissWordElements())">Lihat kata lainnya</button>`
      : 'Skak mat! Tidak ada lagi kata yang memenuhi kriteria.');
  }
  cancelAI() { this.aiRun++; this.aiRunning = false; }
  async handleAITurn() {
    if (this.aiRunning || !this.isVsAI || !this.isPlaying() || this.state.currentPlayer !== aiOpponent.name) return;
    this.aiRunning = true;
    const run = ++this.aiRun;
    const match = this.localMatch;
    const active = () => run === this.aiRun && this.isVsAI && this.localMatch === match &&
      match.state.phase !== 'NOT PLAY' && match.state.currentPlayer === aiOpponent.name;
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    try {
      await pause(500);
      if (!active()) return;
      if (match.expire()) { this.applyState(match.snapshot()); return; }
      if (match.state.phase === 'GUESS') {
        const guess = aiOpponent.guessWord(match);
        if (!guess) { match.finish(aiOpponent.name, 'no-words'); this.applyState(match.snapshot()); return; }
        // Resume an interrupted computer turn from a clean draft.
        while (match.state.draft) this.playLocal('Backspace');
        for (const char of guess) {
          await pause(120);
          if (!active()) return;
          this.playLocal(char);
        }
        if (!active()) return;
        this.playLocal('Enter');
      }
      if (!active() || match.state.phase !== 'SETTING') return;
      const plan = aiOpponent.determineRules(match);
      if (!plan) { match.finish(aiOpponent.name, 'no-rules'); this.applyState(match.snapshot()); return; }
      for (const index of plan.slice(match.state.selected.length)) {
        await pause(180);
        if (!active()) return;
        this.playLocal(String(index + 1));
      }
      await pause(250);
      if (active()) this.playLocal('Enter');
    } finally { if (run === this.aiRun) this.aiRunning = false; }
  }
  async leave() {
    if (this.isVsAI) {
      this.cancelAI();
      timer.clear();
      if (this.localMatch && this.isPlaying()) {
        this.localMatch.finish(userManager.localUsername, 'leave');
        this.applyState(this.localMatch.snapshot());
      }
      this.isVsAI = false;
      this.waitingMatch = null;
      this.currentState = 'NOT PLAY';
      gameHistory.remove();
      await network.setBusy(false).catch(() => {});
      return true;
    }
    const id = this.waitingMatch?.matchId || (this.isPlaying() && this.state.id);
    if (!id) return true;
    try { await network.request('leave-match', { matchId: id }); return true; }
    catch (error) { notification.showShortMessage(error.message); return false; }
  }
  cancelLostMatch(message) {
    timer.clear();
    this.currentState = 'NOT PLAY';
    if (this.state) this.state.phase = 'NOT PLAY';
    this.waitingMatch = null;
    userManager.clearCurrentPlayer();
    userManager.clearOpponentUsername();
    elementUI.hideInfoPlayer();
    elementUI.updateInfoGame(`${message} Silakan mulai pertandingan baru.`);
  }
}
let game = new Game();
