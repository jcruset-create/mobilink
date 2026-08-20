/**
 * Lector de los avisos de presión del arco (CheckPoint).
 *
 * Cuando un vehículo cruza el arco con una rueda por debajo del umbral llega
 * un correo con la marca Goodyear, titulado "Presión baja!":
 *
 *     Presión está en el rango crítico (debajo 75%)
 *     Soledad // La Plana
 *
 *     Matrícula:              7851JNT
 *     ID de flota:            1015
 *     Rueda:                  Eje 2 - izquierdo exterior
 *     Etiquetas:
 *     Fecha y hora:           19.08.2026 · 22:13:23
 *     Presión recomendada:    8.0 bar
 *     Presión bruta:          5.5 bar (-31.08%)
 *
 * ── POR QUÉ ESTO NO LO LEE LA IA ────────────────────────────────────────────
 *
 * Es una plantilla con etiquetas fijas. Sacar "Matrícula: 7851JNT" con una
 * expresión regular es determinista, instantáneo, gratis y comprobable con un
 * test. Pedírselo a un modelo añade coste, latencia y —lo único que importa de
 * verdad— la posibilidad de que se invente una matrícula o una presión. Una
 * incidencia con la matrícula equivocada manda al técnico a un camión que está
 * bien y deja sin avisar al que va con 5,5 bar.
 *
 * Es la misma regla que rige el informe de intervención: la IA redacta, nunca
 * decide los hechos. La IA entra sólo cuando ESTO falla (el día que Goodyear
 * cambie el diseño), y lo que salga de ahí se marca y no se da por bueno sin
 * que lo confirme una persona.
 *
 * ── Y POR QUÉ ESTE MÓDULO NO TOCA LA BASE DE DATOS ──────────────────────────
 *
 * Todo lo que decide algo vive aquí y es una función pura: leer el correo,
 * traducir el rango a gravedad, y decidir si un aviso abre incidencia o se
 * suma a una que ya está abierta. Así se prueba entero sin base de datos, que
 * es lo único que puede convertir un correo en un dato falso. La parte que
 * escribe está en avisoPresionIncidencia.ts y no decide nada.
 */
import { senasPosicion } from "../../src/modules/tyrecontrol/services/checkpoint.ts";

export type Gravedad = "leve" | "importante" | "critica";

/** Un aviso ya leído, con todo lo que hacía falta para abrir la incidencia. */
export interface AvisoPresion {
  /** Matrícula normalizada (sólo A-Z y dígitos), que es como se compara. */
  matricula: string;
  /** La matrícula tal como venía en el correo, para el rastro. */
  matriculaTexto: string;
  idFlota: string | null;
  eje: number;
  lado: "izq" | "der";
  interiorExterior: "int" | "ext" | null;
  /** Código de posición nuestro: E2_IZQ_EXT, E1_DER… */
  codigoPosicion: string;
  medidoAt: Date;
  presionBar: number;
  presionRecomendadaBar: number | null;
  desviacionPct: number | null;
  /** El rango tal cual lo escribe el correo: "crítico", "aviso"… */
  rango: string | null;
  umbralPct: number | null;
  checkpoint: string | null;
}

export type LecturaAviso =
  | { ok: true; aviso: AvisoPresion; notas: string[] }
  | { ok: false; faltan: string[]; notas: string[] };

// ── Texto ───────────────────────────────────────────────────────────────────

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const clave = (s: string) => sinAcentos(String(s ?? "")).toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Las entidades que de verdad aparecen en estos correos. Los acentos vienen
 * casi siempre escritos así ("Matr&iacute;cula"), y sin traducirlos la
 * etiqueta no casa con nada.
 */
const ENTIDADES: Record<string, string> = {
  nbsp: " ", quot: '"', apos: "'", lt: "<", gt: ">",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  ntilde: "ñ", uuml: "ü", ccedil: "ç",
  auml: "ä", ouml: "ö",
  middot: "·", bull: "•", deg: "°", ordm: "º", ordf: "ª",
  laquo: "«", raquo: "»", hellip: "…", mdash: "—", ndash: "–",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201c", rdquo: "\u201d",
  euro: "€", copy: "©", reg: "®", trade: "™",
};

