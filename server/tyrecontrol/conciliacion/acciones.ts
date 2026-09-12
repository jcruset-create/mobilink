/**
 * Las acciones de la conciliación: lo único que escribe algo.
 *
 * Todas comparten la misma forma y la misma obsesión: **la empresa se deriva de
 * la sesión y el vehículo se comprueba contra la base**, nunca contra lo que
 * diga quien llama. Un identificador de vehículo que llega por la red es una
 * propuesta, no una autorización: sin esta comprobación, un `tcVehicleId` de la
 * empresa B enviado por un administrador de la empresa A escribiría el
 * kilometraje del camión de otro cliente en su ficha.
 *
 * Ninguna de estas acciones desmonta neumáticos, mueve stock, toca montajes,
 * altera históricos ni cambia la configuración de ejes. Las que tienen efecto
 * en TyreControl son exactamente dos: crear un vehículo pendiente de validar y
 * poner `activo = false`. Las demás solo escriben en el Hub.
 */

import { supabase } from "../../supabase.ts";
import { coincideMatricula, patronBusquedaMatricula } from "../matricula.ts";
import { METODOS_VINCULO, type MetodoVinculo } from "../../integration-hub/domain/reconciliation.ts";
import {
  ignoreExternal,
  listVehicleMappings,
  setVehicleMappingActive,
  unignoreExternal,
  upsertMapping,
} from "../../integration-hub/infrastructure/repositories.ts";
import { vehiculoDeLaEmpresa } from "./flota.ts";

/** Un fallo que la pantalla puede enseñar tal cual, con su código HTTP. */
export class ErrorConciliacion extends Error {
  constructor(public codigo: string, mensaje: string, public estado = 400) {
    super(mensaje);
  }
}

/** Lo que toda acción necesita saber para no salirse de su empresa y su cuenta. */
export interface Ambito {
  /** Derivada de la sesión. Es a la vez `tc_empresas.id` y el `tenantId` del Hub. */
  empresaId: string;
  connectorKey: string;
  accountKey: string;
}

/** El vehículo existe y es de esta empresa, o se acaba aquí. */
async function exigirVehiculoPropio(ambito: Ambito, tcVehicleId: string) {
  const v = await vehiculoDeLaEmpresa(tcVehicleId, ambito.empresaId);
  if (!v) {
    // El mismo mensaje para «no existe» y para «es de otra empresa»: decir cuál
    // de las dos es confirmaría la existencia de un vehículo ajeno.
    throw new ErrorConciliacion(
      "VEHICULO_NO_ENCONTRADO",
      "El vehículo no existe en esta empresa.",
      404,
    );
  }
  return v;
}

// ── Vincular ────────────────────────────────────────────────────────────────

export interface DatosVinculo {
  tcVehicleId: string;
  externalVehicleId: string;
  matchMethod?: MetodoVinculo;
  /** Matrícula que el proveedor daba en el momento de vincular. */
  externalPlate?: string | null;
  /** Nombre o alias que el proveedor daba en el momento de vincular. */
  externalName?: string | null;
}

/**
 * Enlaza un vehículo de TyreControl con uno del proveedor.
 *
 * Comprueba la invariante ANTES de escribir para poder dar un mensaje que se
 * entienda. El índice único parcial de la base la comprueba también, y esa es
 * la que de verdad protege: entre la lectura y la escritura cabe otra pestaña.
 */
