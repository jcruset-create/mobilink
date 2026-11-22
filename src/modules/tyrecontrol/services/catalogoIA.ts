/**
 * Búsqueda de modelos de neumático con IA: todo lo que DECIDE.
 *
 * Aquí no hay red, ni base de datos, ni modelo de lenguaje: solo las reglas
 * que convierten una frase y una respuesta ajena en algo que se puede ofrecer
 * para crear en el catálogo. Vive en src/ y lo importa también el servidor,
 * igual que el lector del CheckPoint, porque es conocimiento del problema y no
 * de la pantalla.
 *
 * ── La regla que gobierna este fichero ──────────────────────────────────────
 *
 * Un modelo de lenguaje con acceso a Internet puede equivocarse de dos formas
 * distintas, y solo una es tolerable. Puede no encontrar un neumático que
 * existe —se arregla buscando mejor— o puede devolver uno que no existe, con
 * su índice de carga y su marcaje 3PMSF, perfectamente verosímil. Lo segundo
 * mete basura en el catálogo de una empresa que luego compra por él.
 *
 * Por eso aquí nada se da por bueno por venir de la IA:
 *
 *  · La MEDIDA no la interpreta el modelo. Se saca de la frase con una
 *    expresión regular y se compara con la de cada candidato; el que no
 *    coincida no se ofrece, por mucho que el modelo insista.
 *  · El FABRICANTE tiene que aparecer literalmente en lo que escribió la
 *    persona. Así el modelo no puede cambiar de marca por el camino.
 *  · Sin FUENTE no hay candidato verificado. Una ficha sin URL que abrir es
 *    una afirmación sin respaldo, y se marca como tal.
 *
 * Lo que sale de aquí no crea nada: lo ofrece. Crear sigue siendo un gesto
 * humano, con su confirmación, y usa el servicio de catálogo de siempre.
 */

import { baseMedida } from "./medidas";

// ── Normalización, la misma que usa el catálogo ─────────────────────────────

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Texto comparable: sin acentos, sin dobles espacios, en minúsculas. */
export const normTexto = (s?: string | null): string =>
  sinAcentos(String(s ?? "")).trim().toLowerCase().replace(/\s+/g, " ");

/** Medida comparable: en mayúsculas y sin espacios. `295/80 R22.5` → `295/80R22.5`. */
export const normMedida = (s?: string | null): string =>
  String(s ?? "").toUpperCase().replace(/\s+/g, "").replace(",", ".");

/**
 * Nombre de modelo comparable.
 *
 * «WINMILE X3-R», «Winmile X3 R» y «winmile-x3r» son el mismo neumático
 * escrito por tres personas distintas. Se comparan sin separadores para que
 * una diferencia de escritura no acabe siendo una ficha duplicada.
 */
export const normModelo = (s?: string | null): string =>
  normTexto(s).replace(/[^a-z0-9]/g, "");

// ── La consulta ─────────────────────────────────────────────────────────────

export interface ConsultaCatalogo {
  /** Lo que escribió la persona, tal cual. */
  texto: string;
  /** Marca pedida, tal como la escribió. `null` si no se reconoce ninguna. */
  fabricante: string | null;
  /** Medida normalizada: `295/80R22.5`. `null` si la frase no trae ninguna. */
  medida: string | null;
  /** Modelo concreto que se busca («AH31»), si se sabe. Opcional. */
  modelo?: string | null;
}

const PATRON_MEDIDA = /(\d{2,3}\s*\/\s*\d{2,3}\s*R\s*\d{2}(?:[.,]\d)?|\d{1,2}(?:[.,]\d{1,2})?\s*R\s*\d{2}(?:[.,]\d)?)/i;

/** La medida de una frase, ya normalizada. Null si no hay ninguna. */
export function medidaDeTexto(texto: string): string | null {
  const m = String(texto ?? "").match(PATRON_MEDIDA);
  return m ? normMedida(m[1]) : null;
}

/**
 * Palabras que no son una marca.
 *
 * La lista es corta a propósito: solo lo que de verdad aparece al pedir esto
 * en voz alta. Lo que no esté aquí y no sea la medida se toma por marca, que
 * es el comportamiento útil —el catálogo tiene que poder recibir una marca
 * que todavía no conoce; si no, no haría falta buscarla—.
 */
