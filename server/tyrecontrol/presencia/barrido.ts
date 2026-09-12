/**
 * El barrido de presencia en bases, desde TyreControl.
 *
 * Junta las piezas: los adaptadores de Supabase (`bases.ts`), el servicio del
 * Integration Hub que decide (`BasePresenceService`) y el haversine que ya
 * existe. Aquí no hay lógica de negocio; si algo de esto hay que razonarlo,
 * se razona en el dominio, que es puro y se puede probar.
 *
 * ── Esto NUNCA lanza ────────────────────────────────────────────────────────
 *
 * Por lo mismo que `kilometrajeRevision.ts`: lo va a llamar una pantalla y un
 * temporizador, y que una pantalla de revisiones se caiga porque el proveedor
 * de telemática conteste un 502 sería cambiar un dato que falta por un panel
 * que no abre. Devuelve el resultado o el motivo, nunca una excepción.
 */

import { haversineMeters } from "../../connect/liteRules.ts";
import { leerBases, leerFlota, guardarPresencia } from "./bases.ts";

/*
 * El Hub se importa DENTRO de la función, igual que en `kilometrajeRevision.ts`
 * y por la misma razón: `BasePresenceService` arrastra `repositories.ts` →
 * `db.ts`, y `db.ts` LANZA al importarse si no hay `DATABASE_URL`. Con un
 * import estático, cualquier módulo de TyreControl que tocara este fichero
 * dejaría de poder cargarse sin la base del Hub.
 */
type ServicioPresencia = typeof import("../../integration-hub/application/services/BasePresenceService.ts");

/** Lo que devuelve un barrido, ya en términos de TyreControl. */
export interface ResultadoPresencia {
  ok: boolean;
  /** `completo`, `incompleto`, `sin_bases`, `sin_cuentas` o `error`. */
  estado: string;
  /** Explicación para quien lo lea. Siempre hay una. */
  nota: string;
  /** Cuántos vehículos en cada estado. */
  porEstado?: Record<string, number>;
  /** Cuentas consultadas y qué dio cada una. */
  cuentas?: Array<{
    proveedor: string;
    cuenta: string;
    nombre: string | null;
    ok: boolean;
    posiciones: number;
    enlazados: number;
    error?: string;
  }>;
  /** Vehículos no tocados porque su cuenta falló (conservan lo último sabido). */
  omitidos?: number;
  vehiculos?: number;
}

/**
 * Barre la flota de una empresa y guarda el resultado.
 *
 * `guardar: false` calcula sin escribir, para poder previsualizar sin dejar
 * rastro —el mismo gesto que la previsualización de la conciliación—.
 */
export async function barrerBases(
  empresaId: string,
  opciones: { connectorKey?: string; accountKey?: string; guardar?: boolean } = {},
): Promise<ResultadoPresencia> {
  try {
    const servicio: ServicioPresencia = await import(
      "../../integration-hub/application/services/BasePresenceService.ts"
    );
    const { nextCorrelationId } = await import(
      "../../integration-hub/infrastructure/repositories.ts"
    );

    const r = await servicio.barrerPresenciaBases(
      { tenantId: empresaId, correlationId: await nextCorrelationId() },
      {
        leerBases,
        leerFlota,
        guardar: opciones.guardar === false ? undefined : guardarPresencia,
        distanciaMetros: haversineMeters,
        connectorKey: opciones.connectorKey,
        accountKey: opciones.accountKey,
      },
    );

    const cuentas = r.cuentas.map((c) => ({
      proveedor: c.connectorKey,
      cuenta: c.accountKey,
      nombre: c.nombre,
      ok: c.ok,
      posiciones: c.posiciones,
      enlazados: c.enlazados,
      error: c.error,
    }));

    if (r.estado === "sin_bases") {
      return {
        ok: false,
        estado: r.estado,
        nota:
          "Esta empresa no tiene ninguna base con posición configurada. " +
          "Sin geo-zona no se puede decir quién está dentro: hay que poner el " +
          "centro y el radio en la delegación.",
      };
    }
    if (r.estado === "sin_cuentas") {
      return {
        ok: false,
        estado: r.estado,
        nota: "Esta empresa no tiene ninguna cuenta de telemática habilitada.",
      };
    }

    const fallidas = cuentas.filter((c) => !c.ok);
    return {
      ok: true,
      estado: r.estado,
      nota:
        fallidas.length === 0
          ? `${r.filas.length} vehículos barridos, ${r.porEstado.IN_BASE} en base.`
          : `Barrido incompleto: ${fallidas.map((c) => `${c.proveedor}/${c.cuenta}`).join(", ")} no contestó. ` +
            `${r.omitidos} vehículos conservan su último estado conocido.`,
      porEstado: r.porEstado,
      cuentas,
      omitidos: r.omitidos,
      vehiculos: r.filas.length,
    };
  } catch (e: any) {
    return {
      ok: false,
      estado: "error",
      nota: `No se pudo barrer la presencia en bases: ${e?.message ?? "error desconocido"}`,
    };
  }
}
