/**
 * Ejecutar una reparación en TyreControl.
 *
 * ── Leer antes de escribir, siempre ─────────────────────────────────────────
 *
 * TyreControl cambia por su cuenta: alguien puede haber movido esa rueda desde
 * su APK entre que el técnico cerró la asistencia y el worker la procesa. Así
 * que antes de tocar nada se lee el estado ACTUAL y se comprueba que la
 * posición sigue teniendo el montaje y el neumático que Assist creía. Si no,
 * se para y se marca conflicto — nunca se repara «la rueda que haya ahora».
 *
 * ── El problema del resultado incierto ──────────────────────────────────────
 *
 * TyreControl no tiene idempotency key. Si se pierde la respuesta de un RPC,
 * no hay forma directa de preguntar «¿llegó?». Repetir a ciegas podría duplicar
 * una reparación.
 *
 * Para el camino EN SITIO hay una solución limpia: la incidencia la creamos
 * nosotros y conocemos su id, así que **esa incidencia hace de referencia
 * externa**. Si existe una operación en `operaciones_neumaticos` enlazada a
 * ella, la reparación se ejecutó, y se da por buena sin repetirla. Es lo más
 * parecido a idempotencia que se puede tener sin tocar TC.
 *
 * Para el camino de taller no hay ese enlace, así que ante la duda se deriva a
 * revisión manual. Dejar algo pendiente de mirar es peor que nada, pero mucho
 * mejor que reparar dos veces.
 */

import { clienteTyreControl } from "./sesion.ts";
import { estadoDeVehiculo } from "./estadoVehiculo.ts";
import {
  accionEnSitio, admiteEnSitio, problemaEnSitio,
  type ResultadoReparacion, type TipoReparacion,
} from "./reparacion.ts";

export type PlanReparacion = {
  tcVehicleId: string;
  tcEmpresaId: string;
  /** Uno de los dos: la posición es lo normal en carretera. */
  posicionCodigo?: string | null;
  neumaticoId?: string | null;
  tipo: TipoReparacion;
  resultado: ResultadoReparacion;
  observaciones: string | null;
  coste?: number | null;
  proveedor?: string | null;
  /** Lo que Assist creía que había ahí. Si ya no es así, se para. */
  montajeEsperado?: string | null;
  neumaticoEsperado?: string | null;
  /** Para poder buscar evidencia si se pierde la respuesta. */
  incidenciaId?: string | null;
};

export type Desenlace =
  | { estado: "COMPLETED"; operacionTcId: string | null; incidenciaId: string | null; camino: "en_sitio" | "taller" }
  | { estado: "CONFLICT"; motivo: string }
  | { estado: "FAILED"; codigo: string; motivo: string }
  | { estado: "RETRY"; codigo: string; motivo: string }
  | { estado: "MANUAL_REVIEW"; motivo: string; incidenciaId: string | null };

/** Lo que hay AHORA en esa posición, leído de TyreControl. */
export type Situacion = {
  posicionId: string;
  montajeActualId: string | null;
  neumaticoId: string | null;
  estadoNeumatico: string | null;
};

export async function situacionDePosicion(
  tcVehicleId: string, posicionCodigo: string,
): Promise<Situacion | null> {
  const estado = await estadoDeVehiculo(tcVehicleId);
  if (!estado) return null;
  const p = estado.posiciones.find((x) => x.codigoPosicion === posicionCodigo);
  if (!p) return null;
  return {
    posicionId: p.posicionId,
    montajeActualId: p.montajeActualId,
    neumaticoId: p.neumatico?.neumaticoId ?? null,
    estadoNeumatico: p.neumatico?.estado ?? null,
  };
}

/**
 * Estados en los que no tiene sentido intentar la reparación.
 *
 * No se reproduce toda la lógica de TC —el RPC valida lo suyo— pero sí se
 * evitan las llamadas claramente inútiles: un descartado no se repara, y uno ya
 * en reparación no se repara otra vez.
 */
function bloqueaReparacion(estadoNeumatico: string | null): string | null {
  if (estadoNeumatico === "descartado") return "El neumático está descartado en TyreControl.";
  if (estadoNeumatico === "reparacion") return "El neumático ya figura en reparación en TyreControl.";
  return null;
}

