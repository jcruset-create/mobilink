/**
 * BasePresenceService — qué vehículos están ahora dentro de una base.
 *
 * Un barrido, no un seguimiento: se pide al proveedor la última posición de la
 * cuenta entera, se compara con las geo-zonas de las bases y se guarda el
 * resultado. La posición cruda no se archiva —no hace falta para decidir a
 * quién se puede revisar hoy, y guardar el rastro de una flota es otra cosa,
 * con otras implicaciones—.
 *
 * ── Una llamada, no una por vehículo ────────────────────────────────────────
 *
 * El barrido usa `FLEET_POSITIONS`. Con 751 vehículos, preguntar de uno en uno
 * son 751 peticiones cada vez que se refresca la pantalla; con la bandera
 * `lastMessagePosition` de Movertis es una, 134 KB y 1,4 s. Un conector que no
 * sepa hacerlo se salta con su motivo, y no se le pregunta vehículo a vehículo
 * por detrás: eso convertiría una pantalla en una tormenta de peticiones.
 *
 * ── Una cuenta caída no es una flota fuera de la base ───────────────────────
 *
 * Es la misma regla que gobierna `VehicleReconciliationService`, y aquí importa
 * más todavía. Si la cuenta falla, sus vehículos no están «sin posición»: no se
 * sabe. Escribir `NO_POSITION` para toda la flota borraría el último estado
 * conocido —que es justo lo que alguien iba a mirar— por un 502 de la pasarela.
 * Así que los vehículos de una cuenta que ha fallado NO se tocan, el barrido se
 * marca `incompleto` y se dice qué cuenta falló.
 *
 * ── Por qué las bases y la flota entran por puertos ─────────────────────────
 *
 * Porque el Hub no conoce `tc_delegaciones` ni `tc_vehiculos` y no debe
 * empezar: el adaptador que lee Supabase vive en `server/tyrecontrol/`. Además
 * de mantener la separación, permite probar todo esto sin base de datos.
 */

import type { OperationContext } from "../../domain/identifiers.ts";
import type { VehicleTelemetry } from "../../domain/telematics.ts";
import { sabeDarPosicionesDeFlota } from "../../domain/telematics.ts";
import {
  ESTADOS_PRESENCIA,
  evaluarPresencia,
  type EstadoPresencia,
  type GeoZonaBase,
  type Presencia,
} from "../../domain/presencia.ts";
import type { DistanciaMetros } from "../../domain/inmovilidad.ts";
import { listVehicleMappings } from "../../infrastructure/repositories.ts";
import { resolveTelematicsConnectors } from "../../connectors/ConnectorRegistry.ts";

/** Un vehículo de TyreControl, con lo justo para situarlo. */
export interface VehiculoConBase {
  id: string;
  matricula: string;
  /** Delegación asignada, si tiene. Sirve para distinguir «su base» de otra. */
  delegacionId: string | null;
  activo: boolean;
}

/** Las bases (geo-zonas) de la empresa. Lo implementa TyreControl. */
export type LectorBases = (tenantId: string) => Promise<GeoZonaBase[]>;
/** La flota de la empresa. Lo implementa TyreControl. */
export type LectorFlotaConBase = (tenantId: string) => Promise<VehiculoConBase[]>;
/** Dónde se guarda el resultado. Lo implementa TyreControl. */
export type EscritorPresencia = (filas: FilaPresencia[]) => Promise<void>;

/** Lo que se guarda de cada vehículo barrido. */
export interface FilaPresencia extends Presencia {
  /** Empresa dueña del vehículo. Es el `tenantId` del barrido, nunca otro. */
  tenantId: string;
  vehiculoId: string;
  matricula: string;
  /** Conector y cuenta de los que salió la posición. */
  proveedor: string;
  cuenta: string;
  /** Id del vehículo en el proveedor, para poder auditar de dónde vino. */
  externo: string | null;
  /**
   * Por qué no hay posición, cuando no la hay.
   *
   *  - `sin_enlace`          — el vehículo no está vinculado a ningún externo,
   *                            así que no hay a quién preguntar. No es un
   *                            fallo del proveedor: es conciliación pendiente.
   *  - `proveedor_sin_dato`  — está enlazado y el proveedor no dijo nada de él.
   *
   * Sin esta distinción, una pantalla llena de «sin posición» no dice si hay
   * que llamar al proveedor o acabar de vincular la flota.
   */
  motivo?: "sin_enlace" | "proveedor_sin_dato";
  calculadoAt: Date;
}

