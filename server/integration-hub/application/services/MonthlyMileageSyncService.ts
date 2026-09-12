/**
 * MonthlyMileageSyncService — cuántos kilómetros hizo cada vehículo cada mes.
 *
 * ── Qué hace ────────────────────────────────────────────────────────────────
 *
 * Por cada cuenta de telemática del cliente que sepa resumir viajes, y por
 * cada mes que toque, pregunta al proveedor la distancia de los vehículos
 * ENLAZADOS (por `integration_mappings`, nunca por matrícula) en lotes, y
 * guarda una fila por vehículo y mes. Idempotente: el mismo mes escrito dos
 * veces es una sola fila actualizada.
 *
 * ── Qué meses toca ──────────────────────────────────────────────────────────
 *
 *   · El mes en curso, siempre: está abierto y cambia cada día.
 *   · Un mes ya terminado, solo para los vehículos que NO lo tengan cerrado.
 *     «Cerrado» se marca cuando el resumen se pidió después de que el mes
 *     acabara (con margen), y a partir de ahí no se vuelve a pedir salvo que
 *     alguien lo fuerce a mano. Es lo que evita preguntar por agosto cada
 *     noche durante años.
 *   · Hacia atrás, `mesesHistorico` meses (12 por defecto) para que un
 *     vehículo recién enlazado importe su histórico solo, mes a mes.
 *
 * Cada mes es UNA ventana: Movertis pide rangos de un mes como mucho, y
 * enero-diciembre en una llamada no existe aquí ni por accidente.
 *
 * ── Qué pasa cuando algo falla ──────────────────────────────────────────────
 *
 * Un lote que falla no para la sincronización: se anota el error en cada
 * vehículo del lote (sin pisar el dato bueno que ya tuviera), se cuenta, y se
 * sigue con el siguiente. La excepción es un 401/403: con la credencial
 * rechazada, seguir pidiendo es quemar cupo para nada y acercarse al bloqueo
 * del token, así que esa cuenta se abandona entera y se dice por qué.
 *
 * El ritmo lo marca `LimitadorDeRitmo`, compartido por cuenta: el job de la
 * noche y una resincronización manual a la vez se reparten el mismo cupo.
 */

import type { OperationContext } from "../../domain/identifiers.ts";
import { IntegrationError } from "../../domain/errors.ts";
import { sabeResumirViajes, type TripSummary } from "../../domain/telematics.ts";
import {
  claveDeMes, limitesDelMes, mesAnterior, mesCerrado, mesDe, ZONA_HORARIA_POR_DEFECTO, type Mes,
} from "../../domain/meses.ts";
import {
  listVehicleMappings,
  listVehiclesWithClosedMonth,
  nextCorrelationId,
  upsertMonthlyMileage,
  upsertSyncState,
  type MappingRow,
} from "../../infrastructure/repositories.ts";
import { limitadorDe } from "../../infrastructure/ritmo.ts";
import { resolveTelematicsConnectors } from "../../connectors/ConnectorRegistry.ts";

export const FUENTE = "summarytrips";
export const MESES_HISTORICO_POR_DEFECTO = 12;
const UNIDADES_POR_PETICION_POR_DEFECTO = 25;
const UNIDADES_POR_PETICION_MAXIMO = 100;
/**
 * Cortacircuito: tantos lotes SEGUIDOS rechazados por el proveedor y se
 * abandona la cuenta en esta pasada.
 *
 * Visto en producción: Movertis empezó a contestar «Core Error: 4» a todo, y
 * sin esto el job habría lanzado las cuatrocientas peticiones restantes una
 * tras otra, fallando todas. Eso no es insistir, es martillear a un proveedor
 * que ya ha dicho que no, y es la forma más rápida de que bloquee el token.
 * La pasada siguiente lo vuelve a intentar desde donde se quedó (los meses
 * cerrados ya no se piden).
 */
const LOTES_SEGUIDOS_FALLIDOS_MAXIMO = 5;

/** Prefijo de la entrada en `integration_sync_state`; la cuenta va detrás. */
export const ENTIDAD_SYNC = "vehicle_monthly_mileage";
export const entidadSyncDe = (connectorKey: string, accountKey: string) =>
  `${ENTIDAD_SYNC}:${connectorKey}:${accountKey}`;

export interface OpcionesSyncMensual {
  tenantId: string;
  /** Acotar a un conector / cuenta. Sin ellos, todas las de telemática. */
  connectorKey?: string;
  accountKey?: string;
  /**
   * Meses concretos (resincronización manual). Sin esto, el criterio normal:
   * mes en curso + anterior + histórico que falte.
   */
  meses?: Mes[];
  /** Solo estos vehículos de TyreControl (prueba controlada). */
  mobilinkIds?: string[];
  /** Cuántos meses hacia atrás importar si faltan. */
  mesesHistorico?: number;
  /** Volver a pedir también los meses cerrados. Solo tiene sentido a mano. */
  forzar?: boolean;
  /** Para pruebas. */
  ahora?: Date;
}

