/**
 * VehicleReconciliationService — cruzar la flota del proveedor con la de TyreControl.
 *
 * El Telematics Hub ya sabe preguntar el kilometraje de un vehículo enlazado
 * (`VehicleOdometerService`), pero hasta ahora **nadie escribía esos enlaces**:
 * `findExternalCode` devolvía siempre null y el odómetro nunca llegaba. Esta es
 * la pieza que faltaba, y su único trabajo es preparar la información para que
 * una persona decida. No enlaza sola, no crea vehículos y no da de baja a nadie.
 *
 * ── Por qué la flota interna entra por un puerto ────────────────────────────
 *
 * El Hub no conoce `tc_vehiculos` y no debería empezar ahora: hoy no importa
 * Supabase en ninguna parte, y `VehicleOdometerService` se las arregla recibiendo
 * un `mobilinkId` sin saber qué hay detrás. Aquí hace falta la flota entera, así
 * que se recibe por parámetro (`LectorFlotaInterna`) y el adaptador que lee
 * TyreControl vive en `server/tyrecontrol/conciliacion/`. Además de mantener la
 * separación, esto hace que toda la lógica se pueda probar sin base de datos.
 *
 * ── Una cuenta caída no es una flota que desaparece ─────────────────────────
 *
 * Es la regla que gobierna el diseño entero. Si una de las dos cuentas de un
 * cliente falla, sus vehículos no están «ausentes»: no se sabe. La conciliación
 * se marca `incomplete`, se dice qué cuenta falló, y las bajas se desactivan.
 * Lo contrario —clasificar con lo que haya llegado— produciría una lista de
 * cientos de vehículos «solo en TyreControl» invitando a darlos de baja.
 */

import type { OperationContext } from "../../domain/identifiers.ts";
import type { ProviderVehicle } from "../../domain/telematics.ts";
import {
  clasificarFlota,
  resumir,
  type EnlaceVehiculo,
  type ResultadoConciliacion,
  type ResultadoCuenta,
  type VehiculoInterno,
} from "../../domain/reconciliation.ts";
import {
  listIgnoredExternals,
  listVehicleMappings,
  touchVehiclesLastSeen,
  type MappingRow,
} from "../../infrastructure/repositories.ts";
import { resolveTelematicsConnectors } from "../../connectors/ConnectorRegistry.ts";

/** Trae los vehículos de TyreControl de la empresa. Lo implementa TyreControl. */
export type LectorFlotaInterna = (tenantId: string) => Promise<VehiculoInterno[]>;

/** Normalizador de matrícula. Lo implementa TyreControl; aquí no se duplica. */
export type NormalizadorMatricula = (valor: unknown) => string;

export interface OpcionesConciliacion {
  /** Conector concreto. Sin él, todos los de telemática del cliente. */
  connectorKey?: string;
  /** Cuenta concreta. Sin ella, todas las cuentas habilitadas del conector. */
  accountKey?: string;
  /** Cómo leer la flota de TyreControl. */
  leerFlotaInterna: LectorFlotaInterna;
  /** Cómo normalizar una matrícula antes de compararla. */
  normalizarMatricula: NormalizadorMatricula;
  /**
   * Si se puede escribir `last_seen_at` de los vehículos vistos.
   *
   * Se apaga en la previsualización y en los tests. Por defecto sí, porque el
   * uso normal de esta función es una conciliación de verdad.
   */
  registrarUltimaVez?: boolean;
}

/** Una cuenta consultada y lo que dio de sí. */
interface LecturaCuenta {
  connectorKey: string;
  accountKey: string;
  ok: boolean;
  vehiculos: ProviderVehicle[];
  error?: string;
}

