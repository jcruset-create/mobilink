/**
 * Qué pasa con TyreControl cuando una asistencia se da por finalizada.
 *
 * ── Hoy: nada que TC pueda notar ────────────────────────────────────────────
 *
 * Esta función NO llama a TyreControl. Resuelve el vehículo, monta el sobre que
 * en el futuro se enviaría y lo deja anotado. Ni un RPC, ni un movimiento.
 *
 * ── Por qué no llama, aunque pudiera ────────────────────────────────────────
 *
 * Dos razones distintas, y las dos importan:
 *
 *  1. **El técnico no puede esperar a TC.** Cerrar una asistencia tiene que ser
 *     inmediato. Si el cierre dependiera de que TyreControl conteste, un corte
 *     de red dejaría al técnico mirando una rueda que no gira. Por eso el
 *     camino es cierre → outbox → worker → TC, y por eso esta función solo
 *     encola.
 *  2. **Todavía no está decidido qué significa registrar una asistencia en
 *     TC.** Una asistencia de neumáticos y un arranque con pinzas no son la
 *     misma cosa y probablemente no van al mismo sitio. Inventar ahora una
 *     operación de neumático para un cambio de batería sería meter basura en
 *     el histórico técnico de un cliente.
 *
 * Así que se construye el sobre —que es lo que permite verificar la resolución
 * con casos reales— y se para ahí.
 */

import db from "../db.ts";
import { correlacionAsistencia } from "./operaciones.ts";
import { escrituraHabilitada } from "./conector.ts";
import { resolverVehiculoDeCliente } from "./vehiculos.ts";

export type SobreCierre = {
  correlationId: string;
  assistanceId: number;
  /** FOUND | NOT_FOUND | AMBIGUOUS | MAPPING_ERROR | SIN_MATRICULA */
  resolucion: string;
  motivo?: string;
  matricula: string | null;
  clienteId: number | null;
  clienteNombre: string | null;
  tcEmpresaId: string | null;
  tcVehicleId: string | null;
  origenEmpresa: string | null;
  tecnico: string | null;
  finalizadaEnMs: number | null;
  trabajo: string | null;
  /**
   * Si el trabajo menciona neumáticos.
   *
   * Es una PISTA para el análisis, no una decisión: hoy el trabajo es texto
   * libre y de un texto no se puede deducir qué rueda se tocó. Sirve para saber
   * cuántas asistencias caerían de cada lado, no para enrutar nada.
   */
  pareceDeNeumaticos: boolean;
  /**
   * El coste que hay AHORA. Puede no ser el definitivo: los importes se cierran
   * en back-office después, así que este sobre no sirve para facturar nada.
   */
  coste: { costeFinal: number | null; costeAcordado: number | null; estadoAdmin: string | null };
  /*
   * `serviceKm` NO va en el sobre. Son los kilómetros del desplazamiento, no el
   * cuentakilómetros del vehículo, y mandarlo a TC como odómetro corrompería
   * los informes de coste por kilómetro.
   */
};

/** Palabras que sugieren que la asistencia tocó ruedas. Solo para contar. */
const PISTAS_NEUMATICO = /neum[aá]tic|rueda|pinchaz|ll?anta|pincha|reventon|revent[oó]n|vulcaniz|parche/i;

/**
 * Prepara —sin enviar— lo que TyreControl recibiría de esta asistencia.
 *
 * Nunca lanza: un problema con TC no puede impedir que una asistencia se cierre.
 * Devuelve `null` cuando no hay nada que preparar.
 */
