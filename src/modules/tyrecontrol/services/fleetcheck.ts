/**
 * El «Fleetcheck Report» de TIRETASK: una revisión de flota hecha por un
 * tercero, en PDF.
 *
 * Aquí solo se LEE: de las líneas del PDF a vehículos con sus ruedas, y de ahí
 * a las filas que entiende `importRevisiones`. Es código puro, sin navegador
 * ni base de datos, para poder probarlo; el PDF lo abre el servidor
 * (`server/tyrecontrol/fleetcheck.ts`) porque `mupdf` no corre en el panel.
 *
 * ── Qué trae el informe ──────────────────────────────────────────────────────
 *
 * Tras unas páginas de resumen, la «VISTA DETALLADA»: por cada vehículo, su
 * matrícula, «Kilometraje: N» (o «/» si no se apuntó) y una tabla con una fila
 * por rueda:
 *
 *   Pos. · Serie/DOT · Neumáticos · Perfil 1 · Perfil 2 · Perfil 3 · Rayar ·
 *   Condición · Barra antes · Bar después · Comentario
 *
 * ── Las trampas ─────────────────────────────────────────────────────────────
 *
 *  1. Las celdas son líneas sueltas del PDF, no una tabla: lo único que dice
 *     a qué columna pertenece un «8,5» es su X. Se lee la X de la cabecera de
 *     cada tabla y cada valor se asigna a la columna más cercana por la
 *     izquierda. No se cuenta «el cuarto número de la fila»: una celda vacía
 *     correría todas las demás.
 *  2. El neumático ocupa dos líneas («Hankook 295/80 R22.5 Smart» / «Flex AH51
 *     3PMSF 154M»); la segunda no trae posición y es de la rueda de arriba.
 *  3. La posición es «eje-lado+dentro/fuera»: «2-DI» es eje 2, derecha,
 *     interior. En un eje de rueda sencilla el informe escribe igualmente «E»
 *     (1-IE, 1-DE): si el eje no tiene ninguna interior, es sencillo.
 *  4. La fecha es una sola, la del informe. No hay hora ni fecha por vehículo.
 */

/** Una línea de texto del PDF con su sitio en la página. */
export interface LineaFleetcheck {
  pagina: number;
  x: number;
  y: number;
  texto: string;
}

export interface RuedaFleetcheck {
  /** Tal cual viene: «2-DI». */
  posicion: string;
  eje: number;
  lado: "izq" | "der";
  /** Lo que escribe el informe; en un eje sencillo siempre «ext». */
  dentroFuera: "int" | "ext";
  neumatico: string;
  serie: string | null;
  /** Las lecturas de profundidad que traiga, en mm. */
  perfiles: number[];
  presionAntes: number | null;
  presionDespues: number | null;
  comentario: string | null;
}

export interface VehiculoFleetcheck {
  matricula: string;
  km: number | null;
  ruedas: RuedaFleetcheck[];
}

export interface LecturaFleetcheck {
  /** Fecha del informe, `yyyy-MM-dd`, si se ha podido leer. */
  fecha: string | null;
  vehiculos: VehiculoFleetcheck[];
  avisos: string[];
}

const POSICION = /^(\d)-([ID])([EI])$/;
const MATRICULA = /^[0-9A-Z][0-9A-Z-]{3,11}$/;