const PALABRAS_VACIAS = new Set([
  "busca", "buscar", "buscame", "encuentra", "dame", "quiero", "necesito",
  "modelos", "modelo", "neumaticos", "neumatico", "gomas", "goma", "ruedas", "rueda",
  "de", "del", "la", "las", "el", "los", "en", "para", "con", "y", "o", "a",
  "medida", "tamano", "tamaño", "marca", "fabricante", "catalogo", "catalogo",
  "disponibles", "disponible", "todos", "todas", "por", "favor", "que", "hay",
]);

/**
 * Interpreta la frase: qué marca y qué medida.
 *
 * Determinista y sin IA, a propósito. Es barato, es instantáneo y, sobre todo,
 * es lo que permite después comprobar que el modelo no se ha ido a otra marca
 * ni a otra medida: si esto lo decidiera también el modelo, no habría nada
 * contra lo que contrastar.
 */
export function interpretarConsulta(texto: string): ConsultaCatalogo {
  const t = String(texto ?? "");
  const medida = medidaDeTexto(t);

  // Se quita la medida y se mira qué palabras quedan que no sean de relleno.
  const resto = (medida ? t.replace(PATRON_MEDIDA, " ") : t)
    .split(/[\s,;:.]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !PALABRAS_VACIAS.has(normTexto(p)))
    // Un número suelto no es una marca: es media medida mal escrita.
    .filter((p) => !/^[\d.,/]+$/.test(p));

  return { texto: t, medida, fabricante: resto.length ? resto.join(" ") : null };
}

/**
 * La consulta cuando la marca y la medida se eligen en sendos desplegables.
 *
 * Es el camino normal de la pantalla, y es mejor que escribir la frase:
 * cuando se elige de una lista NO hay nada que interpretar, así que no hay
 * nada que interpretar mal. Una marca de dos palabras —«Double Coin»— o una
 * medida tecleada a mano entran enteras, sin pasar por el filtro de palabras
 * de relleno.
 *
 * La medida sí se valida: se acepta tecleada, pero tiene que parecerse a una
 * medida. `null` cuando no lo es, y entonces no se busca.
 */
