/**
 * La foto diaria de los contadores del aparato.
 *
 * Cada madrugada, una lectura por vehículo: horas de motor, gasóleo
 * consumido, odómetro y peso por eje. Se guarda en `tc_lecturas_aparato` y de
 * la resta de dos fotos salen el consumo del día y el del mes. El porqué de
 * guardar, y las cotas de las restas, en `calculo.ts`.
 *
 * ── El reloj ────────────────────────────────────────────────────────────────
 *
 * El mismo patrón que `kilometrajeRevisiones/diario.ts`, y por la misma razón:
 * un `setInterval` de 24 h en un servidor que se despliega tres veces al día
 * no dispara nunca. Así que late cada cuarto de hora, mira si ya se hizo HOY
 * en fecha local y, si no, lo hace. Un reinicio a las once de la mañana
 * recupera la foto que no se tomó a las cuatro.
 *
 * A las 04:00: una hora después del relleno de kilómetros de las revisiones,
 * para no disputarle el cupo del proveedor. Y de madrugada porque la foto de
 * un contador acumulado da igual a qué hora se tome, con tal de que sea
 * SIEMPRE LA MISMA: lo que se resta son dos fotos, y si una es de las 04:00 y
 * la otra de las 18:00, el «día» mide 38 horas.
 *
 * ── Las tandas ──────────────────────────────────────────────────────────────
 *
 * La bandera `sensors` con los 751 vehículos de la cuenta real da 502. Se va
 * por tandas y, si una falla, se parte por la mitad hasta dar con el vehículo
 * que la rompe en vez de perder la tanda entera. Es lo mismo que ya se hace
 * con los meses en `partesDelMes.ts`, y nace del mismo tipo de avería.
 */

import { ZONA_HORARIA_POR_DEFECTO } from "../../integration-hub/domain/meses.ts";
import { enTandas, mitades } from "./calculo.ts";

/** Hora local a la que se toma la foto. Ver la cabecera. */
export const HORA_LOCAL = 4;
/** Cada cuánto se mira si toca. No es la frecuencia de la foto: es la del reloj. */
export const LATIDO_MS = 15 * 60 * 1000;
/** Vehículos por petición. Sobrio a propósito: 751 de golpe dan 502. */
export const TANDA = 25;
/** La entrada en `integration_sync_state`. */
export const ENTIDAD = "lecturas_aparato_diario";
/** Cuánto se espera por el cupo del proveedor antes de dejarlo para mañana. */
const ESPERA_CUPO_MS = 60_000;

/** Año, mes y día de un instante en una zona, como `YYYY-MM-DD`. */
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

/**
 * ¿Toca la foto de hoy?
 *
 * Sí cuando ya es la hora y hoy todavía no se ha hecho. «Hoy» en fecha local
 * y no en milisegundos: un servidor que arranca a las once de la mañana hace
 * la de ese día, y uno que ya la hizo no la repite por la noche.
 */
export function tocaHoy(ultimoMs: number | null, ahora: Date, zona = ZONA_HORARIA_POR_DEFECTO): boolean {
  if (horaLocal(ahora, zona) < HORA_LOCAL) return false;
  if (ultimoMs == null) return true;
  return fechaLocal(new Date(ultimoMs), zona) !== fechaLocal(ahora, zona);
}

export interface ResultadoFoto {
  /** Empresas a las que se ha hecho la foto hoy. */
  hechas: string[];
  /** Ya hecha hoy, o todavía no es la hora. */
  alDia: number;
  /** Vehículos guardados en esta vuelta. */
  guardados: number;
  /** Vehículos cuyo aparato no da ninguno de estos contadores. */
  sinContadores: number;
  /** Vehículos que no se pudieron leer ni estando solos en su tanda. */
  fallidos: string[];
}

interface Lector {
  leerSensoresDeVarios(
    ctx: { tenantId: string; correlationId: string },
    ids: string[],
  ): Promise<{ peticion: unknown; filas: Record<string, unknown>[] }>;
}

function sabeLeerSensores(c: unknown): c is Lector {
  return typeof (c as Lector | null)?.leerSensoresDeVarios === "function";
}

/**
 * Las filas que ha devuelto una tanda, por identificador de vehículo.
 *
 * Movertis devuelve `idVehicle` numérico; los enlaces lo guardan como texto.
 * Se compara en texto para que un 26134116 no deje de encontrarse por ser
 * número aquí y cadena allá, que ya pasó con los ids de las unidades.
 */
export function porVehiculo(filas: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const m = new Map<string, Record<string, unknown>>();
  for (const f of filas) {
    const id = f.idVehicle == null ? "" : String(f.idVehicle);
    if (id) m.set(id, f);
  }
  return m;
}

/**
 * Una vuelta del reloj: la foto de hoy a quien le toque.
 *
 * Una empresa que falla no deja sin foto a las demás, y sin guardar el
 * lanzamiento se reintenta en la vuelta siguiente.
 */
