/**
 * Entender un aviso de Goodyear Proactive Solutions.
 *
 * Goodyear no tiene API ni webhook: lo único que manda es un correo, uno por
 * aviso. Así que este fichero es el punto único de fallo de todo el módulo, y
 * por eso está aquí solo —sin red, sin base de datos y sin IMAP—: es la parte
 * que se puede probar de verdad, con correos reales, y es la que se romperá el
 * día que Goodyear cambie la plantilla.
 *
 * ── Cómo es un aviso ───────────────────────────────────────────────────────
 *
 *   Asunto: [EXTERNO] Presión baja — 1467HJS/854 — Soledad // La Plana
 *
 *     Presión baja!
 *     Presión está en el rango crítico (debajo 75%)
 *     Soledad // La Plana
 *     Detalles
 *       Matrícula:            1467HJS
 *       ID de flota:          854
 *       Rueda:                Eje 2 - derecho interior
 *       Etiquetas:
 *       Fecha y hora:         10.11.2026 · 22:30:54
 *       Presión recomendada:  8.0 bar
 *       Presión bruta:        4.0 bar (-49.65%)
 *
 * ── Tres cosas que midiendo diez correos reales resultaron no ser como
 *    parecían con uno solo ──────────────────────────────────────────────────
 *
 * 1. **Hay dos tipos, y el segundo no trae número.** Además de «Presión baja»
 *    está «Neumático desinflado», donde la presión bruta es literalmente
 *    `!!!`. Por eso `presionBar` y `desviacionPct` admiten nulo: guardar un
 *    cero ahí sería afirmar que se midieron 0,0 bar, que es distinto de «el
 *    sensor no da una lectura fiable».
 *
 * 2. **El umbral no es constante.** Se han visto «debajo 75%» y «debajo 80%»,
 *    y en los avisos de desinflado no hay ninguno. Se lee del texto; no se
 *    supone.
 *
 * 3. **El porcentaje NO se recalcula.** Ninguno de los diez cuadra con los
 *    bares que enseña —4,0 sobre 8,0 sería −50 % y el correo dice −49,65 %—
 *    porque los bares vienen redondeados a un decimal y el porcentaje sale de
 *    los valores crudos. Se copia el del correo: calcularlo nosotros daría un
 *    número distinto del que el cliente ve en su portal, que es la peor clase
 *    de discrepancia, pequeña y constante.
 *
 * ── Por qué se lee por etiqueta y no por posición ──────────────────────────
 *
 * Se busca la fila cuyo rótulo es «Matrícula», nunca «la tercera fila». Una
 * plantilla con una fila más de adorno no puede cambiar lo que se entiende por
 * matrícula. Y el asunto, que lleva matrícula e ID de flota, sirve de contraste:
 * si el cuerpo y el asunto no dicen lo mismo, no se procesa.
 */

/** Los tipos de aviso que se han visto. Hay más, seguro: ver `TIPOS`. */
export type TipoAlerta = "presion_baja" | "desinflado";

export interface AlertaGoodyear {
  tipo: TipoAlerta;
  matricula: string;
  /** El «ID de flota». Contrasta con `tc_vehiculos.numero_unidad`. */
  idFlota: string | null;
  /** Eje 1, 2, 3… tal como lo numera el correo. */
  eje: number;
  lado: "izq" | "der";
  /** `null` cuando el correo no lo dice; ojo, también lo dice de más (ver abajo). */
  interiorExterior: "int" | "ext" | null;
  /** Cuándo se midió, según el correo. Interpretado en hora peninsular. */
  medidoAt: Date;
  presionRecomendadaBar: number | null;
  /** `null` en los avisos de desinflado, donde el correo pone `!!!`. */
  presionBar: number | null;
  /** El que dice el correo, con su signo. No se recalcula. */
  desviacionPct: number | null;
  /** El «(debajo X%)». `null` cuando el aviso no lo trae. */
  umbralPct: number | null;
  /** «Soledad // La Plana»: la cuenta de Goodyear, NO la empresa del SaaS. */
  flota: string | null;
  /** Algunos avisos traen una sección con el arco donde se midió. */
  tieneUbicacionCheckpoint: boolean;
}

