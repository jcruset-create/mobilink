/**
 * Job diario de kilómetros mensuales.
 *
 * Una vez al día, de madrugada, por cada cliente con telemática: el mes en
 * curso, el anterior si aún no está cerrado, y el histórico que falte. Lo hace
 * `MonthlyMileageSyncService`; aquí solo se decide CUÁNDO.
 *
 * ── Por qué la cadencia no es un `setInterval` de 24 h ──────────────────────
 *
 * Render reinicia el proceso a menudo, y un intervalo largo desde el arranque
 * se reinicia con él: podría no disparar nunca, o disparar a mediodía. La
 * marca de la última pasada se guarda en `integration_sync_state` y el bucle
 * solo se despierta cada hora a mirar el reloj: ¿han pasado 20 h y estamos en
 * la ventana de madrugada? Entonces toca. Si no, a dormir sin tocar nada.
 *
 * El primer día no espera a la madrugada: una flota recién enlazada tiene que
 * ver algo en la ficha ese mismo día, no al siguiente.
 */

import { getSyncState, listTenantsWithConnectors, upsertSyncState } from "../infrastructure/repositories.ts";
import { knownTelematicsConnectorKeys } from "../connectors/ConnectorRegistry.ts";
import { syncMonthlyMileage, type ResumenSyncMensual } from "../application/services/MonthlyMileageSyncService.ts";
import { ZONA_HORARIA_POR_DEFECTO } from "../domain/meses.ts";

/** Marca por cliente de «cuándo se hizo la última pasada diaria». */
export const ENTIDAD_JOB = "vehicle_monthly_mileage:job";
/** Cada cuánto se mira el reloj. */
const LATIDO_MS = 60 * 60 * 1000;
/** Mínimo entre dos pasadas del mismo cliente. */
const MINIMO_ENTRE_PASADAS_MS = 20 * 60 * 60 * 1000;
/** Ventana de madrugada, hora local: [inicio, fin). */
const HORA_INICIO = Number(process.env.IH_KM_MENSUAL_HORA_INICIO ?? 2);
const HORA_FIN = Number(process.env.IH_KM_MENSUAL_HORA_FIN ?? 6);

function horaLocal(ahora: Date, zona: string): number {
  const h = new Intl.DateTimeFormat("en-US", { timeZone: zona, hour: "2-digit", hourCycle: "h23" })
    .formatToParts(ahora).find((p) => p.type === "hour")?.value;
  return Number(h ?? 0) % 24;
}

/**
 * ¿Le toca a este cliente ahora?
 *
 * Nunca se ha pasado → sí, ya. Se pasó hace menos de 20 h → no. Si no, solo
 * dentro de la ventana de madrugada. Exportada para probarla sin reloj real.
 */
export function tocaAhora(ultimaMs: number | null, ahora: Date, zona = ZONA_HORARIA_POR_DEFECTO): boolean {
  if (ultimaMs == null) return true;
  if (ahora.getTime() - ultimaMs < MINIMO_ENTRE_PASADAS_MS) return false;
  const h = horaLocal(ahora, zona);
  return h >= HORA_INICIO && h < HORA_FIN;
}

/** Una vuelta: los clientes a los que les toca. Devuelve lo hecho, para el log. */
export async function tickMonthlyMileage(ahora = new Date()): Promise<{ pasados: string[]; omitidos: number }> {
  const tenants = await listTenantsWithConnectors(knownTelematicsConnectorKeys());
  const pasados: string[] = [];
  let omitidos = 0;

  // En serie: cada cliente ya va al ritmo de su limitador, y dos a la vez solo
  // se estorban en nuestra base.
  for (const tenantId of tenants) {
    const marca = await getSyncState(tenantId, ENTIDAD_JOB);
    if (!tocaAhora(marca?.last_sync_ms == null ? null : Number(marca.last_sync_ms), ahora)) {
      omitidos += 1;
      continue;
    }
    try {
      const r = await syncMonthlyMileage({ tenantId, ahora });
      await upsertSyncState({
        tenantId, entity: ENTIDAD_JOB, lastSyncMs: ahora.getTime(),
        status: r.cuentas.some((c) => c.abandonada) ? "error" : "ok",
        detail: resumen(r),
      });
      pasados.push(tenantId);
      console.log(`[km-mensual] ${tenantId}: ${resumen(r)}`);
    } catch (e: any) {
      // Un cliente que falla no deja sin pasada a los siguientes, y su marca
      // NO se mueve: a la hora siguiente se vuelve a intentar.
      console.error(`[km-mensual] ${tenantId}:`, e?.message ?? e);
    }
  }
  return { pasados, omitidos };
}

function resumen(r: ResumenSyncMensual): string {
  return r.cuentas
    .map((c) =>
      `${c.connectorKey}/${c.accountKey}: ${c.vehiculosProcesados}/${c.vehiculosEnlazados} vehículos, ` +
      `${c.peticiones} peticiones, ${c.errores} errores, ${Math.round(c.kmTotales)} km` +
      (c.abandonada ? ` · ABANDONADA: ${c.abandonada}` : ""))
    .join(" | ") || "sin cuentas";
}

let temporizador: ReturnType<typeof setInterval> | null = null;

export function startMonthlyMileageWorker(): void {
  if (temporizador) return;
  const vuelta = () => {
    void tickMonthlyMileage()
      .then(({ pasados, omitidos }) => {
        if (pasados.length === 0 && omitidos > 0) console.log(`[km-mensual] nada que hacer (${omitidos} al día)`);
      })
      .catch((e) => console.error("[km-mensual]", e?.message ?? e));
  };
  // A los diez minutos del arranque, para no competir con el boot ni con el
  // repaso quincenal de la conciliación, que sale a los cinco.
  setTimeout(vuelta, 10 * 60 * 1000);
  temporizador = setInterval(vuelta, LATIDO_MS);
  console.log(`Mobilink Integration Hub: km mensuales cada día entre las ${HORA_INICIO}:00 y las ${HORA_FIN}:00`);
}

export function stopMonthlyMileageWorker(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
