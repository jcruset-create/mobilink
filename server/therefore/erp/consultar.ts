/**
 * Consultar en el ERP el albarán de una actuación, y guardar lo que dijo.
 *
 * Es el caso de uso que junta tres cosas que viven separadas a propósito: el
 * puerto del ERP (`puerto.ts`), la comparación pura (`domain/comparar.ts`) y
 * la actuación en la base. Lo que decide es poco y está escrito aquí: cuándo
 * comparar y qué se guarda.
 *
 * ── Se guarda lo que dijo el ERP, no lo que se dedujo ───────────────────────
 *
 * `erp_estado` lleva la respuesta entera con su `consultadoAt`, y la
 * comparación va al lado, como un resultado más. Así la pantalla puede decir
 * «según el ERP a las 9:14» y, si mañana se cambia la comparación, lo que el
 * ERP contestó entonces sigue ahí.
 *
 * ── Y no se toca nada más ───────────────────────────────────────────────────
 *
 * Ni el estado de la actuación ni el del expediente. Que el ERP diga que el
 * albarán ya está grabado es información para quien decide, no una decisión:
 * puede estar grabado mal, que es justo lo que pide un MODIFICAR.
 */

import { compararConErp, type Comparacion } from "../domain/comparar.ts";
import { ErrorTherefore } from "../errors.ts";
import * as repo from "../repository.ts";
import type { Contexto } from "../service.ts";
import { consultaErpDe } from "./hub.ts";
import type { ConsultaAlbaranesErp, EstadoAlbaranErp } from "./puerto.ts";

export type ResultadoConsultaErp = {
  /** `null` = no se ha podido consultar. Distinto de `existe: false`. */
  estado: EstadoAlbaranErp | null;
  /** Sólo cuando hay líneas en los dos lados. */
  comparacion: Comparacion | null;
  fuente: string;
};

export async function consultarAlbaranEnErp(
  ctx: Contexto,
  actuacionId: string,
  opciones: { consulta?: ConsultaAlbaranesErp; ahora?: Date } = {}
): Promise<ResultadoConsultaErp> {
  const actuacion = await repo.obtenerActuacion(ctx.empresaId, actuacionId);
  if (!actuacion) throw new ErrorTherefore("NO_ENCONTRADO", "La actuación no existe.", 404);
  if (!actuacion.albaranSolicitado) {
    throw new ErrorTherefore("SIN_ALBARAN", "Esta actuación no pide ningún albarán: no hay nada que consultar.", 409);
  }
  const expediente = await repo.obtenerExpediente(ctx.empresaId, actuacion.expedienteId);
  if (!expediente) throw new ErrorTherefore("NO_ENCONTRADO", "El expediente no existe.", 404);

  const consulta = opciones.consulta ?? (await consultaErpDe(ctx.empresaId));
  if (!consulta.disponible()) {
    throw new ErrorTherefore("SIN_ERP", "No hay ningún ERP conectado para esta empresa.", 409);
  }

  const estado = await consulta.consultarAlbaran(
    { empresaId: ctx.empresaId, empresaCodigo: expediente.empresaCodigo },
    actuacion.albaranSolicitado
  );

  /*
   * La comparación sólo tiene sentido con líneas en los dos lados: las del ERP
   * y las del análisis vigente del PDF. Sin análisis, o con el ERP diciendo
   * «no consta», no hay nada que comparar y no se inventa un resultado.
   */
  let comparacion: Comparacion | null = null;
  if (estado?.lineas?.length) {
    const analisis = await repo.ultimoAnalisisDeActuacion(ctx.empresaId, actuacionId);
    if (analisis?.estadoProceso === "COMPLETADO") {
      const lineas = await repo.lineasDeAlbaran(ctx.empresaId, analisis.id);
      if (lineas.length) {
        comparacion = compararConErp(
          lineas.map((l) => ({
            referencia: l.referencia,
            descripcion: l.descripcion,
            cantidad: l.cantidad,
            importeCentimos: l.importeCentimos,
          })),
          estado.lineas
        );
      }
    }
  }

  const ahora = opciones.ahora ?? new Date();
  await repo.enTransaccion(async (c) => {
    await repo.actualizarActuacion(
      ctx.empresaId,
      actuacionId,
      {
        erp_estado: JSON.stringify({ estado, comparacion, fuente: consulta.fuente }),
        erp_consultado_at: ahora.toISOString(),
      },
      c
    );
    await repo.anotarEvento(
      ctx.empresaId,
      {
        expedienteId: actuacion.expedienteId,
        actuacionId,
        tipo: "ERP_CONSULTADO",
        actorTipo: "usuario",
        usuarioId: ctx.userId,
        usuarioNombre: ctx.userNombre ?? null,
        datosNuevos: {
          fuente: consulta.fuente,
          existe: estado?.existe ?? null,
          contabilizado: estado?.contabilizado ?? null,
          coincide: comparacion?.coincide ?? null,
        },
        descripcion:
          estado === null
            ? `No se ha podido consultar el albarán ${actuacion.albaranSolicitado} en el ERP (${consulta.fuente}).`
            : estado.existe
              ? `El ERP (${consulta.fuente}) tiene el albarán ${actuacion.albaranSolicitado}${
                  comparacion ? (comparacion.coincide ? ", y coincide con el papel." : `, con ${comparacion.resumen.difieren + comparacion.resumen.faltanEnErp + comparacion.resumen.sobranEnErp} diferencia(s) con el papel.`) : "."
                }`
              : `El albarán ${actuacion.albaranSolicitado} no consta en el ERP (${consulta.fuente}).`,
      },
      c
    );
  });

  return { estado, comparacion, fuente: consulta.fuente };
}
