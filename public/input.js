class Input {
  constructor() {
    this.suppressedKeys = new Set();
    document.querySelectorAll('.key').forEach(button => button.addEventListener('click', () => {
      this.callback?.(button.classList.contains('del-key') ? 'Backspace' : button.innerText.trim());
    }));
    document.addEventListener('keydown', event => {
      if (this.isEditing(event) || event.ctrlKey || event.altKey || event.metaKey) {
        this.suppressedKeys.add(event.key);
        return;
      }
      if (this.isGameKey(event.key)) event.preventDefault();
    });
    document.addEventListener('keyup', event => {
      if (this.suppressedKeys.delete(event.key)) return;
      if (this.isEditing(event) || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      if (this.isGameKey(event.key)) this.callback?.(event.key);
    });
  }
  isEditing(event) {
    return !!(event.target?.closest?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('.swal2-container'));
  }
  isGameKey(key) { return typeof key === 'string' && (/^[a-z1-6]$/i.test(key) || key === 'Enter' || key === 'Backspace'); }
  onHandleKeyPressed(callback) { this.callback = callback; }
}
let input = new Input();
