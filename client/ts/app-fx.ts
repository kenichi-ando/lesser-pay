/**
 * Ephemeral UI effects: row flash, balance pop, logo cheer, confetti.
 */

function restartAnimation(node: HTMLElement, className: string, durationMs: number): void {
  node.classList.remove(className);
  // force reflow so the animation restarts on repeated triggers
  node.getBoundingClientRect();
  node.classList.add(className);
  setTimeout(function () { node.classList.remove(className); }, durationMs);
}

function randomUnit(): number {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] / 0x100000000;
}

export function flashRow(btn: HTMLElement | null): void {
  const row = btn?.closest('.task-item');
  if (!(row instanceof HTMLElement)) return;
  restartAnimation(row, 'is-flash', 1000);
}

export function popBalance(): void {
  const node = document.querySelector<HTMLElement>('.balance-number');
  if (node) {
    restartAnimation(node, 'is-pop', 800);
  }
  const card = document.querySelector<HTMLElement>('.balance-card');
  if (card) {
    restartAnimation(card, 'is-glow', 1000);
  }
}

export function cheerLogo(): void {
  const node = document.querySelector<HTMLElement>('.app-logo');
  if (!node) return;
  restartAnimation(node, 'is-cheer', 700);
}

export function confettiBurst(originEl: Element | null): void {
  if (!originEl) return;
  const rect = originEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const layer = document.createElement('div');
  layer.className = 'confetti-burst';
  layer.style.left = cx + 'px';
  layer.style.top = cy + 'px';
  const emojis = ['✨', '🎉', '⭐', '🎊', '💫', '🎈', '🌟', '🐾'];
  const count = 24;
  for (let i = 0; i < count; i++) {
    const span = document.createElement('span');
    span.className = 'confetti-piece';
    span.textContent = emojis[i % emojis.length];
    const angle = (Math.PI * 2 * i) / count + randomUnit() * 0.4;
    const dist = 120 + randomUnit() * 80;
    span.style.setProperty('--cx', Math.cos(angle) * dist + 'px');
    span.style.setProperty('--cy', Math.sin(angle) * dist + 'px');
    span.style.setProperty('--cr', randomUnit() * 720 - 360 + 'deg');
    span.style.animationDelay = randomUnit() * 80 + 'ms';
    layer.appendChild(span);
  }
  document.body.appendChild(layer);
  setTimeout(function () { layer.remove(); }, 1700);
}

export function celebrateBalance(opts: {
  withLogo?: boolean;
  toastMessage?: string;
  toast?: (message: string, kind?: string) => void;
}): void {
  if (opts.withLogo) cheerLogo();
  confettiBurst(document.querySelector('.balance-number'));
  popBalance();
  if (opts.toastMessage && opts.toast) opts.toast(opts.toastMessage, 'success');
}
