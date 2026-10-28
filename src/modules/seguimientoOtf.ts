/**
 * Seguimiento de una OTF (orden de trabajo de flota) como el de una
 * asistencia: Asignada → En camino → En punto → Trabajando → Finalizada → En
 * camino a taller → En taller.
 *
 * Una OTF solo guardaba tres cosas: planificada, en la base (por GPS) y
 * finalizada (desde Assist). El resto del recorrido —salida del taller, vuelta
 * y llegada— lo pone ahora el servidor mirando el GPS de la furgoneta, con la
 * decisión aquí, pura, para probarla sin Webfleet.
 */

export type OtfSeguible = {
  status: string;
  createdAtMs?: number | null;
  fechaProgramadaMs?: number | null;
  departedAtMs?: number | null;
  arrivedAtBaseMs?: number | null;
  /** Primer trabajo tocado en la base: cuando empieza a trabajar. */
  primerTrabajoMs?: number | null;
  finishedAtMs?: number | null;
  enCaminoBaseAtMs?: number | null;
  arrivedAtWorkshopMs?: number | null;
  salidaArmada?: boolean | null;
};

export type FaseOtf =
  | "asignada"
  | "en_camino"
  | "en_punto"
  | "trabajando"
  | "finalizada"
  | "en_camino_base"
  | "llegada_taller";

export const FLUJO_OTF: FaseOtf[] = [
  "asignada",
  "en_camino",
  "en_punto",
  "trabajando",
  "finalizada",
  "en_camino_base",
  "llegada_taller",
];

export const ETIQUETA_FASE_OTF: Record<FaseOtf, string> = {
  asignada: "Asignada",
  en_camino: "En camino",
  en_punto: "En punto",
  trabajando: "Trabajando",
  finalizada: "Finalizada",
  en_camino_base: "En camino a taller",
  llegada_taller: "En taller",
};

/** Hora de cada fase, o null si no ha pasado. */
export function horaDeFaseOtf(fase: FaseOtf, o: OtfSeguible): number | null {
  switch (fase) {
    case "asignada":
      return o.createdAtMs ?? null;
    case "en_camino":
      return o.departedAtMs ?? null;
    case "en_punto":
      return o.arrivedAtBaseMs ?? null;
    case "trabajando":
      return o.primerTrabajoMs ?? null;
    case "finalizada":
      return o.finishedAtMs ?? null;
    case "en_camino_base":
      return o.enCaminoBaseAtMs ?? null;
    case "llegada_taller":
      return o.arrivedAtWorkshopMs ?? null;
  }
}

/** En qué fase está: la última que tiene hora. */
export function faseDeOtf(o: OtfSeguible): FaseOtf {
  let fase: FaseOtf = "asignada";
  for (const f of FLUJO_OTF) if (horaDeFaseOtf(f, o) != null) fase = f;
  // «En la base» según Assist aunque el GPS no dejara hora.
  if (fase === "asignada" || fase === "en_camino") {
    if (o.status === "en_curso") fase = "en_punto";
  }
  if (o.status === "finalizada" && (fase === "asignada" || fase === "en_camino" || fase === "en_punto" || fase === "trabajando")) {
    fase = "finalizada";
  }
  return fase;
}

export type PasoOtf = { fase: FaseOtf; etiqueta: string; estado: "hecho" | "actual" | "pendiente"; horaMs: number | null };

export function pasosDeOtf(o: OtfSeguible): PasoOtf[] {
  const actual = FLUJO_OTF.indexOf(faseDeOtf(o));
  return FLUJO_OTF.map((fase, i) => ({
    fase,
    etiqueta: ETIQUETA_FASE_OTF[fase],
    estado: i < actual ? "hecho" : i === actual ? "actual" : "pendiente",
    horaMs: horaDeFaseOtf(fase, o),
  }));
}

/** ¿Sigue siendo trabajo en curso para la TV? Hasta que entra en el taller. */
export function otfSigueEnCurso(o: OtfSeguible): boolean {
  if (o.status === "cancelada") return false;
  if (o.status === "finalizada") return o.arrivedAtWorkshopMs == null;
  return o.status === "planificada" || o.status === "en_curso";
}

export type LecturaGpsOtf = {
  distTallerM: number;
  distBaseM: number | null;
  radioTallerM: number;
  radioBaseM: number;
};

export type CambioOtf = {
  departedAtMs?: number;
  enCaminoBaseAtMs?: number;
  arrivedAtWorkshopMs?: number;
  salidaArmada?: boolean;
  nota?: string;
};

/**
 * Qué apuntar según dónde está la furgoneta.
 * · Planificada sin salida: vista en el taller → se arma; fuera del taller
 *   estando armada → ha salido (igual que las asistencias).
 * · Finalizada sin vuelta: fuera del radio de la base con margen → vuelve.
 * · Vuelve sin llegada: dentro del radio del taller → ha llegado.
 */
export function pasoDeOtfGps(o: OtfSeguible, l: LecturaGpsOtf, ahoraMs: number): CambioOtf {
  if (o.status === "planificada" && o.departedAtMs == null) {
    if (l.distTallerM <= l.radioTallerM) return o.salidaArmada ? {} : { salidaArmada: true };
    if (o.salidaArmada) return { departedAtMs: ahoraMs, nota: "Salida del taller detectada por GPS" };
    return {};
  }
  if (o.status === "finalizada") {
    if (o.enCaminoBaseAtMs == null) {
      if (l.distBaseM != null && l.distBaseM > l.radioBaseM * 1.5) {
        return { enCaminoBaseAtMs: ahoraMs, nota: "Vuelta al taller detectada por GPS" };
      }
      return {};
    }
    if (o.arrivedAtWorkshopMs == null && l.distTallerM <= l.radioTallerM) {
      return { arrivedAtWorkshopMs: ahoraMs, nota: "Llegada al taller detectada por GPS" };
    }
  }
  return {};
}

export type AvisoOtf = { titulo: string; detalle: string; tono: "azul" | "teal" } | null;

export function avisoDeOtf(o: OtfSeguible, eta: { minutos: number | null; km: string | null } | null): AvisoOtf {
  const fase = faseDeOtf(o);
  if (fase !== "en_camino" && fase !== "en_camino_base") return null;
  const vuelta = fase === "en_camino_base";
  const conEta = eta?.minutos != null && eta?.km != null;
  return {
    titulo: vuelta ? "El técnico vuelve al taller" : "El técnico está en camino",
    detalle: conEta ? `Tiempo estimado de llegada: ${eta!.minutos} min · ${eta!.km} km` : vuelta ? "De vuelta al taller" : "En camino hacia la base",
    tono: vuelta ? "teal" : "azul",
  };
}
