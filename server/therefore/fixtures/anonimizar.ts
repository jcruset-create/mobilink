/**
 * Quitar de un correo lo que identifica sin tocar lo que hace falta para
 * validar el parser.
 *
 * Código PURO: entra texto, sale texto. El fichero que lee correos y escribe
 * carpetas es `scripts/therefore-anonimizar.ts`.
 *
 * ── La regla, que es la que gobierna todo lo de aquí ────────────────────────
 *
 * **No se toca ni un número que participe en la lógica.** Referencias de
 * artículo, cantidades, precios, descuentos, importes, números de albarán y de
 * factura salen tal cual. Si se alteraran, el lote dejaría de servir para lo
 * único que sirve: comprobar que el parser saca del papel lo que pone.
 *
 * ── Y la parte que no es obvia: sustituir conservando el formato ────────────
 *
 * Una matrícula y un bastidor SÍ identifican, pero el parser tiene que
 * encontrarlos, así que no se pueden borrar. Se sustituyen por otros con la
 * MISMA forma: `6352GVV` → `4417KBS`, no `[MATRÍCULA]`. Así el reconocedor
 * sigue teniendo delante algo que parece una matrícula —que es lo que se está
 * probando— y el vehículo de nadie aparece en el lote.
 *
 * Lo mismo con NIF y CIF: se genera uno con letra de control correcta, porque
 * un NIF con letra inválida entrenaría al parser a aceptar basura.
 */

/* ── Sustitución literal ─────────────────────────────────────────────────── */

export type MapaSustituciones = Record<string, string>;

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Aplica el mapa al texto.
 *
 * De la clave más larga a la más corta, y no es un detalle: con
 * «NEUMATICOS SOLEDAD» antes que «NEUMATICOS SOLEDAD, S.L.», la primera se
 * comería el principio de la segunda y quedaría «PROVEEDOR UNO, S.L.» mezclado
 * con el resto del nombre real. Ordenar por longitud lo evita.
 *
 * Sin distinguir mayúsculas, porque el mismo proveedor aparece como
 * «NEUMATICOS SOLEDAD» en la factura y «Neumaticos Soledad» en el correo.
 */
export function sustituir(texto: string, mapa: MapaSustituciones): string {
  const claves = Object.keys(mapa)
    .filter((k) => k.length > 0)
    .sort((a, b) => b.length - a.length);
  let salida = texto;
  for (const clave of claves) {
    salida = salida.replace(new RegExp(escapar(clave), "gi"), mapa[clave]);
  }
  return salida;
}

/* ── Detección de lo que hay que mirar ───────────────────────────────────── */

export type TipoDato =
  | "email"
  | "nif"
  | "iban"
  | "telefono"
  | "matricula"
  | "bastidor";

export type Hallazgo = { tipo: TipoDato; valor: string };

/**
 * El ORDEN importa, y costó una prueba en rojo descubrirlo.
 *
 * Un bastidor como `VF30E9HZHAS115406` encaja también en el patrón de IBAN
 * —dos letras, dos dígitos y grupos alfanuméricos— y, con el IBAN delante, se
 * sustituía por un `ES00…`. Eso destruye la forma del bastidor, y entonces el
 * lote ya no prueba que el parser sepa reconocer uno.
 *
 * Así que va de MÁS específico a MENOS: el bastidor tiene una longitud exacta
 * de 17 y excluye I, O y Q; el IBAN es un patrón mucho más laxo. Un IBAN
 * español de verdad tiene 24 caracteres y no lo caza el de 17, porque los
 * límites de palabra impiden coger un trozo.
 */
const PATRONES: { tipo: TipoDato; re: RegExp }[] = [
  { tipo: "email", re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  // Bastidor: 17 caracteres exactos, sin I, O ni Q. El más específico de todos.
  { tipo: "bastidor", re: /\b[A-HJ-NPR-Z0-9]{17}\b/g },
  { tipo: "iban", re: /\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){3,7}[A-Z0-9]{1,4}\b/g },
  // NIF (8 dígitos + letra) y CIF (letra + 7 dígitos + control).
  { tipo: "nif", re: /\b(?:\d{8}[A-Za-z]|[A-HJ-NP-SUVW]\d{7}[0-9A-Ja-j])\b/g },
  // Matrícula española moderna y la antigua con provincia.
  { tipo: "matricula", re: /\b\d{4}[ -]?[BCDFGHJKLMNPRSTVWXYZ]{3}\b/g },
  { tipo: "telefono", re: /\b(?:\+34[ ]?)?[6789]\d{2}[ ]?\d{3}[ ]?\d{3}\b/g },
];

