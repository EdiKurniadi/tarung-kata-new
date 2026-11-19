class UserManager {
  constructor() {
    this.localUsername = sessionStorage.getItem('wordWarUsername') || localStorage.getItem('localUsername') || null;
    if (this.localUsername) sessionStorage.setItem('wordWarUsername', this.localUsername);
    this.opponentUsername = null;
    this.exOpponentUsername = null;
    this.currentPlayer = null;
  }

  isLocalUsernameExist() {
    return !!this.localUsername;
  }

  isOpponentUsernameExist() {
    return !!this.opponentUsername;
  }

  isMyTurn() {
    return this.localUsername && this.currentPlayer === this.localUsername;
  }

  setLocalUsername(newUsername) {
    if (newUsername) {
      this.localUsername = newUsername;
      this.saveLocalUsername();
    }
  }

  setOpponentUsername(newUsername) {
    if (newUsername) {
      this.opponentUsername = newUsername;
    }
  }

  setCurrentPlayer(username) {
    this.currentPlayer = username
  }

  togglePlayer() {
    if(this.currentPlayer === this.localUsername) {
      this.currentPlayer = this.opponentUsername;
    } else {
      this.currentPlayer = this.localUsername;
    }
  }

  saveLocalUsername() {
    if (this.localUsername) {
      localStorage.setItem('localUsername', this.localUsername);
      sessionStorage.setItem('wordWarUsername', this.localUsername);
    } else {
      localStorage.removeItem('localUsername');
      sessionStorage.removeItem('wordWarUsername');
    }
  }

  clearLocalUsername() {
    this.localUsername = null;
    this.saveLocalUsername();
  }

  clearOpponentUsername() {
    this.exOpponentUsername = this.opponentUsername;
    this.opponentUsername = null;
  }

  clearCurrentPlayer() {
    this.currentPlayer = null;
  }
}

let userManager = new UserManager();