/**
 * De HTML a texto plano.
 *
 * Estos correos vienen maquetados con tablas: la etiqueta en una celda y el
 * valor en la de al lado. Los cierres de celda pasan a tabulador y los de fila
 * a salto de línea, para que "Matrícula" y "7851JNT" acaben en la misma línea
 * siempre que se pueda.
 */
export function textoPlano(html: string): string {
  return String(html ?? "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, "\t")
    .replace(/<\/(p|div|tr|table|h[1-6]|li|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (todo: string, n: string) => {
      const v = ENTIDADES[n.toLowerCase()];
      if (!v) return todo;
      // "&Iacute;" es la misma letra en mayúscula.
      return /^[A-Z]/.test(n) ? v.toUpperCase() : v;
    })
    // El & al final: si no, "&amp;oacute;" —que es un & escrito, no una ó—
    // acabaría convertido en "ó".
    .replace(/&amp;/gi, "&")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** El cuerpo del correo: la parte plana si la hay, y si no el HTML aplanado. */
export function cuerpoDelCorreo(correo: { text?: string | null; html?: string | false | null }): string {
  const plano = String(correo?.text ?? "").trim();
  if (plano) return plano.replace(/\r/g, "");
  return textoPlano(typeof correo?.html === "string" ? correo.html : "");
}

// ── Las etiquetas de la plantilla ───────────────────────────────────────────

const ETIQUETAS: Record<string, string> = {
  "matricula": "matricula",
  "id de flota": "idFlota",
  "rueda": "rueda",
  "fecha y hora": "fechaHora",
  "presion recomendada": "presionRecomendada",
  "presion bruta": "presionBruta",
  "nombre de checkpoint": "checkpoint",
  // Viene siempre y viene vacía. Está en la lista para que se reconozca como
  // etiqueta y no la tome nadie por el valor de la anterior.
  "etiquetas": "etiquetas",
};

const esLineaEtiqueta = (linea: string): boolean => {
  const p = linea.indexOf(":");
  if (p < 1) return false;
  const k = clave(linea.slice(0, p));
  return !!ETIQUETAS[k] || /^[\p{L} ]{2,30}$/u.test(k);
};

/**
 * Los pares etiqueta → valor del correo.
 *
 * Dos pasadas por campo: el valor en la misma línea y, si esa línea sólo trae
 * la etiqueta, el de la línea siguiente — que es como queda una tabla HTML
 * cuando el emisor pone la etiqueta y el valor en filas distintas.
 *
 * La segunda pasada descarta el valor si él mismo parece una etiqueta. Sin
 * eso, "Etiquetas:" (que viene vacía) se comería "Fecha y hora:".
 */
export function camposDelTexto(texto: string): Record<string, string> {
  const lineas = String(texto ?? "").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim());
  const out: Record<string, string> = {};
  for (let i = 0; i < lineas.length; i++) {
    const p = lineas[i].indexOf(":");
    if (p < 1) continue;
    const k = ETIQUETAS[clave(lineas[i].slice(0, p))];
    if (!k || out[k]) continue; // la primera aparición manda
    let v = lineas[i].slice(p + 1).trim();
    if (!v) {
      const sig = lineas[i + 1] ?? "";
      if (sig && !esLineaEtiqueta(sig)) v = sig;
    }
    if (v) out[k] = v;
  }
  return out;
}

// ── ¿Es un aviso de presión? ────────────────────────────────────────────────

const MARCAS = ["matricula", "rueda", "presionBruta", "presionRecomendada", "checkpoint"];

/**
 * Se reconoce por lo que ES: el asunto de la plantilla y sus etiquetas.
 *
 * No por lo que le falta. Que un aviso no lleve adjunto y el informe semanal
 * sí es cierto hoy, pero apoyarse en eso convertiría cualquier correo suelto
 * —una respuesta, publicidad— en un candidato a aviso.
 */
export function esAvisoPresion(asunto: string | null | undefined, texto: string): boolean {
  // clave() quita los acentos, así que aquí "presion" cubre "Presión".
  if (!/presion\s+baja/.test(clave(asunto))) return false;
  const campos = camposDelTexto(texto);
  return MARCAS.filter((m) => campos[m]).length >= 3;
}

// ── Números ─────────────────────────────────────────────────────────────────

/** Acepta coma o punto decimal: el arco escribe las dos formas. */
const num = (v: string | null | undefined): number | null => {
  const s = String(v ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const barDe = (v: string | null | undefined): number | null => {
  const m = String(v ?? "").match(/(-?[\d.,]+)\s*bar/i);
  return m ? num(m[1]) : null;
};

const porcentajeDe = (v: string | null | undefined): number | null => {
  const m = String(v ?? "").match(/\(\s*([+-]?[\d.,]+)\s*%\s*\)/);
  return m ? num(m[1]) : null;
};

/** Una presión que no esté entre 0 y 20 bar no es una presión: es un error. */
const presionValida = (n: number | null): n is number => n != null && n > 0 && n < 20;

// ── La hora, que no dice zona ───────────────────────────────────────────────

const ZONA = "Europe/Madrid";

function desfaseZonaMs(d: Date, zona: string): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const v: Record<string, string> = {};
  for (const p of partes) if (p.type !== "literal") v[p.type] = p.value;
  return Date.UTC(+v.year, +v.month - 1, +v.day, +v.hour, +v.minute, +v.second) - d.getTime();
}

/**
 * "19.08.2026 · 22:13:23" es hora local española, pero el correo no lo dice y
 * el servidor corre en UTC: interpretarla con `new Date(...)` la guardaría dos
 * horas tarde en verano. Y es un fallo silencioso — nadie mira el segundero de
 * una incidencia hasta que hay que reconstruir qué pasó.
 *
 * Mismo método que la agenda (server/index.ts): se calcula el desfase de la
 * zona y se aplica dos veces, porque el propio desfase depende del instante y
 * en los cambios de hora la primera cuenta se queda corta.
 */
export function momentoEnMadrid(y: number, mes: number, d: number, h: number, mi: number, s: number): Date {
  const comoUtc = Date.UTC(y, mes - 1, d, h, mi, s);
  let ms = comoUtc - desfaseZonaMs(new Date(comoUtc), ZONA);
  ms = comoUtc - desfaseZonaMs(new Date(ms), ZONA);
  return new Date(ms);
}

/** "19.08.2026 · 22:13:23", "19/08/2026 22:13" o "19-08-2026 · 22:13:23". */
export function fechaDelAviso(valor: string | null | undefined): Date | null {
  const m = String(valor ?? "").match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})\D{1,4}(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [d, mes, y, h, mi] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  const s = m[6] ? +m[6] : 0;
  if (mes < 1 || mes > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  const f = momentoEnMadrid(y, mes, d, h, mi, s);
  return isNaN(f.getTime()) ? null : f;
}

// ── Gravedad ────────────────────────────────────────────────────────────────

const PESO: Record<Gravedad, number> = { leve: 0, importante: 1, critica: 2 };

export const mayorGravedad = (a: Gravedad, b: Gravedad): Gravedad => (PESO[a] >= PESO[b] ? a : b);

/**
 * La gravedad la dice el correo, no se inventa.
 *
 * Hoy sólo conocemos con certeza un rango, "crítico (debajo 75%)", que es el
 * único que ha llegado. Cualquier otra palabra NO se interpreta: se crea la
 * incidencia con la gravedad más baja y se deja dicho en las observaciones,
 * que es exactamente lo que hay que hacer con un dato que no se entiende.
 * Cuando aparezca un rango nuevo, el correo de aviso lo dirá y esta tabla se
 * amplía con su test.
 */
export function gravedadDeRango(rango: string | null): { gravedad: Gravedad; conocido: boolean } {
  const r = clave(rango ?? "");
  if (!r) return { gravedad: "leve", conocido: false };
  if (r.startsWith("critic")) return { gravedad: "critica", conocido: true };
  return { gravedad: "leve", conocido: false };
}

// ── El analizador ───────────────────────────────────────────────────────────

const normalizarMatricula = (s: string) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Lee el aviso. O lo lee entero, o no devuelve nada.
 *
 * Nunca campos a medias: media matrícula y una presión suelta son justo el
 * dato falso que este módulo existe para evitar. `faltan` dice qué se ha roto,
 * y es lo que acaba en el correo de aviso y en el registro.
 */
export function leerAvisoPresion(
  texto: string,
  opts: { fechaCorreo?: Date | null } = {},
): LecturaAviso {
  const t = String(texto ?? "");
  const c = camposDelTexto(t);
  const faltan: string[] = [];
  const notas: string[] = [];

  // El rango y su umbral van en la primera línea, sin etiqueta.
  const mRango = t.match(/rango\s+(?:de\s+)?([\p{L}]+)/iu);
  const rango = mRango ? mRango[1] : null;
  const umbralPct = num((t.match(/debajo\s+(?:de\s+)?([\d.,]+)\s*%/i) ?? [])[1]);

  const matriculaTexto = (c.matricula ?? "").trim();
  const matricula = normalizarMatricula(matriculaTexto);
  if (!/^[A-Z0-9]{6,10}$/.test(matricula)) faltan.push("Matrícula");

  // La rueda: "Eje 2 - izquierdo exterior". Si dice interior o exterior, el
  // eje es de gemelos; si no lo dice, de rueda simple. La traducción a nuestro
  // código la hace senasPosicion(), la misma que usa el informe semanal.
  const rueda = (c.rueda ?? "").trim();
  const eje = Number((rueda.match(/eje\s*(\d+)/i) ?? [])[1] ?? NaN);
  const dice = /interior|exterior/i.test(rueda);
  const senas = Number.isFinite(eje) && eje >= 1 && eje <= 5
    ? senasPosicion(eje, rueda, dice ? 4 : 2)
    : null;
  if (!senas) faltan.push("Rueda");

  const medidoAt = fechaDelAviso(c.fechaHora);
  if (!medidoAt) faltan.push("Fecha y hora");

  const presionBar = barDe(c.presionBruta);
  if (!presionValida(presionBar)) faltan.push("Presión bruta");

  const recomendada = barDe(c.presionRecomendada);
  const presionRecomendadaBar = presionValida(recomendada) ? recomendada : null;
  if (recomendada != null && presionRecomendadaBar == null) {
    notas.push(`La presión recomendada del correo no es una presión creíble: "${c.presionRecomendada}"`);
  }

  if (faltan.length) return { ok: false, faltan, notas };

  if (!rango) notas.push("El correo no dice en qué rango está la presión: se registra con la gravedad más baja");
  else if (!gravedadDeRango(rango).conocido) {
    notas.push(`Rango desconocido "${rango}": se registra con la gravedad más baja hasta saber qué significa`);
  }

  // Red barata contra haber leído el campo equivocado: si la medición se
  // aparta una semana de la fecha del propio correo, algo no cuadra. No se
  // descarta el aviso — el correo puede haberse reenviado tarde—, se anota.
  if (opts.fechaCorreo && medidoAt) {
    const dias = Math.abs(opts.fechaCorreo.getTime() - medidoAt.getTime()) / 86_400_000;
    if (dias > 7) {
      notas.push(`La medición (${medidoAt.toISOString()}) se aparta ${Math.round(dias)} días de la fecha del correo`);
    }
  }

  return {
    ok: true,
    notas,
    aviso: {
      matricula,
      matriculaTexto,
      idFlota: (c.idFlota ?? "").trim() || null,
      eje,
      lado: senas!.lado,
      interiorExterior: senas!.interiorExterior,
      codigoPosicion: senas!.codigo,
      medidoAt: medidoAt!,
      presionBar: presionBar!,
      presionRecomendadaBar,
      desviacionPct: porcentajeDe(c.presionBruta),
      rango,
      umbralPct,
      checkpoint: (c.checkpoint ?? "").trim() || null,
    },
  };
}

// ── Redacción ───────────────────────────────────────────────────────────────

/** 5.5 → "5,5". Los números se enseñan como se escriben aquí. */
export const bar = (n: number): string => String(n).replace(".", ",");

const fechaCorta = (d: Date): string =>
  new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
const fechaHoraCorta = (d: Date): string =>
  new Intl.DateTimeFormat("es-ES", {
    timeZone: ZONA, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);

/**
 * Qué hacer, en lenguaje normal y a partir de números ya extraídos.
 *
 * Siempre hay una frase, aunque no haya IA ni conexión: la IA sólo la pule
 * (avisoPresionIncidencia.ts), y si falla se queda ésta.
 */
export function accionRecomendadaBase(aviso: AvisoPresion): string {
  const desvio = aviso.desviacionPct != null ? `, un ${bar(Math.abs(aviso.desviacionPct))}% por debajo` : "";
  const objetivo = aviso.presionRecomendadaBar != null
    ? `Inflar a ${bar(aviso.presionRecomendadaBar)} bar: el arco la ha medido en ${bar(aviso.presionBar)} bar${desvio}.`
    : `Corregir la presión: el arco la ha medido en ${bar(aviso.presionBar)} bar${desvio}.`;
  return `${objetivo} Si el aviso se repite tras inflarla, buscar la pérdida (válvula, pinchazo lento).`;
}

/** Cuántas veces se ha avisado de esto y desde cuándo. */
export interface ContextoAviso {
  /** Avisos registrados para esta incidencia contando el que llega. */
  veces: number;
  /** Medición del primero de todos. */
  primero: Date;
}

/**
 * El resumen que va a las observaciones de la incidencia.
 *
 * Se REGENERA en cada aviso a partir del histórico, no se acumula. Un texto
 * que crece cada día acaba siendo ilegible, y un contador que se incrementa a
 * mano acaba desviándose del hecho; contando filas eso no puede pasar, ni
 * siquiera si un aviso se reprocesa.
 */
export function resumenAviso(aviso: AvisoPresion, ctx: ContextoAviso, notas: string[] = []): string {
  const rango = aviso.rango ? `, rango ${aviso.rango.toLowerCase()}` : "";
  const desvio = aviso.desviacionPct != null ? ` (${bar(aviso.desviacionPct)}%)` : "";
  const donde = aviso.checkpoint ? ` CheckPoint: ${aviso.checkpoint}.` : "";
  const cabeza = ctx.veces > 1
    ? `Aviso del arco repetido ${ctx.veces} veces entre el ${fechaCorta(ctx.primero)} y el ${fechaCorta(aviso.medidoAt)}. ` +
      `Última medición: ${bar(aviso.presionBar)} bar${desvio}${rango}.`
    : `Aviso del arco del ${fechaHoraCorta(aviso.medidoAt)}: ${bar(aviso.presionBar)} bar${desvio}${rango}.`;
  return [cabeza + donde, ...notas].join(" ").trim();
}

// ── La decisión ─────────────────────────────────────────────────────────────

/** Lo que hace falta saber de una incidencia ya abierta para decidir. */
export interface IncidenciaAbierta {
  id: string;
  gravedad: Gravedad;
}

export interface DecisionAviso {
  accion: "crear" | "actualizar";
  incidenciaId: string | null;
  gravedad: Gravedad;
  gravedadAuto: Gravedad;
  observacion: string;
  accionRecomendada: string;
}

/**
 * ¿Incidencia nueva o la que ya hay?
 *
 * Ese camión va a cruzar el arco todos los días con la rueda baja hasta que
 * alguien la infle. Si cada aviso abriera incidencia, en una semana habría
 * siete idénticas y la pantalla quedaría inservible.
 *
 * La gravedad SÓLO SUBE. Si el lunes llega "crítico" y el martes un rango más
 * suave, la rueda no ha mejorado sola: o le han metido aire —y entonces
 * alguien cerrará la incidencia— o el arco ha leído distinto. Bajarla
 * escondería un problema que sigue ahí.
 */
export function decidirAviso(
  existente: IncidenciaAbierta | null,
  aviso: AvisoPresion,
  ctx: ContextoAviso,
  notas: string[] = [],
): DecisionAviso {
  const gravedadAuto = gravedadDeRango(aviso.rango).gravedad;
  return {
    accion: existente ? "actualizar" : "crear",
    incidenciaId: existente?.id ?? null,
    gravedad: existente ? mayorGravedad(existente.gravedad, gravedadAuto) : gravedadAuto,
    gravedadAuto,
    observacion: resumenAviso(aviso, ctx, notas),
    accionRecomendada: accionRecomendadaBase(aviso),
  };
}