export async function vincular(ambito: Ambito, datos: DatosVinculo) {
  await exigirVehiculoPropio(ambito, datos.tcVehicleId);

  const externalCode = String(datos.externalVehicleId ?? "").trim();
  if (!externalCode) {
    throw new ErrorConciliacion("EXTERNO_VACIO", "Falta el identificador del vehículo del proveedor.");
  }

  const enlaces = await listVehicleMappings({
    tenantId: ambito.empresaId,
    system: ambito.connectorKey,
    accountKey: ambito.accountKey,
  });

  const yaEnlazado = enlaces.find(
    (e) => e.active !== false && e.mobilink_id === datos.tcVehicleId && e.external_code !== externalCode,
  );
  if (yaEnlazado) {
    throw new ErrorConciliacion(
      "VEHICULO_YA_ENLAZADO",
      `Este vehículo ya está enlazado con ${yaEnlazado.external_code} en esta cuenta. ` +
        `Desvincúlalo antes de enlazarlo con otro.`,
      409,
    );
  }

  const externoOcupado = enlaces.find(
    (e) => e.active !== false && e.external_code === externalCode && e.mobilink_id !== datos.tcVehicleId,
  );
  if (externoOcupado) {
    throw new ErrorConciliacion(
      "EXTERNO_YA_ENLAZADO",
      `El vehículo ${externalCode} del proveedor ya está enlazado con otro vehículo de ` +
        `TyreControl en esta cuenta.`,
      409,
    );
  }

  return upsertMapping({
    tenantId: ambito.empresaId,
    entityType: "vehicle",
    system: ambito.connectorKey,
    accountKey: ambito.accountKey,
    externalCode,
    mobilinkId: datos.tcVehicleId,
    active: true,
    metadata: {
      match_method: datos.matchMethod ?? METODOS_VINCULO.MANUAL,
      // Las fotos del momento del enlace. Sirven para detectar después que al
      // vehículo le han cambiado la matrícula en la plataforma del proveedor,
      // sin sobrescribir nada en TyreControl.
      external_plate_snapshot: datos.externalPlate ?? null,
      external_name_snapshot: datos.externalName ?? null,
      linked_at_ms: Date.now(),
    },
  });
}

// ── Desvincular ─────────────────────────────────────────────────────────────

/**
 * Deshace un enlace SIN borrarlo.
 *
 * Se conserva el código externo, el metadata y las fechas, para poder contestar
 * más adelante a «este vehículo estuvo enlazado con el X del proveedor». Lo
 * único que cambia es `active`, y con él `findExternalCode` deja de devolverlo,
 * que es lo que hace que el odómetro pare de preguntar por él.
 */
export async function desvincular(
  ambito: Ambito,
  datos: { tcVehicleId: string; externalVehicleId: string },
) {
  await exigirVehiculoPropio(ambito, datos.tcVehicleId);

  const fila = await setVehicleMappingActive({
    tenantId: ambito.empresaId,
    system: ambito.connectorKey,
    accountKey: ambito.accountKey,
    mobilinkId: datos.tcVehicleId,
    externalCode: datos.externalVehicleId,
    active: false,
  });
  if (!fila) {
    throw new ErrorConciliacion("ENLACE_NO_ENCONTRADO", "No había ningún enlace que deshacer.", 404);
  }
  return fila;
}

// ── Ignorar y dejar de ignorar ──────────────────────────────────────────────

export async function ignorar(
  ambito: Ambito,
  datos: { externalVehicleId: string; motivo?: string | null },
) {
  return ignoreExternal({
    tenantId: ambito.empresaId,
    entityType: "vehicle",
    system: ambito.connectorKey,
    accountKey: ambito.accountKey,
    externalCode: datos.externalVehicleId,
    reason: datos.motivo ?? null,
  });
}

export async function dejarDeIgnorar(ambito: Ambito, datos: { externalVehicleId: string }) {
  const habia = await unignoreExternal({
    tenantId: ambito.empresaId,
    entityType: "vehicle",
    system: ambito.connectorKey,
    accountKey: ambito.accountKey,
    externalCode: datos.externalVehicleId,
  });
  if (!habia) {
    throw new ErrorConciliacion("NO_IGNORADO", "Ese vehículo no estaba ignorado.", 404);
  }
  return { ok: true };
}

// ── Crear en TyreControl desde el proveedor ─────────────────────────────────

export interface DatosAlta {
  externalVehicleId: string;
  matricula: string;
  bastidor?: string | null;
  numeroUnidad?: string | null;
  externalName?: string | null;
}