export interface OpcionesBarrido {
  /** Conector concreto. Sin él, todos los de telemática del cliente. */
  connectorKey?: string;
  /** Cuenta concreta. Sin ella, todas las cuentas habilitadas. */
  accountKey?: string;
  leerBases: LectorBases;
  leerFlota: LectorFlotaConBase;
  /** Sin escritor, el barrido calcula y devuelve sin guardar (previsualización). */
  guardar?: EscritorPresencia;
  distanciaMetros: DistanciaMetros;
  /** Minutos a partir de los que una posición es `STALE_POSITION`. */
  antiguedadMaxMin?: number;
  /** Reloj, inyectado para poder probar. */
  ahora?: Date;
}

/** Una cuenta consultada y lo que dio de sí. */
export interface CuentaBarrida {
  connectorKey: string;
  accountKey: string;
  nombre: string | null;
  ok: boolean;
  /** Posiciones utilizables que devolvió. */
  posiciones: number;
  /** Vehículos enlazados a esa cuenta. */
  enlazados: number;
  error?: string;
}

export interface ResultadoBarrido {
  /**
   * `completo` solo si TODAS las cuentas contestaron.
   *
   * Con una cuenta caída es `incompleto`, y los vehículos de esa cuenta se
   * quedan como estaban. Ver la cabecera.
   */
  estado: "completo" | "incompleto" | "sin_bases" | "sin_cuentas";
  cuentas: CuentaBarrida[];
  /** Filas calculadas (y guardadas, si había escritor). */
  filas: FilaPresencia[];
  /** Cuántos vehículos en cada estado, para el resumen de la pantalla. */
  porEstado: Record<EstadoPresencia, number>;
  /** Vehículos que no se han tocado por culpa de una cuenta caída. */
  omitidos: number;
}

function contadorVacio(): Record<EstadoPresencia, number> {
  return {
    [ESTADOS_PRESENCIA.IN_BASE]: 0,
    [ESTADOS_PRESENCIA.OUTSIDE_BASES]: 0,
    [ESTADOS_PRESENCIA.STALE_POSITION]: 0,
    [ESTADOS_PRESENCIA.NO_POSITION]: 0,
    [ESTADOS_PRESENCIA.INVALID_POSITION]: 0,
  };
}

/**
 * Barre la flota de un cliente y dice quién está en base.
 *
 * `ctx.tenantId` es la empresa, y de ahí no se sale: las bases se filtran por
 * ella y los enlaces se leen por ella. Nada de lo que llegue en una petición
 * decide qué flota se consulta.
 */