export function consultaDe(marca: string, medida: string, modelo?: string | null): ConsultaCatalogo {
  const m = String(marca ?? "").trim().replace(/\s+/g, " ");
  const med = medidaDeTexto(String(medida ?? ""));
  const mod = String(modelo ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  return {
    // El texto se compone para que quede en el registro y para que
    // `marcaPedida` siga teniendo dónde buscar la marca.
    texto: mod
      ? `Busca el modelo ${mod} de neumáticos ${m} en ${med ?? medida}`
      : `Busca modelos de neumáticos ${m} en ${med ?? medida}`,
    fabricante: m || null,
    medida: med,
    modelo: mod || null,
  };
}

/**
 * ¿Dijo la persona esta marca?
 *
 * El modelo devuelve el fabricante de cada ficha, y esto comprueba que es el
 * que se le pidió. Sin esta comprobación, una búsqueda de CEAT que acabara
 * trayendo Bridgestone entraría al catálogo sin que nadie lo notara: las
 * fichas son verosímiles y nadie relee la marca de una tabla de veinte filas.
 */
export function marcaPedida(consulta: ConsultaCatalogo, marca?: string | null): boolean {
  const m = normTexto(marca);
  if (!m) return false;
  const enConsulta = normTexto(consulta.fabricante ?? "");
  if (enConsulta && (enConsulta === m || enConsulta.includes(m) || m.includes(enConsulta))) return true;
  // Respaldo: que aparezca literal en la frase entera.
  return normTexto(consulta.texto).includes(m);
}

// ── Los candidatos ──────────────────────────────────────────────────────────

/** Una fuente citada por la búsqueda. */
export interface FuenteCandidato {
  url: string;
  titulo?: string | null;
}

/** Un modelo propuesto por la búsqueda, tal como llega. */
export interface CandidatoCrudo {
  fabricante?: string | null;
  modelo?: string | null;
  medida?: string | null;
  indiceCargaSimple?: string | null;
  indiceCargaDoble?: string | null;
  codigoVelocidad?: string | null;
  ply?: string | null;
  tipoVehiculo?: string | null;
  posicion?: string | null;
  utilizacion?: string | null;
  ms?: boolean | null;
  tresPmsf?: boolean | null;
  eficienciaEnergetica?: string | null;
  adherenciaMojado?: string | null;
  ruidoDb?: number | null;
  ean?: string | null;
  imagenUrl?: string | null;
  fichaUrl?: string | null;
  fuentes?: FuenteCandidato[] | null;
}

export type EstadoCandidato = "nuevo" | "existente" | "revisar" | "no_verificado";

export interface Candidato extends CandidatoCrudo {
  fabricante: string;
  modelo: string;
  medida: string;
  fuentes: FuenteCandidato[];
  estado: EstadoCandidato;
  /** Por qué está en ese estado. Siempre hay un motivo que enseñar. */
  motivo: string;
  /** Referencias del catálogo que se le parecen. */
  parecidos: ReferenciaExistente[];
  /** Qué falta para poder crearlo. Vacío = se puede crear. */
  faltan: string[];
}

/** Lo que hace falta saber del catálogo para no duplicar. */
export interface ReferenciaExistente {
  id: string;
  marca: string;
  modelo: string;
  medida: string;
  referenciaCompleta?: string | null;
}

const URL_VALIDA = /^https?:\/\/[^\s]+$/i;
const IC_VALIDO = /^\d{2,3}$/;
const VEL_VALIDO = /^[A-Z]$/;

/** Las fuentes utilizables: una URL que se pueda abrir, sin repetir. */
export function fuentesUtiles(fuentes?: FuenteCandidato[] | null): FuenteCandidato[] {
  const vistas = new Set<string>();
  const out: FuenteCandidato[] = [];
  for (const f of fuentes ?? []) {
    const url = String(f?.url ?? "").trim();
    if (!URL_VALIDA.test(url) || vistas.has(url)) continue;
    vistas.add(url);
    out.push({ url, titulo: f?.titulo ?? null });
  }
  return out;
}

/**
 * Pone los índices en su sitio cuando la IA los copia tal cual del catálogo.
 *
 * Los catálogos los escriben juntos («156/150 L», a veces con un segundo
 * marcado: «156/150 L (154/150 M)») y la IA a menudo los mete enteros en el
 * índice simple. Se separan: simple 156, doble 150, velocidad L. El marcado
 * entre paréntesis se ignora. Solo rellena lo que venga vacío o mal formado.
 */
export function normalizarIndices<T extends CandidatoCrudo>(c: T): T {
  const leer = (t: unknown) => {
    const m = String(t ?? "").toUpperCase().replace(/\(.*?\)/g, " ").trim()
      .match(/^(\d{2,3})(?:\s*\/\s*(\d{2,3}))?\s*([A-Z])?\b/);
    return m ? { simple: m[1], doble: m[2] ?? null, vel: m[3] ?? null } : null;
  };
  const simple = String(c.indiceCargaSimple ?? "").trim();
  const doble = String(c.indiceCargaDoble ?? "").trim();
  const vel = String(c.codigoVelocidad ?? "").trim().toUpperCase();
  const out = { ...c };
  const s = IC_VALIDO.test(simple) ? null : leer(simple);
  if (s) {
    out.indiceCargaSimple = s.simple;
    if (!IC_VALIDO.test(doble) && s.doble) out.indiceCargaDoble = s.doble;
    if (!VEL_VALIDO.test(vel) && s.vel) out.codigoVelocidad = s.vel;
  }
  const d = doble && !IC_VALIDO.test(doble) ? leer(doble) : null;
  if (d) {
    out.indiceCargaDoble = d.simple;
    if (!VEL_VALIDO.test(String(out.codigoVelocidad ?? "")) && d.vel) out.codigoVelocidad = d.vel;
  }
  const v = String(out.codigoVelocidad ?? "").toUpperCase().replace(/\(.*?\)/g, " ").trim();
  if (v && VEL_VALIDO.test(v)) out.codigoVelocidad = v;
  else if (v) {
    const letra = v.match(/\b([A-Z])\b/);
    if (letra) out.codigoVelocidad = letra[1];
  }
  return out;
}

/**
 * Qué le falta a un candidato para poder crearse.
 *
 * El catálogo exige marca, modelo, medida e índice de carga; el código de
 * velocidad es opcional (la columna admite null) y por eso no bloquea, pero se
 * dice que falta para que se vea el hueco antes de guardar.
 */
export function faltanDatos(c: CandidatoCrudo): string[] {
  const faltan: string[] = [];
  if (!String(c.fabricante ?? "").trim()) faltan.push("fabricante");
  if (!String(c.modelo ?? "").trim()) faltan.push("modelo");
  if (!medidaDeTexto(String(c.medida ?? ""))) faltan.push("medida");
  const ic = String(c.indiceCargaSimple ?? "").trim();
  if (!IC_VALIDO.test(ic)) faltan.push("índice de carga");
  return faltan;
}

/** Avisos sobre datos que vienen con una forma que no es la suya. */
export function avisosDeForma(c: CandidatoCrudo): string[] {
  const avisos: string[] = [];
  const doble = String(c.indiceCargaDoble ?? "").trim();
  if (doble && !IC_VALIDO.test(doble)) avisos.push(`índice de carga doble raro: «${doble}»`);
  const vel = String(c.codigoVelocidad ?? "").trim().toUpperCase();
  if (vel && !VEL_VALIDO.test(vel)) avisos.push(`código de velocidad raro: «${vel}»`);
  const ruido = c.ruidoDb;
  if (ruido != null && (ruido < 50 || ruido > 90)) avisos.push(`ruido fuera de rango: ${ruido} dB`);
  return avisos;
}

/**
 * Clasifica un candidato contra el catálogo y contra la consulta.
 *
 * El orden importa y no es casual: primero se comprueba que el candidato ES lo
 * que se pidió (marca, medida, fuente) y solo después si ya lo tenemos. Un
 * candidato de otra marca no es «existente» ni «nuevo»: es un resultado que no
 * vale, y mezclarlo con los demás sería invitar a crearlo.
 */
export function clasificar(
  crudo: CandidatoCrudo,
  consulta: ConsultaCatalogo,
  existentes: ReferenciaExistente[],
): Candidato {
  crudo = normalizarIndices(crudo);
  const fuentes = fuentesUtiles(crudo.fuentes);
  const fabricante = String(crudo.fabricante ?? "").trim();
  const modelo = String(crudo.modelo ?? "").trim();
  const medida = normMedida(crudo.medida ?? "");
  const faltan = faltanDatos(crudo);

  const base = { ...crudo, fabricante, modelo, medida, fuentes, parecidos: [] as ReferenciaExistente[], faltan };

  // ── 1. ¿Es lo que se pidió? ───────────────────────────────────────────────
  if (!modelo) {
    return { ...base, estado: "no_verificado", motivo: "La búsqueda no ha devuelto el nombre del modelo." };
  }
  if (!marcaPedida(consulta, fabricante)) {
    return {
      ...base, estado: "no_verificado",
      motivo: `«${fabricante || "sin marca"}» no es la marca que has pedido${consulta.fabricante ? ` (${consulta.fabricante})` : ""}.`,
    };
  }
  // La «C» de comercial no hace otra medida (205/75 R16 C = 205/75R16).
  if (consulta.medida && baseMedida(medida) !== baseMedida(consulta.medida)) {
    return {
      ...base, estado: "no_verificado",
      motivo: `La ficha es de ${medida || "una medida que no dice"}, no de ${consulta.medida}.`,
    };
  }
  if (!fuentes.length) {
    return { ...base, estado: "no_verificado", motivo: "Sin ninguna fuente que abrir: no hay con qué comprobarlo." };
  }

  // ── 2. ¿Ya lo tenemos? ────────────────────────────────────────────────────
  const mismaMarca = existentes.filter((e) => normTexto(e.marca) === normTexto(fabricante));
  const mismoModelo = mismaMarca.filter((e) => normModelo(e.modelo) === normModelo(modelo));
  const exacto = mismoModelo.find((e) => normMedida(e.medida) === medida);
  if (exacto) {
    return { ...base, estado: "existente", motivo: "Ya está en el catálogo.", parecidos: [exacto] };
  }
  if (mismoModelo.length) {
    return {
      ...base, estado: "revisar", parecidos: mismoModelo,
      motivo: `El modelo ya está en el catálogo en otra medida (${mismoModelo.map((e) => e.medida).join(", ")}).`,
    };
  }

  // Parecidos de verdad: el mismo nombre escrito de otra forma ya lo habría
  // cazado normModelo, así que aquí se buscan los que contienen al otro.
  const parecidos = mismaMarca.filter((e) => {
    const a = normModelo(e.modelo); const b = normModelo(modelo);
    return a && b && (a.includes(b) || b.includes(a));
  });

  // ── 3. ¿Se puede crear? ───────────────────────────────────────────────────
  if (faltan.length) {
    return {
      ...base, estado: "revisar", parecidos,
      motivo: `Falta ${faltan.join(", ")}: complétalo antes de crearlo.`,
    };
  }
  if (parecidos.length) {
    return {
      ...base, estado: "revisar", parecidos,
      motivo: `Se parece a ${parecidos.map((e) => e.modelo).join(", ")}: comprueba que no es el mismo.`,
    };
  }

  const avisos = avisosDeForma(crudo);
  return {
    ...base, estado: "nuevo", parecidos,
    motivo: avisos.length ? avisos.join(". ") : "Verificado y sin duplicados: se puede crear.",
  };
}

/**
 * Clasifica la lista entera y quita los repetidos de la propia búsqueda.
 *
 * Un mismo modelo puede llegar dos veces desde dos páginas distintas. Se queda
 * el primero y se le suman las fuentes del segundo: dos fuentes para la misma
 * ficha es mejor respaldo, no una fila más.
 */
export function clasificarTodos(
  crudos: CandidatoCrudo[],
  consulta: ConsultaCatalogo,
  existentes: ReferenciaExistente[],
): Candidato[] {
  const porClave = new Map<string, Candidato>();
  const sueltos: Candidato[] = [];

  for (const crudo of crudos ?? []) {
    const c = clasificar(crudo, consulta, existentes);
    const clave = `${normTexto(c.fabricante)}|${normModelo(c.modelo)}|${c.medida}`;
    if (!c.modelo) { sueltos.push(c); continue; }
    const ya = porClave.get(clave);
    if (!ya) { porClave.set(clave, c); continue; }
    const urls = new Set(ya.fuentes.map((f) => f.url));
    for (const f of c.fuentes) if (!urls.has(f.url)) ya.fuentes.push(f);
  }
  return [...porClave.values(), ...sueltos];
}

// ── Lo que el catálogo acepta ───────────────────────────────────────────────

/**
 * La posición, traducida a los cuatro valores que admite el catálogo.
 *
 * `tc_cat_modelos_neumatico.eje_recomendado` tiene lista cerrada
 * —direccion, traccion, remolque, mixto— y el alta falla con un error de
 * restricción si llega cualquier otra cosa. La IA, leyendo fichas reales,
 * devuelve «multiposición», «all-position», «steer» o «dirección» con tilde,
 * según la página. Traducir aquí es la diferencia entre guardar la ficha y
 * que el alta reviente con un mensaje que no se parece a su causa.
 *
 * Lo que no encaja en ninguno de los cuatro se devuelve null: el modelo se
 * crea sin eje, que es un hueco que alguien puede rellenar, en vez de con uno
 * inventado por parecido.
 */
export function ejeDelCandidato(posicion?: string | null): "direccion" | "traccion" | "remolque" | "mixto" | null {
  const p = normTexto(posicion);
  if (!p) return null;
  if (/(multi|mixt|all.?position|all.?round)/.test(p)) return "mixto";
  if (/(direcc|steer|front|delant)/.test(p)) return "direccion";
  if (/(tracc|drive|motriz|trasera)/.test(p)) return "traccion";
  if (/(remolqu|trailer|semirremolqu|arrastr)/.test(p)) return "remolque";
  return null;
}

/** Los que se pueden crear sin tocar nada: lo que se marca solo en la tabla. */
export const creables = (cs: Candidato[]): Candidato[] => cs.filter((c) => c.estado === "nuevo");
