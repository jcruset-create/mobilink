/**
 * La referencia que ata un correo a su expediente.
 *
 * El correo no es un buzón aparte: es parte de la asistencia. Para eso hace
 * falta poder reconocer una respuesta tres días después, cuando el que
 * contesta ha borrado el histórico, ha cambiado el asunto o responde desde otra
 * dirección.
 *
 * Se usan DOS mecanismos, y hacen falta los dos:
 *
 *  1. **La referencia en el asunto** — `[AST-4210]`. Sobrevive a que reenvíen
 *     el correo a un compañero, que es lo que pasa la mitad de las veces.
 *  2. **Las cabeceras `In-Reply-To` / `References`** — sobreviven a que alguien
 *     reescriba el asunto entero, que es la otra mitad.
 *
 * Con uno solo se pierden respuestas. Con los dos, casi ninguna; y lo que no se
 * reconoce va a una bandeja de sin clasificar en vez de perderse.
 */

/** Prefijos que se reconocen. Assist numera `AST-`, Central `AS-YYYY-`. */
const PATRON = /\[((?:AST|AS|CTR)-[A-Z0-9-]+)\]/i;

/** Construye la referencia que va en el asunto. */
export function referenciaDe(expediente: string | null | undefined): string | null {
  const e = String(expediente ?? "").trim().toUpperCase();
  return e ? `[${e}]` : null;
}

/**
 * Añade la referencia al asunto si no la lleva ya.
 *
 * Que no se duplique importa: al responder varias veces sobre el mismo hilo,
 * un asunto con `[AST-4210] [AST-4210] [AST-4210] Re: Re:` es lo que acaba
 * haciendo que la gente lo borre a mano y se pierda el enganche.
 */
export function asuntoConReferencia(asunto: string, expediente: string | null | undefined): string {
  const ref = referenciaDe(expediente);
  if (!ref) return asunto;
  return extraerExpediente(asunto) ? asunto : `${ref} ${asunto}`.trim();
}

/** Saca el expediente de un asunto, si lo lleva. */
export function extraerExpediente(asunto: unknown): string | null {
  const m = PATRON.exec(String(asunto ?? ""));
  return m ? m[1].toUpperCase() : null;
}

/**
 * Normaliza un Message-ID para poder compararlo.
 *
 * Los clientes de correo son inconsistentes con los ángulos y con los espacios,
 * y una comparación literal falla justo cuando hace falta.
 */
export function normalizarMessageId(v: unknown): string {
  return String(v ?? "").trim().replace(/^</, "").replace(/>$/, "").toLowerCase();
}

/** Todos los identificadores a los que responde un correo entrante. */
export function referenciasDeCabecera(cabeceras: {
  inReplyTo?: unknown;
  references?: unknown;
}): string[] {
  const bruto: string[] = [];
  if (cabeceras.inReplyTo) bruto.push(String(cabeceras.inReplyTo));
  const refs = cabeceras.references;
  if (Array.isArray(refs)) bruto.push(...refs.map(String));
  else if (refs) bruto.push(...String(refs).split(/\s+/));

  const vistos = new Set<string>();
  for (const r of bruto) {
    for (const trozo of r.split(/\s+/)) {
      const n = normalizarMessageId(trozo);
      if (n) vistos.add(n);
    }
  }
  return [...vistos];
}

/**
 * Normaliza una dirección de correo para compararla.
 *
 * Se queda solo con la parte de la dirección: «Marta <marta@taller.es>» y
 * «MARTA@TALLER.ES» son la misma persona, y el nombre que ponga cada cliente
 * no puede decidir si una respuesta se engancha o no.
 */
export function normalizarDireccion(v: unknown): string {
  const s = String(v ?? "").trim();
  const m = /<([^>]+)>/.exec(s);
  return (m ? m[1] : s).trim().toLowerCase();
}

/**
 * Limpia el asunto de las marcas de respuesta y reenvío, para agrupar el hilo.
 *
 * `Re:`, `RE:`, `Rv:`, `Fwd:`… y las combinaciones que van encadenando los
 * clientes. Sin esto, el mismo hilo aparece como cinco conversaciones.
 */
export function asuntoBase(asunto: unknown): string {
  return String(asunto ?? "")
    .replace(PATRON, "")
    .replace(/^(\s*(re|rv|fwd|fw|resp)\s*(\[\d+\])?\s*:)+/gi, "")
    .trim();
}
