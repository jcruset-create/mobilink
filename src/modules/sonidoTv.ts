/**
 * El sonido de Pantalla técnicos: un tono corto o la voz. Vive aparte del
 * componente para que el componente no sepa nada de AudioContext.
 *
 * El navegador solo deja sonar después de un toque de la persona: `activar()`
 * se llama desde el botón «Activar sonido» y deja el audio desbloqueado para
 * el resto de la sesión. Sin eso, los avisos se pierden sin dar error.
 */

let ctx: AudioContext | null = null;
let activado = false;

export function sonidoActivado(): boolean {
  return activado;
}

/** Desde un clic: crea el contexto de audio y lo deja listo. */
export async function activarSonido(): Promise<boolean> {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (AC) {
      ctx = ctx ?? new AC();
      if (ctx && ctx.state === "suspended") await ctx.resume();
    }
    // La voz también se desbloquea con un gesto: una frase vacía basta.
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    }
    activado = true;
    return true;
  } catch {
    return false;
  }
}

/** Dos notas cortas, como un timbre de aviso. */
export function sonarTono(): void {
  if (!ctx) return;
  const t0 = ctx.currentTime;
  for (const [inicio, hz] of [
    [0, 880],
    [0.22, 1175],
  ] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, t0 + inicio);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + inicio + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + inicio + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + inicio);
    osc.stop(t0 + inicio + 0.22);
  }
}

/** La frase en voz alta, en español. */
export function decir(frase: string): void {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(frase);
  u.lang = "es-ES";
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
}