/**
 * Da de alta un vehículo que solo estaba en el proveedor, y lo enlaza.
 *
 * ── Qué se copia y qué no ───────────────────────────────────────────────────
 *
 * Solo lo inequívoco: matrícula, bastidor y número de unidad. NO se inventan
 * tipo de vehículo, configuración de ejes, medida ni llanta, que es de donde
 * cuelga todo el control de neumáticos: un eje mal supuesto produce posiciones
 * que no existen y mediciones que no cuadran con la rueda que se mira. Tampoco
 * marca y modelo, que en las plataformas telemáticas suelen venir del alias que
 * alguien tecleó.
 *
 * Por eso nace `pendiente_validar`: aparece en la pantalla de validación que ya
 * existe y un administrador le completa la ficha antes de que se pueda operar
 * con él. Es el mismo camino que un alta desde la tablet.
 */
export async function crearPendiente(ambito: Ambito, datos: DatosAlta) {
  const matricula = String(datos.matricula ?? "").trim();
  if (!matricula) {
    throw new ErrorConciliacion(
      "SIN_MATRICULA",
      "El proveedor no da matrícula para este vehículo, así que no se puede crear " +
        "automáticamente. Créalo a mano y vincúlalo.",
    );
  }

  // `unique (empresa_id, matricula)` reventaría, pero con un error de base que
  // no dice nada. Y como las matrículas NO están normalizadas en la tabla, una
  // igualdad simple no basta: `1234ABC` y `1234-ABC` son la misma y chocarían.
  //
  // Se usa el buscador de `matricula.ts` en vez de traerse la flota entera:
  // filtra en el servidor con un patrón de comodines y deja un puñado de filas,
  // que después se confirman normalizando. Es el mismo camino que sigue Assist
  // para resolver una matrícula, y no hay dos formas de compararlas.
  const patron = patronBusquedaMatricula(matricula);
  const { data: existentes } = patron
    ? await supabase
        .from("tc_vehiculos")
        .select("id, matricula")
        .eq("empresa_id", ambito.empresaId)
        .ilike("matricula", patron)
    : { data: [] as any[] };
  const choque = (existentes ?? []).find((v: any) => coincideMatricula(v.matricula, matricula));
  if (choque) {
    throw new ErrorConciliacion(
      "MATRICULA_YA_EXISTE",
      `Ya hay un vehículo con la matrícula ${(choque as any).matricula} en esta empresa. ` +
        `Vincúlalo con este en vez de crear uno nuevo.`,
      409,
    );
  }

  const { data, error } = await supabase
    .from("tc_vehiculos")
    .insert({
      empresa_id: ambito.empresaId,
      matricula,
      bastidor: datos.bastidor ?? null,
      numero_unidad: datos.numeroUnidad ?? null,
      km_actual: 0,
      origen_km: "manual",
      activo: true,
      pendiente_validar: true,
      creado_desde: "telematica",
    })
    .select("id, matricula")
    .single();
  if (error || !data) {
    throw new ErrorConciliacion(
      "ALTA_FALLIDA",
      `No se pudo crear el vehículo: ${error?.message ?? "sin detalle"}`,
      500,
    );
  }

  const vehiculo = { id: String((data as any).id), matricula: String((data as any).matricula) };
  const enlace = await vincular(ambito, {
    tcVehicleId: vehiculo.id,
    externalVehicleId: datos.externalVehicleId,
    matchMethod: METODOS_VINCULO.CREADO_DESDE_PROVEEDOR,
    externalPlate: matricula,
    externalName: datos.externalName ?? null,
  });

  return { vehiculo, enlace, pendienteValidar: true };
}

// ── Dar de baja ─────────────────────────────────────────────────────────────

export interface DatosBaja {
  tcVehicleId: string;
  /**
   * Cuántos neumáticos decía la pantalla que llevaba montados.
   *
   * Se exige para que la baja no pueda salir de un botón que se pulsó sin ver
   * el aviso: si lo que se manda no coincide con lo que hay ahora, la pantalla
   * estaba desfasada y la baja se rechaza para que se vuelva a mirar.
   */
  neumaticosMontadosVistos: number;
  /** También desactivar el enlace con el proveedor, si lo hay. */
  desvincularTambien?: boolean;
}