export async function tickLecturasAparato(ahora = new Date()): Promise<ResultadoFoto> {
  const { listTenantsWithConnectors, getSyncState, upsertSyncState, listVehicleMappings, nextCorrelationId } =
    await import("../../integration-hub/infrastructure/repositories.ts");
  const { knownTelematicsConnectorKeys, resolveTelematicsConnectors } =
    await import("../../integration-hub/connectors/ConnectorRegistry.ts");
  const { limitadorDe, ritmoDeConfig, ErrorRitmo } = await import("../../integration-hub/infrastructure/ritmo.ts");
  const { sensoresDe } = await import("../movertisSensores.ts");
  const { lecturaDeAparato, hayAlgoQueEnsenar } = await import("../lecturaAparato.ts");
  const { supabase } = await import("../../supabase.ts");

  const r: ResultadoFoto = { hechas: [], alDia: 0, guardados: 0, sinContadores: 0, fallidos: [] };
  const zona = ZONA_HORARIA_POR_DEFECTO;
  const fecha = fechaLocal(ahora, zona);

  for (const empresaId of await listTenantsWithConnectors(knownTelematicsConnectorKeys())) {
    try {
      const estado = await getSyncState(empresaId, ENTIDAD);
      const ultimoMs = estado?.last_sync_ms != null ? Number(estado.last_sync_ms) : null;
      if (!tocaHoy(ultimoMs, ahora, zona)) { r.alDia += 1; continue; }

      let guardados = 0;
      let sinContadores = 0;
      const fallidos: string[] = [];

      for (const cuenta of await resolveTelematicsConnectors(empresaId)) {
        const conector = cuenta.connector;
        if (!sabeLeerSensores(conector)) continue;

        const enlaces = (await listVehicleMappings({
          tenantId: empresaId, system: cuenta.key, accountKey: cuenta.accountKey,
        })).filter((e: { active?: boolean }) => e.active !== false);
        if (!enlaces.length) continue;

        const deUnidad = new Map<string, string>(
          enlaces.map((e: { external_code: unknown; mobilink_id: string }) => [String(e.external_code), e.mobilink_id]),
        );
        const limitador = limitadorDe(`${empresaId}/${cuenta.key}/${cuenta.accountKey}`, ritmoDeConfig(cuenta.config));

        /** Pide una tanda; si falla, la parte por la mitad hasta dar con el malo. */
        const pedir = async (ids: string[]): Promise<void> => {
          if (!ids.length) return;
          let filas: Record<string, unknown>[];
          try {
            await limitador.turno(ESPERA_CUPO_MS);
            const ctx = { tenantId: empresaId, correlationId: await nextCorrelationId() };
            ({ filas } = await conector.leerSensoresDeVarios(ctx, ids));
          } catch (e) {
            if (e instanceof ErrorRitmo) throw e; // sin cupo: se deja para mañana
            const partes = mitades(ids);
            if (!partes) { fallidos.push(ids[0]); return; }
            await pedir(partes[0]);
            await pedir(partes[1]);
            return;
          }

          const porId = porVehiculo(filas);
          for (const unidad of ids) {
            const fila = porId.get(unidad);
            const vehiculoId = deUnidad.get(unidad);
            if (!fila || !vehiculoId) { fallidos.push(unidad); continue; }

            const lectura = lecturaDeAparato(sensoresDe(fila));
            if (!hayAlgoQueEnsenar(lectura)) { sinContadores += 1; continue; }

            // Una fila por vehículo y día: si hoy se lee dos veces, vale la
            // última. Dos fotos del mismo día partirían el tramo en dos.
            const { error } = await supabase.from("tc_lecturas_aparato").upsert({
              vehiculo_id: vehiculoId,
              empresa_id: empresaId,
              fecha,
              leido_en: new Date().toISOString(),
              horas_motor: lectura.horasMotor,
              consumido_l: lectura.consumidoL,
              odometro_km: lectura.odometroKm,
              peso_total_kg: lectura.pesoTotalKg,
              ejes: lectura.ejes,
              lectura,
            }, { onConflict: "vehiculo_id,fecha" });
            // Un fallo al escribir no es «este vehículo no se pudo leer»: es
            // que la base no está lista (¿migración sin pasar?). Se corta la
            // empresa y se reintenta en la vuelta siguiente, con el motivo en
            // el log una vez y no 751 veces.
            if (error) throw new Error(`No se ha podido guardar la lectura: ${error.message}`);
            guardados += 1;
          }
        };

        for (const tanda of enTandas([...deUnidad.keys()], TANDA)) await pedir(tanda);
      }

      r.hechas.push(empresaId);
      r.guardados += guardados;
      r.sinContadores += sinContadores;
      r.fallidos.push(...fallidos);

      await upsertSyncState({
        tenantId: empresaId,
        entity: ENTIDAD,
        lastSyncMs: ahora.getTime(),
        status: guardados > 0 ? "ok" : "sin_datos",
        detail: JSON.stringify({ fecha, guardados, sinContadores, fallidos: fallidos.length }),
      });
    } catch (e) {
      // Sin guardar el estado, la siguiente vuelta lo reintenta.
      console.error("[lecturas-aparato]", empresaId, (e as { message?: string })?.message ?? e);
    }
  }
  return r;
}

let temporizador: ReturnType<typeof setInterval> | null = null;

export function startLecturasAparato(): void {
  if (temporizador) return;
  const vuelta = () => {
    void tickLecturasAparato()
      .then((r) => {
        if (r.hechas.length) {
          console.log(`[lecturas-aparato] ${r.guardados} vehículo(s) guardados en ${r.hechas.length} empresa(s)`
            + (r.fallidos.length ? `; ${r.fallidos.length} sin leer` : ""));
        }
      })
      .catch((e) => console.error("[lecturas-aparato]", (e as { message?: string })?.message ?? e));
  };
  // A los cuatro minutos del arranque: después de los otros dos relleno que
  // se reanudan a los dos y tres, para no arrancar todos a la vez.
  setTimeout(vuelta, 4 * 60 * 1000);
  temporizador = setInterval(vuelta, LATIDO_MS);
}

export function stopLecturasAparato(): void {
  if (temporizador) clearInterval(temporizador);
  temporizador = null;
}
