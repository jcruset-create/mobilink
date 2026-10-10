/**
 * El relleno DIARIO del kilometraje de las revisiones.
 *
 * ── Qué problema resuelve ───────────────────────────────────────────────────
 *
 * Las revisiones del CheckPoint nacen sin kilómetros: el arco no los lee. El
 * importador intenta ponérselos en el momento —`kilometrajeRevision.ts`, que
 * atribuye el odómetro de ahora si el bus no se ha movido—, pero un bus que
 * pasó por el arco a las 13:51 y siguió su ruta se queda sin ellos. Y el
 * relleno del histórico (`worker.ts`) es una tarea que alguien lanza a mano
 * desde el panel y que, además, no toca el día en curso.
 *
 * Resultado: las revisiones de cada día se quedaban con el kilometraje en
 * blanco hasta que alguien se acordaba de pulsar el botón.
 *
 * Esto lo hace solo: cada mañana, cuando el día anterior ya es un dato cerrado
 * para el proveedor, lanza el mismo relleno —la misma tarea, el mismo método,
 * las mismas cotas— acotado a los últimos días. No es otro relleno: es el de
 * siempre, con reloj.
 *
 * ── La ventana, y por qué es corta ──────────────────────────────────────────
 *
 * Desde hace DIAS_ATRAS días hasta AYER. Ayer porque hoy «baila»: el
 * proveedor contesta valores distintos para el mismo instante del día en
 * curso (ver HistoricOdometerService), y el día se da por cerrado seis horas
 * después de medianoche. Unos días atrás porque una revisión que ayer no
 * pudo rellenarse (proveedor caído, lectura sin corroborar) merece otro
 * intento, pero no infinitos: cada intento son dos peticiones al proveedor, y
 * una revisión que tres mañanas seguidas no da nada no va a darlo a la cuarta.
 * Lo anterior a la ventana es cosa del relleno del histórico, a mano.
 *
 * ── Lo que NO hace ──────────────────────────────────────────────────────────
 *
 * No se mete si hay un relleno en marcha para esa empresa: el del histórico
 * puede llevar horas y es el mismo cupo del proveedor. Se espera a la
 * siguiente vuelta. No pisa kilómetros escritos a mano (lo garantiza la tarea
 * de siempre). Y no inventa: lo que no pasa las cotas no se escribe.
 */

import { ZONA_HORARIA_POR_DEFECTO } from "../../integration-hub/domain/meses.ts";

/** Hora local a partir de la cual el día de ayer ya está cerrado para el proveedor. */
export const HORA_LOCAL = 7;
/** Cuántos días atrás, contando desde ayer, se reintentan. */
export const DIAS_ATRAS = 3;
/** Cada cuánto se mira si toca. No es la frecuencia del relleno: es la del reloj. */
export const LATIDO_MS = 15 * 60 * 1000;
/** La entrada en `integration_sync_state`. Distinta de la tarea: esto es el reloj. */
export const ENTIDAD_DIARIO = "km_revisiones_diario";

