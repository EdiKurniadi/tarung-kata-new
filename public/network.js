class Network {
  constructor() {
    this.server = (window.WORD_WAR_SERVER_URL || (location.protocol === 'file:' ? 'http://localhost:3001' : location.origin)).replace(/\/$/, '');
    this.socket = io(this.server, { autoConnect: false, reconnection: true });
    this.token = sessionStorage.getItem('wordWarSession');
    if (!this.token) {
      this.token = typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('wordWarSession', this.token);
    }
    this.queue = Promise.resolve();
    this.epoch = 0;
    this.registeredUsername = null;
    this.socket.on('connect', () => {
      this.register().catch(error => this.onRegistrationError?.(error));
    });
    this.socket.on('disconnect', () => {
      this.registeredUsername = null;
      this.epoch++;
      this.onDisconnect?.();
    });
  }
  get isActive() { return this.socket.connected && this.registeredUsername === userManager.localUsername; }
  on(event, callback) { this.socket.on(event, callback); }
  request(event, data = {}) {
    if (!this.socket.connected) return Promise.reject(new Error('Server tidak terhubung.'));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server tidak merespons. Coba kembali.')), 5000);
      this.socket.emit(event, data, result => {
        clearTimeout(timeout);
        if (!result?.ok) reject(new Error(result?.error || 'Permintaan gagal.'));
        else resolve(result);
      });
    });
  }
  async connect() {
    if (this.socket.connected) return;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off('connect', connected);
        this.socket.off('connect_error', failed);
      };
      const connected = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('Server tidak dapat dijangkau. Kamu tetap bisa melawan komputer.')); };
      const timeout = setTimeout(failed, 5000);
      this.socket.once('connect', connected);
      this.socket.once('connect_error', failed);
      this.socket.connect();
    });
  }
  async register() {
    const username = userManager.localUsername;
    if (!username || this.registeredUsername === username) return;
    if (this.registration) return this.registration;
    this.registration = this.request('join', { username, token: this.token }).then(result => {
      this.registeredUsername = result.username;
      this.onConnect?.(result);
      return result;
    }).finally(() => { this.registration = null; });
    return this.registration;
  }
  async join() { await this.connect(); await this.register(); }
  async getUsers() { await this.join(); return (await this.request('request-users-data')).users; }
  async setBusy(busy) {
    if (this.isActive) await this.request('set-availability', { busy });
  }
  async invite(invited) {
    try {
      await this.join();
      await this.request('invite', { invited });
      elementUI.updateInfoGame(`Menunggu ${invited} menerima undangan...`);
    } catch (error) { notification.showShortMessage(error.message); }
  }
  sendKey(matchId, turn, key) {
    const epoch = this.epoch;
    this.queue = this.queue.then(async () => {
      if (epoch !== this.epoch || !this.isActive) return;
      try { await this.request('match-input', { matchId, turn, key }); }
      catch (error) {
        if (epoch !== this.epoch) return;
        notification.showShortMessage(error.message, 1000);
        if (error.message.startsWith('Server tidak merespons')) {
          this.epoch++;
          await this.request('sync-match', { matchId }).catch(() => {});
        }
      }
    });
  }
}
let network = new Network();
