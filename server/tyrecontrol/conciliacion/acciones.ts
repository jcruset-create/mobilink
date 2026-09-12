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
import { leerEstado, permisoDeBaja } from "./estado.ts";

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

// ── Lo que hay que comprobar antes de escribir un enlace ────────────────────
//
// `connectorKey` y `accountKey` llegan en el cuerpo de la petición, y hasta
// ahora solo se comprobaba que no vinieran vacíos. Con eso, un administrador
// podía escribir enlaces en una cuenta que no existe: no se filtra nada de otro
// cliente —el `tenant_id` sale de la sesión— pero quedan mapeos en cuentas
// fantasma, y el vehículo externo tampoco se verificaba, así que un
// identificador inventado creaba un enlace huérfano que la propia conciliación
// reportaba después como «desaparecido».

/**
 * Una cuenta ya comprobada y su flota, para no repetir el trabajo por fila.
 *
 * Se pasa explícitamente en vez de con un booleano tipo `yaValidado`: un
 * parámetro que dijera «confía en mí» es justo lo que acaba colándose desde un
 * sitio que no había validado nada. Esto solo se puede construir llamando a
 * `prepararVinculacion`, que es la que comprueba.
 */
export interface Vinculacion {
  /** Los identificadores que el proveedor devuelve AHORA en esa cuenta. */
  externosValidos: Set<string>;
}

/**
 * Comprueba la cuenta y trae su flota.
 *
 * `resolveTelematicsConnectors` resuelve de una vez cuatro cosas que había que
 * comprobar por separado: que la configuración existe, que está habilitada, que
 * es de telemática y que es de ESTE tenant —lee
 * `integration_connector_configs` filtrando por `tenant_id`—. No se añade otra
 * fuente de verdad porque ya la hay.
 */
export async function prepararVinculacion(ambito: Ambito): Promise<Vinculacion> {
  const { resolveTelematicsConnectors } = await import(
    "../../integration-hub/connectors/ConnectorRegistry.ts"
  );
  const { nextCorrelationId } = await import("../../integration-hub/infrastructure/repositories.ts");

  const cuentas = await resolveTelematicsConnectors(ambito.empresaId);
  const cuenta = cuentas.find(
    (c) => c.key === ambito.connectorKey && c.accountKey === ambito.accountKey,
  );
  if (!cuenta) {
    // El mismo mensaje para «no existe», «está deshabilitada» y «es de otra
    // empresa»: distinguirlas confirmaría la existencia de una cuenta ajena.
    throw new ErrorConciliacion(
      "CUENTA_NO_CONFIGURADA",
      `Esta empresa no tiene configurada la cuenta «${ambito.accountKey}» de ${ambito.connectorKey}.`,
      404,
    );
  }

  const ctx = { tenantId: ambito.empresaId, correlationId: await nextCorrelationId() };
  const flota = await cuenta.connector.listVehicles(ctx);
  return { externosValidos: new Set(flota.map((v) => v.providerVehicleId)) };
}

/**
 * El vehículo externo existe AHORA en esa cuenta, o se acaba aquí.
 *
 * No se acepta que el navegador lo haya visto antes: entre lo que la pantalla
 * pintó y lo que se envía cabe un identificador editado a mano, y el proveedor
 * es el único que puede decir qué vehículos tiene.
 */