export async function barrerPresenciaBases(
  ctx: OperationContext,
  opciones: OpcionesBarrido,
): Promise<ResultadoBarrido> {
  const ahora = opciones.ahora ?? new Date();
  const vacio = (estado: ResultadoBarrido["estado"]): ResultadoBarrido => ({
    estado,
    cuentas: [],
    filas: [],
    porEstado: contadorVacio(),
    omitidos: 0,
  });

  const [bases, flota] = await Promise.all([
    opciones.leerBases(ctx.tenantId),
    opciones.leerFlota(ctx.tenantId),
  ]);

  // Sin bases configuradas, TODOS saldrían «fuera de las bases», que es una
  // mentira con forma de dato: lo que pasa es que nadie ha dicho dónde están
  // las bases. Se para y se dice, sin escribir nada.
  const propias = bases.filter((b) => b.empresaId === ctx.tenantId);
  if (propias.length === 0) return vacio("sin_bases");

  let conectores = await resolveTelematicsConnectors(ctx.tenantId);
  if (opciones.connectorKey) {
    conectores = conectores.filter((c) => c.key === opciones.connectorKey);
  }
  if (opciones.accountKey) {
    conectores = conectores.filter((c) => c.accountKey === opciones.accountKey);
  }
  if (conectores.length === 0) return vacio("sin_cuentas");

  // ── Se pregunta a cada cuenta ─────────────────────────────────────────────
  const cuentas: CuentaBarrida[] = [];
  // externo → lectura, por cuenta. La clave lleva la cuenta porque dos
  // proveedores pueden usar el mismo id para vehículos distintos.
  const lecturas = new Map<string, VehicleTelemetry>();
  // vehiculoId → { cuenta, externo }. Un vehículo enlazado a más de una cuenta
  // se queda con el primero: no es un caso esperado y elegir es mejor que
  // duplicar la fila del vehículo.
  const enlacePorVehiculo = new Map<string, { clave: string; externo: string; connectorKey: string; accountKey: string }>();
  const cuentasCaidas = new Set<string>();
  /**
   * Umbral de antigüedad por cuenta, si la cuenta lo declara.
   *
   * Sale de `integration_connector_configs.config.antiguedadMaxMin`, que ya
   * existe y es por cuenta: no hace falta tabla nueva, y una flota de autobuses
   * urbanos que emite cada minuto puede exigir un umbral más estricto que una
   * de discrecionales sin tocar a la otra.
   */
  const umbralPorCuenta = new Map<string, number>();

  for (const c of conectores) {
    const clave = `${c.key}::${c.accountKey}`;
    const umbral = Number((c.config as Record<string, unknown>)?.antiguedadMaxMin);
    if (Number.isFinite(umbral) && umbral > 0) umbralPorCuenta.set(clave, umbral);
    const mapeos = await listVehicleMappings({
      tenantId: ctx.tenantId,
      system: c.key,
      accountKey: c.accountKey,
    });
    let enlazados = 0;
    for (const m of mapeos) {
      if (!m.active) continue;
      const vehiculoId = String(m.mobilink_id);
      enlazados += 1;
      if (!enlacePorVehiculo.has(vehiculoId)) {
        enlacePorVehiculo.set(vehiculoId, {
          clave,
          externo: String(m.external_code),
          connectorKey: c.key,
          accountKey: c.accountKey,
        });
      }
    }

    if (!sabeDarPosicionesDeFlota(c.connector)) {
      cuentasCaidas.add(clave);
      cuentas.push({
        connectorKey: c.key,
        accountKey: c.accountKey,
        nombre: c.nombre,
        ok: false,
        posiciones: 0,
        enlazados,
        // No es un error de red: es que este proveedor no sabe barrer la flota.
        // Se trata como cuenta no consultada para no borrar su último estado.
        error: "El conector no sabe dar la posición de toda la flota",
      });
      continue;
    }

    try {
      const posiciones = await c.connector.getFleetPositions(ctx);
      for (const p of posiciones) {
        lecturas.set(`${clave}::${p.providerVehicleId}`, p);
      }
      cuentas.push({
        connectorKey: c.key,
        accountKey: c.accountKey,
        nombre: c.nombre,
        ok: true,
        posiciones: posiciones.length,
        enlazados,
      });
    } catch (e: any) {
      cuentasCaidas.add(clave);
      cuentas.push({
        connectorKey: c.key,
        accountKey: c.accountKey,
        nombre: c.nombre,
        ok: false,
        posiciones: 0,
        enlazados,
        error: e?.message ?? "Error consultando la cuenta",
      });
    }
  }

  // ── Se clasifica vehículo a vehículo ──────────────────────────────────────
  const filas: FilaPresencia[] = [];
  const porEstado = contadorVacio();
  let omitidos = 0;

  for (const v of flota) {
    // Los inactivos no se barren: un vehículo dado de baja no se va a revisar,
    // y llenar la pantalla con ellos esconde a los que sí.
    if (!v.activo) continue;

    const enlace = enlacePorVehiculo.get(v.id);
    // Vehículo de una cuenta que ha fallado: no se toca. Su fila anterior sigue
    // siendo lo último que se supo, y eso es más útil que un «no se sabe».
    if (enlace && cuentasCaidas.has(enlace.clave)) {
      omitidos += 1;
      continue;
    }

    const lectura = enlace ? lecturas.get(`${enlace.clave}::${enlace.externo}`) ?? null : null;
    const presencia = evaluarPresencia({
      lectura,
      bases: propias,
      delegacionId: v.delegacionId,
      ahora,
      antiguedadMaxMin:
        (enlace ? umbralPorCuenta.get(enlace.clave) : undefined) ??
        opciones.antiguedadMaxMin,
      distanciaMetros: opciones.distanciaMetros,
    });

    porEstado[presencia.estado] += 1;
    filas.push({
      ...presencia,
      tenantId: ctx.tenantId,
      vehiculoId: v.id,
      matricula: v.matricula,
      proveedor: enlace?.connectorKey ?? "",
      cuenta: enlace?.accountKey ?? "",
      externo: enlace?.externo ?? null,
      motivo:
        presencia.estado === ESTADOS_PRESENCIA.NO_POSITION
          ? enlace
            ? "proveedor_sin_dato"
            : "sin_enlace"
          : undefined,
      calculadoAt: ahora,
    });
  }

  if (opciones.guardar && filas.length > 0) await opciones.guardar(filas);

  return {
    estado: cuentas.some((c) => !c.ok) ? "incompleto" : "completo",
    cuentas,
    filas,
    porEstado,
    omitidos,
  };
}