/** «8,5» → 8.5; «-», «/» o vacío → null. */
function numero(t: string | undefined): number | null {
  const s = String(t ?? "").trim().replace(",", ".");
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

type Columna = "pos" | "serie" | "neumatico" | "perfil1" | "perfil2" | "perfil3"
  | "rayar" | "condicion" | "antes" | "despues" | "comentario";

/** Dónde empieza cada columna si una tabla no trae cabecera legible. */
const X_POR_DEFECTO: Array<[Columna, number]> = [
  ["pos", 45], ["serie", 68], ["neumatico", 130], ["perfil1", 229], ["perfil2", 257],
  ["perfil3", 286], ["rayar", 314], ["condicion", 342], ["antes", 425], ["despues", 456],
  ["comentario", 487],
];

/** Las X de la cabecera de una tabla, leídas de sus propias líneas. */
function columnasDe(cabecera: LineaFleetcheck[]): Array<[Columna, number]> {
  const perfiles = cabecera.filter((l) => l.texto === "Perfil").map((l) => l.x).sort((a, b) => a - b);
  const x = (t: string) => cabecera.find((l) => l.texto === t)?.x;
  const leidas: Array<[Columna, number | undefined]> = [
    ["pos", x("Pos.")], ["serie", x("Número de")], ["neumatico", x("Neumáticos")],
    ["perfil1", perfiles[0]], ["perfil2", perfiles[1]], ["perfil3", perfiles[2]],
    ["rayar", x("Rayar")], ["condicion", x("Condición")], ["antes", x("Barra")],
    ["despues", x("Bar de")], ["comentario", x("Comentario")],
  ];
  // Si falta alguna, no se mezclan dos orígenes: se usan las de por defecto.
  if (leidas.some(([, v]) => v == null)) return X_POR_DEFECTO;
  return leidas as Array<[Columna, number]>;
}

/** La columna de una X: la última cabecera que queda a su izquierda. */
function columnaDe(x: number, columnas: Array<[Columna, number]>): Columna {
  // Los números van centrados y empiezan un par de puntos a la derecha de su
  // cabecera; el margen cubre también uno que empiece un poco antes.
  let elegida: Columna = columnas[0][0];
  for (const [nombre, cx] of columnas) {
    if (x + 3 >= cx) elegida = nombre;
  }
  return elegida;
}

export function leerFleetcheck(lineas: LineaFleetcheck[]): LecturaFleetcheck {
  const avisos: string[] = [];

  // La fecha: la que queda justo debajo del rótulo «Fecha» de la portada. En
  // el PDF no van seguidas —el orden de las líneas no es el de lectura—, así
  // que se busca por sitio y no por vecindad.
  let fecha: string | null = null;
  const rotulo = lineas.find((l) => l.texto === "Fecha");
  if (rotulo) {
    const m = lineas
      .filter((l) => l.pagina === rotulo.pagina && l.y > rotulo.y && l.y - rotulo.y < 40)
      .map((l) => /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(l.texto)).find(Boolean);
    if (m) fecha = `${m[3]}-${m[2]}-${m[1]}`;
  }
  if (!fecha) avisos.push("No se ha podido leer la fecha del informe: hay que ponerla a mano.");

  const inicio = lineas.findIndex((l) => l.texto === "VISTA DETALLADA");
  if (inicio < 0) {
    return { fecha, vehiculos: [], avisos: [...avisos, "Este PDF no trae la «VISTA DETALLADA»: no es un Fleetcheck Report o está incompleto."] };
  }

  // Página a página y de arriba abajo: una tabla puede seguir en la siguiente.
  const detalle = lineas.slice(inicio)
    .filter((l) => l.texto !== "VISTA DETALLADA" && !/^Creado con /.test(l.texto) && l.y < 800)
    .sort((a, b) => a.pagina - b.pagina || a.y - b.y || a.x - b.x);

  const vehiculos: VehiculoFleetcheck[] = [];
  let veh: VehiculoFleetcheck | null = null;
  let columnas = X_POR_DEFECTO;
  let rueda: (RuedaFleetcheck & { _y: number; _pagina: number }) | null = null;
  let cabecera: LineaFleetcheck[] = [];
  let enCabecera = false;

  for (let i = 0; i < detalle.length; i += 1) {
    const l = detalle[i];

    // Vehículo nuevo: una matrícula seguida de su «Kilometraje:».
    const sig = detalle[i + 1];
    if (MATRICULA.test(l.texto) && sig && /^Kilometraje:/.test(sig.texto) && sig.pagina === l.pagina) {
      const km = numero(sig.texto.split(":")[1]);
      veh = { matricula: l.texto.toUpperCase(), km: km != null && km > 0 ? km : null, ruedas: [] };
      vehiculos.push(veh);
      rueda = null; cabecera = []; enCabecera = true;
      i += 1;
      continue;
    }
    if (!veh) continue;

    const pos = POSICION.exec(l.texto);
    if (pos) {
      if (enCabecera) { columnas = columnasDe(cabecera); enCabecera = false; }
      rueda = {
        posicion: l.texto, eje: Number(pos[1]),
        lado: pos[2] === "I" ? "izq" : "der",
        dentroFuera: pos[3] === "I" ? "int" : "ext",
        neumatico: "", serie: null, perfiles: [], presionAntes: null, presionDespues: null,
        comentario: null, _y: l.y, _pagina: l.pagina,
      };
      veh.ruedas.push(rueda);
      continue;
    }
    if (enCabecera) { cabecera.push(l); continue; }
    // La cabecera se repite cuando la tabla salta de página.
    if (["Pos.", "Número de", "serie / DOT", "Neumáticos", "Perfil", "Rayar", "Condición", "Barra", "antes", "Bar de", "spués.", "Comentario"].includes(l.texto)
      || (/^[123]$/.test(l.texto) && (!rueda || l.pagina !== rueda._pagina || l.y < rueda._y))) {
      continue;
    }
    if (!rueda || l.pagina !== rueda._pagina || l.y - rueda._y > 16) continue;

    switch (columnaDe(l.x, columnas)) {
      case "neumatico": rueda.neumatico = `${rueda.neumatico} ${l.texto}`.trim(); break;
      case "serie": rueda.serie = `${rueda.serie ?? ""} ${l.texto}`.trim(); break;
      case "perfil1": case "perfil2": case "perfil3": {
        const n = numero(l.texto);
        if (n != null) rueda.perfiles.push(n);
        break;
      }
      case "antes": rueda.presionAntes = numero(l.texto); break;
      case "despues": rueda.presionDespues = numero(l.texto); break;
      case "comentario": rueda.comentario = `${rueda.comentario ?? ""} ${l.texto}`.trim(); break;
      default: break;
    }
  }

  for (const v of vehiculos) {
    for (const r of v.ruedas) {
      delete (r as Partial<typeof rueda & object>)._y;
      delete (r as Partial<typeof rueda & object>)._pagina;
    }
    if (v.ruedas.length === 0) avisos.push(`${v.matricula}: viene en el informe sin ninguna rueda.`);
  }
  const repetidas = vehiculos.map((v) => v.matricula).filter((mat, i, t) => t.indexOf(mat) !== i);
  if (repetidas.length) avisos.push(`Matrículas repetidas en el informe: ${[...new Set(repetidas)].join(", ")}.`);

  return { fecha, vehiculos, avisos };
}

/** La medida que va dentro del texto del neumático: «295/80 R22.5». */
export function medidaDeNeumatico(texto: string): string | null {
  const m = /(\d{3}\/\d{2})\s*R\s*(\d{2}(?:[.,]\d)?)/i.exec(texto);
  return m ? `${m[1]} R${m[2].replace(",", ".")}` : null;
}

/** Una fila de las que entiende `importRevisiones`. */
export interface FilaFleetcheck {
  matricula: string;
  fecha_revision: string;
  codigo_posicion: string;
  _eje: number;
  _lado: "izq" | "der";
  _io: "int" | "ext" | null;
  profundidad_mm: number | null;
  presion_bar: number | null;
  medida: string | null;
  marca_neumatico: string | null;
  observaciones: string | null;
}

/**
 * Del informe a filas de revisión.
 *
 * - Profundidad: la MENOR de las lecturas de la rueda. Es la que manda para
 *   decidir un cambio, y con dos lecturas que difieren varios milímetros
 *   quedarse con la alta escondería un desgaste irregular.
 * - Presión: la de después si la hay (cómo quedó la rueda); si no, la de
 *   antes.
 * - La hora no viene y no se inventa: la revisión lleva su día y nada más.
 *   El relleno de kilometraje ya sabe qué hacer con eso (pide el odómetro al
 *   empezar el día, que es la cota prudente).
 */
export function filasDeFleetcheck(lectura: LecturaFleetcheck, fecha: string): FilaFleetcheck[] {
  const filas: FilaFleetcheck[] = [];
  for (const v of lectura.vehiculos) {
    const ejesDobles = new Set(v.ruedas.filter((r) => r.dentroFuera === "int").map((r) => r.eje));
    for (const r of v.ruedas) {
      const doble = ejesDobles.has(r.eje);
      const lado = r.lado.toUpperCase();
      const comentario = [
        r.perfiles.length > 1 ? `Lecturas: ${r.perfiles.map((p) => p.toFixed(1).replace(".", ",")).join(" / ")} mm` : null,
        r.comentario,
      ].filter(Boolean).join(" · ");
      filas.push({
        matricula: v.matricula,
        fecha_revision: fecha,
        codigo_posicion: doble ? `E${r.eje}_${lado}_${r.dentroFuera === "int" ? "INT" : "EXT"}` : `E${r.eje}_${lado}`,
        _eje: r.eje, _lado: r.lado, _io: doble ? r.dentroFuera : null,
        profundidad_mm: r.perfiles.length ? Math.min(...r.perfiles) : null,
        presion_bar: r.presionDespues ?? r.presionAntes,
        medida: medidaDeNeumatico(r.neumatico),
        marca_neumatico: r.neumatico.split(/\s+/)[0] || null,
        observaciones: comentario || null,
      });
    }
  }
  return filas;
}

/** Lo que dice el texto de un neumático, troceado. */
export interface PartesNeumatico {
  marca: string;
  modelo: string;
  medida: string;
  /** Índice de carga en simple («154»); null si el informe no lo trae. */
  carga: string | null;
  /** Índice en gemelo, cuando viene como «154/150». */
  cargaDoble: string | null;
  /** Código de velocidad («M»). */
  velocidad: string | null;
}

/**
 * «Hankook 295/80 R22.5 Smart Flex AH51 3PMSF 154M» → marca, medida, modelo e
 * índices.
 *
 * El «3PMSF» es el marcaje de invierno, no parte del modelo: se quita para
 * que «Smart Flex AH51 3PMSF» case con el «Smart Flex AH51» del catálogo y no
 * abra un modelo nuevo. Si no hay medida reconocible, null: sin ella no se
 * puede identificar el neumático.
 */
export function partesDeNeumatico(texto: string): PartesNeumatico | null {
  const t = String(texto ?? "").replace(/\s+/g, " ").trim();
  const m = /^(.*?)\s*(\d{3}\/\d{2})\s*R\s*(\d{2}(?:[.,]\d)?)\s*(.*)$/i.exec(t);
  if (!m || !m[1]) return null;
  let resto = m[4].trim();
  let carga: string | null = null; let cargaDoble: string | null = null; let velocidad: string | null = null;
  const idx = /(?:^|\s)(\d{2,3})(?:\/(\d{2,3}))?([A-Z])$/.exec(resto);
  if (idx) {
    carga = idx[1]; cargaDoble = idx[2] ?? null; velocidad = idx[3];
    resto = resto.slice(0, idx.index).trim();
  }
  const modelo = resto.replace(/\s*\b3PMSF\b/gi, "").replace(/\s+/g, " ").trim();
  return {
    marca: m[1].trim(),
    modelo,
    medida: `${m[2]} R${m[3].replace(",", ".")}`,
    carga, cargaDoble, velocidad,
  };
}

/** Las ruedas por eje de un vehículo, como las nombra el catálogo: «2x4x2». */
export function firmaDeEjes(ruedas: Pick<RuedaFleetcheck, "eje">[]): string {
  const porEje = new Map<number, number>();
  for (const r of ruedas) porEje.set(r.eje, (porEje.get(r.eje) ?? 0) + 1);
  return [...porEje].sort((a, b) => a[0] - b[0]).map(([, n]) => n).join("x");
}

/**
 * El tipo de vehículo que corresponde a cada reparto de ruedas en una flota
 * de autobuses. Solo los que no admiten duda: un 2x2 puede ser furgoneta o
 * turismo, y eso no lo decide un informe de neumáticos.
 */
export const TIPO_POR_FIRMA: Record<string, string> = {
  "2x4": "autobus",
  "2x4x2": "autocar",
  "2x4x4": "autocar_2x4x4",
};