/**
 * O el aviso entendido, o el motivo por el que no.
 *
 * Union con `in` y no con un `ok: boolean`, que es lo primero que se escribió:
 * el tsconfig del servidor va con `strict: false`, y sin `strictNullChecks`
 * TypeScript NO estrecha una union por un discriminante booleano —`if (!r.ok)`
 * no te da el `motivo`—. Con `"motivo" in r` estrecha igual, y además es el
 * mismo molde que usa el resto del backend (`"error" in res`).
 */
export type Lectura = AlertaGoodyear | { motivo: string };

/**
 * Qué encabezado es qué tipo.
 *
 * El orden importa: se comprueba «desinflado» antes que «presión», porque el
 * texto del desinflado también menciona la presión («La presión de los
 * neumáticos es muy baja»).
 */
const TIPOS: Array<{ clave: RegExp; tipo: TipoAlerta }> = [
  { clave: /neum[áa]tico\s+desinflado/i, tipo: "desinflado" },
  { clave: /presi[óo]n\s+baja/i, tipo: "presion_baja" },
];

/** La zona del cliente. El correo da hora de pared, sin decir de dónde. */
const ZONA = "Europe/Madrid";

/**
 * Pasa el HTML de un correo a texto plano manteniendo las separaciones.
 *
 * Los rótulos y sus valores viven en celdas distintas de una tabla, así que el
 * corte de etiquetas tiene que dejar un salto de línea: sin él, «Matrícula:» y
 * «1467HJS» se pegarían a lo siguiente y el valor saldría con cola.
 */
export function textoDelCorreo(html: string | null | undefined, texto?: string | null): string {
  if (html && html.trim()) {
    return html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|tr|td|th|li|h[1-6]|table)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)))
      .replace(/[ \t\u00a0]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }
  return (texto ?? "").replace(/[ \t\u00a0]+/g, " ").trim();
}

/**
 * El valor que sigue a un rótulo.
 *
 * El rótulo y su valor pueden venir en la misma línea («Matrícula: 1467HJS») o
 * en líneas distintas, según cómo caiga la tabla al aplanarla. Se admiten las
 * dos, y se para en el salto de línea para no arrastrar el rótulo siguiente.
 */
function trasRotulo(texto: string, rotulo: RegExp): string | null {
  const re = new RegExp(rotulo.source + String.raw`\s*:?\s*([^\n]*)`, "i");
  const m = texto.match(re);
  if (!m) return null;
  const mismaLinea = (m[1] ?? "").trim();
  if (mismaLinea) return mismaLinea;
  // Vacío en la misma línea: el valor está en la siguiente.
  const resto = texto.slice((m.index ?? 0) + m[0].length);
  const siguiente = resto.split("\n").find((l) => l.trim().length > 0);
  return siguiente ? siguiente.trim() : null;
}

/** Un número español o inglés («8.0», «8,0») a number. */
function aNumero(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(",", ".").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Cuántos milisegundos hay que sumar a una hora de pared para tener el
 * instante real en una zona. Sin librerías: `Intl` ya sabe los horarios de
 * verano, y hacerlo a mano con «+1 o +2» se equivoca dos domingos al año.
 */
function desfase(zona: string, instante: Date): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: zona, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(instante)) p[x.type] = x.value;
  const comoUtc = Date.UTC(
    Number(p.year), Number(p.month) - 1, Number(p.day),
    Number(p.hour) % 24, Number(p.minute), Number(p.second),
  );
  return comoUtc - instante.getTime();
}

/** Una hora de pared de `ZONA` al instante que le corresponde. */
export function instanteEnZona(
  año: number, mes: number, dia: number, h: number, min: number, seg: number,
  zona: string = ZONA,
): Date {
  const comoSiFueraUtc = Date.UTC(año, mes - 1, dia, h, min, seg);
  // Dos pasadas: la primera estima el desfase, la segunda lo corrige en el
  // borde del cambio de hora, donde el desfase de antes y el de después
  // difieren.
  let t = comoSiFueraUtc - desfase(zona, new Date(comoSiFueraUtc));
  t = comoSiFueraUtc - desfase(zona, new Date(t));
  return new Date(t);
}

/** «Eje 2 - derecho interior» → sus tres piezas. */
export function leerRueda(s: string | null | undefined): Pick<
  AlertaGoodyear, "eje" | "lado" | "interiorExterior"
