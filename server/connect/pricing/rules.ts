/**
 * Resolución de la regla tarifaria: el corazón del motor.
 *
 * Es donde un motor de tarifas se rompe en silencio. Si varias reglas encajan
 * y se elige "la primera", el precio depende del orden en que PostgreSQL
 * devuelva las filas —que no está garantizado y cambia con el plan de
 * ejecución—, así que la misma asistencia podría costar 198 € hoy y 331 €
 * mañana sin que nadie haya tocado nada.
 *
 * Aquí el orden es TOTAL y explícito:
 *
 *   1. prioridad, la que diga el tarifario (Navidad 100, festivo 90, …)
 *   2. especificidad: a igual prioridad gana la regla con más condiciones,
 *      porque describe mejor el caso
 *   3. identificador, como último desempate
 *
 * Y si las dos primeras empatan en prioridad y especificidad, se elige igual
 * —el resultado tiene que ser reproducible— pero se avisa con
 * AMBIGUOUS_RULES: el precio sale y la configuración queda señalada. Callarlo
 * sería esconder un error de configuración detrás de un número plausible.
 */

export interface ReglaTarifa {
  id: number;
  code: string;
  name: string;
  /** Dimensiones; null = "cualquiera" (comodín). */
  serviceTypeCode?: string | null;
  vehicleTypeCode?: string | null;
  zoneId?: number | null;
  timeBandId?: number | null;
  dayClasses?: string[] | null;
  minDistanceKm?: number | null;
  maxDistanceKm?: number | null;
  minDurationMin?: number | null;
  maxDurationMin?: number | null;
  priority: number;
  active?: boolean | null;
}

export interface ContextoRegla {
  serviceTypeCode: string;
  vehicleTypeCode: string;
  /** Zonas a las que pertenece el punto del servicio. */
  zoneIds: number[];
  /** Franjas horarias aplicables al instante contractual. */
  timeBandIds: number[];
  /** Clases del día, de la más específica a la más general. */
  dayClasses: string[];
  distanceKm: number | null;
  durationMin: number | null;
}

export type MotivoDescarte =
  | "service_type" | "vehicle_type" | "zone" | "time_band" | "day_class"
  | "distance" | "duration" | "inactive" | "distance_unknown" | "duration_unknown";

export interface Descarte {
  regla: ReglaTarifa;
  motivo: MotivoDescarte;
}

export interface ResultadoResolucion {
  regla: ReglaTarifa | null;
  candidatas: ReglaTarifa[];
  descartadas: Descarte[];
  avisos: string[];
}

/**
 * Por qué encaja o no encaja una regla. Se devuelve el motivo del descarte
 * para poder explicar "no se aplicó la de proximidad porque son 76 km", que es
 * la pregunta que hace el operador cuando el precio no es el que esperaba.
 */
export function porQueNoAplica(r: ReglaTarifa, ctx: ContextoRegla): MotivoDescarte | null {
  if (r.active === false) return "inactive";
  if (r.serviceTypeCode && r.serviceTypeCode !== ctx.serviceTypeCode) return "service_type";
  if (r.vehicleTypeCode && r.vehicleTypeCode !== ctx.vehicleTypeCode) return "vehicle_type";
  if (r.zoneId != null && !ctx.zoneIds.includes(r.zoneId)) return "zone";
  if (r.timeBandId != null && !ctx.timeBandIds.includes(r.timeBandId)) return "time_band";

  if (r.dayClasses && r.dayClasses.length > 0) {
    if (!r.dayClasses.some((c) => ctx.dayClasses.includes(c))) return "day_class";
  }

  /*
   * Una regla con límite de distancia no se puede dar por buena sin saber la
   * distancia: la de proximidad exige menos de 30 km, y aplicarla a ciegas
   * facturaría 110 € donde tocan 198 €. Se descarta y se avisa.
   */
  if (r.minDistanceKm != null || r.maxDistanceKm != null) {
    if (ctx.distanceKm == null) return "distance_unknown";
    if (r.minDistanceKm != null && ctx.distanceKm < r.minDistanceKm) return "distance";
    if (r.maxDistanceKm != null && ctx.distanceKm > r.maxDistanceKm) return "distance";
  }

  if (r.minDurationMin != null || r.maxDurationMin != null) {
    if (ctx.durationMin == null) return "duration_unknown";
    if (r.minDurationMin != null && ctx.durationMin < r.minDurationMin) return "duration";
    if (r.maxDurationMin != null && ctx.durationMin > r.maxDurationMin) return "duration";
  }

  return null;
}