/* ── Búsqueda de evidencia ───────────────────────────────────────────────── */

/**
 * ¿Se llegó a ejecutar la reparación?
 *
 * Se pregunta por la incidencia que creamos nosotros: si hay una operación
 * enlazada a ella, sí. Es la referencia externa que TyreControl no tiene, hecha
 * con lo que sí hay.
 */
export async function buscarEvidencia(incidenciaId: string): Promise<string | null> {
  try {
    const cliente = await clienteTyreControl();
    const { data } = await cliente
      .from("operaciones_neumaticos")
      .select("id")
      .eq("incidencia_id", incidenciaId)
      .eq("tipo_operacion", "reparacion")
      .limit(1);
    return data?.[0]?.id ? String(data[0].id) : null;
  } catch {
    return null;
  }
}

/* ── Ejecución ───────────────────────────────────────────────────────────── */

/**
 * Camino EN SITIO: la rueda se queda puesta.
 *
 * Es el flujo de la APK de TyreControl: incidencia + problema, y se resuelve.
 * La incidencia se crea con la sesión del usuario de integración, así que el
 * RLS de TC decide si puede — no se salta ningún permiso, solo no hay un RPC
 * para esto y la APK lo hace igual.
 */
async function repararEnSitio(p: PlanReparacion, situacion: Situacion): Promise<Desenlace> {
  const cliente = await clienteTyreControl();
  const accion = accionEnSitio(p.tipo);
  const problema = problemaEnSitio(p.tipo);
  if (!accion || !problema) {
    return { estado: "FAILED", codigo: "tc_invalid_operation",
             motivo: `«${p.tipo}» no se puede hacer con la rueda puesta.` };
  }

  let incidenciaId = p.incidenciaId ?? null;

  // Si ya había incidencia de un intento anterior, primero se mira si aquello
  // llegó a ejecutarse. Repetirlo sería la segunda reparación que no queremos.
  if (incidenciaId) {
    const ya = await buscarEvidencia(incidenciaId);
    if (ya) return { estado: "COMPLETED", operacionTcId: ya, incidenciaId, camino: "en_sitio" };
  }

  if (!incidenciaId) {
    const { data, error } = await cliente.from("tc_incidencias").insert({
      empresa_id: p.tcEmpresaId,
      vehiculo_id: p.tcVehicleId,
      posicion_id: situacion.posicionId,
      neumatico_id: situacion.neumaticoId,
      gravedad: "importante",
      estado: "en_curso",
      accion_recomendada: p.observaciones,
    }).select("id").single();
    if (error || !data) {
      return { estado: "RETRY", codigo: "tc_unavailable",
               motivo: `No se pudo abrir la incidencia en TyreControl: ${error?.message ?? "sin respuesta"}` };
    }
    incidenciaId = String(data.id);
  }

  const { data: prob, error: errProb } = await cliente.from("tc_incidencia_problemas")
    .insert({ incidencia_id: incidenciaId, tipo: problema }).select("id").single();
  if (errProb || !prob) {
    return { estado: "MANUAL_REVIEW", incidenciaId,
             motivo: "La incidencia se creó pero no su problema; hay que revisarla en TyreControl." };
  }

  const { error } = await cliente.rpc("tc_resolver_incidencia_parcial", {
    p_incidencia_id: incidenciaId,
    p_problema_ids: [prob.id],
    p_tipo: accion,
    p_resultado: p.resultado,
    p_observaciones: p.observaciones,
  });

  if (error) {
    /*
     * El RPC pudo llegar a ejecutarse y perderse la respuesta. Se busca la
     * evidencia antes de decidir nada: es justo el caso que no puede acabar en
     * un reintento a ciegas.
     */
    const ya = await buscarEvidencia(incidenciaId);
    if (ya) return { estado: "COMPLETED", operacionTcId: ya, incidenciaId, camino: "en_sitio" };

    const transitorio = /timeout|network|fetch failed|econn|socket|50\d/i.test(error.message ?? "");
    return transitorio
      ? { estado: "RETRY", codigo: "tc_unavailable", motivo: error.message }
      : { estado: "FAILED", codigo: "tc_error", motivo: error.message };
  }

  const operacionTcId = await buscarEvidencia(incidenciaId);
  return { estado: "COMPLETED", operacionTcId, incidenciaId, camino: "en_sitio" };
}

