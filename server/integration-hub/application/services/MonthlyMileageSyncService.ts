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
import { ErrorRitmo, limitadorDe, ritmoDeConfig } from "../../infrastructure/ritmo.ts";
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

/*
 * Un lote rechazado se PARTE para aislar al vehículo que lo tumba.
 *
 * Visto en producción (octubre y noviembre de 2026, Autocares Plana): Movertis
 * contesta «Cannot read properties of undefined (reading 'toString')» a todo
 * el lote cuando UNA de sus unidades le sienta mal. Con 25 por petición, siete
 * de cada nueve lotes caían enteros, el cortacircuito saltaba y el mes anterior
 * se quedaba sin cerrar para cientos de vehículos que no tenían nada.
 *
 * Así que un rechazo (no un 503 ni una credencial) se parte en dos mitades y
 * se vuelve a pedir cada una, y la que falle se vuelve a partir, hasta dejar
 * solo al culpable con su error. Si las DOS mitades fallan enteras no es una
 * unidad rara: es el proveedor diciendo que no a todo, y no se sigue partiendo
 * (eso sería martillear con más peticiones). Con un culpable en 25 son unas
 * diez peticiones más, todas por el limitador.
 */

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
  /**
   * Cuánto se puede esperar por el cupo del proveedor antes de rendirse.
   *
   * Lo pone quien tiene a alguien delante: una pantalla no puede quedarse
   * colgada cinco minutos esperando turno. El job no lo pone, porque él sí
   * puede esperar.
   */
  esperaMaximaMs?: number;
  /** Para pruebas. */
  ahora?: Date;
}

export interface ResumenCuentaMensual {
  connectorKey: string;
  accountKey: string;
  nombre: string | null;
  zonaHoraria: string;
  unidadesPorPeticion: number;
  /** El ritmo que se ha usado, para poder verlo sin abrir la config. */
  ritmo: { maximo: number; ventanaMs: number };
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
  /** Se abandonó por no tener turno con el proveedor, sin llegar a preguntar. */
  sinCupo?: boolean;
}

export interface ResumenSyncMensual {
  correlationId: string;
  cuentas: ResumenCuentaMensual[];
}

/** Lo que devuelve el proveedor para un vehículo, o por qué no. */
type Resultado =
  | { tipo: "ok"; resumen: TripSummary }
  | { tipo: "vacio" }
  | { tipo: "error"; mensaje: string; divisible?: boolean };

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
  const ritmo = ritmoDeConfig(cuenta.config);

  const r: ResumenCuentaMensual = {
    connectorKey: cuenta.key,
    accountKey: cuenta.accountKey,
    nombre: cuenta.nombre,
    zonaHoraria: zona,
    unidadesPorPeticion: lote,
    ritmo,
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

    // El histórico también sale de la config si no lo pide quien llama: con un
    // ritmo muy bajo, trece meses de flota entera son días de peticiones, y
    // poder decir «de momento solo el mes en curso» es media prueba.
    const historico = op.mesesHistorico ?? numeroDeConfig(cuenta.config.mesesHistorico);
    const meses = op.meses?.length ? op.meses : mesesQueTocan(ahora, zona, historico);
    r.meses = meses.map(claveDeMes);

    const limitador = limitadorDe(`${op.tenantId}/${cuenta.key}/${cuenta.accountKey}`, ritmo);
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

        try {
          await limitador.turno(op.esperaMaximaMs);
        } catch (e) {
          if (!(e instanceof ErrorRitmo)) throw e;
          // Nada que guardar: al proveedor no se le ha llegado a preguntar, y
          // escribir un error en las filas diría que Movertis falló cuando lo
          // que pasa es que aquí se ha decidido no molestarlo todavía.
          r.abandonada =
            `Cupo agotado con el proveedor: quedan ${Math.ceil(e.esperaMs / 1000)} s para el siguiente turno. ` +
            `Lo terminará la sincronización de fondo.`;
          r.sinCupo = true;
          r.vehiculosProcesados = procesados.size;
          r.vehiculosConKm = conKm.size;
          r.vehiculosSinDatos = [...sinDatos].filter((id) => !conKm.has(id)).length;
          await cerrarAuditoria(op.tenantId, cuenta, r, r.errores > 0 ? "error" : "partial");
          return r;
        }
        r.peticiones += 1;
        const primera = await pedirLote(ctx, conector, tanda, limites);
        const porVehiculo = await partirSiHaceFalta(tanda, primera, async (parte) => {
          await limitador.turno(op.esperaMaximaMs);
          r.peticiones += 1;
          return pedirLote(ctx, conector, parte, limites);
        });

        // Un lote entero en error es una respuesta del proveedor, no un
        // vehículo raro: se cuentan seguidos y, pasado el tope, se para.
        const loteFallido = tanda.length > 0 && tanda.every((e) => porVehiculo.get(e.mobilink_id)?.tipo === "error");
        lotesSeguidosFallidos = loteFallido ? lotesSeguidosFallidos + 1 : 0;

        // ¿Estaba el proveedor contestando de verdad en esta petición?
        //
        // Importa para poder DAR POR CERRADO un mes sin datos. Un mes pasado
        // en el que un vehículo no se movió es un cero legítimo y no hay que
        // volver a preguntarlo nunca. Pero una respuesta vacía para los veinte
        // del lote se parece demasiado a un mal momento del proveedor, y
        // cerrar eso dejaría el mes en blanco para siempre sin que nadie lo
        // reintente. Si al menos uno trajo kilómetros, el vacío de los demás
        // es suyo; si no trajo ninguno, no se cierra nada y mañana se repite.
        const proveedorContesto = tanda.some((e) => porVehiculo.get(e.mobilink_id)?.tipo === "ok");

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
          await guardarFila(
            op.tenantId, cuenta, enlace, mes, limites, zona, res,
            // Un «sin datos» solo se cierra si el proveedor estaba contestando.
            cerrado && (res.tipo === "ok" || proveedorContesto),
          );
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
  // Los primeros días del mes, CERRAR el anterior va antes que actualizar el
  // en curso (que a esas alturas apenas tiene nada): si la pasada se queda a
  // medias, que lo que falte sea lo que mañana se vuelve a pedir de todos
  // modos, no el cierre del mes.
  if (total > 0 && diaDelMes(ahora, zona) <= DIAS_CIERRE_PRIMERO) [lista[0], lista[1]] = [lista[1], lista[0]];
  return lista;
}

