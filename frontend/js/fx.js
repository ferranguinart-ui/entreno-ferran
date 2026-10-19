// Lógica pura de los efectos visuales de la pantalla de entreno
// (anillo, dígitos animados, latido del 3-2-1). Sin DOM: se testea en Node.

/** Texto del dial: "40" por debajo de un minuto, "1:05" a partir de 60 s. */
export function dialText(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  if (sec < 60) return String(sec);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** Fracción del paso que queda (1 = recién empezado, 0 = terminado). */
export function ringFraction(remainingMs, totalSec) {
  if (!(totalSec > 0)) return 0;
  return Math.min(1, Math.max(0, remainingMs / (totalSec * 1000)));
}

/** Posiciones de carácter que cambian; si cambia la longitud, todas. */
export function changedIndices(prev, next) {
  const out = [];
  for (let i = 0; i < next.length; i++) {
    if (prev.length !== next.length || prev[i] !== next[i]) out.push(i);
  }
  return out;
}

/** El dial late al cruzar 3, 2 y 1: el mismo instante que el pitido de cuenta atrás. */
export function beatAt(prevSec, curSec) {
  return prevSec != null && curSec < prevSec && curSec >= 1 && curSec <= 3;
}