function exigirExternoDeLaCuenta(ambito: Ambito, externalCode: string, v: Vinculacion) {
  if (!v.externosValidos.has(externalCode)) {
    throw new ErrorConciliacion(
      "EXTERNO_NO_EXISTE",
      `El proveedor no devuelve ningún vehículo ${externalCode} en la cuenta ` +
        `«${ambito.accountKey}». Vuelve a conciliar: puede que ya no exista o que sea de otra cuenta.`,
      404,
    );
  }
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
export async function vincular(
  ambito: Ambito,
  datos: DatosVinculo,
  /**
   * Cuenta y flota ya comprobadas. Solo lo pasa `vincularLote`, que las
   * comprueba una vez para seiscientas filas en vez de seiscientas veces.
   * Sin esto, cada enlace hace su propia comprobación.
   */
  preparada?: Vinculacion,
) {
  const externalCode = String(datos.externalVehicleId ?? "").trim();
  if (!externalCode) {
    throw new ErrorConciliacion("EXTERNO_VACIO", "Falta el identificador del vehículo del proveedor.");
  }

  // La cuenta y el externo, antes del vehículo propio: así un enlace hacia una
  // cuenta que no es de esta empresa se corta sin llegar a mirar su flota.
  const vinculacion = preparada ?? (await prepararVinculacion(ambito));
  exigirExternoDeLaCuenta(ambito, externalCode, vinculacion);

  const vehiculo = await exigirVehiculoPropio(ambito, datos.tcVehicleId);

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
      // Las fotos del momento del enlace. Son la referencia contra la que se
      // detecta un cambio posterior, y por eso NO se refrescan al sincronizar:
      // sobrescribirlas perdería justo la referencia que las hace útiles.
      external_plate_snapshot: datos.externalPlate ?? null,
      external_name_snapshot: datos.externalName ?? null,
      // También la de TyreControl, y no por simetría: con la del proveedor sola
      // se puede ver que las dos ya no coinciden, pero no de qué lado se movió.
      // Sale de la ficha, no de lo que mande quien llama.
      internal_plate_snapshot: vehiculo.matricula ?? null,
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
export async function crearPendiente(
  ambito: Ambito,
  datos: DatosAlta,
  /** Igual que en `vincular`: la pasa el lote para no repetir la comprobación. */
  preparada?: Vinculacion,
) {
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
  const enlace = await vincular(
    ambito,
    {
      tcVehicleId: vehiculo.id,
      externalVehicleId: datos.externalVehicleId,
      matchMethod: METODOS_VINCULO.CREADO_DESDE_PROVEEDOR,
      externalPlate: matricula,
      externalName: datos.externalName ?? null,
    },
    preparada,
  );

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
  /*
   * Lo PRIMERO, antes incluso de mirar el vehículo: ¿demuestra el estado
   * guardado que se puede afirmar una ausencia en esta cuenta?
   *
   * La pantalla ya deshabilita el botón cuando la conciliación no es completa, y
   * eso no protege nada: un POST directo, una pestaña abierta desde antes de que
   * el proveedor se cayera o un cliente modificado se lo saltan. Y el servidor
   * no puede fiarse de un booleano que venga del navegador, así que la respuesta
   * sale de `integration_sync_state`, que es donde la escribió la última pasada.
   *
   * Va dentro de `darDeBaja` y no en el router porque esta función es la baja DE
   * LA CONCILIACIÓN —su único llamador es ese router— y así cualquier camino
   * nuevo hereda la regla en vez de tener que acordarse de repetirla. Las bajas
   * de vehículos que existan fuera de esta pantalla no pasan por aquí y siguen
   * funcionando igual.
   */
  const permiso = permisoDeBaja({
    estado: await leerEstado(ambito.empresaId),
    connectorKey: ambito.connectorKey,
    accountKey: ambito.accountKey,
    ahoraMs: Date.now(),
  });
  if (permiso.estado === "bloqueado") {
    throw new ErrorConciliacion(permiso.codigo, permiso.mensaje, 409);
  }

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

  /*
   * ── Cuándo se puede enlazar sin que nadie lo mire ─────────────────────────
   *
   * La conciliación de ESTA cuenta tiene que haber sido completa. Con una
   * pasada incompleta, `clasificarFlota` ya se guarda de proponer nada de la
   * cuenta que falló —los vehículos sin enlace se apartan en vez de darse por
   * ausentes—, así que esta comprobación es un cinturón sobre un tirante que ya
   * existe. Se pone igualmente y explícita: la regla «no se autoenlaza sobre
   * una foto incompleta» tiene que estar escrita donde se autoenlaza, no
   * deducirse de tres módulos más abajo.
   */
  if (resultado.resumen.status !== "complete") {
    const fallando = resultado.resumen.cuentas.filter((c) => !c.ok).map((c) => c.accountKey);
    throw new ErrorConciliacion(
      "CONCILIACION_INCOMPLETA",
      "No se enlaza en bloque con una conciliación incompleta: " +
        (fallando.length
          ? `la cuenta «${fallando.join(", ")}» no respondió.`
          : "el proveedor no respondió.") +
        " Vuelve a conciliar.",
      409,
    );
  }

  /*
   * De aquí sale el resto de las condiciones, y no de comprobarlas otra vez:
   *
   *  - `soloProveedor` con `propuesta` ya significa matrícula reconocible,
   *    normalizada, coincidente, con UN único candidato y sin ambigüedad: las
   *    ambiguas y las que proponen el mismo vehículo interno se van a
   *    discrepancias, y las que no traen matrícula no proponen nada
   *    (`clasificarFlota`, reglas 2 a 4).
   *  - Los ignorados no llegan a `soloProveedor`.
   *  - La cuenta es de este tenant y el externo existe: `vincular` lo comprueba
   *    con la preparación de abajo.
   *  - Que ni el vehículo interno ni el externo tengan ya un enlace activo lo
   *    comprueba `vincular` fila a fila, contra la base y no contra esta foto.
   */
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

  // Los identificadores salen de la conciliación que se acaba de hacer, así que
  // están probados contra el proveedor. Se prepara UNA vez para todas las filas:
  // seiscientas comprobaciones de cuenta serían seiscientas consultas.
  const preparada: Vinculacion = {
    externosValidos: new Set(propuestas.map((f) => f.externo.providerVehicleId)),
  };

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
            // Enlace automático: se distingue del que confirma una persona.
            matchMethod: METODOS_VINCULO.MATRICULA_EXACTA_AUTO,
            externalPlate: f.externo.plate ?? null,
            externalName: f.externo.name ?? null,
          }, preparada);
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

// ── Lotes elegidos a mano ───────────────────────────────────────────────────

export interface ResultadoLoteExternos {
  hechos: number;
  fallidos: Array<{ externalVehicleId: string; error: string }>;
  /** Pedidos que no estaban en la respuesta del proveedor. */
  omitidos: string[];
}

/** Un tope sobrio: si alguien pide más, es que se ha equivocado de botón. */
const MAX_LOTE = 500;

function externosPedidos(datos: { externalVehicleIds?: unknown }): string[] {
  const brutos = Array.isArray(datos.externalVehicleIds) ? datos.externalVehicleIds : [];
  const ids = Array.from(new Set(brutos.map((x) => String(x ?? "").trim()).filter(Boolean)));
  if (ids.length === 0) {
    throw new ErrorConciliacion("LOTE_VACIO", "No has seleccionado ningún vehículo.");
  }
  if (ids.length > MAX_LOTE) {
    throw new ErrorConciliacion(
      "LOTE_DEMASIADO_GRANDE",
      `Como mucho ${MAX_LOTE} vehículos de una vez; has pedido ${ids.length}.`,
    );
  }
  return ids;
}

/**
 * Los vehículos que el proveedor devuelve AHORA, sin enlazar, por identificador.
 *
 * Aquí sí llega una lista del navegador —es el usuario quien elige cuáles—,
 * pero solo llegan IDENTIFICADORES: la matrícula, el bastidor y el nombre con
 * los que se crea salen de esta lectura, no de la petición. Es la diferencia
 * entre «crea estos que he marcado» y «crea un vehículo con los datos que yo
 * te diga», que es lo que no debe poder pedirse desde fuera.
 */
async function sinEnlazarAhora(ambito: Ambito) {
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
      registrarUltimaVez: false,
    },
  );

  return new Map(resultado.soloProveedor.map((f) => [f.externo.providerVehicleId, f.externo]));
}

