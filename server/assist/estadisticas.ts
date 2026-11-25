/**
 * Estadísticas de las asistencias: cuántas, cuánto se tarda en cada fase,
 * cuándo entran, a qué distancia, por cliente, por operario, por tipo de
 * avería y qué hay que revisar.
 *
 * Solo cuentas: las filas llegan ya leídas de la base (con los km, la
 * distancia a la base, la valoración y si hay firma y fotos). Así se puede
 * probar todo sin base de datos, y la misma función sirve para la vista
 * general y para la ficha de un cliente.
 *
 * Los tiempos se miden en minutos y se descartan los que no tienen sentido
 * (negativos o de más de un día): una fase sin la hora de un estado, o un
 * estado marcado a mano días después, no puede hundir una media.
 */

export type FilaEstadistica = {
  id: number;
  status: string;
  createdAtMs: number;
  assignedAtMs: number | null;
  departedAtMs: number | null;
  arrivedAtPointMs: number | null;
  inicioReparacionAtMs: number | null;
  finishedAtMs: number | null;
  arrivedAtWorkshopMs: number | null;
  cancelledAtMs: number | null;
  customerName: string | null;
  clientId: number | null;
  assignedTechName: string | null;
  assignedVehicleName: string | null;
  webfleetVehicleId: string | null;
  tipo: string | null;
  origen: string | null;
  motivo: string | null;
  descripcionAveria: string | null;
  plate: string | null;
  plateRemolque: string | null;
  esRemolque: boolean;
  address: string | null;
  plateMismatch: boolean;
  waStatus: string | null;
  /** Km recorridos por la furgoneta (ida y vuelta), si se han calculado. */
  kmRecorridos: number | null;
  /** Km en línea recta de la base al punto de la avería. */
  distanciaKm: number | null;
  valoracion: number | null;
  conFirma: boolean;
  conFotos: boolean;
};

export type Objetivos = {
  /** Llegada (asignación → en punto) dentro de este tiempo: «a tiempo». */
  llegadaMin: number;
  /** A partir de aquí la llegada es una alerta. */
  llegadaAlertaMin: number;
  asignarMin: number;
  salirMin: number;
};

export const OBJETIVOS_POR_DEFECTO: Objetivos = {
  llegadaMin: 60,
  llegadaAlertaMin: 90,
  asignarMin: 10,
  salirMin: 10,
};

const MAX_MIN = 24 * 60;

/** Minutos entre dos horas, o null si falta alguna o no tiene sentido. */
export function minutos(desde: number | null | undefined, hasta: number | null | undefined): number | null {
  if (!desde || !hasta) return null;
  const m = (Number(hasta) - Number(desde)) / 60_000;
  return Number.isFinite(m) && m >= 0 && m <= MAX_MIN ? m : null;
}

export function media(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

const r1 = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10);

export const esAnulada = (a: FilaEstadistica) => a.status === "cancelada" || a.cancelledAtMs != null;
export const esRealizada = (a: FilaEstadistica) => !esAnulada(a) && a.status !== "redirigida";

export const llegadaMin = (a: FilaEstadistica) => minutos(a.assignedAtMs, a.arrivedAtPointMs);
export const reparacionMin = (a: FilaEstadistica) => minutos(a.arrivedAtPointMs, a.finishedAtMs);
export const servicioMin = (a: FilaEstadistica) =>
  a.finishedAtMs || a.arrivedAtWorkshopMs ? minutos(a.createdAtMs, a.arrivedAtWorkshopMs || a.finishedAtMs) : null;

/* ── Partes de la fecha en hora de Madrid ─────────────────────────────── */

const fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Madrid",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", weekday: "short", hourCycle: "h23",
});
const DIAS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function partesMadrid(ms: number): { dia: string; mes: string; hora: number; diaSemana: number } {
  const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    dia: `${p.year}-${p.month}-${p.day}`,
    mes: `${p.year}-${p.month}`,
    hora: Number(p.hour) % 24,
    diaSemana: DIAS[p.weekday] ?? 0,
  };
}

/* ── Tipo de avería ──────────────────────────────────────────────────── */

export const TIPOS_AVERIA = [
  "Llanta / balona",
  "Pinchazo / reventón",
  "Cambio de neumático",
  "Batería / arranque",
  "Valoración / traslado",
  "Otros",
] as const;