/**
 * Baja lógica, con el mecanismo que ya existe: `tc_vehiculos.activo = false`.
 *
 * No se crea ningún sistema paralelo de baja. Y no se toca nada más: los
 * neumáticos siguen montados, el histórico intacto, el stock igual y las
 * operaciones donde estaban. Un vehículo dado de baja desaparece de la tablet
 * y sigue en el panel y en los informes.
 *
 * El enlace con el proveedor NO se desactiva solo. Son dos decisiones
 * distintas —«este vehículo ya no opera» y «este vehículo ya no es aquel equipo
 * telemático»— y hacer la segunda a escondidas dentro de la primera es
 * exactamente la acción oculta que no queremos. Quien pulse decide, y por eso
 * `desvincularTambien` es explícito.
 */
export async function darDeBaja(ambito: Ambito, datos: DatosBaja) {
  const vehiculo = await exigirVehiculoPropio(ambito, datos.tcVehicleId);
  if (!vehiculo.activo) {
    throw new ErrorConciliacion("YA_DE_BAJA", "Este vehículo ya estaba dado de baja.", 409);
  }

  const { count, error: errCount } = await supabase
    .from("tc_montajes_actuales")
    .select("id", { count: "exact", head: true })
    .eq("vehiculo_id", datos.tcVehicleId);
  if (errCount) {
    throw new ErrorConciliacion(
      "MONTAJES_NO_LEIDOS",
      `No se pudo comprobar cuántos neumáticos lleva montados: ${errCount.message}`,
      500,
    );
  }
  const montados = count ?? 0;
  if (montados !== datos.neumaticosMontadosVistos) {
    throw new ErrorConciliacion(
      "MONTAJES_CAMBIARON",
      `El vehículo lleva ahora ${montados} neumáticos montados y la pantalla decía ` +
        `${datos.neumaticosMontadosVistos}. Vuelve a conciliar antes de darlo de baja.`,
      409,
    );
  }

  const { error } = await supabase
    .from("tc_vehiculos")
    .update({ activo: false })
    .eq("id", datos.tcVehicleId)
    .eq("empresa_id", ambito.empresaId);
  if (error) {
    throw new ErrorConciliacion("BAJA_FALLIDA", `No se pudo dar de baja: ${error.message}`, 500);
  }

  let enlaceDesactivado: string | null = null;
  if (datos.desvincularTambien) {
    const enlaces = await listVehicleMappings({
      tenantId: ambito.empresaId,
      system: ambito.connectorKey,
      accountKey: ambito.accountKey,
    });
    const activo = enlaces.find((e) => e.active !== false && e.mobilink_id === datos.tcVehicleId);
    if (activo) {
      await setVehicleMappingActive({
        tenantId: ambito.empresaId,
        system: ambito.connectorKey,
        accountKey: ambito.accountKey,
        mobilinkId: datos.tcVehicleId,
        externalCode: activo.external_code,
        active: false,
      });
      enlaceDesactivado = activo.external_code;
    }
  }

  return {
    vehiculoId: vehiculo.id,
    matricula: vehiculo.matricula,
    neumaticosMontados: montados,
    enlaceDesactivado,
    aviso:
      montados > 0
        ? `El vehículo tenía ${montados} neumáticos montados. La baja no los ha desmontado ` +
          `ni ha tocado su histórico.`
        : null,
  };
}

// ── Vincular todas las coincidencias exactas de una vez ─────────────────────

export interface ResultadoLote {
  enlazados: number;
  fallidos: Array<{ tcVehicleId: string; externalVehicleId: string; error: string }>;
}