/** Camino de taller: el neumático ya está desmontado. Acepta coste y proveedor. */
async function repararEnTaller(p: PlanReparacion, neumaticoId: string): Promise<Desenlace> {
  const cliente = await clienteTyreControl();
  const { data, error } = await cliente.rpc("tc_registrar_reparacion", {
    p_neumatico: neumaticoId,
    p_tipo_reparacion: p.tipo,
    p_resultado: p.resultado,
    p_proveedor: p.proveedor ?? null,
    p_coste: p.coste ?? null,
    // El kilometraje NO se manda: `serviceKm` de Assist son los km del
    // desplazamiento, no el cuentakilómetros, y el RPC lo admite nulo.
    p_km: null,
    p_obs: p.observaciones,
  });

  if (error) {
    const transitorio = /timeout|network|fetch failed|econn|socket|50\d/i.test(error.message ?? "");
    if (transitorio) {
      /*
       * Sin incidencia no hay enlace que buscar: no se puede demostrar si llegó
       * a ejecutarse. Reintentar podría duplicar la reparación, así que se
       * deriva a una persona.
       */
      return {
        estado: "MANUAL_REVIEW", incidenciaId: null,
        motivo: "No se sabe si la reparación llegó a registrarse en TyreControl. " +
                "Compruébalo en la ficha del neumático antes de reintentar.",
      };
    }
    return { estado: "FAILED", codigo: "tc_error", motivo: error.message };
  }
  return { estado: "COMPLETED", operacionTcId: data ? String(data) : null, incidenciaId: null, camino: "taller" };
}

/**
 * Ejecuta la reparación, eligiendo el camino por el estado REAL del neumático.
 */
export async function ejecutarReparacion(p: PlanReparacion): Promise<Desenlace> {
  // 1 · Estado actual de TyreControl.
  let situacion: Situacion | null = null;
  if (p.posicionCodigo) {
    situacion = await situacionDePosicion(p.tcVehicleId, p.posicionCodigo);
    if (!situacion) {
      return { estado: "FAILED", codigo: "tc_invalid_operation",
               motivo: `La posición ${p.posicionCodigo} no existe en la configuración del vehículo.` };
    }
  }

  // 2 · ¿Sigue siendo lo que Assist creía?
  if (situacion) {
    if (!situacion.montajeActualId || !situacion.neumaticoId) {
      return { estado: "CONFLICT",
               motivo: `En la posición ${p.posicionCodigo} ya no hay ningún neumático montado.` };
    }
    if (p.montajeEsperado && p.montajeEsperado !== situacion.montajeActualId) {
      return { estado: "CONFLICT",
               motivo: `Alguien ha cambiado la rueda de ${p.posicionCodigo} desde TyreControl.` };
    }
    if (p.neumaticoEsperado && p.neumaticoEsperado !== situacion.neumaticoId) {
      return { estado: "CONFLICT",
               motivo: `En ${p.posicionCodigo} ya no está el mismo neumático.` };
    }
  }

  // 3 · Estados que no admiten reparación.
  const bloqueo = bloqueaReparacion(situacion?.estadoNeumatico ?? null);
  if (bloqueo) return { estado: "FAILED", codigo: "tc_invalid_operation", motivo: bloqueo };

  // 4 · El camino lo decide el estado real, no una suposición.
  const montado = situacion?.estadoNeumatico === "montado";
  if (montado) {
    if (!admiteEnSitio(p.tipo)) {
      return {
        estado: "FAILED", codigo: "tc_invalid_operation",
        motivo: `«${p.tipo}» exige desmontar la rueda, y eso todavía no se sincroniza.`,
      };
    }
    return repararEnSitio(p, situacion!);
  }

  const neumaticoId = p.neumaticoId ?? situacion?.neumaticoId ?? null;
  if (!neumaticoId) {
    return { estado: "FAILED", codigo: "tc_tyre_not_found",
             motivo: "No se ha podido identificar el neumático que se reparó." };
  }
  return repararEnTaller(p, neumaticoId);
}
