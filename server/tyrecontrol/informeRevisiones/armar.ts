/**
 * El informe de revisiones: de filas de la base a documento.
 *
 * Aquí no se dibuja nada y no se habla con la base. Entran las revisiones y
 * sus mediciones, sale la estructura del PDF. Separado a propósito: lo que
 * decide QUÉ sale en el informe se puede probar, y dibujar un PDF para
 * comprobar un total es una forma carísima de no comprobarlo.
 *
 * ── Tres formatos, y no son tres tamaños del mismo ──────────────────────────
 *
 *   · `resumen`  — los totales del periodo y una línea por revisión. Se lee
 *                  de principio a fin.
 *   · `detalle`  — lo mismo más la tabla de ruedas de cada revisión. Es un
 *                  documento de respaldo: nadie lo lee entero, se busca en él.
 *   · `vehiculo` — una sección por camión con sus revisiones en orden. Sirve
 *                  para repasar uno a uno, que es otra tarea.
 *
 * ── Dos ámbitos, y la diferencia no es cosmética ────────────────────────────
 *
 * El del CLIENTE no lleva nombres de técnico ni códigos internos, y solo
 * incluye revisiones **completadas**: un borrador es trabajo a medias y
 * enseñárselo al cliente como si fuera una revisión hecha es mentir por
 * omisión. El INTERNO los lleva y además incluye los borradores marcados
 * como tales, porque saber cuáles quedaron a medias es justo lo útil.
 */

/** Una medición de una rueda, tal como sale de la base. */
export interface MedicionFila {
  revision_id: string;
  posicion: string | null;
  orden: number | null;
  profundidad_mm: number | null;
  presion_bar: number | null;
  /** El mínimo que aplica a ESA rueda: medida → categoría → empresa → 1,6. */
  minimo_mm: number | null;
  aviso_mm: number | null;
  no_accesible: boolean | null;
  neumatico_ausente: boolean | null;
  marca: string | null;
  medida: string | null;
  codigo_interno: string | null;
}

/** Una revisión, tal como sale de la base. */
export interface RevisionFila {
  id: string;
  fecha: string;                 // ISO yyyy-mm-dd
  matricula: string | null;
  numero_unidad: string | null;
  km_vehiculo: number | null;
  estado: string;                // 'completada' | 'borrador' | …
  tecnico: string | null;
  tipo_revision: string | null;
  observaciones: string | null;
}

export type Formato = "resumen" | "detalle" | "vehiculo";
export type Ambito = "cliente" | "interno";

export interface OpcionesInforme {
  empresa: string;
  desde: string;                 // ISO yyyy-mm-dd, inclusive
  hasta: string;                 // ISO yyyy-mm-dd, inclusive
  formato: Formato;
  ambito: Ambito;
  /**
   * Dejar fuera las revisiones que no tienen ninguna medición guardada.
   *
   * Una revisión sin mediciones ocupa dos líneas en el PDF y no dice nada.
   * Con un periodo largo son páginas enteras de «sin mediciones de
   * neumático guardadas» entre las que sí tienen datos, y el informe deja
   * de poder leerse.
   *
   * No es el valor por defecto: dejar de imprimir revisiones que existen es
   * una decisión de quien pide el informe, no mía. Cuando se activa, se
   * escribe cuántas se han quitado.
   */
  soloConMediciones?: boolean;
  /** La consulta llegó al tope de filas y hay más en el periodo. */
  truncado?: boolean;
}

/** Una rueda ya clasificada para pintarla. */
export interface RuedaDoc {
  posicion: string;
  profundidad: number | null;
  presion: number | null;
  minimo: number | null;
  estado: "ok" | "aviso" | "bajo_minimo" | "sin_medir";
  detalle: string | null;        // marca y medida; vacío en el del cliente
}

export interface RevisionDoc {
  fecha: string;
  matricula: string;
  unidad: string | null;
  km: number | null;
  estado: string;
  /** Solo en el interno. */
  tecnico: string | null;
  ruedas: RuedaDoc[];
  medidas: number;
  bajoMinimo: number;
  enAviso: number;
  observaciones: string | null;
}