/**
 * Enlaza de golpe todas las propuestas por matrícula exacta.
 *
 * ── Por qué el servidor NO se fía de la lista que le manden ─────────────────
 *
 * La tentación es que el navegador envíe los pares que ve en pantalla. No se
 * hace: eso convertiría «vincular las coincidencias exactas» en «vincular lo
 * que yo diga, etiquetado como exacto», y bastaría un fallo del cliente —o una
 * petición fabricada a mano— para escribir enlaces cruzados con el sello de
 * automáticos. Aquí se vuelve a conciliar y se enlaza únicamente lo que el
 * servidor calcula como propuesta suya.
 *
 * Una propuesta es, por construcción, coincidencia ÚNICA y EXACTA de matrícula
 * normalizada: las ambiguas se van a discrepancias y las que no traen matrícula
 * no proponen nada. Confirmarlas en bloque es la misma decisión repetida, no una
 * decisión distinta, y sigue siendo reversible porque desvincular conserva el
 * enlace desactivado.
 *
 * ── La pantalla desfasada ───────────────────────────────────────────────────
 *
 * `esperados` es lo que decía la pantalla cuando alguien pulsó. Si el servidor
 * calcula otro número, la conciliación ha cambiado por debajo —alguien enlazó
 * desde otra pestaña, el proveedor devolvió otra cosa— y se rechaza en vez de
 * enlazar un conjunto que nadie ha visto. Es el mismo criterio que la baja con
 * su recuento de neumáticos.
 */
export async function vincularLote(
  ambito: Ambito,
  datos: { esperados?: number } = {},
): Promise<ResultadoLote> {
  // Se importa aquí, no arriba, por lo mismo que `kilometrajeOperacion.ts`: el
  // servicio arrastra la base del Hub, y TyreControl no tiene por qué exigirla
  // solo por cargar este módulo.
  const { conciliarFlota } = await import(
    "../../integration-hub/application/services/VehicleReconciliationService.ts"
  );
  const { leerFlotaInterna } = await import("./flota.ts");
  const { normalizarMatricula } = await import("../matricula.ts");
  const { nextCorrelationId } = await import("../../integration-hub/infrastructure/repositories.ts");

  const resultado = await conciliarFlota(
    { tenantId: ambito.empresaId, correlationId: await nextCorrelationId() },
    {
      connectorKey: ambito.connectorKey,
      accountKey: ambito.accountKey,
      leerFlotaInterna,
      normalizarMatricula,
      // Ya se registró al conciliar para pintar la pantalla; no hace falta otra vez.
      registrarUltimaVez: false,
    },
  );

  const propuestas = resultado.soloProveedor.filter((f) => f.propuesta);

  if (datos.esperados !== undefined && datos.esperados !== propuestas.length) {
    throw new ErrorConciliacion(
      "PROPUESTAS_CAMBIARON",
      `Ahora hay ${propuestas.length} coincidencias exactas y la pantalla decía ` +
        `${datos.esperados}. Vuelve a conciliar antes de enlazar en bloque.`,
      409,
    );
  }
  if (propuestas.length === 0) {
    throw new ErrorConciliacion("SIN_PROPUESTAS", "No hay ninguna coincidencia exacta que enlazar.");
  }

  const fallidos: ResultadoLote["fallidos"] = [];
  let enlazados = 0;

  // Por tandas: seiscientos upserts a la vez agotan el pool de conexiones, y en
  // serie son seiscientas idas y venidas. Veinte es un término medio sobrio.
  const TANDA = 20;
  for (let i = 0; i < propuestas.length; i += TANDA) {
    const tanda = propuestas.slice(i, i + TANDA);
    await Promise.all(
      tanda.map(async (f) => {
        const externalVehicleId = f.externo.providerVehicleId;
        const tcVehicleId = f.propuesta!.id;
        try {
          // Se reutiliza `vincular`, que revalida la empresa y las invariantes.
          // Repetir la comprobación por cada fila cuesta una consulta y evita
          // que un camino nuevo se salte lo que el camino de uno en uno respeta.
          await vincular(ambito, {
            tcVehicleId,
            externalVehicleId,
            matchMethod: METODOS_VINCULO.MATRICULA_EXACTA,
            externalPlate: f.externo.plate ?? null,
            externalName: f.externo.name ?? null,
          });
          enlazados++;
        } catch (e) {
          // Un fallo suelto no tumba el lote: se apunta y se sigue. Lo contrario
          // dejaría media flota enlazada y sin decir cuál es la mitad.
          fallidos.push({
            tcVehicleId,
            externalVehicleId,
            error: e instanceof ErrorConciliacion ? e.message : String((e as Error)?.message ?? e),
          });
        }
      }),
    );
  }

  return { enlazados, fallidos };
}
