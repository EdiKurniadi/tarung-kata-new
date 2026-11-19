class Timer {
  constructor() {
    this.minuteElement = document.getElementById('minute');
    this.secondElement = document.getElementById('second');
    this.ID = null;
  }
  watch(deadline, now, callback) {
    this.clear();
    if (!deadline) { this.reset(); return; }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - now()) / 1000));
      this.minuteElement.innerText = String(Math.floor(remaining / 60)).padStart(2, '0');
      this.secondElement.innerText = String(remaining % 60).padStart(2, '0');
      if (!remaining) { this.clear(); callback(); }
    };
    this.ID = setInterval(tick, 100);
    tick();
  }
  clear() { clearInterval(this.ID); this.ID = null; }
  reset() {
    this.clear();
    this.minuteElement.innerText = '--';
    this.secondElement.innerText = '--';
  }
}
let timer = new Timer();
