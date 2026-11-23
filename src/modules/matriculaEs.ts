/**
 * Cómo se dibuja una matrícula: como la placa de su país.
 *
 * Solo decide el DIBUJO. No valida ni corrige: lo que no encaja en nada se
 * enseña tal cual está escrito, en un recuadro liso.
 *
 * ── El país ─────────────────────────────────────────────────────────────────
 *
 * Se deduce de la forma SOLO cuando la forma no deja dudas: las españolas,
 * las portuguesas, las rumanas y las polacas. En el resto no se adivina:
 * Francia e Italia usan exactamente el mismo patrón (AA-123-AA), y una búlgara
 * «B 1234 AB» es igual que una antigua de Barcelona. Una placa con el país
 * equivocado es peor que una sin país, así que esas salen como placa UE sin
 * letra, hasta que alguien indique el país (campo «País de la matrícula»).
 *
 * La misma regla está en la tablet (flutter_app/lib/services/matricula_es.dart)
 * y tiene que decir lo mismo, con las mismas pruebas.
 */

export type TipoMatricula =
  | "actual" // española, 4 cifras y 3 letras
  | "remolque" // española de remolque: roja
  | "especial" // española de vehículo especial (E delante): letras rojas
  | "antigua" // española de provincia: sin banda
  | "ue" // de otro país de la UE, o con forma de placa europea sin país claro
  | "otra"; // fuera de la UE o no reconocida: recuadro liso

export type MatriculaDibujo = {
  tipo: TipoMatricula;
  /** Los grupos, para pintarlos separados: «6084» «FRG». */
  partes: string[];
  /** Cómo se juntan los grupos: espacio, guion… */
  separador: string;
  /** La letra de la banda azul («E», «F»…). Vacía: banda sin letra. */
  pais: string;
  /** Si lleva la banda azul de la UE. */
  banda: boolean;
  fondo: "blanco" | "rojo" | "amarillo" | "liso";
  /** Letras rojas (vehículo especial español). */
  letrasRojas: boolean;
};

/** El valor de «País de la matrícula» para una que no es de la UE. */
export const FUERA_UE = "X";

/** Los países que se pueden elegir, con la letra que va en la banda. */
export const PAISES_MATRICULA: { codigo: string; nombre: string }[] = [
  { codigo: "E", nombre: "España" },
  { codigo: "P", nombre: "Portugal" },
  { codigo: "F", nombre: "Francia" },
  { codigo: "I", nombre: "Italia" },
  { codigo: "D", nombre: "Alemania" },
  { codigo: "NL", nombre: "Países Bajos" },
  { codigo: "B", nombre: "Bélgica" },
  { codigo: "L", nombre: "Luxemburgo" },
  { codigo: "PL", nombre: "Polonia" },
  { codigo: "RO", nombre: "Rumanía" },
  { codigo: "BG", nombre: "Bulgaria" },
  { codigo: "CZ", nombre: "Chequia" },
  { codigo: "SK", nombre: "Eslovaquia" },
  { codigo: "H", nombre: "Hungría" },
  { codigo: "A", nombre: "Austria" },
  { codigo: "SLO", nombre: "Eslovenia" },
  { codigo: "HR", nombre: "Croacia" },
  { codigo: "LT", nombre: "Lituania" },
  { codigo: "LV", nombre: "Letonia" },
  { codigo: "EST", nombre: "Estonia" },
  { codigo: "IRL", nombre: "Irlanda" },
  { codigo: "DK", nombre: "Dinamarca" },
  { codigo: "S", nombre: "Suecia" },
  { codigo: "FIN", nombre: "Finlandia" },
  { codigo: "GR", nombre: "Grecia" },
  { codigo: "CY", nombre: "Chipre" },
  { codigo: "M", nombre: "Malta" },
];
const CODIGOS = new Set(PAISES_MATRICULA.map((p) => p.codigo));

/** Lo que se guarda: un código de la lista, FUERA_UE, o null (automático). */
export function paisMatriculaValido(v: unknown): string | null {
  const t = String(v ?? "").trim().toUpperCase();
  return t === FUERA_UE || CODIGOS.has(t) ? t : null;
}

// Las matrículas españolas actuales no llevan vocales ni Ñ ni Q.
const LETRAS = "BCDFGHJKLMNPRSTVWXYZ";

const ACTUAL = new RegExp(`^(\\d{4})([${LETRAS}]{3})$`);
const REMOLQUE = new RegExp(`^(R)(\\d{4})([${LETRAS}]{3})$`);
const ESPECIAL = new RegExp(`^(E)(\\d{4})([${LETRAS}]{3})$`);
const ANTIGUA = /^([A-Z]{1,2})(\d{4})([A-Z]{1,2})$/;
// Portugal: tres parejas, con las letras en cualquiera de las tres posiciones.
const PORTUGAL = /^(?:([A-Z]{2})(\d{2})([A-Z]{2})|(\d{2})([A-Z]{2})(\d{2})|(\d{2})(\d{2})([A-Z]{2})|([A-Z]{2})(\d{2})(\d{2}))$/;
// Rumanía: B + 2-3 cifras + 3 letras, o provincia de dos letras + 2 cifras + 3 letras.
const RUMANIA = /^(?:(B)(\d{2,3})|([A-Z]{2})(\d{2}))([A-Z]{3})$/;
// Las provincias rumanas: sin la lista, una británica «AB12 CDE» (misma forma,
// y no es de la UE) saldría como rumana.
const JUDETE = new Set([
  "AB", "AR", "AG", "BC", "BH", "BN", "BT", "BV", "BR", "BZ", "CS", "CL", "CJ", "CT", "CV", "DB", "DJ", "GL",
  "GR", "GJ", "HR", "HD", "IL", "IS", "IF", "MM", "MH", "MS", "NT", "OT", "PH", "SM", "SJ", "SB", "SV", "TR",
  "TM", "TL", "VS", "VL", "VN",
]);
// Polonia: 2-3 letras de comarca, cuatro cifras y un carácter más. (La forma
// «letras + 3 cifras + 2 letras» NO: es también la francesa, la italiana y la
// eslovaca.)
const POLONIA = /^([A-Z]{2,3})(\d{4}[A-Z0-9])$/;
// Francia e Italia (mismo patrón): solo con el país indicado.
const AA123AA = /^([A-Z]{2})(\d{3})([A-Z]{2})$/;

