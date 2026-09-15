/**
 * El trabajo diario: la prioridad envejece y lo resuelto se cierra solo.
 *
 * Dos cosas que pasan por el simple paso del tiempo y que nadie va a hacer a
 * mano: un expediente abierto vale más puntos cada día que pasa, y uno
 * resuelto hace treinta días sin que nadie haya vuelto a tocarlo está cerrado
 * aunque su estado diga otra cosa.
 *
 * Mismo molde que el worker de análisis: una función por pasada que se puede
 * llamar a mano, y un temporizador que la repite cada hora. Cada hora y no
 * cada día porque el servidor se reinicia cuando quiere Render, y un
 * temporizador diario que arranca a las 15:00 hace su primera pasada mañana a
 * las 15:00. La pasada es barata —sólo mira lo que no se recalculó HOY—, así
 * que repetirla cada hora no cuesta nada y garantiza que algún día se haga.
 *
 * ── El autocierre respeta al que espera ─────────────────────────────────────
 *
 * Un RESUELTO con una decisión pendiente no se cierra. Es el caso 24: llega
 * una reclamación sobre algo resuelto, el sistema pregunta en vez de reabrir
 * solo, y mientras nadie conteste el expediente tiene una pregunta abierta.
 * Cerrarlo por antigüedad sería enterrar la pregunta con él.
 *
 * Y se puede reabrir, como cualquier CERRADO: equivocarse por poco no cuesta.
 */

import { leerConfig } from "./config.ts";
import * as repo from "./repository.ts";
import { cambiosDePrioridad } from "./service.ts";

const CADA_MS = 60 * 60_000;

export type PasadaDiaria = {
  empresas: number;
  recalculados: number;
  prioridadesCambiadas: number;
  cerrados: number;
};

/** Recalcula la prioridad de lo que no se recalculó hoy. Devuelve cuántos cambiaron. */
export async function recalcularPrioridades(
  empresaId: string,
  ahora = new Date()
): Promise<{ recalculados: number; cambiados: number }> {
  const cfg = await leerConfig(empresaId);
  const pendientes = await repo.expedientesSinRecalcularHoy(empresaId);
  let cambiados = 0;

  for (const e of pendientes) {
    const cambios = cambiosDePrioridad(e, cfg, ahora);
    if (!cambios) continue;
    await repo.enTransaccion(async (c) => {
      await repo.actualizarExpediente(empresaId, e.id, cambios, c);
      await repo.anotarEvento(
        empresaId,
        {
          expedienteId: e.id,
          tipo: "PRIORIDAD_MODIFICADA",
          actorTipo: "sistema",
          datosAnteriores: { prioridad: e.prioridad, score: e.prioridadScore },
          datosNuevos: { prioridad: cambios.prioridad, score: cambios.prioridad_score },
          descripcion: `Prioridad ${cambios.prioridad} (${cambios.prioridad_score} puntos) por antigüedad.`,
        },
        c
      );
    });
    cambiados++;
  }

  // Se marcan TODOS los mirados, cambiaran o no: la marca dice «ya se miró
  // hoy», no «hoy cambió».
  await repo.marcarRecalculadoHoy(
    empresaId,
    pendientes.map((e) => e.id)
  );
  return { recalculados: pendientes.length, cambiados };
}

/** Cierra lo resuelto hace más de `expediente.dias_autocierre` días. */
export async function autocerrar(empresaId: string): Promise<number> {
  const cfg = await leerConfig(empresaId);
  const candidatos = await repo.resueltosParaCerrar(empresaId, cfg.diasAutocierre);
  let cerrados = 0;

  for (const e of candidatos) {
    await repo.enTransaccion(async (c) => {
      // Bloqueado y releído: entre la lista y aquí alguien puede haberlo
      // reabierto, y un reabierto no se cierra por antigüedad.
      const actual = await repo.obtenerExpedienteBloqueado(empresaId, e.id, c);
      if (!actual || actual.estado !== "RESUELTO") return;

      await repo.actualizarExpediente(empresaId, e.id, { estado: "CERRADO", fecha_cierre: new Date().toISOString() }, c);
      await repo.anotarEvento(
        empresaId,
        {
          expedienteId: e.id,
          tipo: "EXPEDIENTE_CERRADO",
          actorTipo: "sistema",
          datosAnteriores: { estado: "RESUELTO" },
          datosNuevos: { estado: "CERRADO", motivo: "antigüedad" },
          descripcion: `Cerrado por antigüedad: ${cfg.diasAutocierre} días resuelto sin novedad.`,
        },
        c
      );
      cerrados++;
    });
  }
  return cerrados;
}

/** Una pasada por todas las empresas con trabajo. Nunca lanza. */
export async function procesarDiario(ahora = new Date()): Promise<PasadaDiaria> {
  const salida: PasadaDiaria = { empresas: 0, recalculados: 0, prioridadesCambiadas: 0, cerrados: 0 };
  let empresas: string[] = [];
  try {
    empresas = await repo.empresasConTrabajoDiario();
  } catch (e) {
    console.error("[Therefore] trabajo diario: no se han podido listar las empresas:", (e as Error).message);
    return salida;
  }
  for (const empresaId of empresas) {
    salida.empresas++;
    try {
      const r = await recalcularPrioridades(empresaId, ahora);
      salida.recalculados += r.recalculados;
      salida.prioridadesCambiadas += r.cambiados;
      salida.cerrados += await autocerrar(empresaId);
    } catch (e) {
      // Una empresa que falla no para a las demás.
      console.error(`[Therefore] trabajo diario de ${empresaId}:`, (e as Error).message);
    }
  }
  return salida;
}

let temporizador: ReturnType<typeof setInterval> | null = null;
let enCurso = false;

async function vuelta(): Promise<void> {
  if (enCurso) return;
  enCurso = true;
  try {
    const r = await procesarDiario();
    if (r.prioridadesCambiadas || r.cerrados) {
      console.log(
        `Therefore trabajo diario: ${r.prioridadesCambiadas} prioridad(es) cambiada(s), ${r.cerrados} cerrado(s) por antigüedad`
      );
    }
  } finally {
    enCurso = false;
  }
}

export function startThereforeDiario(): void {
  if (temporizador) return;
  // Una primera pasada al arrancar, para que un servidor que estuvo apagado
  // se ponga al día sin esperar una hora.
  void vuelta();
  temporizador = setInterval(() => void vuelta(), CADA_MS);
  temporizador.unref?.();
}

export function stopThereforeDiario(): void {
  if (!temporizador) return;
  clearInterval(temporizador);
  temporizador = null;
}