export interface Documento {
  titulo: string;
  periodo: { desde: string; hasta: string };
  ambito: Ambito;
  formato: Formato;
  resumen: {
    revisiones: number;
    vehiculos: number;
    mediciones: number;
    bajoMinimo: number;
    enAviso: number;
    sinMedir: number;
    borradores: number;
    /** Revisiones del periodo sin ninguna medición. Se cuentan se filtren o no. */
    sinMediciones: number;
  };
  /** Revisiones por mes, para la tabla de evolución. */
  meses: Array<{ mes: string; revisiones: number; vehiculos: number; bajoMinimo: number }>;
  /** Listado plano, en `resumen` y `detalle`. */
  revisiones: RevisionDoc[];
  /** Agrupado, solo en `vehiculo`. */
  vehiculos: Array<{ matricula: string; unidad: string | null; revisiones: RevisionDoc[]; bajoMinimo: number }>;
  /** Lo que se ha dejado fuera y por qué. Se escribe en el PDF. */
  advertencias: string[];
}

const MINIMO_POR_DEFECTO = 1.6;

/** En qué estado está una rueda según su profundidad y su propio mínimo. */
export function estadoRueda(m: MedicionFila): RuedaDoc["estado"] {
  if (m.no_accesible || m.neumatico_ausente || m.profundidad_mm == null) return "sin_medir";
  const minimo = m.minimo_mm ?? MINIMO_POR_DEFECTO;
  if (m.profundidad_mm <= minimo) return "bajo_minimo";
  // El aviso solo cuenta si está configurado y por encima del mínimo; un
  // aviso por debajo del mínimo no significa nada y no se inventa uno.
  if (m.aviso_mm != null && m.aviso_mm > minimo && m.profundidad_mm <= m.aviso_mm) return "aviso";
  return "ok";
}

/** «2026-03» a partir de una fecha ISO. */
export function mesDe(fechaIso: string): string {
  return (fechaIso ?? "").slice(0, 7);
}

/**
 * Monta el documento.
 *
 * Las mediciones vienen sueltas y se reparten por revisión aquí: así la
 * consulta puede ser una sola y no una por revisión.
 */
