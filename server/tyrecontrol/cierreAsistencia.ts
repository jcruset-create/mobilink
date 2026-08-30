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
import {
  EXPLICACION, empresaEnAlcance, evaluarAptitud, sincronizacionReparacionActiva,
} from "./reparacion.ts";

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
 * Decide si esta asistencia se encola para TyreControl, y la encola.
 *
 * Nunca ejecuta el RPC: eso es del worker. Y nunca lanza — el cierre de la
 * asistencia manda por encima de todo lo demás.
 */
export async function engancheCierreTyreControl(assistanceId: number): Promise<SobreCierre | null> {
  const sobre = await alFinalizarAsistenciaParaTyreControl(assistanceId);
  if (!sobre) return null;

  try {
    await decidirYEncolar(assistanceId, sobre);
  } catch (e: any) {
    console.error(`[TyreControl] no se pudo encolar la asistencia ${assistanceId}:`, e?.message);
  }
  return sobre;
}

/** Anota por qué NO se sincroniza. Que la oficina lo vea es parte del trabajo. */
async function anotarNoSincroniza(assistanceId: number, motivo: string): Promise<void> {
  await db.query(
    `UPDATE roadside_assistances
        SET "tcSyncEstado" = 'NO_APLICA', "tcSyncMotivo" = $2, "tcSyncAtMs" = $3
      WHERE id = $1`,
    [assistanceId, motivo, Date.now()],
  ).catch(() => {});
}

async function decidirYEncolar(assistanceId: number, sobre: SobreCierre): Promise<void> {
  const fila = await db.query(
    `SELECT status, plate, "tcOperacion", "tcTipoReparacion", "tcResultadoReparacion",
            "tcPosicionCodigo", "tcNeumaticoId", "observacionesReparacion"
       FROM roadside_assistances WHERE id = $1`,
    [assistanceId],
  );
  const a = fila.rows[0];
  if (!a) return;

  const aptitud = evaluarAptitud(a);
  if (aptitud.apta !== true) {
    // «Sin marca» es el caso de la inmensa mayoría de asistencias: no se anota
    // nada para no llenar la ficha de avisos que no significan nada.
    if (aptitud.motivo !== "sin_marca") {
      await anotarNoSincroniza(assistanceId, EXPLICACION[aptitud.motivo]);
    }
    return;
  }

  if (sobre.resolucion !== "FOUND" || !sobre.tcVehicleId || !sobre.tcEmpresaId) {
    await anotarNoSincroniza(assistanceId,
      sobre.motivo ?? EXPLICACION[sobre.resolucion === "NOT_FOUND" ? "sin_vehiculo_tc" : "sin_matricula"]);
    return;
  }

  /*
   * Para ESCRIBIR, la empresa tiene que venir de una correspondencia declarada.
   * Que la matrícula fuera única en toda la base es un buen indicio para leer,
   * pero no para tocar el histórico técnico de un cliente: si la coincidencia
   * era casual, se estaría escribiendo en la ficha de otro.
   */
  if (sobre.origenEmpresa !== "mapping") {
    await anotarNoSincroniza(assistanceId, EXPLICACION.empresa_no_por_mapping);
    return;
  }

  if (!empresaEnAlcance(sobre.tcEmpresaId)) {
    await anotarNoSincroniza(assistanceId, EXPLICACION.fuera_de_alcance);
    return;
  }

  const refRueda = String(a.tcPosicionCodigo ?? a.tcNeumaticoId ?? "").trim();
  const { encolarReparacion, situacionDePosicion } = await import("./outbox.ts");

  /*
   * Se lee la situación AHORA para guardarla como referencia. El worker volverá
   * a leerla antes de escribir; esto es lo que Assist creía en el momento del
   * cierre, y comparar las dos es lo que detecta que alguien movió la rueda
   * mientras tanto.
   */
  let montajeEsperado: string | null = null;
  let neumaticoEsperado: string | null = null;
  if (a.tcPosicionCodigo) {
    const s = await situacionDePosicion(sobre.tcVehicleId, String(a.tcPosicionCodigo)).catch(() => null);
    montajeEsperado = s?.montajeActualId ?? null;
    neumaticoEsperado = s?.neumaticoId ?? null;
  }

  const r = await encolarReparacion({
    assistanceId,
    refRueda,
    plan: {
      tcVehicleId: sobre.tcVehicleId,
      tcEmpresaId: sobre.tcEmpresaId,
      posicionCodigo: a.tcPosicionCodigo ?? null,
      neumaticoId: a.tcNeumaticoId ?? null,
      tipo: aptitud.tipo,
      resultado: aptitud.resultado,
      /*
       * Una referencia humana mínima: quién y de qué asistencia. Es lo único
       * que puede llevar el técnico real a TyreControl, porque la operación se
       * atribuye al usuario de integración.
       */
      observaciones: [
        `Asistencia Mobilink AST-${assistanceId}`,
        sobre.tecnico ? `Técnico: ${sobre.tecnico}` : null,
        a.observacionesReparacion || null,
      ].filter(Boolean).join(" · "),
      // El coste NO se manda: en Assist se cierra en back-office después del
      // cierre técnico, así que aquí todavía no es definitivo.
      coste: null,
      proveedor: null,
      montajeEsperado,
      neumaticoEsperado,
    },
  });

  if (r.encolada === true) {
    await db.query(
      `UPDATE roadside_assistances SET "tcSyncEstado" = 'PENDIENTE', "tcSyncMotivo" = NULL,
              "tcSyncAtMs" = $2 WHERE id = $1`,
      [assistanceId, Date.now()],
    ).catch(() => {});
    console.log(`[TyreControl] reparación encolada · ${r.correlationId}`);
  } else {
    console.log(`[TyreControl] no se encola ${r.correlationId}: ${r.motivo}`);
  }
}

/** Solo para el simulacro: qué pasaría, sin encolar ni escribir. */
export async function simulacroCierre(assistanceId: number): Promise<Record<string, unknown> | null> {
  const sobre = await alFinalizarAsistenciaParaTyreControl(assistanceId);
  if (!sobre) return null;
  const fila = await db.query(
    `SELECT status, plate, "tcOperacion", "tcTipoReparacion", "tcResultadoReparacion",
            "tcPosicionCodigo", "tcNeumaticoId" FROM roadside_assistances WHERE id = $1`,
    [assistanceId],
  );
  const aptitud = evaluarAptitud(fila.rows[0] ?? {});
  return {
    ...sobre,
    apta: aptitud.apta,
    motivoNoApta: aptitud.apta === true ? null : EXPLICACION[aptitud.motivo],
    tipoReparacion: aptitud.apta === true ? aptitud.tipo : null,
    empresaEnAlcance: empresaEnAlcance(sobre.tcEmpresaId),
    escrituraActiva: sincronizacionReparacionActiva(),
    rpcPrevisto: aptitud.apta
      ? "tc_resolver_incidencia_parcial (rueda montada) o tc_registrar_reparacion (desmontada)"
      : null,
    // Se dice explícitamente lo que NO se manda, que es tan importante como lo
    // que sí: el coste llega después y serviceKm no es el cuentakilómetros.
    noSeEnvia: ["coste", "proveedor", "serviceKm"],
    escrituraGeneral: escrituraHabilitada(),
  };
}