/**
 * Un `BIGINT` de PostgreSQL a número, o null.
 *
 * Hace falta porque node-postgres devuelve los BIGINT como CADENA, y no por
 * capricho: un bigint no cabe en el number de JavaScript, así que el driver
 * prefiere no perder precisión a que nadie se dé cuenta. Aquí sí cabe —son
 * milisegundos de época, unos 13 dígitos— pero la cadena viaja intacta hasta la
 * pantalla, y allí `new Date("1789204588796")` no es la fecha: es **Invalid
 * Date**, porque a `new Date` una cadena se le parsea como texto de fecha y no
 * como marca de tiempo.
 *
 * Eso es lo que ponía «visto: Invalid Date» en todas las filas de la
 * conciliación, y por qué la guarda `if (!ms) return "—"` de la pantalla no lo
 * atrapaba: una cadena no vacía es truthy. La pista estaba en
 * `enlacesVehiculo.integration.test.ts`, que compara con `Number(...)` alrededor
 * del valor: quien escribió esa prueba ya sabía que llegaba como cadena.
 *
 * Se convierte AQUÍ, en la frontera, y no en la pantalla: el dominio, la API y
 * la interfaz declaran todos `number | null`, así que la cadena era una mentira
 * de tipos desde la primera línea.
 */
export function msDeBigint(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Traduce una fila de `integration_mappings` al vocabulario del dominio. */
function aEnlace(fila: MappingRow & { last_seen_at_ms?: number | string | null }): EnlaceVehiculo {
  const meta = (fila.metadata ?? {}) as Record<string, unknown>;
  const texto = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v : null);
  return {
    mobilinkId: fila.mobilink_id,
    externalCode: fila.external_code,
    activo: fila.active !== false,
    metodo: texto(meta.match_method),
    matriculaSnapshot: texto(meta.external_plate_snapshot),
    matriculaInternaSnapshot: texto(meta.internal_plate_snapshot),
    nombreSnapshot: texto(meta.external_name_snapshot),
    ultimaVezVistoMs: msDeBigint(fila.last_seen_at_ms),
  };
}

/**
 * Pregunta a una cuenta por su flota, sin dejar que un fallo tumbe el resto.
 *
 * El error se captura y se devuelve como dato porque la conciliación tiene que
 * poder decir «la cuenta B falló» y seguir enseñando lo de la cuenta A. Lanzar
 * aquí convertiría un fallo parcial en un fallo total.
 */
async function leerCuenta(
  ctx: OperationContext,
  cuenta: { key: string; accountKey: string; connector: { listVehicles: (c: OperationContext) => Promise<ProviderVehicle[]> } },
): Promise<LecturaCuenta> {
  try {
    const vehiculos = await cuenta.connector.listVehicles(ctx);
    return { connectorKey: cuenta.key, accountKey: cuenta.accountKey, ok: true, vehiculos };
  } catch (e) {
    return {
      connectorKey: cuenta.key,
      accountKey: cuenta.accountKey,
      ok: false,
      vehiculos: [],
      error: (e as Error)?.message ?? String(e),
    };
  }
}

/**
 * Concilia la flota de un cliente con la de sus cuentas telemáticas.
 *
 * No escribe nada en TyreControl. Lo único que puede escribir es
 * `last_seen_at_ms` de los enlaces cuyos vehículos se han visto de verdad.
 */
