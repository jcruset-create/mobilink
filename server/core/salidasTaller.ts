/**
 * Salidas de taller: un operario sale con una furgoneta a un destino (repartir
 * neumáticos, buscar recambios…) y vuelve. Se guardan en la misma tabla que
 * las asistencias en carretera, con `tipo = 'salida'`, para heredar todo lo
 * que ya funciona: GPS de la furgoneta, ETA, salida y llegada al taller
 * automáticas, ocupación del técnico y Pantalla técnicos.
 *
 * Lo que una salida tiene de distinto es el recorrido: nadie lleva tablet, así
 * que la llegada al punto y la vuelta las decide el servidor mirando el GPS.
 * Esa decisión está aquí, pura, para poder probarla sin Webfleet.
 */

export const TIPO_SALIDA = "salida";
export const TIPO_ASISTENCIA = "asistencia";

export const MOTIVOS_SALIDA = [
  { key: "repartir_neumaticos", label: "Repartir neumáticos", icono: "🛞" },
  { key: "buscar_recambios", label: "Buscar recambios", icono: "🔧" },
  { key: "entrega_cliente", label: "Entrega a cliente", icono: "📦" },
  { key: "gestion", label: "Gestión", icono: "🧾" },
  { key: "otro", label: "Otro", icono: "🚐" },
] as const;

export type MotivoSalida = (typeof MOTIVOS_SALIDA)[number]["key"];

export function esMotivoDeSalida(valor: unknown): valor is MotivoSalida {
  return MOTIVOS_SALIDA.some((m) => m.key === valor);
}

export function etiquetaDeMotivo(motivo: string | null | undefined): string {
  return MOTIVOS_SALIDA.find((m) => m.key === motivo)?.label ?? "Salida";
}

/** Los pasos de una salida: sin «Reparando» ni «Finalizada». */
export const FLUJO_SALIDA = ["asignada", "en_camino", "en_punto", "en_camino_base", "llegada_taller"] as const;

/** Radio del destino: el mismo que usan los lugares conocidos. */
export const RADIO_DESTINO_M = 300;

export type LecturaGps = {
  status: string;
  /** Metros de la furgoneta al destino. */
  distDestinoM: number;
  /** ¿Se mueve? null si Webfleet no lo dice. */
  moving: boolean | null;
  /** Ya se la vio dentro del radio en una pasada anterior (en marcha). */
  enPuntoVisto: boolean;
  radioDestinoM?: number;
};

export type PasoDeSalida = {
  /** Estado nuevo, si toca cambiarlo. */
  status?: "en_punto" | "en_camino_base";
  /** Nuevo valor del latch de «vista dentro», si cambia. */
  enPuntoVisto?: boolean;
  nota?: string;
};

/**
 * Qué hacer con una salida según dónde está la furgoneta.
 *
 * · En camino → en el punto: dentro del radio del destino y parada. Si pasa
 *   por dentro en marcha, se apunta («vista dentro») y la segunda vez que se
 *   la ve dentro cuenta como llegada: un reparto rápido puede no pillarse
 *   parado en ninguna lectura, pero dos lecturas dentro en un minuto no son
 *   pasar de largo. Si sale sin pararse, se borra el apunte.
 * · En el punto → vuelve al taller: cuando sale del radio con margen (una
 *   vez y media), para que el GPS bailando en el borde no la saque y la meta.
 */
export function pasoDeSalida(l: LecturaGps): PasoDeSalida {
  const radio = l.radioDestinoM ?? RADIO_DESTINO_M;
  const dentro = l.distDestinoM <= radio;

  if (l.status === "en_camino") {
    if (!dentro) return l.enPuntoVisto ? { enPuntoVisto: false } : {};
    if (l.moving === false || l.enPuntoVisto) {
      return {
        status: "en_punto",
        enPuntoVisto: true,
        nota: l.moving === false ? "Llegada al punto detectada por GPS (parada)" : "Llegada al punto detectada por GPS (vista dentro dos veces)",
      };
    }
    return { enPuntoVisto: true };
  }

  if (l.status === "en_punto") {
    if (l.distDestinoM > radio * 1.5) {
      return { status: "en_camino_base", nota: "Vuelta al taller detectada por GPS (salió del destino)" };
    }
    return {};
  }

  return {};
}

/** Lo que debe traer una salida para crearse. Vacío = correcto. */
export function validarSalida(b: {
  motivo?: unknown;
  assignedTechName?: unknown;
  address?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  knownPlaceId?: unknown;
}): string[] {
  const errores: string[] = [];
  if (!esMotivoDeSalida(b.motivo)) errores.push("Elige el motivo de la salida.");
  if (!String(b.assignedTechName ?? "").trim()) errores.push("Elige el operario.");
  const conCoordenadas = Number.isFinite(Number(b.latitude)) && Number.isFinite(Number(b.longitude)) && b.latitude != null && b.longitude != null;
  if (!conCoordenadas && !String(b.address ?? "").trim() && b.knownPlaceId == null) {
    errores.push("Indica el destino: un lugar conocido, una dirección o un punto en el mapa.");
  }
  return errores;
}