/**
 * Busca en el texto lo que probablemente identifica a alguien.
 *
 * **Propone, no decide.** La lista va a un fichero que una persona revisa
 * antes de que se escriba nada: un detector automático que sustituyera por su
 * cuenta acabaría tocando un número de albarán que se pareciera a un teléfono,
 * y eso rompería el lote en silencio.
 */
export function detectar(texto: string): Hallazgo[] {
  const vistos = new Set<string>();
  const salida: Hallazgo[] = [];
  for (const { tipo, re } of PATRONES) {
    for (const m of texto.matchAll(re)) {
      const valor = m[0];
      // Una cadena ya cazada por un patrón anterior no se vuelve a proponer:
      // un bastidor contiene tiradas que parecen otras cosas.
      if (vistos.has(valor)) continue;
      vistos.add(valor);
      salida.push({ tipo, valor });
    }
  }
  return salida;
}

/* ── Sustitutos que conservan la forma ───────────────────────────────────── */

/**
 * Un número estable a partir de un texto.
 *
 * Determinista a propósito: el mismo valor real produce siempre el mismo
 * sustituto, así que las relaciones entre correo, factura y adjunto se
 * conservan. Si fuese aleatorio, el mismo proveedor saldría con dos nombres en
 * dos casos y el lote dejaría de poder probar la deduplicación.
 */