export interface ResumenCuentaMensual {
  connectorKey: string;
  accountKey: string;
  nombre: string | null;
  zonaHoraria: string;
  unidadesPorPeticion: number;
  inicioMs: number;
  finMs: number;
  meses: string[];
  vehiculosEnlazados: number;
  vehiculosProcesados: number;
  vehiculosConKm: number;
  vehiculosSinDatos: number;
  lotes: number;
  peticiones: number;
  errores: number;
  /** Los primeros mensajes de error, para leerlos sin abrir la base. */
  muestraErrores: string[];
  kmTotales: number;
  /** Si la cuenta se abandonó (credencial rechazada, sin capacidad…). */
  abandonada?: string;
}

export interface ResumenSyncMensual {
  correlationId: string;
  cuentas: ResumenCuentaMensual[];
}

/** Lo que devuelve el proveedor para un vehículo, o por qué no. */
type Resultado =
  | { tipo: "ok"; resumen: TripSummary }
  | { tipo: "vacio" }
  | { tipo: "error"; mensaje: string };

export async function syncMonthlyMileage(op: OpcionesSyncMensual): Promise<ResumenSyncMensual> {
  const ctx: OperationContext = { tenantId: op.tenantId, correlationId: await nextCorrelationId() };
  const ahora = op.ahora ?? new Date();

  let cuentas = await resolveTelematicsConnectors(op.tenantId);
  if (op.connectorKey) cuentas = cuentas.filter((c) => c.key === op.connectorKey);
  if (op.accountKey) cuentas = cuentas.filter((c) => c.accountKey === op.accountKey);

  const resultados: ResumenCuentaMensual[] = [];
  // Cuentas en serie: cada una ya va al ritmo de su limitador, y dos a la vez
  // solo duplican la carga en nuestra base, que es la que escribe 751 filas.
  for (const cuenta of cuentas) {
    resultados.push(await sincronizarCuenta(ctx, cuenta, op, ahora));
  }
  return { correlationId: ctx.correlationId, cuentas: resultados };
}

