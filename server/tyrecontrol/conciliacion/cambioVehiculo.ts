/**
 * «El equipo está ahora en otro vehículo».
 *
 * Cuando el proveedor cambia la matrícula de un equipo ya enlazado
 * (MATRICULA_CAMBIO_PROVEEDOR) casi nunca es una errata: el equipo telemático se
 * ha pasado a otro autocar —otra matrícula y otro número de flota—, y desde ese
 * momento sus kilómetros se apuntan al vehículo equivocado. La buena es la del
 * proveedor (decisión de Mobilink), así que:
 *
 *  1. el vehículo antiguo se da de baja (si se pide) — sus neumáticos siguen
 *     montados en él y su histórico intacto: es la baja de siempre;
 *  2. el equipo se desvincula del antiguo;
 *  3. el vehículo con la matrícula del proveedor se reactiva si ya existe, o se
 *     da de alta pendiente de validar (con el tipo del antiguo);
 *  4. el equipo se vincula a él.
 *
 * Todo pasa por las acciones que ya existen (`darDeBaja`, `desvincular`,
 * `crearPendiente`, `vincular`), así que hereda sus comprobaciones. Lo único
 * nuevo que se escribe en TyreControl es `activo = true` al reactivar.
 */

import { supabase } from "../../supabase.ts";
import { coincideMatricula, patronBusquedaMatricula } from "../matricula.ts";
import { METODOS_VINCULO } from "../../integration-hub/domain/reconciliation.ts";
import { listVehicleMappings } from "../../integration-hub/infrastructure/repositories.ts";
import {
  ErrorConciliacion, crearPendiente, darDeBaja, desvincular, vincular,
  type Ambito, type Vinculacion,
} from "./acciones.ts";
import { cambiosPendientes, planDeCambio, type CambioPendiente, type PasoNuevo } from "./cambioVehiculoPlan.ts";

/** La conciliación en vivo de esta cuenta (no la foto del navegador). */
async function conciliacionEnVivo(ambito: Ambito) {
  const { conciliarFlota } = await import(
    "../../integration-hub/application/services/VehicleReconciliationService.ts"
  );
  const { leerFlotaInterna } = await import("./flota.ts");
  const { normalizarMatricula } = await import("../matricula.ts");
  const { nextCorrelationId } = await import("../../integration-hub/infrastructure/repositories.ts");
  const r = await conciliarFlota(
    { tenantId: ambito.empresaId, correlationId: await nextCorrelationId() },
    { connectorKey: ambito.connectorKey, accountKey: ambito.accountKey, leerFlotaInterna, normalizarMatricula, registrarUltimaVez: false },
  );
  if (r.resumen.cuentas.length === 0 || r.resumen.status !== "complete") {
    throw new ErrorConciliacion(
      "CONCILIACION_INCOMPLETA",
      "El proveedor no ha respondido entero: no se cambian equipos de vehículo sobre una conciliación incompleta. Vuelve a conciliar.",
      409,
    );
  }
  return r;
}

/** El vehículo de la empresa con esa matrícula (activo o no), o null. */
async function vehiculoPorMatricula(ambito: Ambito, matricula: string) {
  const patron = patronBusquedaMatricula(matricula);
  if (!patron) return null;
  const { data, error } = await supabase
    .from("tc_vehiculos")
    .select("id, matricula, activo")
    .eq("empresa_id", ambito.empresaId)
    .ilike("matricula", patron);
  if (error) throw new ErrorConciliacion("LECTURA_FALLIDA", error.message, 500);
  const v = ((data ?? []) as Array<{ id: string; matricula: string; activo: boolean | null }>)
    .find((x) => coincideMatricula(x.matricula, matricula));
  return v ? { id: String(v.id), matricula: String(v.matricula), activo: v.activo !== false } : null;
}

export interface DatosCambio {
  tcVehicleId: string;
  externalVehicleId: string;
  /** Lo que la pantalla decía: si no cuadra con lo de ahora, no se da de baja. */
  neumaticosMontadosVistos: number;
}

export interface ResultadoCambio {
  antigua: string;
  nueva: string;
  /** Qué ha pasado con el vehículo nuevo. */
  nuevo: PasoNuevo;
  bajaAntiguo: boolean;
}