/**
 * Crea de golpe los vehículos marcados, pendientes de validar.
 *
 * Cada uno pasa por `crearPendiente`, que revalida la matrícula y rechaza los
 * choques: repetir la comprobación por fila cuesta una consulta y evita que
 * este camino se salte lo que respeta el de uno en uno.
 */
export async function crearPendientesLote(
  ambito: Ambito,
  datos: { externalVehicleIds: string[] },
): Promise<ResultadoLoteExternos> {
  const pedidos = externosPedidos(datos);
  const disponibles = await sinEnlazarAhora(ambito);
  // Los identificadores de `disponibles` salen de una conciliación en vivo, así
  // que ya están probados contra el proveedor: no hace falta pedirle la flota
  // otra vez por cada alta.
  const preparada: Vinculacion = { externosValidos: new Set(disponibles.keys()) };

  const fallidos: ResultadoLoteExternos["fallidos"] = [];
  const omitidos: string[] = [];
  let hechos = 0;

  // En serie: cada alta hace una búsqueda de matrícula, un insert y un enlace.
  // En paralelo, además de agotar el pool, dos matrículas iguales en la misma
  // tanda se colarían las dos porque ninguna vería a la otra.
  for (const id of pedidos) {
    const externo = disponibles.get(id);
    if (!externo) {
      omitidos.push(id);
      continue;
    }
    try {
      await crearPendiente(
        ambito,
        {
          externalVehicleId: id,
          matricula: externo.plate ?? "",
          bastidor: externo.vin ?? null,
          externalName: externo.name ?? null,
        },
        preparada,
      );
      hechos++;
    } catch (e) {
      fallidos.push({
        externalVehicleId: id,
        error: e instanceof ErrorConciliacion ? e.message : String((e as Error)?.message ?? e),
      });
    }
  }

  return { hechos, fallidos, omitidos };
}

/**
 * Aparta de golpe los vehículos marcados.
 *
 * Ignorar no escribe nada en la flota: solo deja de enseñarlos, y se deshace
 * desde la propia pantalla. Por eso no se revalida contra el proveedor —un
 * identificador que ya no exista se ignora igual, y no molesta a nadie.
 */
export async function ignorarLote(
  ambito: Ambito,
  datos: { externalVehicleIds: string[]; motivo?: string | null },
): Promise<ResultadoLoteExternos> {
  const pedidos = externosPedidos(datos);

  const fallidos: ResultadoLoteExternos["fallidos"] = [];
  let hechos = 0;

  const TANDA = 20;
  for (let i = 0; i < pedidos.length; i += TANDA) {
    await Promise.all(
      pedidos.slice(i, i + TANDA).map(async (id) => {
        try {
          await ignorar(ambito, { externalVehicleId: id, motivo: datos.motivo ?? null });
          hechos++;
        } catch (e) {
          fallidos.push({
            externalVehicleId: id,
            error: e instanceof ErrorConciliacion ? e.message : String((e as Error)?.message ?? e),
          });
        }
      }),
    );
  }

  return { hechos, fallidos, omitidos: [] };
}

