/**
 * Leer la cabecera de las nóminas de un PDF mensual.
 *
 * El PDF que manda la gestoría trae una nómina por página, y cada una empieza
 * con la misma cabecera:
 *
 *   Empresa    COMERCIAL SEA, SA      Trabajador   APELLIDOS, NOMBRE
 *   Centro     551 AGROREUS           Grupo Prof.  G4 PROFESIONAL OFICIO 1ª
 *   Población  43206 REUS             Antigüedad   08/09/2015
 *   C.C.C.     43/0000000/00          N.A.S.S.     43/00000000/00
 *   C.I.F.     A00000000              Código       000002 / 112   N.I.F.  00000000T
 *   Periodo de liquidación   Del 01 al 30 de Noviembre de 2.026   Total días  30
 *
 * De ahí sale todo lo que hace falta para dar de alta a alguien en Core. Aquí
 * solo se lee: es puro, trabaja sobre las líneas de texto que da
 * `therefore/documentos/texto.ts` y se prueba con líneas escritas a mano.
 *
 * ## Lo que NO se lee
 *
 * Nada de lo que hay debajo de la cabecera: conceptos, importes, bases, IBAN.
 * Una nómina lleva el sueldo de una persona; para darla de alta no hace falta
 * y no tiene por qué pasar por ningún sitio más.
 *
 * ## El código de la nómina
 *
 * «000002 / 112»: el primero es el número del trabajador en la gestoría, que
 * es el que no cambia y el que se usa en Core como número de trabajador (sin
 * los ceros de delante). El segundo cambia de una nómina a otra de la misma
 * persona; no se sabe qué es y no se usa.
 *
 * ## Si la gestoría cambia de programa
 *
 * Esto depende de las etiquetas de ESTE formato. Una página que no las trae
 * no se inventa nada: se devuelve como «no reconocida» y la pantalla lo dice.
 */

/** Una nómina, tal como viene en su página. */
export type NominaLeida = {
  pagina: number;
  empresa: string;
  cif: string;
  /** «551 AGROREUS» → codigo «551», nombre «AGROREUS». */
  centroCodigo: string;
  centroNombre: string;
  apellidos: string;
  nombre: string;
  grupo: string;
  /** aaaa-mm-dd, o null si no se entiende. */
  antiguedad: string | null;
  nass: string;
  /** Número del trabajador en la gestoría, sin ceros delante. */
  codigo: string;
  nif: string;
  periodo: string;
  /** «Total días», o null si no viene. */
  dias: number | null;
};

/** Una de las nóminas de una persona: en qué página está y de cuándo es. */
export type NominaDePersona = { pagina: number; periodo: string; dias: number | null };

/** Una persona: puede tener más de una nómina en el mismo PDF. */
export type PersonaDeNomina = Omit<NominaLeida, "pagina" | "periodo" | "dias"> & {
  paginas: number[];
  periodos: string[];
  /** Cada nómina con su página, para poder guardarla suelta en la ficha. */
  nominas: NominaDePersona[];
};

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/**
 * El mes de un periodo: «Del 01 al 30 de Noviembre de 2.026» → 2026, 11.
 * `null` si no se entiende: una nómina sin mes no se puede archivar.
 */
export function mesDePeriodo(periodo: string): { anio: number; mes: number } | null {
  const m = /de\s+(\p{L}+)\s+de\s+(\d[\d.]*)\s*$/u.exec(periodo.trim());
  if (!m) return null;
  const mes = MESES.indexOf(m[1].toLocaleLowerCase("es").replace("setiembre", "septiembre")) + 1;
  const anio = Number(m[2].replace(/\./g, ""));
  if (mes < 1 || !Number.isInteger(anio) || anio < 2000 || anio > 2100) return null;
  return { anio, mes };
}

/** Partículas que van en minúscula dentro de un nombre o un cargo. */
const MINUSCULAS = new Set(["de", "del", "la", "las", "los", "les", "el", "i", "y", "da", "do", "dos", "das"]);

/**
 * «MARIA DE LES NEUS» → «Maria de les Neus». La gestoría lo escribe todo en
 * mayúsculas; en Core los nombres van como se escriben.
 */
export function capitalizar(texto: string): string {
  return texto
    .trim()
    .toLocaleLowerCase("es")
    .split(/\s+/)
    .map((p, i) => {
      if (i > 0 && MINUSCULAS.has(p)) return p;
      // «1ª» y «g4» no son palabras: la letra tras una cifra no se toca.
      return p.replace(/^\p{L}/u, (c) => c.toLocaleUpperCase("es"));
    })
    .join(" ");
}

/** Sin espacios, puntos ni guiones, y en mayúsculas: para comparar NIF y CIF. */
export function normalizarDocumento(valor: unknown): string {
  return String(valor ?? "").replace(/[\s.\-/]/g, "").toUpperCase();
}