export async function alFinalizarAsistenciaParaTyreControl(
  assistanceId: number,
): Promise<SobreCierre | null> {
  try {
    const r = await db.query(
      `SELECT a.id, a.plate, a."clienteFacturacionId", a."assignedTechName", a."finishedAtMs",
              a."tallerId", a."trabajosARealizar", a."descripcionAveria",
              a."costeFinal", a."costeAcordado", a."estadoAdmin",
              c.name AS "clienteNombre"
         FROM roadside_assistances a
         LEFT JOIN connect_clients c ON c.id = a."clienteFacturacionId"
        WHERE a.id = $1`,
      [assistanceId],
    );
    const a = r.rows[0];
    if (!a) return null;

    const correlationId = correlacionAsistencia(assistanceId);
    const trabajo = [a.trabajosARealizar, a.descripcionAveria].filter(Boolean).join(". ") || null;
    const base = {
      correlationId,
      assistanceId: Number(a.id),
      matricula: a.plate || null,
      clienteId: a.clienteFacturacionId == null ? null : Number(a.clienteFacturacionId),
      clienteNombre: a.clienteNombre ?? null,
      tecnico: a.assignedTechName ?? null,
      finalizadaEnMs: a.finishedAtMs == null ? null : Number(a.finishedAtMs),
      trabajo,
      pareceDeNeumaticos: PISTAS_NEUMATICO.test(String(trabajo ?? "")),
      coste: {
        costeFinal: a.costeFinal == null ? null : Number(a.costeFinal),
        costeAcordado: a.costeAcordado == null ? null : Number(a.costeAcordado),
        estadoAdmin: a.estadoAdmin ?? null,
      },
    };

    if (!a.plate) {
      return { ...base, resolucion: "SIN_MATRICULA", tcEmpresaId: null, tcVehicleId: null, origenEmpresa: null };
    }

    const res = await resolverVehiculoDeCliente(a.plate, base.clienteId, a.tallerId ?? null);

    if (res.estado === "FOUND") {
      return {
        ...base, resolucion: "FOUND",
        tcEmpresaId: res.vehiculo.empresaId, tcVehicleId: res.vehiculo.tcVehicleId,
        origenEmpresa: res.origenEmpresa,
      };
    }
    if (res.estado === "MAPPING_ERROR") {
      return {
        ...base, resolucion: "MAPPING_ERROR", motivo: res.motivo,
        tcEmpresaId: res.tcEmpresaId, tcVehicleId: null, origenEmpresa: null,
      };
    }
    if (res.estado === "AMBIGUOUS") {
      return {
        ...base, resolucion: "AMBIGUOUS",
        motivo: `La matrícula está en ${res.candidatos.length} empresas de TyreControl`,
        tcEmpresaId: null, tcVehicleId: null, origenEmpresa: null,
      };
    }
    return { ...base, resolucion: "NOT_FOUND", tcEmpresaId: null, tcVehicleId: null, origenEmpresa: null };
  } catch (e) {
    // Nunca hacia arriba: el cierre de la asistencia manda.
    console.error(`[TyreControl] no se pudo preparar el cierre de la asistencia ${assistanceId}:`,
      (e as any)?.message);
    return null;
  }
}

/**
 * El enganche que se llama al cerrar.
 *
 * Aun con el interruptor puesto, en esta fase NO encola ninguna escritura: solo
 * anota lo que habría enviado. Es a propósito — activar el interruptor por
 * error no debe provocar escrituras de negocio que nadie ha aprobado.
 */
export async function engancheCierreTyreControl(assistanceId: number): Promise<SobreCierre | null> {
  const sobre = await alFinalizarAsistenciaParaTyreControl(assistanceId);
  if (!sobre) return null;

  const modo = escrituraHabilitada() ? "preparado" : "simulacro";
  if (sobre.resolucion === "FOUND") {
    console.log(
      `[TyreControl] ${modo}: asistencia ${assistanceId} → vehículo ${sobre.tcVehicleId} ` +
      `(empresa por ${sobre.origenEmpresa}) · ${sobre.correlationId}`,
    );
  } else {
    console.log(
      `[TyreControl] ${modo}: asistencia ${assistanceId} sin vehículo en TC (${sobre.resolucion})`,
    );
  }
  return sobre;
}