/**
 * El tipo de avería, deducido de lo que se escribió (motivo y descripción).
 * Es texto libre, así que se busca por palabras; el orden importa: «reventón
 * que ha dañado la balona» es de balona, que es lo que alarga el trabajo.
 */
export function tipoDeAveria(a: Pick<FilaEstadistica, "motivo" | "descripcionAveria">): (typeof TIPOS_AVERIA)[number] {
  const t = `${a.motivo ?? ""} ${a.descripcionAveria ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (/balona|llanta/.test(t)) return "Llanta / balona";
  if (/revent|pinch|pinxa|rebent|deshinch|perdida de aire|pierde aire|sin aire/.test(t)) return "Pinchazo / reventón";
  if (/neumatic|rueda|cubierta|roda/.test(t)) return "Cambio de neumático";
  if (/bater|arranc|arrenc/.test(t)) return "Batería / arranque";
  if (/valora|trasl|grua|remolc/.test(t)) return "Valoración / traslado";
  return "Otros";
}

/* ── Filtros ─────────────────────────────────────────────────────────── */

export type Filtros = {
  cliente?: string | null;
  operario?: string | null;
  furgoneta?: string | null;
  tipoAveria?: string | null;
  origen?: string | null;
};

export const nombreCliente = (a: FilaEstadistica) => (a.customerName ?? "").trim() || "Sin cliente";

export function filtrar(filas: FilaEstadistica[], f: Filtros): FilaEstadistica[] {
  return filas.filter(
    (a) =>
      (!f.cliente || nombreCliente(a).toLowerCase() === f.cliente.toLowerCase()) &&
      (!f.operario || (a.assignedTechName ?? "") === f.operario) &&
      (!f.furgoneta || (a.assignedVehicleName ?? "") === f.furgoneta) &&
      (!f.tipoAveria || tipoDeAveria(a) === f.tipoAveria) &&
      (!f.origen || (a.origen ?? "") === f.origen),
  );
}

/** Los valores posibles de cada filtro, para los desplegables. */
export function opcionesFiltros(filas: FilaEstadistica[]) {
  const unicos = (xs: (string | null)[]) =>
    [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  return {
    clientes: unicos(filas.map(nombreCliente)),
    operarios: unicos(filas.map((a) => a.assignedTechName)),
    furgonetas: unicos(filas.map((a) => a.assignedVehicleName)),
    tiposAveria: [...TIPOS_AVERIA],
    origenes: unicos(filas.map((a) => a.origen)),
  };
}

/* ── Cifras clave ────────────────────────────────────────────────────── */

export function resumen(filas: FilaEstadistica[], obj: Objetivos = OBJETIVOS_POR_DEFECTO) {
  const realizadas = filas.filter(esRealizada);
  const llegadas = realizadas.map(llegadaMin).filter((x): x is number => x != null);
  const valoraciones = filas.map((a) => a.valoracion).filter((x): x is number => x != null);
  return {
    total: filas.length,
    realizadas: realizadas.length,
    anuladas: filas.filter(esAnulada).length,
    llegadaMediaMin: r1(media(llegadas)),
    reparacionMediaMin: r1(media(realizadas.map(reparacionMin))),
    servicioMedioMin: r1(media(realizadas.map(servicioMin))),
    kmMedio: r1(media(realizadas.map((a) => a.kmRecorridos))),
    kmConDato: realizadas.filter((a) => a.kmRecorridos != null).length,
    distanciaMediaKm: r1(media(realizadas.map((a) => a.distanciaKm))),
    distanciaMaxKm: r1(Math.max(0, ...realizadas.map((a) => a.distanciaKm ?? 0))),
    pctLlegadaObjetivo: llegadas.length
      ? Math.round((llegadas.filter((m) => m <= obj.llegadaMin).length / llegadas.length) * 100)
      : null,
    valoracionMedia: r1(media(valoraciones)),
    encuestas: valoraciones.length,
  };
}

/* ── Por día ─────────────────────────────────────────────────────────── */

export function porDia(filas: FilaEstadistica[], desdeMs: number, hastaMs: number) {
  const dias = new Map<string, { dia: string; realizadas: number; anuladas: number }>();
  // Todos los días del periodo, también los que no tuvieron ninguna.
  for (let t = desdeMs; t <= hastaMs; t += 6 * 3600_000) {
    const d = partesMadrid(t).dia;
    if (!dias.has(d)) dias.set(d, { dia: d, realizadas: 0, anuladas: 0 });
  }
  for (const a of filas) {
    const d = partesMadrid(a.createdAtMs).dia;
    const x = dias.get(d) ?? { dia: d, realizadas: 0, anuladas: 0 };
    if (esAnulada(a)) x.anuladas += 1;
    else x.realizadas += 1;
    dias.set(d, x);
  }
  return [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Por mes, para la evolución de la ficha de cliente. */
export function porMes(filas: FilaEstadistica[]) {
  const meses = new Map<string, FilaEstadistica[]>();
  for (const a of filas) {
    const m = partesMadrid(a.createdAtMs).mes;
    meses.set(m, [...(meses.get(m) ?? []), a]);
  }
  return [...meses.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, xs]) => ({
      mes,
      asistencias: xs.length,
      anuladas: xs.filter(esAnulada).length,
      llegadaMediaMin: r1(media(xs.filter(esRealizada).map(llegadaMin))),
    }));
}

/* ── Fases ───────────────────────────────────────────────────────────── */

export function fases(filas: FilaEstadistica[], obj: Objetivos = OBJETIVOS_POR_DEFECTO) {
  const rs = filas.filter(esRealizada);
  return [
    { clave: "asignar", nombre: "Recepción → asignación", min: r1(media(rs.map((a) => minutos(a.createdAtMs, a.assignedAtMs)))), objetivoMin: obj.asignarMin },
    { clave: "salir", nombre: "Asignación → salida", min: r1(media(rs.map((a) => minutos(a.assignedAtMs, a.departedAtMs)))), objetivoMin: obj.salirMin },
    { clave: "trayecto", nombre: "Trayecto al punto", min: r1(media(rs.map((a) => minutos(a.departedAtMs, a.arrivedAtPointMs)))), objetivoMin: null },
    { clave: "reparacion", nombre: "Reparación en el punto", min: r1(media(rs.map(reparacionMin))), objetivoMin: null },
    { clave: "vuelta", nombre: "Vuelta al taller", min: r1(media(rs.map((a) => minutos(a.finishedAtMs, a.arrivedAtWorkshopMs)))), objetivoMin: null },
  ];
}

/* ── Día de la semana × franja de 3 horas ───────────────────────────── */

export const FRANJAS = ["0–3", "3–6", "6–9", "9–12", "12–15", "15–18", "18–21", "21–24"];

export function franjas(filas: FilaEstadistica[]) {
  const celdas = Array.from({ length: 7 }, () => Array.from({ length: 8 }, () => [] as FilaEstadistica[]));
  for (const a of filas) {
    const p = partesMadrid(a.createdAtMs);
    celdas[p.diaSemana][Math.floor(p.hora / 3)].push(a);
  }
  return celdas.map((fila) =>
    fila.map((xs) => ({ n: xs.length, llegadaMediaMin: r1(media(xs.filter(esRealizada).map(llegadaMin))) })),
  );
}

/* ── Distancia ───────────────────────────────────────────────────────── */

export const TRAMOS_KM: { etiqueta: string; hasta: number }[] = [
  { etiqueta: "< 10 km", hasta: 10 },
  { etiqueta: "10–25", hasta: 25 },
  { etiqueta: "25–50", hasta: 50 },
  { etiqueta: "50–100", hasta: 100 },
  { etiqueta: "> 100", hasta: Infinity },
];

export function distancias(filas: FilaEstadistica[]) {
  const rs = filas.filter((a) => esRealizada(a) && a.distanciaKm != null);
  let desde = 0;
  return TRAMOS_KM.map(({ etiqueta, hasta }) => {
    const xs = rs.filter((a) => a.distanciaKm! >= desde && a.distanciaKm! < hasta);
    desde = hasta;
    return { tramo: etiqueta, n: xs.length, llegadaMediaMin: r1(media(xs.map(llegadaMin))) };
  });
}

/* ── Por cliente, por operario, por tipo ─────────────────────────────── */

function agrupar<K extends string>(filas: FilaEstadistica[], clave: (a: FilaEstadistica) => K) {
  const g = new Map<K, FilaEstadistica[]>();
  for (const a of filas) g.set(clave(a), [...(g.get(clave(a)) ?? []), a]);
  return g;
}

export function porCliente(filas: FilaEstadistica[], obj: Objetivos = OBJETIVOS_POR_DEFECTO) {
  const total = filas.length || 1;
  return [...agrupar(filas, nombreCliente).entries()]
    .map(([cliente, xs]) => {
      const rs = xs.filter(esRealizada);
      const llegada = r1(media(rs.map(llegadaMin)));
      return {
        cliente,
        asistencias: xs.length,
        pct: Math.round((xs.length / total) * 1000) / 10,
        llegadaMediaMin: llegada,
        llegadaLenta: llegada != null && llegada > obj.llegadaMin,
        reparacionMediaMin: r1(media(rs.map(reparacionMin))),
        kmMedio: r1(media(rs.map((a) => a.kmRecorridos))),
        distanciaMediaKm: r1(media(rs.map((a) => a.distanciaKm))),
        anuladas: xs.filter(esAnulada).length,
        remolques: xs.filter((a) => a.esRemolque || !!a.plateRemolque).length,
        valoracionMedia: r1(media(xs.map((a) => a.valoracion))),
        encuestas: xs.filter((a) => a.valoracion != null).length,
      };
    })
    .sort((a, b) => b.asistencias - a.asistencias || a.cliente.localeCompare(b.cliente, "es"));
}

export function porOperario(filas: FilaEstadistica[]) {
  const rs = filas.filter((a) => a.assignedTechName);
  return [...agrupar(rs, (a) => `${a.assignedTechName}|${a.assignedVehicleName ?? ""}` as string).entries()]
    .map(([k, xs]) => {
      const [operario, furgoneta] = k.split("|");
      const hechas = xs.filter(esRealizada);
      const horas = hechas.reduce(
        (s, a) => s + (minutos(a.departedAtMs, a.arrivedAtWorkshopMs || a.finishedAtMs) ?? 0),
        0,
      ) / 60;
      return {
        operario,
        furgoneta: furgoneta || null,
        asistencias: xs.length,
        salidaMediaMin: r1(media(hechas.map((a) => minutos(a.assignedAtMs, a.departedAtMs)))),
        llegadaMediaMin: r1(media(hechas.map(llegadaMin))),
        reparacionMediaMin: r1(media(hechas.map(reparacionMin))),
        kmTotal: Math.round(hechas.reduce((s, a) => s + (a.kmRecorridos ?? 0), 0)),
        horasServicio: r1(horas),
      };
    })
    .sort((a, b) => b.asistencias - a.asistencias);
}

export function porTipoAveria(filas: FilaEstadistica[]) {
  const g = agrupar(filas, (a) => tipoDeAveria(a));
  return TIPOS_AVERIA.map((tipo) => {
    const xs = g.get(tipo) ?? [];
    return { tipo, asistencias: xs.length, reparacionMediaMin: r1(media(xs.filter(esRealizada).map(reparacionMin))) };
  }).filter((t) => t.asistencias > 0);
}

/* ── Control de calidad ──────────────────────────────────────────────── */

export function alertas(filas: FilaEstadistica[], obj: Objetivos = OBJETIVOS_POR_DEFECTO) {
  const rs = filas.filter(esRealizada);
  // Firma y fotos solo se piden a las que ya se han terminado.
  const terminadas = rs.filter((a) => a.finishedAtMs || a.arrivedAtWorkshopMs);
  const lista = (clave: string, texto: string, nivel: "alto" | "medio" | "bajo", xs: FilaEstadistica[]) => ({
    clave, texto, nivel, n: xs.length, ids: xs.map((a) => a.id),
  });
  return [
    lista("llegadaTarde", `Llegaron en más de ${obj.llegadaAlertaMin} min`, "alto",
      rs.filter((a) => (llegadaMin(a) ?? 0) > obj.llegadaAlertaMin)),
    lista("sinFirma", "Sin firma del conductor", "medio", terminadas.filter((a) => !a.conFirma)),
    lista("sinFotos", "Sin fotos del trabajo", "medio", terminadas.filter((a) => !a.conFotos)),
    lista("matricula", "Matrícula leída distinta de la de la asistencia", "bajo", filas.filter((a) => a.plateMismatch)),
    lista("whatsapp", "WhatsApp de seguimiento no entregado", "bajo",
      filas.filter((a) => a.waStatus === "failed" || a.waStatus === "undelivered")),
    lista("anuladaEnCamino", "Anuladas con el operario ya en camino", "alto",
      filas.filter((a) => esAnulada(a) && a.departedAtMs)),
    lista("sinWebfleet", "Sin furgoneta Webfleet: sin km reales", "bajo",
      rs.filter((a) => a.departedAtMs && !a.webfleetVehicleId)),
    lista("valoracionBaja", "Valoración de 3 o menos", "alto",
      filas.filter((a) => a.valoracion != null && a.valoracion <= 3)),
  ];
}

/* ── Ficha de cliente ────────────────────────────────────────────────── */

/**
 * El municipio de una dirección. Dos formas habituales:
 *  · Google: «Calle Mayor 3, 43003 Tarragona, España» → el que va con el CP.
 *  · OpenStreetMap: «Camí…, Vandellòs i l'Hospitalet de l'Infant, Baix Camp,
 *    Tarragona, Catalunya, 43890, España» → el que va justo tras la calle.
 */
export function municipioDe(dir: string | null): string {
  const partes = (dir ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const p of partes) {
    const m = /^\d{5}\s+(.+)$/.exec(p);
    if (m) return m[1];
  }
  const resto = partes.slice(1).filter((p) => !/^\d+[a-z]?$/i.test(p));
  return resto[0] ?? partes[0] ?? "";
}

/** Lo que solo tiene sentido para un cliente: sus vehículos y sus sitios. */
export function fichaCliente(filas: FilaEstadistica[]) {
  const contar = (xs: string[]) =>
    [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>()).entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

  return {
    porMes: porMes(filas),
    vehiculos: contar(filas.map((a) => a.plate || a.plateRemolque || "").filter(Boolean))
      .map(([matricula, n]) => ({ matricula, asistencias: n })),
    lugares: contar(filas.map((a) => municipioDe(a.address)).filter(Boolean)).map(([lugar, n]) => ({ lugar, asistencias: n })),
    ultimas: [...filas]
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, 25)
      .map((a) => ({
        id: a.id,
        createdAtMs: a.createdAtMs,
        plate: a.plate || a.plateRemolque,
        estado: a.status,
        tipoAveria: tipoDeAveria(a),
        llegadaMin: r1(llegadaMin(a)),
        reparacionMin: r1(reparacionMin(a)),
        kmRecorridos: r1(a.kmRecorridos),
        valoracion: a.valoracion,
        operario: a.assignedTechName,
      })),
  };
}

/** Todo junto: lo que devuelve el endpoint para un periodo. */
export function estadisticas(
  filas: FilaEstadistica[],
  anteriores: FilaEstadistica[],
  desdeMs: number,
  hastaMs: number,
  obj: Objetivos = OBJETIVOS_POR_DEFECTO,
) {
  return {
    objetivos: obj,
    resumen: resumen(filas, obj),
    anterior: resumen(anteriores, obj),
    porDia: porDia(filas, desdeMs, hastaMs),
    fases: fases(filas, obj),
    franjas: { etiquetas: FRANJAS, dias: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"], celdas: franjas(filas) },
    distancias: distancias(filas),
    clientes: porCliente(filas, obj),
    operarios: porOperario(filas),
    averias: porTipoAveria(filas),
    alertas: alertas(filas, obj),
  };
}

/** El detalle de cada asistencia, para la exportación a Excel. */
export function detalleParaExcel(filas: FilaEstadistica[]) {
  return filas.map((a) => ({
    id: a.id,
    createdAtMs: a.createdAtMs,
    cliente: nombreCliente(a),
    matricula: a.plate || a.plateRemolque || "",
    estado: a.status,
    origen: a.origen ?? "",
    tipoAveria: tipoDeAveria(a),
    operario: a.assignedTechName ?? "",
    furgoneta: a.assignedVehicleName ?? "",
    asignarMin: r1(minutos(a.createdAtMs, a.assignedAtMs)),
    salirMin: r1(minutos(a.assignedAtMs, a.departedAtMs)),
    llegadaMin: r1(llegadaMin(a)),
    reparacionMin: r1(reparacionMin(a)),
    servicioMin: r1(servicioMin(a)),
    distanciaKm: r1(a.distanciaKm),
    kmRecorridos: r1(a.kmRecorridos),
    valoracion: a.valoracion,
  }));
}