export function armarInforme(
  revisiones: RevisionFila[],
  mediciones: MedicionFila[],
  op: OpcionesInforme,
): Documento {
  const advertencias: string[] = [];

  // El cliente no ve borradores. Se dice cuántos se han dejado fuera en vez
  // de que el total no cuadre y nadie sepa por qué.
  const borradores = revisiones.filter((r) => r.estado !== "completada").length;
  let visibles = op.ambito === "cliente"
    ? revisiones.filter((r) => r.estado === "completada")
    : revisiones;
  if (op.ambito === "cliente" && borradores > 0) {
    advertencias.push(
      `Se han excluido ${borradores} revisión(es) sin terminar: solo se incluyen las completadas.`,
    );
  }

  const porRevision = new Map<string, MedicionFila[]>();
  for (const m of mediciones) {
    const l = porRevision.get(m.revision_id);
    if (l) l.push(m); else porRevision.set(m.revision_id, [m]);
  }

  // Las que no tienen ni una medición. Se cuentan SIEMPRE, se quiten o no:
  // el número es útil por sí mismo —dice cuánto trabajo quedó sin anotar— y
  // sale en el resumen aunque no se filtre.
  const sinMediciones = visibles.filter((r) => (porRevision.get(r.id) ?? []).length === 0).length;
  if (op.soloConMediciones && sinMediciones > 0) {
    visibles = visibles.filter((r) => (porRevision.get(r.id) ?? []).length > 0);
    advertencias.push(
      `Se han dejado fuera ${sinMediciones} revisión(es) sin ninguna medición de neumático guardada.`,
    );
  }

  if (op.truncado) {
    advertencias.push(
      "El periodo tiene más revisiones de las que cabe en un informe: se han incluido las primeras. "
      + "Acota las fechas para verlas todas.",
    );
  }

  const docs: RevisionDoc[] = visibles
    .slice()
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : (a.matricula ?? "").localeCompare(b.matricula ?? "", "es")))
    .map((r) => {
      const ruedas = (porRevision.get(r.id) ?? [])
        .slice()
        .sort((a, b) => (a.orden ?? 9999) - (b.orden ?? 9999) || (a.posicion ?? "").localeCompare(b.posicion ?? "", "es"))
        .map<RuedaDoc>((m) => ({
          posicion: m.posicion ?? "—",
          profundidad: m.profundidad_mm,
          presion: m.presion_bar,
          minimo: m.minimo_mm ?? MINIMO_POR_DEFECTO,
          estado: estadoRueda(m),
          // El código interno es nuestro, no del cliente.
          detalle: op.ambito === "interno"
            ? [m.codigo_interno, m.marca, m.medida].filter(Boolean).join(" · ") || null
            : [m.marca, m.medida].filter(Boolean).join(" · ") || null,
        }));
      return {
        fecha: r.fecha,
        matricula: r.matricula ?? "—",
        unidad: r.numero_unidad ?? null,
        km: r.km_vehiculo,
        estado: r.estado,
        tecnico: op.ambito === "interno" ? r.tecnico : null,
        ruedas,
        medidas: ruedas.filter((x) => x.estado !== "sin_medir").length,
        bajoMinimo: ruedas.filter((x) => x.estado === "bajo_minimo").length,
        enAviso: ruedas.filter((x) => x.estado === "aviso").length,
        observaciones: r.observaciones?.trim() || null,
      };
    });

  // Los meses salen de las revisiones visibles: si el cliente no ve los
  // borradores, tampoco los cuenta su gráfico.
  const meses = new Map<string, { revisiones: number; vehiculos: Set<string>; bajoMinimo: number }>();
  for (const d of docs) {
    const k = mesDe(d.fecha);
    const m = meses.get(k) ?? { revisiones: 0, vehiculos: new Set<string>(), bajoMinimo: 0 };
    m.revisiones += 1;
    m.vehiculos.add(d.matricula);
    m.bajoMinimo += d.bajoMinimo;
    meses.set(k, m);
  }

  const porVehiculo = new Map<string, { unidad: string | null; revisiones: RevisionDoc[] }>();
  for (const d of docs) {
    const v = porVehiculo.get(d.matricula) ?? { unidad: d.unidad, revisiones: [] };
    v.revisiones.push(d);
    if (!v.unidad && d.unidad) v.unidad = d.unidad;
    porVehiculo.set(d.matricula, v);
  }

  const todasLasRuedas = docs.flatMap((d) => d.ruedas);
  if (docs.length > 0 && todasLasRuedas.length === 0 && !op.soloConMediciones) {
    advertencias.push("Ninguna de las revisiones del periodo tiene mediciones de neumático guardadas.");
  }

  return {
    titulo: "Revisiones de neumáticos",
    periodo: { desde: op.desde, hasta: op.hasta },
    ambito: op.ambito,
    formato: op.formato,
    resumen: {
      revisiones: docs.length,
      vehiculos: porVehiculo.size,
      mediciones: todasLasRuedas.filter((r) => r.estado !== "sin_medir").length,
      bajoMinimo: todasLasRuedas.filter((r) => r.estado === "bajo_minimo").length,
      enAviso: todasLasRuedas.filter((r) => r.estado === "aviso").length,
      sinMedir: todasLasRuedas.filter((r) => r.estado === "sin_medir").length,
      borradores: op.ambito === "interno" ? borradores : 0,
      sinMediciones,
    },
    meses: [...meses.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([mes, m]) => ({ mes, revisiones: m.revisiones, vehiculos: m.vehiculos.size, bajoMinimo: m.bajoMinimo })),
    // El listado plano no se monta en el formato por vehículo, y al revés
    // tampoco: así el PDF no arrastra datos que no va a pintar.
    revisiones: op.formato === "vehiculo" ? [] : docs,
    vehiculos: op.formato === "vehiculo"
      ? [...porVehiculo.entries()]
          .sort(([a], [b]) => a.localeCompare(b, "es", { numeric: true }))
          .map(([matricula, v]) => ({
            matricula, unidad: v.unidad, revisiones: v.revisiones,
            bajoMinimo: v.revisiones.reduce((s, r) => s + r.bajoMinimo, 0),
          }))
      : [],
    advertencias,
  };
}