/**
 * Siglas de provincia del sistema español anterior (hasta el año 2000). Sin
 * esta lista, cualquier extranjera con forma de «letras-4 cifras-letras»
 * saldría dibujada como española.
 */
const PROVINCIAS = new Set([
  "A", "AB", "AL", "AV", "B", "BA", "BI", "BU", "C", "CA", "CC", "CE", "CO", "CR", "CS", "CU",
  "GC", "GE", "GI", "GR", "GU", "H", "HU", "IB", "J", "L", "LE", "LO", "LU", "M", "MA", "ML",
  "MU", "NA", "O", "OR", "OU", "P", "PM", "PO", "S", "SA", "SE", "SG", "SO", "SS", "T", "TE",
  "TF", "TO", "V", "VA", "VI", "Z", "ZA",
]);

const base = (tipo: TipoMatricula, partes: string[], extra: Partial<MatriculaDibujo> = {}): MatriculaDibujo => ({
  tipo, partes, separador: " ", pais: "", banda: false, fondo: "blanco", letrasRojas: false, ...extra,
});

/** Lo escrito, en mayúsculas y con los separadores de quien la tecleó reducidos a un espacio. */
function comoEstaEscrita(matricula: unknown): string {
  return String(matricula ?? "").trim().toUpperCase().replace(/[\s\-.·]+/g, " ");
}

function espanola(m: string): MatriculaDibujo | null {
  let r = REMOLQUE.exec(m);
  if (r) return base("remolque", [r[1], r[2], r[3]], { pais: "E", banda: true, fondo: "rojo" });
  r = ESPECIAL.exec(m);
  if (r) return base("especial", [r[1], r[2], r[3]], { pais: "E", banda: true, letrasRojas: true });
  r = ACTUAL.exec(m);
  if (r) return base("actual", [r[1], r[2]], { pais: "E", banda: true });
  r = ANTIGUA.exec(m);
  if (r && PROVINCIAS.has(r[1])) return base("antigua", [r[1], r[2], r[3]]);
  return null;
}

/** Con el país indicado: su letra, su color y su forma de separar. */
function conPais(m: string, escrita: string, pais: string): MatriculaDibujo {
  const ue = (partes: string[], extra: Partial<MatriculaDibujo> = {}) =>
    base("ue", partes, { pais, banda: true, ...extra });
  if (pais === "E") return espanola(m) ?? ue([escrita]);
  if (pais === "P") {
    const r = PORTUGAL.exec(m);
    if (r) return ue(r.slice(1).filter(Boolean), { separador: "·" });
  }
  if (pais === "F" || pais === "I") {
    const r = AA123AA.exec(m);
    if (r) return ue([r[1], r[2], r[3]], { separador: pais === "F" ? "-" : " " });
  }
  if (pais === "RO") {
    const r = RUMANIA.exec(m);
    if (r) return ue([r[1] ?? r[3], r[2] ?? r[4], r[5]]);
  }
  if (pais === "PL") {
    const r = POLONIA.exec(m);
    if (r) return ue([r[1], r[2]]);
  }
  // Países Bajos y Luxemburgo llevan la placa amarilla.
  return ue([escrita], pais === "NL" || pais === "L" ? { fondo: "amarillo" } : {});
}

export function dibujoMatricula(matricula: unknown, paisIndicado?: unknown): MatriculaDibujo {
  const escrita = comoEstaEscrita(matricula);
  const m = escrita.replace(/ /g, "");
  const pais = paisMatriculaValido(paisIndicado);

  if (pais === FUERA_UE) return base("otra", [escrita], { fondo: "liso" });
  if (pais) return conPais(m, escrita, pais);

  // Automático: solo lo que no deja dudas.
  const es = espanola(m);
  if (es) return es;
  let r = PORTUGAL.exec(m);
  if (r) return base("ue", r.slice(1).filter(Boolean), { pais: "P", banda: true, separador: "·" });
  r = RUMANIA.exec(m);
  if (r && (r[1] || JUDETE.has(r[3]))) return base("ue", [r[1] ?? r[3], r[2] ?? r[4], r[5]], { pais: "RO", banda: true });
  r = POLONIA.exec(m);
  if (r) return base("ue", [r[1], r[2]], { pais: "PL", banda: true });

  // Con pinta de placa europea (letras y cifras, de 5 a 9 caracteres): banda
  // de la UE sin letra, porque el país no se puede saber por la forma.
  if (/^[A-Z0-9]{5,9}$/.test(m) && /[A-Z]/.test(m) && /\d/.test(m)) {
    return base("ue", [escrita], { banda: true });
  }
  return base("otra", [escrita], { fondo: "liso" });
}