export const reglaAplica = (r: ReglaTarifa, ctx: ContextoRegla): boolean =>
  porQueNoAplica(r, ctx) === null;

/**
 * Cuántas condiciones impone la regla. A igual prioridad gana la más
 * específica, porque describe mejor el caso: entre "camión en zona nacional en
 * franja nocturna" y "cualquier vehículo", la primera es la que el tarifario
 * quería aplicar.
 */
export function especificidad(r: ReglaTarifa): number {
  let n = 0;
  if (r.serviceTypeCode) n++;
  if (r.vehicleTypeCode) n++;
  if (r.zoneId != null) n++;
  if (r.timeBandId != null) n++;
  if (r.dayClasses && r.dayClasses.length > 0) n++;
  if (r.minDistanceKm != null || r.maxDistanceKm != null) n++;
  if (r.minDurationMin != null || r.maxDurationMin != null) n++;
  return n;
}

/** Orden total y determinista. Nunca depende del orden de llegada. */
export function compararReglas(a: ReglaTarifa, b: ReglaTarifa): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  const ea = especificidad(a);
  const eb = especificidad(b);
  if (ea !== eb) return eb - ea;
  return a.id - b.id;
}

export function resolverRegla(reglas: ReglaTarifa[], ctx: ContextoRegla): ResultadoResolucion {
  const candidatas: ReglaTarifa[] = [];
  const descartadas: Descarte[] = [];
  const avisos: string[] = [];

  for (const r of reglas) {
    const motivo = porQueNoAplica(r, ctx);
    if (motivo === null) candidatas.push(r);
    else descartadas.push({ regla: r, motivo });
  }

  if (descartadas.some((d) => d.motivo === "distance_unknown")) {
    avisos.push("DISTANCE_NOT_AVAILABLE");
  }
  if (descartadas.some((d) => d.motivo === "duration_unknown")) {
    avisos.push("DURATION_NOT_AVAILABLE");
  }

  candidatas.sort(compararReglas);

  if (candidatas.length === 0) {
    avisos.push("NO_MATCHING_RULE");
    return { regla: null, candidatas, descartadas, avisos };
  }

  const [primera, segunda] = candidatas;
  if (segunda &&
      primera.priority === segunda.priority &&
      especificidad(primera) === especificidad(segunda)) {
    // Se elige igual, para que el resultado sea reproducible, pero esto es un
    // error de configuración y tiene que verse.
    avisos.push("AMBIGUOUS_RULES");
  }

  return { regla: primera, candidatas, descartadas, avisos };
}

/** Texto de por qué se descartó una regla, para la explicación al operador. */
export function explicarDescarte(d: Descarte, ctx: ContextoRegla): string {
  const r = d.regla;
  switch (d.motivo) {
    case "inactive": return `${r.name}: desactivada`;
    case "service_type": return `${r.name}: es para ${r.serviceTypeCode}, no para ${ctx.serviceTypeCode}`;
    case "vehicle_type": return `${r.name}: es para ${r.vehicleTypeCode}, no para ${ctx.vehicleTypeCode}`;
    case "zone": return `${r.name}: fuera de su zona`;
    case "time_band": return `${r.name}: fuera de su franja horaria`;
    case "day_class": return `${r.name}: no aplica a este tipo de día`;
    case "distance":
      return `${r.name}: ${ctx.distanceKm} km fuera de su rango` +
        `${r.maxDistanceKm != null ? ` (máximo ${r.maxDistanceKm} km)` : ""}`;
    case "duration":
      return `${r.name}: ${ctx.durationMin} min fuera de su rango`;
    case "distance_unknown": return `${r.name}: exige un rango de distancia y no se conoce la distancia`;
    case "duration_unknown": return `${r.name}: exige un rango de tiempo y no se conoce la duración`;
  }
}