async function aplicarUno(
  ambito: Ambito,
  pendientes: CambioPendiente[],
  datos: DatosCambio,
  darDeBajaAntiguo: boolean,
  preparada: Vinculacion,
): Promise<ResultadoCambio> {
  const c = pendientes.find((p) => p.tcVehicleId === datos.tcVehicleId && p.externalVehicleId === datos.externalVehicleId);
  if (!c) {
    throw new ErrorConciliacion(
      "CAMBIO_YA_NO_APLICA",
      "Ese aviso ya no está en la conciliación (alguien lo ha resuelto o el proveedor ha vuelto a cambiar). Vuelve a conciliar.",
      409,
    );
  }

  const { data: antiguo, error } = await supabase
    .from("tc_vehiculos").select("id, activo, tipo_vehiculo_id")
    .eq("id", c.tcVehicleId).eq("empresa_id", ambito.empresaId).maybeSingle();
  if (error || !antiguo) throw new ErrorConciliacion("VEHICULO_NO_ENCONTRADO", "El vehículo no existe en esta empresa.", 404);
  const ant = antiguo as { activo: boolean | null; tipo_vehiculo_id: string | null };

  const objetivo = await vehiculoPorMatricula(ambito, c.matriculaNueva);
  const plan = planDeCambio({ darDeBajaAntiguo, antiguoActivo: ant.activo !== false, objetivo, tcVehicleId: c.tcVehicleId });
  if (!plan) {
    throw new ErrorConciliacion("MISMO_VEHICULO", "El vehículo del proveedor es el mismo que ya estaba enlazado.", 409);
  }

  // Antes de tocar nada: el nuevo no puede estar ya enlazado con otro equipo.
  if (objetivo) {
    const enlaces = await listVehicleMappings({ tenantId: ambito.empresaId, system: ambito.connectorKey, accountKey: ambito.accountKey });
    const otro = enlaces.find((e) => e.active !== false && e.mobilink_id === objetivo.id && e.external_code !== c.externalVehicleId);
    if (otro) {
      throw new ErrorConciliacion(
        "NUEVO_YA_ENLAZADO",
        `${objetivo.matricula} ya está enlazado con el equipo ${otro.external_code}. Desvincúlalo primero y vuelve a intentarlo.`,
        409,
      );
    }
  }

  // 1-2. El antiguo: baja (con su control de montados) y desvincular, o solo desvincular.
  if (plan.antiguo === "baja_y_desvincular") {
    await darDeBaja(ambito, { tcVehicleId: c.tcVehicleId, neumaticosMontadosVistos: datos.neumaticosMontadosVistos, desvincularTambien: true });
  } else {
    await desvincular(ambito, { tcVehicleId: c.tcVehicleId, externalVehicleId: c.externalVehicleId });
  }

  // 3-4. El nuevo.
  if (!objetivo) {
    await crearPendiente(ambito, {
      externalVehicleId: c.externalVehicleId,
      matricula: c.matriculaNueva,
      externalName: c.nombreProveedor,
      tipoVehiculoId: ant.tipo_vehiculo_id ?? null,
    }, preparada);
  } else {
    if (plan.nuevo === "reactivar_y_vincular") {
      const { error: e2 } = await supabase.from("tc_vehiculos").update({ activo: true })
        .eq("id", objetivo.id).eq("empresa_id", ambito.empresaId);
      if (e2) throw new ErrorConciliacion("REACTIVAR_FALLIDO", `No se pudo reactivar ${objetivo.matricula}: ${e2.message}`, 500);
    }
    await vincular(ambito, {
      tcVehicleId: objetivo.id,
      externalVehicleId: c.externalVehicleId,
      matchMethod: METODOS_VINCULO.MANUAL,
      externalPlate: c.matriculaNueva,
      externalName: c.nombreProveedor,
    }, preparada);
  }

  return { antigua: c.matriculaAntigua, nueva: c.matriculaNueva, nuevo: plan.nuevo, bajaAntiguo: plan.antiguo === "baja_y_desvincular" };
}

/** Uno o varios cambios, sobre UNA conciliación en vivo. En serie: cada uno lee y escribe. */
export async function cambiarDeVehiculo(
  ambito: Ambito,
  datos: { cambios: DatosCambio[]; darDeBajaAntiguo: boolean },
): Promise<{ hechos: ResultadoCambio[]; fallidos: Array<{ tcVehicleId: string; error: string }> }> {
  const lista = (datos.cambios ?? []).slice(0, 200);
  if (!lista.length) throw new ErrorConciliacion("LOTE_VACIO", "No hay ningún cambio que hacer.");
  const r = await conciliacionEnVivo(ambito);
  const pendientes = cambiosPendientes(r.discrepancias);
  const preparada: Vinculacion = { externosValidos: new Set(pendientes.map((p) => p.externalVehicleId)) };

  const hechos: ResultadoCambio[] = [];
  const fallidos: Array<{ tcVehicleId: string; error: string }> = [];
  for (const d of lista) {
    try {
      hechos.push(await aplicarUno(ambito, pendientes, d, datos.darDeBajaAntiguo, preparada));
    } catch (e) {
      fallidos.push({ tcVehicleId: d.tcVehicleId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { hechos, fallidos };
}