function fechaIso(ddmmaaaa: string | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(ddmmaaaa ?? "");
  if (!m) return null;
  const [, d, mes, a] = m;
  const fecha = new Date(Date.UTC(Number(a), Number(mes) - 1, Number(d)));
  // 31/02 «existe» para Date: se comprueba que no se haya ido a otro mes.
  if (fecha.getUTCMonth() !== Number(mes) - 1 || fecha.getUTCDate() !== Number(d)) return null;
  return `${a}-${mes}-${d}`;
}

/** Lee la cabecera de UNA página, o `null` si no es una nómina de este formato. */
export function leerCabecera(lineas: string[], pagina: number): NominaLeida | null {
  let empresa = "", trabajador = "", centro = "", grupo = "", antiguedad: string | null = null;
  let nass = "", cif = "", codigo = "", nif = "", periodo = "";
  let dias: number | null = null;

  for (const cruda of lineas) {
    const l = cruda.replace(/\s+/g, " ").trim();
    let m: RegExpExecArray | null;
    if ((m = /^Empresa (.+?) Trabajador (.+)$/.exec(l))) [, empresa, trabajador] = m;
    else if ((m = /^Centro (.+?) Grupo Prof\.(?: (.*))?$/.exec(l))) { centro = m[1]; grupo = m[2] ?? ""; }
    else if ((m = /Antigüedad (\S+)/.exec(l))) antiguedad = fechaIso(m[1]);
    else if ((m = /N\.A\.S\.S\. (\S+)/.exec(l))) nass = m[1];
    else if ((m = /^C\.I\.F\. (\S+) Código (\d+) ?\/ ?\d+ N\.I\.F\. (\S+)/.exec(l))) [, cif, codigo, nif] = m;
    else if ((m = /^Periodo de liquidación (.+?) Total días(?: (\d+))?/.exec(l))) {
      periodo = m[1];
      dias = m[2] ? Number(m[2]) : null;
    }
    // La cabecera se acaba donde empieza la tabla de conceptos: de ahí para
    // abajo no se mira nada.
    else if (/^Concepto /.test(l)) break;
  }

  // Sin nombre o sin NIF no hay a quién dar de alta: la página no vale.
  const partes = /^(.+?),\s*(.+)$/.exec(trabajador);
  if (!partes || !nif) return null;

  const [, centroCodigo = "", centroNombre = centro] = /^(\d+) (.+)$/.exec(centro) ?? [];
  return {
    pagina,
    empresa: empresa.trim(),
    cif: normalizarDocumento(cif),
    centroCodigo,
    centroNombre: centroNombre.trim(),
    apellidos: capitalizar(partes[1]),
    nombre: capitalizar(partes[2]),
    grupo: capitalizar(grupo),
    antiguedad,
    nass: nass.trim(),
    codigo: codigo.replace(/^0+(?=\d)/, ""),
    nif: normalizarDocumento(nif),
    periodo: periodo.trim(),
    dias,
  };
}

export type LecturaNominas = {
  personas: PersonaDeNomina[];
  /** Páginas que no son una nómina de este formato. */
  paginasNoReconocidas: number[];
  /** Los CIF distintos que aparecen: debería ser uno. */
  empresas: { cif: string; nombre: string }[];
};

/**
 * Lee todas las páginas y junta las nóminas de una misma persona (por NIF):
 * quien causa baja a mitad de mes, o cambia de contrato, sale dos veces.
 */
export function leerNominas(paginas: string[][]): LecturaNominas {
  const porNif = new Map<string, PersonaDeNomina>();
  const paginasNoReconocidas: number[] = [];
  const empresas = new Map<string, string>();

  paginas.forEach((lineas, i) => {
    const n = leerCabecera(lineas, i + 1);
    if (!n) {
      // Una página en blanco al final no es un fallo de lectura.
      if (lineas.some((l) => l.trim() !== "")) paginasNoReconocidas.push(i + 1);
      return;
    }
    if (n.cif || n.empresa) empresas.set(n.cif || n.empresa, n.empresa);
    const { pagina, periodo, dias, ...datos } = n;
    const ya = porNif.get(n.nif);
    if (ya) {
      ya.paginas.push(pagina);
      if (periodo) ya.periodos.push(periodo);
      ya.nominas.push({ pagina, periodo, dias });
    } else {
      porNif.set(n.nif, { ...datos, paginas: [pagina], periodos: periodo ? [periodo] : [], nominas: [{ pagina, periodo, dias }] });
    }
  });

  return {
    personas: [...porNif.values()],
    paginasNoReconocidas,
    empresas: [...empresas].map(([cif, nombre]) => ({ cif, nombre })),
  };
}