/** Días del mes en los que el anterior se pide antes que el en curso. */
export const DIAS_CIERRE_PRIMERO = 7;

function diaDelMes(ahora: Date, zona: string): number {
  const d = new Intl.DateTimeFormat("en-US", { timeZone: zona, day: "numeric" })
    .formatToParts(ahora).find((p) => p.type === "day")?.value;
  return Number(d ?? 1);
}

/** Un entero de la config, o `undefined` si no lo hay. */
function numeroDeConfig(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
}

function tamanoDeLote(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return UNIDADES_POR_PETICION_POR_DEFECTO;
  return Math.min(UNIDADES_POR_PETICION_MAXIMO, Math.floor(n));
}

/** ¿Todo el lote en error? */
const todoError = (tanda: MappingRow[], res: Map<string, Resultado>) =>
  tanda.length > 0 && tanda.every((e) => res.get(e.mobilink_id)?.tipo === "error");

/**
 * Si el lote entero vino rechazado, lo parte en mitades hasta aislar a quien
 * lo tumba (ver la cabecera). `pedir` pasa por el limitador y cuenta la
 * petición. Si el limitador no da turno a tiempo, se deja de partir y lo que
 * falte queda con el error del lote: se reintentará en la siguiente pasada.
 * Exportada para probarla sin proveedor.
 */
export async function partirSiHaceFalta(
  tanda: MappingRow[],
  res: Map<string, Resultado>,
  pedir: (parte: MappingRow[]) => Promise<Map<string, Resultado>>,
): Promise<Map<string, Resultado>> {
  if (tanda.length < 2 || !todoError(tanda, res)) return res;
  const primero = res.get(tanda[0].mobilink_id);
  if (primero?.tipo !== "error" || !primero.divisible) return res;

  const mitad = Math.ceil(tanda.length / 2);
  const a = tanda.slice(0, mitad);
  const b = tanda.slice(mitad);
  // Sin turno a tiempo se deja de partir: lo que no se ha podido volver a
  // pedir se queda con el error del lote.
  const pedirSinTurno = async (parte: MappingRow[]) => {
    try { return await pedir(parte); } catch (e) { if (e instanceof ErrorRitmo) return null; throw e; }
  };
  const ra = await pedirSinTurno(a);
  if (!ra) return res;
  const rb = await pedirSinTurno(b);
  if (!rb) return new Map([...res, ...ra]);
  // Las dos mitades rechazadas enteras: es el proveedor, no una unidad.
  if (todoError(a, ra) && todoError(b, rb)) return new Map([...ra, ...rb]);
  const [fa, fb] = [await partirSiHaceFalta(a, ra, pedir), await partirSiHaceFalta(b, rb, pedir)];
  return new Map([...fa, ...fb]);
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
    // Solo un rechazo de la petición se puede aislar partiendo el lote; un
    // fallo pasajero (503, red) o de credencial no lo arregla partir.
    const divisible = err instanceof IntegrationError && err.kind === "PERMANENT";
    for (const en of tanda) salida.set(en.mobilink_id, { tipo: "error", mensaje, divisible });
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

  // Una pasada que no llegó a preguntar NADA no tiene nada que informar, y
  // guardarla borraría el informe de la que sí hizo algo. Pasó en la primera
  // prueba de Autocares Plana: dos clics seguidos, y el segundo —sin turno—
  // dejó la tarjeta en ceros tapando los veinte vehículos del primero.
  if (r.sinCupo && r.peticiones === 0) return;

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
        lotes: r.lotes, peticiones: r.peticiones, errores: r.errores, ritmo: r.ritmo,
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