async function sincronizarCuenta(
  ctx: OperationContext,
  cuenta: Awaited<ReturnType<typeof resolveTelematicsConnectors>>[number],
  op: OpcionesSyncMensual,
  ahora: Date,
): Promise<ResumenCuentaMensual> {
  const inicioMs = Date.now();
  const zona = String(cuenta.config.zonaHoraria ?? ZONA_HORARIA_POR_DEFECTO);
  const lote = tamanoDeLote(cuenta.config.unidadesPorPeticion);

  const r: ResumenCuentaMensual = {
    connectorKey: cuenta.key,
    accountKey: cuenta.accountKey,
    nombre: cuenta.nombre,
    zonaHoraria: zona,
    unidadesPorPeticion: lote,
    inicioMs,
    finMs: inicioMs,
    meses: [],
    vehiculosEnlazados: 0,
    vehiculosProcesados: 0,
    vehiculosConKm: 0,
    vehiculosSinDatos: 0,
    lotes: 0,
    peticiones: 0,
    errores: 0,
    muestraErrores: [],
    kmTotales: 0,
  };

  const anotarError = (mensaje: string) => {
    r.errores += 1;
    if (r.muestraErrores.length < 5) r.muestraErrores.push(mensaje);
  };

  try {
    const conector = cuenta.connector;
    if (!sabeResumirViajes(conector)) {
      r.abandonada = `${cuenta.key} no sabe resumir distancias (sin capacidad trip-summary)`;
      return r;
    }

    // Enlaces activos: el mapeo vehículo ↔ unidad es la única llave.
    let enlaces = (await listVehicleMappings({
      tenantId: op.tenantId, system: cuenta.key, accountKey: cuenta.accountKey,
    })).filter((e) => e.active !== false);
    if (op.mobilinkIds?.length) {
      const pedidos = new Set(op.mobilinkIds);
      enlaces = enlaces.filter((e) => pedidos.has(e.mobilink_id));
    }
    r.vehiculosEnlazados = enlaces.length;
    if (enlaces.length === 0) return r;

    const meses = op.meses?.length ? op.meses : mesesQueTocan(ahora, zona, op.mesesHistorico);
    r.meses = meses.map(claveDeMes);

    const limitador = limitadorDe(`${op.tenantId}/${cuenta.key}/${cuenta.accountKey}`);
    const procesados = new Set<string>();
    const conKm = new Set<string>();
    const sinDatos = new Set<string>();
    let lotesSeguidosFallidos = 0;

    for (const mes of meses) {
      const limites = limitesDelMes(mes, zona);
      const cerrado = mesCerrado(mes, zona, ahora);

      // Un mes terminado no se vuelve a pedir a quien ya lo tiene cerrado.
      let pendientes = enlaces;
      if (cerrado && !op.forzar) {
        const yaCerrados = await listVehiclesWithClosedMonth({
          tenantId: op.tenantId, system: cuenta.key, accountKey: cuenta.accountKey,
          year: mes.year, month: mes.month,
        });
        pendientes = enlaces.filter((e) => !yaCerrados.has(e.mobilink_id));
      }
      if (pendientes.length === 0) continue;

      for (let i = 0; i < pendientes.length; i += lote) {
        const tanda = pendientes.slice(i, i + lote);
        r.lotes += 1;

        await limitador.turno();
        r.peticiones += 1;
        const porVehiculo = await pedirLote(ctx, conector, tanda, limites);

        // Un lote entero en error es una respuesta del proveedor, no un
        // vehículo raro: se cuentan seguidos y, pasado el tope, se para.
        const loteFallido = tanda.length > 0 && tanda.every((e) => porVehiculo.get(e.mobilink_id)?.tipo === "error");
        lotesSeguidosFallidos = loteFallido ? lotesSeguidosFallidos + 1 : 0;

        for (const enlace of tanda) {
          const res = porVehiculo.get(enlace.mobilink_id) ?? { tipo: "vacio" as const };
          procesados.add(enlace.mobilink_id);

          if (res.tipo === "error") {
            anotarError(`${claveDeMes(mes)} ${enlace.external_code}: ${res.mensaje}`);
            // Con la credencial rechazada, cada petición más es cupo quemado.
            if (res.mensaje.startsWith("AUTH:")) {
              await guardarFila(op.tenantId, cuenta, enlace, mes, limites, zona, res, cerrado);
              r.abandonada = res.mensaje;
              await cerrarAuditoria(op.tenantId, cuenta, r, "error");
              return r;
            }
          } else if (res.tipo === "ok") {
            conKm.add(enlace.mobilink_id);
            r.kmTotales += res.resumen.distanceKm;
          } else {
            sinDatos.add(enlace.mobilink_id);
          }
          await guardarFila(op.tenantId, cuenta, enlace, mes, limites, zona, res, cerrado);
        }

        if (lotesSeguidosFallidos >= LOTES_SEGUIDOS_FALLIDOS_MAXIMO) {
          const ultimo = porVehiculo.get(tanda[0].mobilink_id);
          r.abandonada =
            `${LOTES_SEGUIDOS_FALLIDOS_MAXIMO} lotes seguidos rechazados por el proveedor; se deja para la ` +
            `siguiente pasada. Último error: ${ultimo?.tipo === "error" ? ultimo.mensaje : "?"}`;
          r.vehiculosProcesados = procesados.size;
          r.vehiculosConKm = conKm.size;
          r.vehiculosSinDatos = [...sinDatos].filter((id) => !conKm.has(id)).length;
          await cerrarAuditoria(op.tenantId, cuenta, r, "error");
          return r;
        }
      }
    }

    r.vehiculosProcesados = procesados.size;
    r.vehiculosConKm = conKm.size;
    r.vehiculosSinDatos = [...sinDatos].filter((id) => !conKm.has(id)).length;
    await cerrarAuditoria(op.tenantId, cuenta, r, r.errores > 0 ? "partial" : "ok");
    return r;
  } catch (e: any) {
    anotarError(String(e?.message ?? e));
    r.abandonada = String(e?.message ?? e);
    await cerrarAuditoria(op.tenantId, cuenta, r, "error");
    return r;
  }
}

/**
 * Los meses que toca sincronizar hoy: el en curso, el anterior y el histórico
 * hacia atrás. En ese orden: lo que se mira primero se actualiza primero.
 */
export function mesesQueTocan(ahora: Date, zona: string, mesesHistorico = MESES_HISTORICO_POR_DEFECTO): Mes[] {
  const actual = mesDe(ahora, zona);
  const lista: Mes[] = [actual];
  let m = actual;
  const total = Math.max(0, Math.min(120, Math.floor(mesesHistorico)));
  for (let i = 0; i < total; i++) {
    m = mesAnterior(m);
    lista.push(m);
  }
  return lista;
}