/** Año, mes y día de un instante en una zona, como texto `YYYY-MM-DD`. */
export function fechaLocal(instante: Date, zona = ZONA_HORARIA_POR_DEFECTO): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(instante).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}`;
}

function horaLocal(instante: Date, zona: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zona, hourCycle: "h23", hour: "2-digit" })
      .formatToParts(instante).map((x) => [x.type, x.value]),
  );
  return Number(p.hour);
}

/** `YYYY-MM-DD` menos N días, en calendario (sin horas de por medio). */
function restarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - dias));
  return t.toISOString().slice(0, 10);
}

/** La ventana de hoy: desde hace DIAS_ATRAS días hasta ayer, en fechas locales. */
export function ventanaDiaria(ahora: Date, zona = ZONA_HORARIA_POR_DEFECTO): { desde: string; hasta: string } {
  const hoy = fechaLocal(ahora, zona);
  return { desde: restarDias(hoy, DIAS_ATRAS), hasta: restarDias(hoy, 1) };
}

/**
 * ¿Toca lanzar el relleno de hoy?
 *
 * Sí cuando ya es la hora y todavía no se ha lanzado hoy. «Hoy» en fecha
 * local, no en milisegundos: así un servidor que se reinicia a las 11 lanza el
 * de ese día si no lo hizo a las 7, y uno que lo lanzó a las 7 no lo repite a
 * las 23 aunque hayan pasado dieciséis horas.
 */
export function tocaHoy(ultimoMs: number | null, ahora: Date, zona = ZONA_HORARIA_POR_DEFECTO): boolean {
  if (horaLocal(ahora, zona) < HORA_LOCAL) return false;
  if (ultimoMs == null) return true;
  return fechaLocal(new Date(ultimoMs), zona) !== fechaLocal(ahora, zona);
}

export interface ResultadoDiario {
  lanzadas: string[];
  /** Ya lanzadas hoy, o todavía no es la hora. */
  alDia: number;
  /** Con otro relleno en marcha: se esperará a la próxima vuelta. */
  ocupadas: string[];
  /** Nada que rellenar en la ventana. */
  vacias: string[];
}

/**
 * Una vuelta del reloj: lanza el relleno de hoy a quien le toque.
 *
 * Se guarda el lanzamiento ANTES de que la tarea termine: lo que importa para
 * no repetir es que se ha lanzado hoy, y la tarea ya se guarda sola a cada
 * revisión. Si no había nada que rellenar también cuenta como hecho, que es
 * lo normal en una empresa sin CheckPoint.
 */
/**
 * Lo que pasó la última vez que el reloj miró a cada empresa, en memoria.
 *
 * El lanzamiento de hoy se guarda en `integration_sync_state`; esto es lo
 * otro: que a las 07:00 se miró y había un relleno en marcha, o que falló.
 * Sin ello, un panel que solo lee la base diría «todavía no se ha lanzado
 * hoy» y no por qué, que es justo lo que se le pregunta.
 */
interface Vuelta { ms: number; resultado: "lanzado" | "sin_pendientes" | "al_dia" | "ocupada" | "error"; detalle?: string }
const ultimaVuelta = new Map<string, Vuelta>();

export interface EstadoDiario {
  /** Cuándo se lanzó por última vez (ms), o null si nunca. */
  ultimoLanzamientoMs: number | null;
  /** La ventana y las pendientes de ese lanzamiento. */
  ventana: { desde: string; hasta: string } | null;
  pendientesAlLanzar: number | null;
  /** ¿Ya se ha lanzado hoy (fecha local)? */
  lanzadoHoy: boolean;
  /** La última vez que el reloj miró esta empresa y qué decidió. */
  ultimaVuelta: Vuelta | null;
  /** A qué hora local se lanza. */
  horaLocal: number;
  diasAtras: number;
}

/** Para el panel: dónde está el reloj diario de una empresa. */
export async function estadoRellenoDiario(empresaId: string, ahora = new Date()): Promise<EstadoDiario> {
  const { getSyncState } = await import("../../integration-hub/infrastructure/repositories.ts");
  const fila = await getSyncState(empresaId, ENTIDAD_DIARIO);
  const ultimoMs = fila?.last_sync_ms != null ? Number(fila.last_sync_ms) : null;
  let detalle: any = null;
  try { detalle = fila?.detail ? JSON.parse(String(fila.detail)) : null; } catch { detalle = null; }
  return {
    ultimoLanzamientoMs: ultimoMs,
    ventana: detalle?.desde && detalle?.hasta ? { desde: String(detalle.desde), hasta: String(detalle.hasta) } : null,
    pendientesAlLanzar: typeof detalle?.pendientes === "number" ? detalle.pendientes : null,
    lanzadoHoy: ultimoMs != null && fechaLocal(new Date(ultimoMs)) === fechaLocal(ahora),
    ultimaVuelta: ultimaVuelta.get(empresaId) ?? null,
    horaLocal: HORA_LOCAL,
    diasAtras: DIAS_ATRAS,
  };
}

export async function tickRellenoDiario(ahora = new Date()): Promise<ResultadoDiario> {
  const { listTenantsWithConnectors, getSyncState, upsertSyncState } = await import(
    "../../integration-hub/infrastructure/repositories.ts"
  );
  const { knownTelematicsConnectorKeys } = await import(
    "../../integration-hub/connectors/ConnectorRegistry.ts"
  );
  const { estadoRellenoRevisiones, iniciarRellenoRevisiones } = await import("./worker.ts");

  const r: ResultadoDiario = { lanzadas: [], alDia: 0, ocupadas: [], vacias: [] };
  const zona = ZONA_HORARIA_POR_DEFECTO;

  for (const empresaId of await listTenantsWithConnectors(knownTelematicsConnectorKeys())) {
    try {
      const fila = await getSyncState(empresaId, ENTIDAD_DIARIO);
      const ultimoMs = fila?.last_sync_ms != null ? Number(fila.last_sync_ms) : null;
      if (!tocaHoy(ultimoMs, ahora, zona)) {
        r.alDia += 1;
        ultimaVuelta.set(empresaId, { ms: ahora.getTime(), resultado: "al_dia" });
        continue;
      }

      // Un relleno en marcha —el del histórico, lanzado a mano— usa el mismo
      // cupo del proveedor. No se le pisa: se vuelve a mirar en 15 minutos.
      const viva = estadoRellenoRevisiones(empresaId);
      if (viva && viva.estado === "en_curso") {
        r.ocupadas.push(empresaId);
        ultimaVuelta.set(empresaId, {
          ms: ahora.getTime(), resultado: "ocupada",
          detalle: `hay un relleno ${viva.origen === "diario" ? "diario" : "del histórico"} en marcha (${viva.escritas} escritas de ${viva.totalAlEmpezar}); se vuelve a mirar en 15 min`,
        });
        continue;
      }

      const { desde, hasta } = ventanaDiaria(ahora, zona);
      const tarea = await iniciarRellenoRevisiones({ empresaId, desde, hasta, origen: "diario" });
      const vacia = tarea.estado === "terminada" && tarea.totalAlEmpezar === 0;
      (vacia ? r.vacias : r.lanzadas).push(empresaId);
      ultimaVuelta.set(empresaId, {
        ms: ahora.getTime(), resultado: vacia ? "sin_pendientes" : "lanzado",
        detalle: `${desde} a ${hasta}: ${tarea.totalAlEmpezar} revisión(es) sin km`,
      });

      await upsertSyncState({
        tenantId: empresaId,
        entity: ENTIDAD_DIARIO,
        lastSyncMs: ahora.getTime(),
        status: vacia ? "sin_pendientes" : "lanzado",
        detail: JSON.stringify({ desde, hasta, pendientes: tarea.totalAlEmpezar }),
      });
    } catch (e: any) {
      // Una empresa que falla no deja sin relleno a las demás. Y sin guardar
      // el lanzamiento, se reintenta en la siguiente vuelta.
      console.error("[km-revisiones-diario]", empresaId, e?.message ?? e);
      ultimaVuelta.set(empresaId, { ms: ahora.getTime(), resultado: "error", detalle: String(e?.message ?? e) });
    }
  }
  return r;
}

let temporizador: ReturnType<typeof setInterval> | null = null;

export function startRellenoDiario(): void {
  if (temporizador) return;
  const vuelta = () => {
    void tickRellenoDiario()
      .then((r) => {
        if (r.lanzadas.length) console.log(`[km-revisiones-diario] lanzado en ${r.lanzadas.length} empresa(s)`);
        if (r.ocupadas.length) console.log(`[km-revisiones-diario] ${r.ocupadas.length} con otro relleno en marcha; se espera`);
      })
      .catch((e) => console.error("[km-revisiones-diario]", (e as any)?.message ?? e));
  };
  // A los tres minutos del arranque: después de que `startRellenoRevisiones`
  // haya reanudado lo que un despliegue dejó a medias (a los dos).
  setTimeout(vuelta, 3 * 60 * 1000);
  temporizador = setInterval(vuelta, LATIDO_MS);
}

export function stopRellenoDiario(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}

/** Solo para las pruebas. */
export function olvidarVueltasDiario(): void {
  ultimaVuelta.clear();
}
