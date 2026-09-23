/**
 * ¿Es creíble este odómetro para esta revisión?
 *
 * El servicio del Hub ya exige que dos ventanas del proveedor coincidan antes
 * de dar un número. Esto es la segunda barrera, y hace falta porque las dos
 * ventanas salen de la MISMA API: si Movertis tiene un mal rato coherente, las
 * dos mienten igual. Lo que hay aquí son cotas de fuera de la API.
 *
 * ── Las cuatro cotas, de más fuerte a más débil ────────────────────────────
 *
 * **Un odómetro no retrocede.** Es la única ley física del asunto y no admite
 * excepciones salvo cambio de cuadro, que en esta flota no ha pasado. Si la
 * revisión anterior del mismo vehículo marcaba 1.200.000 km, esta no puede
 * marcar menos. Lo mismo por arriba con la siguiente.
 *
 * Al principio del relleno esta cota no dice nada —ninguna revisión tiene
 * kilometraje todavía— y va apretando sola conforme se llenan. Es deliberado:
 * el orden de proceso es por fecha, así que cada revisión escrita se convierte
 * en el suelo de la siguiente.
 *
 * **El mes ya sincronizado.** `integration_vehicle_monthly_mileage` guarda el
 * odómetro al principio y al final de cada mes, y sale de otra consulta, otro
 * día y otra ventana. Una revisión del 15 de marzo tiene que caer entre el
 * odómetro del 1 de marzo y el del 31. Es la cota independiente de verdad.
 *
 * **El odómetro de hoy.** Se puede consultar en cualquier momento, y un
 * odómetro no retrocede: lo que marcaba el autobús en marzo no puede ser más
 * de lo que marca hoy. Es la cota más débil de las cuatro —deja pasar
 * cualquier número por debajo del actual— pero es la única que está SIEMPRE
 * disponible, y por eso es la que permite aceptar una lectura respaldada por
 * una sola ventana del proveedor en vez de tirarla.
 *
 * **Cero no es un odómetro.** Redundante con el mapeo del conector desde que
 * trata el 0 como «sin lectura», y se queda igualmente: es la clase de cosa
 * que vuelve por otro camino.
 *
 * Todo puro: entran las cotas, sale el veredicto con su motivo. Quien mira
 * cómo quedó el relleno necesita leer POR QUÉ se rechazó un número, no
 * encontrarse un hueco.
 */

/** Cuánto se le perdona a una cota, en km. Cubre redondeos, no discrepancias. */
export const TOLERANCIA_KM = 1;

export interface Vecina {
  km: number;
  /** Para poder nombrarla en el motivo. */
  fecha: string;
}

export interface Cotas {
  /** La revisión con kilometraje más cercana ANTES de este instante. */
  anterior?: Vecina | null;
  /** La más cercana DESPUÉS. */
  siguiente?: Vecina | null;
  /** Odómetro al principio y al final del mes, del kilometraje mensual. */
  mes?: { inicial: number; final: number } | null;
  /**
   * El odómetro que marca el vehículo HOY. Techo absoluto de cualquier lectura
   * del pasado, y la única cota que está disponible siempre: las otras dos
   * dependen de que exista una revisión vecina con kilómetros o de que el mes
   * ya esté sincronizado, y para un vehículo recién enlazado no existe ninguna.
   */
  hoy?: { km: number } | null;
}

/**
 * Discriminante de texto y no `ok: boolean`: `tsconfig.server.json` va con
 * `strict: false`, y sin `strictNullChecks` TypeScript no estrecha uniones por
 * un literal booleano. Con `estado` sí, y es la convención de la casa.
 */
export type Veredicto = { estado: "ok" } | { estado: "rechazado"; motivo: string };