function tamanoDeLote(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return UNIDADES_POR_PETICION_POR_DEFECTO;
  return Math.min(UNIDADES_POR_PETICION_MAXIMO, Math.floor(n));
}

/** Una petición al proveedor por un lote, con el resultado repartido por vehículo. */
async function pedirLote(
  ctx: OperationContext,
  conector: { getTripSummary: (c: OperationContext, ids: string[], w: { from: Date; to: Date }) => Promise<TripSummary[]> },
  tanda: MappingRow[],
  limites: { desde: Date; hasta: Date },
): Promise<Map<string, Resultado>> {
  const salida = new Map<string, Resultado>();
  try {
    const resumenes = await conector.getTripSummary(
      ctx,
      tanda.map((e) => e.external_code),
      { from: limites.desde, to: limites.hasta },
    );
    const porUnidad = new Map(resumenes.map((s) => [String(s.providerVehicleId), s]));
    for (const e of tanda) {
      const s = porUnidad.get(String(e.external_code));
      salida.set(e.mobilink_id, s ? { tipo: "ok", resumen: s } : { tipo: "vacio" });
    }
  } catch (e) {
    const err = e as IntegrationError;
    const mensaje = err instanceof IntegrationError && err.kind === "AUTH"
      ? `AUTH: ${err.message}`
      : String(err?.message ?? e);
    for (const en of tanda) salida.set(en.mobilink_id, { tipo: "error", mensaje });
  }
  return salida;
}

async function guardarFila(
  tenantId: string,
  cuenta: { key: string; accountKey: string },
  enlace: MappingRow,
  mes: Mes,
  limites: { desde: Date; hasta: Date },
  zona: string,
  res: Resultado,
  cerrado: boolean,
): Promise<void> {
  const base = {
    tenantId, system: cuenta.key, accountKey: cuenta.accountKey,
    mobilinkId: enlace.mobilink_id, externalCode: enlace.external_code,
    year: mes.year, month: mes.month,
    periodStartMs: limites.desde.getTime(), periodEndMs: limites.hasta.getTime(),
    timezone: zona, source: FUENTE,
  };
  if (res.tipo === "ok") {
    await upsertMonthlyMileage({
      ...base,
      distanceKm: redondear(res.resumen.distanceKm),
      initialOdometerKm: res.resumen.initialOdometerKm != null ? redondear(res.resumen.initialOdometerKm) : null,
      finalOdometerKm: res.resumen.finalOdometerKm != null ? redondear(res.resumen.finalOdometerKm) : null,
      trips: res.resumen.trips ?? null,
      syncStatus: "ok", closed: cerrado, lastError: null,
    });
  } else if (res.tipo === "vacio") {
    // Sin datos NO es cero: puede ser un equipo apagado. Se deja en blanco y
    // se marca; la ficha lo enseña como «sin datos», no como «0 km».
    await upsertMonthlyMileage({
      ...base, distanceKm: null, syncStatus: "empty", closed: cerrado, lastError: null,
    });
  } else {
    // El error no pisa lo que hubiera: lo resuelve el UPSERT.
    await upsertMonthlyMileage({
      ...base, distanceKm: null, syncStatus: "error", closed: false, lastError: res.mensaje.slice(0, 500),
    });
  }
}

/** Auditoría en `integration_sync_state`, una entrada por cuenta. Sin tokens. */
async function cerrarAuditoria(
  tenantId: string,
  cuenta: { key: string; accountKey: string },
  r: ResumenCuentaMensual,
  status: "ok" | "partial" | "error",
): Promise<void> {
  r.finMs = Date.now();
  try {
    await upsertSyncState({
      tenantId,
      entity: entidadSyncDe(cuenta.key, cuenta.accountKey),
      lastSyncMs: r.inicioMs,
      status,
      detail: JSON.stringify({
        inicioMs: r.inicioMs, finMs: r.finMs, meses: r.meses,
        vehiculosEnlazados: r.vehiculosEnlazados, vehiculosProcesados: r.vehiculosProcesados,
        vehiculosConKm: r.vehiculosConKm, vehiculosSinDatos: r.vehiculosSinDatos,
        lotes: r.lotes, peticiones: r.peticiones, errores: r.errores,
        muestraErrores: r.muestraErrores, kmTotales: redondear(r.kmTotales),
        unidadesPorPeticion: r.unidadesPorPeticion, zonaHoraria: r.zonaHoraria,
        abandonada: r.abandonada ?? null,
      }),
    });
  } catch (e: any) {
    // La auditoría no puede tumbar la sincronización que audita.
    console.warn("[km-mensual] no se pudo guardar la auditoría:", e?.message ?? e);
  }
}

function redondear(km: number): number {
  return Math.round(km * 1000) / 1000;
}
