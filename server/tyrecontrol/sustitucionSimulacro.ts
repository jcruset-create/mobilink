/**
 * El simulacro de sustitución: de una asistencia de Assist al RPC previsto.
 *
 * ── Por qué esto NO pasa por el outbox ──────────────────────────────────────
 *
 * La reparación se encola porque se va a ejecutar. La sustitución todavía no,
 * así que encolarla llenaría `integration_operations` de operaciones que nadie
 * va a procesar: cada una con su contador de intentos, su estado y su ruido en
 * los paneles de la oficina, y todas mintiendo sobre el trabajo pendiente.
 *
 * Peor aún: el día que se encienda la llave, el worker se encontraría una cola
 * de sustituciones viejas —de asistencias cerradas hace semanas, con la rueda
 * ya cambiada de sitio— y las intentaría todas. La cola no es un archivo
 * histórico, es una lista de cosas por hacer.
 *
 * Por eso `SOPORTADAS` en `reparacion.ts` sigue teniendo solo la reparación: el
 * enganche del cierre no encola sustituciones. Este módulo las calcula a
 * petición, cuando alguien de la oficina abre la pantalla, y no persiste nada.
 * En 1D.1, cuando la ejecución exista, encolar será añadir la operación a
 * `SOPORTADAS` y reutilizar el outbox que ya está probado.
 */

import db from "../db.ts";
import { escrituraHabilitada } from "./conector.ts";
import { resolverVehiculoDeCliente } from "./vehiculos.ts";
import { empresaEnAlcance } from "./reparacion.ts";
import {
  EXPLICACION_SUSTITUCION, evaluarAptitudSustitucion, sincronizacionSustitucionActiva,
} from "./sustitucion.ts";
import { prepararSustitucion, type Preparacion } from "./sustitucionServicio.ts";

export type Simulacro = {
  assistanceId: number;
  matricula: string | null;
  clienteId: number | null;
  tcEmpresaId: string | null;
  tcVehicleId: string | null;
  origenEmpresa: string | null;
  apta: boolean;
  motivoNoApta: string | null;
  empresaEnAlcance: boolean;
  escrituraGeneral: boolean;
  sincronizacionSustitucion: boolean;
  /** El RPC y sus argumentos exactos, cuando se ha podido llegar hasta ahí. */
  preparacion: Preparacion | null;
  /** Lo que NO se manda, que dice tanto como lo que sí. */
  noSeEnvia: string[];
};

const NO_SE_ENVIA = ["coste", "proveedor", "serviceKm", "odómetro", "reserva de stock"];

/**
 * Calcula qué se le mandaría a TyreControl. No escribe en TC ni en la cola.
 *
 * Devuelve `null` solo si la asistencia no existe: todo lo demás —falta la
 * posición, no hay mapeo, la empresa está fuera del despliegue— se cuenta
 * dentro del resultado, porque para la oficina es información, no un error.
 */
export async function simulacroSustitucion(assistanceId: number): Promise<Simulacro | null> {
  const r = await db.query(
    `SELECT a.id, a.status, a.plate, a."clienteFacturacionId", a."tallerId",
            a."assignedTechName", a."observacionesReparacion",
            a."tcOperacion", a."tcPosicionCodigo", a."tcNeumaticoId",
            a."tcProductoAlmacenId", a."tcCondicion", a."tcDestinoRetirado",
            a."tcMotivoDesmontaje", a."tcRfidEntrante", a."tcSerieEntrante", a."tcDotEntrante"
       FROM roadside_assistances a WHERE a.id = $1`,
    [assistanceId],
  );
  const a = r.rows[0];
  if (!a) return null;

  const clienteId = a.clienteFacturacionId == null ? null : Number(a.clienteFacturacionId);
  const base = {
    assistanceId: Number(a.id),
    matricula: a.plate || null,
    clienteId,
    escrituraGeneral: escrituraHabilitada(),
    sincronizacionSustitucion: sincronizacionSustitucionActiva(),
    noSeEnvia: NO_SE_ENVIA,
  };

  const aptitud = evaluarAptitudSustitucion(a);
  if (aptitud.apta !== true) {
    return {
      ...base, tcEmpresaId: null, tcVehicleId: null, origenEmpresa: null,
      apta: false, motivoNoApta: EXPLICACION_SUSTITUCION[aptitud.motivo],
      empresaEnAlcance: false, preparacion: null,
    };
  }

  const res = await resolverVehiculoDeCliente(a.plate, clienteId, a.tallerId ?? null);
  if (res.estado !== "FOUND") {
    const motivo = res.estado === "MAPPING_ERROR"
      ? res.motivo
      : res.estado === "AMBIGUOUS"
        ? `La matrícula está en ${res.candidatos.length} empresas de TyreControl.`
        : EXPLICACION_SUSTITUCION.sin_vehiculo_tc;
    return {
      ...base,
      tcEmpresaId: res.estado === "MAPPING_ERROR" ? res.tcEmpresaId : null,
      tcVehicleId: null, origenEmpresa: null,
      apta: false, motivoNoApta: motivo, empresaEnAlcance: false, preparacion: null,
    };
  }

  const tcEmpresaId = res.vehiculo.empresaId;
  const enAlcance = empresaEnAlcance(tcEmpresaId);
  const comun = {
    ...base, tcEmpresaId, tcVehicleId: res.vehiculo.tcVehicleId,
    origenEmpresa: res.origenEmpresa, empresaEnAlcance: enAlcance,
  };

  /*
   * La empresa deducida por coincidencia de matrícula sirve para LEER, no para
   * escribir: si la coincidencia era casual se estaría moviendo el stock de
   * otro cliente. Es la misma regla que en la reparación, y aquí pesa más
   * porque una sustitución consume material.
   */
  if (res.origenEmpresa !== "mapping") {
    return { ...comun, apta: false, motivoNoApta: EXPLICACION_SUSTITUCION.empresa_no_por_mapping, preparacion: null };
  }
  if (!enAlcance) {
    return { ...comun, apta: false, motivoNoApta: EXPLICACION_SUSTITUCION.fuera_de_alcance, preparacion: null };
  }

  const preparacion = await prepararSustitucion({
    assistanceId: Number(a.id),
    tcEmpresaId,
    tcVehicleId: res.vehiculo.tcVehicleId,
    codigoPosicion: String(a.tcPosicionCodigo),
    // En el simulacro no hay «lo que Assist creía»: se lee lo que hay ahora.
    // El testigo se guardará al encolar, en 1D.1, igual que en la reparación.
    montajeEsperado: null,
    neumaticoSalienteEsperado: a.tcNeumaticoId ?? null,
    productoAlmacenId: aptitud.productoAlmacenId,
    condicion: aptitud.condicion,
    destinoRetirado: aptitud.destinoRetirado,
    motivoDesmontaje: aptitud.motivoDesmontaje,
    identidad: aptitud.identidad,
    observaciones: [
      `Asistencia Mobilink AST-${a.id}`,
      a.assignedTechName ? `Técnico: ${a.assignedTechName}` : null,
      a.observacionesReparacion || null,
    ].filter(Boolean).join(" · "),
  });

  return { ...comun, apta: true, motivoNoApta: null, preparacion };
}
