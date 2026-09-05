/**
 * Qué hace Satisfaction cuando una asistencia termina.
 *
 * Vive aquí y no en `cierre/finalizacion.ts` a propósito: ese fichero coordina
 * los enganches y no tiene por qué saber qué es una encuesta. Aquí solo entra
 * un id de asistencia y sale una decisión ya tomada.
 *
 * ── Crea, no envía ──────────────────────────────────────────────────────────
 *
 * Deja la encuesta en `CREATED`, con su hora de envío y su caducidad ya
 * calculadas y guardadas. Quien la mande es el worker, después. Separarlo es
 * lo que permite que el técnico cierre la asistencia sin esperar a nadie, y lo
 * que hace que un WhatsApp caído no impida que la encuesta exista.
 *
 * Y **no emite el token**. Eso ocurre justo antes del envío, en 1G: en la base
 * solo queda el hash, así que el valor en claro hay que usarlo en el momento o
 * se pierde.
 */

import {
  evaluarElegibilidad, type Elegibilidad, type MotivoBloqueo,
} from "./elegibilidad.ts";
import { crearSurveyInstance } from "./servicio.ts";
import type { RolDestinatario, Sistema } from "./dominio.ts";

export type ResultadoRol =
  | { rol: RolDestinatario; estado: "created"; instanceId: number }
  | { rol: RolDestinatario; estado: "already_exists"; instanceId: number }
  | { rol: RolDestinatario; estado: "skipped"; motivo: MotivoBloqueo | "error" };

export type ResultadoSatisfaction = {
  assistanceId: number;
  procesada: boolean;
  resultados: ResultadoRol[];
  motivos: MotivoBloqueo[];
};

/**
 * Enmascara un teléfono para el log: `600******3`.
 *
 * Un número completo en el log es un dato personal en un fichero que se lee, se
 * copia y se manda por correo cuando algo va mal. Con los tres primeros y el
 * último se puede reconocer cuál es sin que el log lo reparta.
 */
export function enmascarar(normalizado: string | null | undefined): string {
  const s = String(normalizado ?? "");
  if (s.length < 5) return "***";
  return `${s.slice(0, 3)}${"*".repeat(s.length - 4)}${s.slice(-1)}`;
}

/**
 * Evalúa y crea lo que proceda. No lanza nunca.
 *
 * Es idempotente porque `crearSurveyInstance` lo es: la garantía está en el
 * índice único de la base, no en haber comprobado antes.
 */
export async function procesarSatisfactionTrasFinalizacion(p: {
  assistanceId: number;
  tenantId?: string | number | null;
  sourceSystem?: Sistema;
  ahoraMs?: number;
}): Promise<ResultadoSatisfaction> {
  const ahora = p.ahoraMs ?? Date.now();
  const vacio: ResultadoSatisfaction = {
    assistanceId: p.assistanceId, procesada: false, resultados: [], motivos: [],
  };

  let decision: Elegibilidad;
  try {
    decision = await evaluarElegibilidad({
      assistanceId: p.assistanceId, tenantId: p.tenantId, sourceSystem: p.sourceSystem,
    });
  } catch (e: unknown) {
    console.error(`[Satisfaction] asistencia ${p.assistanceId}: no se pudo evaluar:`,
      e instanceof Error ? e.message : e);
    return vacio;
  }

  /*
   * El conflicto de destinatario se registra ALTO y con nombre propio. Es la
   * política provisional —no se manda nada cuando conductor y cliente son el
   * mismo número— y la única forma de saber cuántas veces pasa de verdad, que
   * es lo que hace falta para decidir la definitiva.
   */
  if (decision.sameRecipient) {
    console.warn(
      `[Satisfaction] asistencia ${p.assistanceId}: same_recipient_conflict ` +
      `(${enmascarar(decision.driverRecipient.hay ? decision.driverRecipient.normalizado : null)}) ` +
      "— no se crea ninguna encuesta",
    );
  }

  const resultados: ResultadoRol[] = [];
  const aCrear: { rol: RolDestinatario; elegible: boolean; motivo: MotivoBloqueo }[] = [
    { rol: "DRIVER", elegible: decision.eligibleDriver,
      motivo: motivoDe(decision, "DRIVER") },
    { rol: "CUSTOMER", elegible: decision.eligibleCustomer,
      motivo: motivoDe(decision, "CUSTOMER") },
  ];

  for (const { rol, elegible, motivo } of aCrear) {
    if (!elegible) {
      resultados.push({ rol, estado: "skipped", motivo });
      continue;
    }
    try {
      const r = await crearSurveyInstance({
        ambito: {
          sourceSystem: decision.sourceSystem,
          tenantId: decision.tenantId,
          assistanceId: String(p.assistanceId),
        },
        recipientRole: rol,
        caducidadMs: decision.effectiveConfig.caducidadHoras * 3_600_000,
        retrasoMs: decision.effectiveConfig.retrasoMinutos * 60_000,
        ahoraMs: ahora,
      });
      resultados.push({ rol, estado: r.estado, instanceId: r.instancia.id });
      if (r.estado === "created") {
        console.log(`[Satisfaction] asistencia ${p.assistanceId}: encuesta ${rol} creada ` +
          `(#${r.instancia.id}, envío a partir de ${new Date(r.instancia.sendAfterMs).toISOString()})`);
      }
    } catch (e: unknown) {
      console.error(`[Satisfaction] asistencia ${p.assistanceId}: no se pudo crear ${rol}:`,
        e instanceof Error ? e.message : e);
      resultados.push({ rol, estado: "skipped", motivo: "error" });
    }
  }

  const creadas = resultados.filter((r) => r.estado === "created").length;
  if (creadas === 0 && !decision.sameRecipient && decision.blockingReasons.length) {
    // Una línea por asistencia que no genera nada, con el motivo. Sin esto,
    // «no llega ninguna encuesta» es indistinguible de «no funciona».
    console.log(`[Satisfaction] asistencia ${p.assistanceId}: sin encuestas ` +
      `(${decision.blockingReasons.join(", ")})`);
  }

  return {
    assistanceId: p.assistanceId,
    procesada: true,
    resultados,
    motivos: decision.blockingReasons,
  };
}

/** El motivo concreto por el que un rol no sale, para poder contarlo. */
function motivoDe(d: Elegibilidad, rol: RolDestinatario): MotivoBloqueo {
  if (d.blockingReasons.includes("assistance_not_found")) return "assistance_not_found";
  if (d.blockingReasons.includes("not_finished")) return "not_finished";
  if (d.blockingReasons.includes("satisfaction_disabled")) return "satisfaction_disabled";
  if (d.sameRecipient) return "same_recipient_conflict";
  if (rol === "DRIVER") {
    return d.blockingReasons.includes("driver_survey_disabled")
      ? "driver_survey_disabled" : "driver_missing_recipient";
  }
  return d.blockingReasons.includes("customer_survey_disabled")
    ? "customer_survey_disabled" : "customer_missing_recipient";
}