> | null {
  if (!s) return null;
  const eje = s.match(/eje\s*(\d+)/i);
  if (!eje) return null;
  const lado = /izquierd/i.test(s) ? "izq" : /derech/i.test(s) ? "der" : null;
  if (!lado) return null;
  const interiorExterior = /interior/i.test(s) ? "int" : /exterior/i.test(s) ? "ext" : null;
  return { eje: Number(eje[1]), lado, interiorExterior };
}

/** La matrícula y el ID de flota que lleva el asunto: «— 1467HJS/854 —». */
export function leerAsunto(asunto: string | null | undefined): { matricula: string; idFlota: string | null } | null {
  if (!asunto) return null;
  const m = asunto.match(/[—–-]\s*([A-Z0-9]{4,12})\s*\/\s*([A-Za-z0-9._-]+)\s*[—–-]/);
  if (m) return { matricula: m[1].toUpperCase(), idFlota: m[2] };
  const soloMatricula = asunto.match(/[—–-]\s*([A-Z0-9]{4,12})\s*[—–-]/);
  return soloMatricula ? { matricula: soloMatricula[1].toUpperCase(), idFlota: null } : null;
}

/**
 * Lee un aviso. Devuelve el motivo en vez de lanzar: un correo que no se
 * entiende no es una excepción del programa, es un correo que hay que apartar
 * y enseñar a alguien.
 */
export function leerAlerta(entrada: { asunto?: string | null; html?: string | null; texto?: string | null }): Lectura {
  const asunto = entrada.asunto ?? "";
  const cuerpo = textoDelCorreo(entrada.html, entrada.texto);
  if (!cuerpo) return { motivo: "El correo no trae cuerpo" };

  const juntos = `${asunto}\n${cuerpo}`;
  const tipo = TIPOS.find((t) => t.clave.test(juntos))?.tipo;
  if (!tipo) return { motivo: "No se reconoce el tipo de aviso" };

  const matriculaCuerpo = trasRotulo(cuerpo, /matr[íi]cula/)?.toUpperCase().replace(/\s+/g, "") ?? null;
  const delAsunto = leerAsunto(asunto);
  if (!matriculaCuerpo && !delAsunto) return { motivo: "Sin matrícula" };

  // El asunto contrasta el cuerpo. Si no dicen lo mismo, algo ha cambiado en la
  // plantilla y procesarlo sería adivinar sobre qué vehículo se está avisando.
  if (matriculaCuerpo && delAsunto && matriculaCuerpo !== delAsunto.matricula) {
    return { motivo: `El asunto dice ${delAsunto.matricula} y el cuerpo ${matriculaCuerpo}` };
  }
  const matricula = matriculaCuerpo ?? delAsunto!.matricula;

  const rueda = leerRueda(trasRotulo(cuerpo, /rueda/));
  if (!rueda) return { motivo: "No se entiende la rueda" };

  const fechaTexto = trasRotulo(cuerpo, /fecha\s*y\s*hora/);
  const f = fechaTexto?.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})\D+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!f) return { motivo: "No se entiende la fecha" };
  const medidoAt = instanteEnZona(
    Number(f[3]), Number(f[2]), Number(f[1]),
    Number(f[4]), Number(f[5]), Number(f[6] ?? 0),
  );

  const bruta = trasRotulo(cuerpo, /presi[óo]n\s*bruta/);
  // `!!!` es lo que pone el correo de desinflado: no hay lectura, no es un cero.
  const sinLectura = !bruta || /^!+$/.test(bruta.trim());

  const idFlotaCuerpo = trasRotulo(cuerpo, /id\s*de\s*flota/);
  const umbral = cuerpo.match(/debajo\s*(\d+(?:[.,]\d+)?)\s*%/i);
  const flota = cuerpo.match(/^(.+\/\/.+)$/m);

  return {
    tipo,
    matricula,
    idFlota: (idFlotaCuerpo || delAsunto?.idFlota) ?? null,
    ...rueda,
    medidoAt,
    presionRecomendadaBar: aNumero(trasRotulo(cuerpo, /presi[óo]n\s*recomendada/)),
    presionBar: sinLectura ? null : aNumero(bruta),
    desviacionPct: sinLectura ? null : aNumero(bruta?.match(/\(\s*(-?\d+(?:[.,]\d+)?)\s*%/)?.[1]),
    umbralPct: aNumero(umbral?.[1]),
    flota: flota ? flota[1].trim() : null,
    tieneUbicacionCheckpoint: /ubicaci[óo]n\s+de\s+checkpoint/i.test(cuerpo),
  };
}