export async function conciliarFlota(
  ctx: OperationContext,
  opciones: OpcionesConciliacion,
): Promise<ResultadoConciliacion> {
  const startedAt = new Date();

  let cuentas = await resolveTelematicsConnectors(ctx.tenantId);
  if (opciones.connectorKey) cuentas = cuentas.filter((c) => c.key === opciones.connectorKey);
  if (opciones.accountKey) cuentas = cuentas.filter((c) => c.accountKey === opciones.accountKey);

  const internos = await opciones.leerFlotaInterna(ctx.tenantId);

  // Sin ninguna cuenta configurada no hay nada que conciliar, y decirlo con un
  // resultado vacío y `status: error` es más honesto que devolver la flota
  // entera como «solo en TyreControl», que es lo que saldría al clasificar
  // contra una lista vacía.
  if (cuentas.length === 0) {
    const vacios = {
      enlazados: [], soloProveedor: [], soloTyreControl: [], discrepancias: [],
      noEvaluados: internos,
    };
    return {
      ...vacios,
      externosVistos: [],
      resumen: resumir({
        cuadrantes: vacios,
        cuentas: [],
        internos: internos.length,
        externos: 0,
        desconocidos: internos.length,
        startedAt,
        completedAt: new Date(),
      }),
    };
  }

  const lecturas = await Promise.all(cuentas.map((c) => leerCuenta(ctx, c as any)));

  // Enlaces e ignorados de todas las cuentas consultadas, en paralelo.
  const porCuenta = await Promise.all(
    cuentas.map(async (c) => ({
      cuenta: c,
      enlaces: await listVehicleMappings({
        tenantId: ctx.tenantId,
        system: c.key,
        accountKey: c.accountKey,
      }),
      ignorados: await listIgnoredExternals({
        tenantId: ctx.tenantId,
        entityType: "vehicle",
        system: c.key,
        accountKey: c.accountKey,
      }),
    })),
  );

  const ignorados = new Set(porCuenta.flatMap((p) => p.ignorados.map((i) => i.external_code)));
  const externos = lecturas.flatMap((l) => l.vehiculos);

  // ── Lo que pertenece a una cuenta caída se aparta, no se clasifica ────────
  //
  // Si la cuenta B no contesta, sus enlaces no se pueden juzgar: el vehículo
  // externo no está en la respuesta porque no hay respuesta, no porque lo hayan
  // retirado. Clasificarlos daría «externo desaparecido» para cada uno y
  // metería sus vehículos de TyreControl en la lista de candidatos a baja, que
  // es exactamente el desastre que esta conciliación existe para no provocar.
  const cuentaCaida = (system: string, accountKey: string) =>
    lecturas.some((l) => !l.ok && l.connectorKey === system && l.accountKey === accountKey);

  const enlaces: EnlaceVehiculo[] = porCuenta
    .filter((p) => !cuentaCaida(p.cuenta.key, p.cuenta.accountKey))
    .flatMap((p) => p.enlaces.map(aEnlace));

  const sinEvaluar = new Set(
    porCuenta
      .filter((p) => cuentaCaida(p.cuenta.key, p.cuenta.accountKey))
      .flatMap((p) => p.enlaces.filter((e) => e.active !== false).map((e) => e.mobilink_id)),
  );
  const internosEvaluables = internos.filter((v) => !sinEvaluar.has(v.id));

  // `last_seen_at` SOLO de las cuentas que respondieron bien. La condición
  // «apareció en la respuesta» la cumple la propia lista de códigos.
  if (opciones.registrarUltimaVez !== false) {
    const ahora = Date.now();
    await Promise.all(
      lecturas
        .filter((l) => l.ok && l.vehiculos.length > 0)
        .map((l) =>
          touchVehiclesLastSeen({
            tenantId: ctx.tenantId,
            system: l.connectorKey,
            accountKey: l.accountKey,
            externalCodes: l.vehiculos.map((v) => v.providerVehicleId),
            at: ahora,
          }),
        ),
    );
  }

  // Solo se puede afirmar que un vehículo NO está en el proveedor si TODAS las
  // cuentas han contestado. Con una caída, un vehículo sin enlace podría estar
  // en la que falló, y declararlo «solo en TyreControl» es exactamente la lista
  // falsa que esta conciliación existe para no producir.
  const todasRespondieron = lecturas.length > 0 && lecturas.every((l) => l.ok);

  const cuadrantes = clasificarFlota({
    externos,
    internos: internosEvaluables,
    enlaces,
    ignorados,
    puedeAfirmarAusencias: todasRespondieron,
    normalizarMatricula: opciones.normalizarMatricula,
  });

  const resultadoCuentas: ResultadoCuenta[] = lecturas.map((l) => ({
    connectorKey: l.connectorKey,
    accountKey: l.accountKey,
    ok: l.ok,
    vehiculos: l.vehiculos.length,
    ...(l.error ? { error: l.error } : {}),
  }));

  return {
    ...cuadrantes,
    externosVistos: externos.map((v) => v.providerVehicleId),
    resumen: resumir({
      cuadrantes,
      cuentas: resultadoCuentas,
      internos: internos.length,
      externos: externos.length,
      desconocidos: sinEvaluar.size + cuadrantes.noEvaluados.length,
      startedAt,
      completedAt: new Date(),
    }),
  };
}