export function esCoherente(km: number, cotas: Cotas = {}): Veredicto {
  if (!Number.isFinite(km) || km <= 0) {
    return { estado: "rechazado", motivo: `Odómetro ${km}: un cuentakilómetros a cero o negativo no es una lectura.` };
  }

  const { anterior, siguiente, mes, hoy } = cotas;

  if (anterior && km < anterior.km - TOLERANCIA_KM) {
    return {
      estado: "rechazado",
      motivo:
        `Odómetro ${redondo(km)} km, por debajo de los ${redondo(anterior.km)} km de la revisión ` +
        `del ${anterior.fecha}. Un odómetro no retrocede.`,
    };
  }

  if (siguiente && km > siguiente.km + TOLERANCIA_KM) {
    return {
      estado: "rechazado",
      motivo:
        `Odómetro ${redondo(km)} km, por encima de los ${redondo(siguiente.km)} km de la revisión ` +
        `del ${siguiente.fecha}, que es posterior.`,
    };
  }

  if (mes && Number.isFinite(mes.inicial) && Number.isFinite(mes.final)) {
    if (km < mes.inicial - TOLERANCIA_KM || km > mes.final + TOLERANCIA_KM) {
      return {
        estado: "rechazado",
        motivo:
          `Odómetro ${redondo(km)} km, fuera del mes: ese vehículo fue de ${redondo(mes.inicial)} ` +
          `a ${redondo(mes.final)} km. Son dos consultas distintas al proveedor y no cuadran.`,
      };
    }
  }

  if (hoy && Number.isFinite(hoy.km) && km > hoy.km + TOLERANCIA_KM) {
    return {
      estado: "rechazado",
      motivo:
        `Odómetro ${redondo(km)} km, por encima de los ${redondo(hoy.km)} km que marca ` +
        "hoy el vehículo. Un odómetro no retrocede, así que el pasado no puede ir por delante.",
    };
  }

  return { estado: "ok" };
}

/**
 * ¿Hay alguna cota que de verdad ate este número?
 *
 * `esCoherente` con las cotas vacías devuelve «ok», y tiene que ser así: no es
 * lo mismo un número desmentido que uno que nadie ha podido contrastar. Pero
 * quien acepta una lectura respaldada por UNA sola ventana del proveedor sí
 * necesita distinguirlo, porque ahí el «ok» no significa que el número esté
 * bien, sino que no había con qué comprobarlo.
 */
export function hayCotaIndependiente(cotas: Cotas = {}): boolean {
  const { anterior, siguiente, mes, hoy } = cotas;
  if (anterior && Number.isFinite(anterior.km)) return true;
  if (siguiente && Number.isFinite(siguiente.km)) return true;
  if (mes && Number.isFinite(mes.inicial) && Number.isFinite(mes.final)) return true;
  if (hoy && Number.isFinite(hoy.km)) return true;
  return false;
}

/**
 * El instante al que se pide el odómetro y cuánta confianza merece.
 *
 * Con `medido_at` hay instante exacto. Sin él solo hay un día, y entonces se
 * pide el odómetro **al empezar ese día**: es la cota inferior, y equivocarse
 * por abajo no le atribuye al neumático kilómetros que no había hecho, que es
 * el error que sí estropea un cálculo de desgaste.
 */
export function instanteDeRevision(r: {
  medido_at?: string | null;
  fecha_revision: string;
}): { instante: Date; exacto: boolean } | null {
  if (r.medido_at) {
    const d = new Date(r.medido_at);
    if (!Number.isNaN(d.getTime())) return { instante: d, exacto: true };
  }
  // `fecha_revision` puede venir como fecha sola («2026-03-15») o con hora.
  const soloFecha = /^\d{4}-\d{2}-\d{2}$/.test(String(r.fecha_revision ?? "").trim());
  const d = new Date(soloFecha ? `${r.fecha_revision}T00:00:00Z` : r.fecha_revision);
  if (Number.isNaN(d.getTime())) return null;
  return { instante: d, exacto: false };
}

function redondo(km: number): string {
  return Math.round(km).toLocaleString("es-ES");
}