function semilla(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const LETRAS_MATRICULA = "BCDFGHJKLMNPRSTVWXYZ";
const LETRAS_NIF = "TRWAGMYFPDXBNJZSQVHLCKE";
const LETRAS_BASTIDOR = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";

export function matriculaFalsa(original: string): string {
  const s = semilla(original);
  const numero = String(s % 10000).padStart(4, "0");
  const letras = [0, 1, 2]
    .map((i) => LETRAS_MATRICULA[Math.floor(s / Math.pow(20, i)) % LETRAS_MATRICULA.length])
    .join("");
  return `${numero}${letras}`;
}

/** Letras que puede llevar un CIF delante, y las del dígito de control. */
const LETRAS_CIF = "ABCDEFGHJNPQRSUVW";
const CONTROL_CIF = "JABCDEFGHI";

/**
 * NIF o CIF falso con la letra de control CORRECTA y la MISMA forma que el
 * original.
 *
 * Dos cosas, y las dos importan:
 *
 * · Uno con letra inválida enseñaría al parser a aceptar basura, y el día que
 *   se quiera validar el NIF del proveedor el lote entero no valdría.
 * · Un CIF (letra + 7 dígitos + control) tiene que salir como CIF, no como NIF
 *   (8 dígitos + letra). Cambiar la forma cambia lo que el lote prueba.
 */
export function nifFalso(original: string): string {
  const s = semilla(original);
  const esCif = /^[A-Za-z]/.test(original.trim());

  if (!esCif) {
    const numero = s % 100000000;
    return `${String(numero).padStart(8, "0")}${LETRAS_NIF[numero % 23]}`;
  }

  const inicial = LETRAS_CIF[s % LETRAS_CIF.length];
  const digitos = String(s % 10000000).padStart(7, "0");

  // Control del CIF: pares tal cual; impares doblados y sumando sus cifras.
  let suma = 0;
  for (let i = 0; i < 7; i++) {
    const d = Number(digitos[i]);
    if (i % 2 === 0) {
      const doble = d * 2;
      suma += Math.floor(doble / 10) + (doble % 10);
    } else {
      suma += d;
    }
  }
  const control = (10 - (suma % 10)) % 10;

  // Las sociedades con letra de control van con letra; el resto, con dígito.
  const conLetra = "PQRSNW".includes(inicial);
  return `${inicial}${digitos}${conLetra ? CONTROL_CIF[control] : String(control)}`;
}

export function bastidorFalso(original: string): string {
  const s = semilla(original);
  let salida = "";
  for (let i = 0; i < 17; i++) {
    salida += LETRAS_BASTIDOR[Math.floor(s / Math.pow(7, i % 8) + i * 31) % LETRAS_BASTIDOR.length];
  }
  return salida;
}

export function emailFalso(original: string): string {
  return `persona${semilla(original) % 1000}@example.invalid`;
}

export function telefonoFalso(original: string): string {
  return `6${String(semilla(original) % 100000000).padStart(8, "0")}`;
}

export function ibanFalso(original: string): string {
  return `ES00${String(semilla(original) % 10 ** 16).padStart(16, "0")}`;
}

/**
 * Propone un sustituto para cada hallazgo, del tipo que toque.
 *
 * Los nombres de personas y empresas NO se detectan solos —no hay patrón que
 * los distinga de un concepto de albarán— y por eso se añaden a mano al mapa.
 * Es lo correcto: quien los añade sabe cuáles son.
 */
export function proponerSustitutos(hallazgos: readonly Hallazgo[]): MapaSustituciones {
  const mapa: MapaSustituciones = {};
  for (const h of hallazgos) {
    mapa[h.valor] = sustitutoDe(h);
  }
  return mapa;
}

export function sustitutoDe(h: Hallazgo): string {
  switch (h.tipo) {
    case "email":
      return emailFalso(h.valor);
    case "nif":
      return nifFalso(h.valor);
    case "iban":
      return ibanFalso(h.valor);
    case "telefono":
      return telefonoFalso(h.valor);
    case "matricula":
      return matriculaFalsa(h.valor);
    case "bastidor":
      return bastidorFalso(h.valor);
  }
}

/* ── El bloque libre y el Message-ID ─────────────────────────────────────── */

/**
 * Etiquetas de la plantilla de Therefore que cierran el bloque libre.
 *
 * El correo tiene dos mitades: lo que escribe una persona y lo que rellena
 * Therefore siempre igual. `Información Adicional` abre la primera, y la
 * primera de estas etiquetas abre la segunda.
 */
const ETIQUETAS_PLANTILLA = [
  "código proveedor",
  "codigo proveedor",
  "razón social",
  "razon social",
  "cuenta contable",
  "número factura",
  "numero factura",
  "fecha factura",
  "importe",
  "moneda",
];

/**
 * Saca el bloque «Información Adicional»: sólo lo que escribió la persona.
 *
 * Termina donde empiezan los campos de plantilla. Sin ese corte, el bloque se
 * traga «Código Proveedor: 8», «Razón Social: …» y el resto, y entonces deja de
 * ser lo que dice ser: la petición concreta. Y es justo el campo que se mira
 * cuando un caso falla, así que tenerlo sucio sale caro.
 *
 * Si no aparece la etiqueta de apertura se devuelve el cuerpo entero: quedarse
 * sin el bloque es peor que tenerlo de más.
 */
export function informacionAdicional(texto: string): string {
  const apertura = texto.match(/informaci[oó]n\s+adicional\s*:?\s*\n/i);
  const desde = apertura?.index === undefined ? 0 : apertura.index + apertura[0].length;

  const lineas = texto.slice(desde).split("\n");
  const fin = lineas.findIndex((l) => {
    const m = l.match(/^\s*([^:]{3,30}):/);
    return m ? ETIQUETAS_PLANTILLA.includes(m[1].trim().toLowerCase()) : false;
  });

  return (fin === -1 ? lineas : lineas.slice(0, fin)).join("\n").trim();
}

/**
 * Deja el Message-ID sin el dominio de la empresa.
 *
 * La parte local se conserva **entera y tal cual**: es lo que hace único el
 * mensaje, y la idempotencia —que procesar dos veces el mismo correo no cree
 * dos notificaciones— es justo lo que el lote tiene que poder probar. Si se
 * sustituyera por un valor derivado, dos correos distintos podrían acabar con
 * el mismo identificador y la prueba pasaría por el motivo equivocado.
 *
 * Lo que se va es el dominio, que sí dice de quién es el buzón.
 */
export function anonimizarMessageId(id: string | null | undefined): string {
  if (!id) return "";
  return id.replace(/@[^>\s]+/, "@example.invalid");
}

/* ── La red de seguridad ─────────────────────────────────────────────────── */

/**
 * ¿Queda algo sin anonimizar después de aplicar el mapa?
 *
 * Se ejecuta SIEMPRE sobre el resultado, y es lo último que separa un lote
 * limpio de publicar el correo de alguien. Devuelve lo que el detector todavía
 * encuentra: si no está vacío, el caso no se escribe.
 *
 * Los valores que el propio mapa ha introducido no cuentan como hallazgo: un
 * NIF falso sigue pareciendo un NIF, y debe.
 */
export function loQueQueda(textoAnonimizado: string, mapa: MapaSustituciones): Hallazgo[] {
  const introducidos = new Set(Object.values(mapa));
  return detectar(textoAnonimizado).filter((h) => !introducidos.has(h.valor));
}
