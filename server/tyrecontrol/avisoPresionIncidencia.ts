/**
 * Del aviso leído a la incidencia.
 *
 * Esta es la parte que escribe. No decide nada: quién decide es
 * avisoPresion.ts, que es puro y tiene los tests. Aquí sólo se busca el
 * vehículo, se resuelve la rueda, se mira si ya hay una incidencia abierta y
 * se escribe lo que diga `decidirAviso()`.
 *
 * Escribe con la clave de servicio, igual que el importador del informe
 * (checkpointImport.ts): la clave se salta la RLS, así que un RPC
 * `security definer` no daría ningún permiso que no se tenga ya. Lo que sí
 * hace falta —que dos avisos a la vez no abran dos incidencias— lo garantiza
 * un índice único parcial en la base de datos, no el orden del código.
 *
 * Un aviso que no se puede convertir en incidencia (matrícula desconocida,
 * rueda que el tipo no tiene) NO se pierde: deja fila en tc_avisos_presion y
 * manda correo. Un proceso que escribe sin que nadie mire tiene que dejar
 * rastro también cuando no escribe.
 */
import { supabase } from "../supabase.ts";
import { pedirIA, hayIA } from "../core/openaiService.ts";
import {
  decidirAviso,
  type AvisoPresion, type IncidenciaAbierta, type Gravedad,
} from "./avisoPresion.ts";

/** Los datos del correo, para el rastro. */
export interface CorreoAviso {
  messageId: string;
  asunto: string | null;
  remitente: string | null;
  fechaCorreo: string | null;
}

export type EstadoAviso =
  | "creada" | "actualizada" | "sin_vehiculo" | "vehiculo_ambiguo"
  | "sin_posicion" | "pendiente_confirmacion" | "no_reconocido";

export interface ResultadoAviso {
  estado: EstadoAviso;
  incidenciaId: string | null;
  matricula: string | null;
  /** Qué contar en el correo de aviso. Vacío = no hay nada que contar. */
  detalle: string;
  veces: number;
}

// Lo que NO cuenta como abierta. Misma definición que usa
// tc_resolver_incidencia_parcial: no me invento una segunda.
const CERRADAS = "(solucionada,cancelada,no_procede)";

/** ¿Ya se procesó este correo? El unique de message_id es la segunda red. */
export async function avisoYaProcesado(messageId: string): Promise<boolean> {
  const { data } = await supabase.from("tc_avisos_presion")
    .select("id").eq("message_id", messageId).maybeSingle();
  return !!data;
}

interface Vehiculo {
  id: string; matricula: string; empresa_id: string;
  tipo_vehiculo_id: string | null; numero_unidad: string | null;
}

/**
 * Todos los vehículos activos, por páginas.
 *
 * Mismo criterio que el importador del informe: se casa por matrícula sobre
 * los activos. Va por páginas porque PostgREST corta en 1000 filas sin decir
 * nada, y una flota que crezca por encima de eso dejaría de casar vehículos
 * en silencio. Ordenado por id: sin un orden estable, paginar puede devolver
 * una fila dos veces y otra ninguna.
 */
async function vehiculosActivos(): Promise<Vehiculo[]> {
  const out: Vehiculo[] = [];
  for (let desde = 0; desde < 20_000; desde += 1000) {
    const { data, error } = await supabase.from("tc_vehiculos")
      .select("id, matricula, empresa_id, tipo_vehiculo_id, numero_unidad")
      .eq("activo", true).order("id").range(desde, desde + 999);
    if (error) throw new Error("Vehículos: " + error.message);
    const filas = (data ?? []) as Vehiculo[];
    out.push(...filas);
    if (filas.length < 1000) break;
  }
  return out;
}

const normalizar = (s: string) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * El aviso completo: leerlo ya se hizo, aquí se convierte en incidencia.
 *
 * Devuelve qué ha pasado. Sólo lanza si falla la base de datos, y eso es a
 * propósito: quien llama deja el correo SIN LEER para reintentarlo, que es lo
 * que uno espera de algo que falla por un motivo pasajero.
 */
export async function procesarAvisoPresion(
  correo: CorreoAviso,
  aviso: AvisoPresion,
  opts: { notas?: string[]; cuerpo?: string } = {},
): Promise<ResultadoAviso> {
  const notas = [...(opts.notas ?? [])];
  const fila: Record<string, any> = {
    message_id: correo.messageId,
    asunto: correo.asunto,
    remitente: correo.remitente,
    fecha_correo: correo.fechaCorreo,
    matricula: aviso.matriculaTexto,
    id_flota: aviso.idFlota,
    eje: aviso.eje,
    lado: aviso.lado,
    interior_exterior: aviso.interiorExterior,
    codigo_posicion: aviso.codigoPosicion,
    presion_bar: aviso.presionBar,
    presion_recomendada_bar: aviso.presionRecomendadaBar,
    desviacion_pct: aviso.desviacionPct,
    rango: aviso.rango,
    umbral_pct: aviso.umbralPct,
    medido_at: aviso.medidoAt.toISOString(),
    checkpoint: aviso.checkpoint,
    origen_datos: "plantilla",
  };

  // ── El vehículo ───────────────────────────────────────────────────────────
  const candidatos = (await vehiculosActivos())
    .filter((v) => normalizar(v.matricula) === aviso.matricula);

  if (!candidatos.length) {
    // No se da de alta desde un aviso: no trae configuración de ejes ni
    // medidas. Que lo mire una persona.
    return await registrar(fila, "sin_vehiculo", notas, opts.cuerpo,
      `La matrícula ${aviso.matriculaTexto} no está en TyreControl (o está de baja). No se ha creado ninguna incidencia.`);
  }
  if (candidatos.length > 1) {
    return await registrar(fila, "vehiculo_ambiguo", notas, opts.cuerpo,
      `La matrícula ${aviso.matriculaTexto} está en ${candidatos.length} vehículos activos. No se ha creado ninguna incidencia.`);
  }

  const veh = candidatos[0];
  fila.vehiculo_id = veh.id;
  fila.empresa_id = veh.empresa_id;

  // El ID de flota no decide nada —manda la matrícula—, pero si no cuadra es
  // señal de que una de las dos fichas está mal.
  if (aviso.idFlota && veh.numero_unidad && normalizar(aviso.idFlota) !== normalizar(veh.numero_unidad)) {
    notas.push(`El ID de flota del aviso (${aviso.idFlota}) no coincide con el del vehículo (${veh.numero_unidad}).`);
  }

  // ── La rueda ──────────────────────────────────────────────────────────────
  const posicionId = await resolverPosicion(veh, aviso);
  if (!posicionId) {
    return await registrar(fila, "sin_posicion", notas, opts.cuerpo,
      `El tipo de vehículo de ${aviso.matriculaTexto} no tiene la posición ${aviso.codigoPosicion}. ` +
      `No se ha creado la incidencia: colgarla de una rueda aproximada sería peor que no crearla.`);
  }
  fila.posicion_id = posicionId;

  // ── ¿Hay ya una incidencia abierta de esta misma rueda? ───────────────────
  const existente = await incidenciaAbierta(veh.id, posicionId);

  // Cuántas veces se ha avisado ya de esto. Se CUENTA, no se lleva un
  // contador: así el número no puede desviarse del histórico ni aunque un
  // aviso se reprocese.
  const previos = existente ? await avisosDe(existente.id) : [];
  const primero = previos.length
    ? new Date(Math.min(...previos.map((p) => p.getTime()), aviso.medidoAt.getTime()))
    : aviso.medidoAt;
  const ctx = { veces: previos.length + 1, primero };

  const d = decidirAviso(existente, aviso, ctx, notas);

  if (d.accion === "crear") {
    const accion = await pulirAccion(d.accionRecomendada, aviso);
    const { data, error } = await supabase.from("tc_incidencias").insert({
      empresa_id: veh.empresa_id,
      vehiculo_id: veh.id,
      posicion_id: posicionId,
      neumatico_id: await montajeActual(veh.id, posicionId),
      gravedad: d.gravedad,
      gravedad_auto: d.gravedadAuto,
      estado: "detectada",
      // Sin sesión de usuario: el vigilante corre con la clave de servicio.
      // En la APK esto es auth.uid(); aquí queda null a propósito y quien lo
      // dice es `origen`.
      detectada_por: null,
      origen: "checkpoint_aviso",
      detectada_at: aviso.medidoAt.toISOString(),
      accion_recomendada: accion,
      motivo_observacion: d.observacion,
      medicion_inicial: { presion_bar: aviso.presionBar },
    }).select("id").single();
    if (error) throw new Error("Incidencia: " + error.message);

    const incidenciaId = (data as any).id as string;
    const { error: eProb } = await supabase.from("tc_incidencia_problemas")
      .insert({ incidencia_id: incidenciaId, tipo: "presion_baja" });
    if (eProb) throw new Error("Problema de la incidencia: " + eProb.message);

    fila.incidencia_id = incidenciaId;
    return await registrar(fila, "creada", notas, undefined,
      `Nueva incidencia de presión baja en ${aviso.matriculaTexto}, ${aviso.codigoPosicion}: ` +
      `${aviso.presionBar} bar (${d.gravedad}).`, incidenciaId, ctx.veces);
  }

  // Actualizar la que hay. `medicion_inicial` NO se toca: es la inicial, y el
  // nombre no miente. La medición de hoy vive en su fila de tc_avisos_presion.
  const { error } = await supabase.from("tc_incidencias").update({
    gravedad: d.gravedad,
    gravedad_auto: d.gravedadAuto,
    motivo_observacion: d.observacion,
  }).eq("id", d.incidenciaId!);
  if (error) throw new Error("Incidencia: " + error.message);

  fila.incidencia_id = d.incidenciaId;
  // Los dos primeros repetidos no dicen nada: la incidencia ya está en la
  // pantalla y el arco avisa todos los días hasta que alguien infle la rueda.
  // Del tercero en adelante sí, porque tres días con la misma rueda baja ya no
  // es "está en la lista", es que no la está mirando nadie.
  return await registrar(fila, "actualizada", notas, undefined,
    ctx.veces >= 3
      ? `${aviso.matriculaTexto} ${aviso.codigoPosicion} lleva ${ctx.veces} avisos sin resolverse.`
      : "",
    d.incidenciaId, ctx.veces);
}

/**
 * El correo era un aviso pero no se ha podido leer.
 *
 * Aquí es donde entra la IA, y sólo aquí: como red para el día que cambie la
 * plantilla. Lo que devuelva NO abre incidencia — se registra marcado como
 * suyo y se avisa a una persona para que lo confirme. Una incidencia sin
 * confirmar en la pantalla sería justo el dato falso que todo esto evita.
 */
export async function avisoNoReconocido(
  correo: CorreoAviso,
  cuerpo: string,
  faltan: string[],
): Promise<ResultadoAviso> {
  const fila: Record<string, any> = {
    message_id: correo.messageId,
    asunto: correo.asunto,
    remitente: correo.remitente,
    fecha_correo: correo.fechaCorreo,
    faltan,
  };

  const leido = await leerConIA(cuerpo);
  if (!leido) {
    return await registrar(fila, "no_reconocido", [], cuerpo,
      `Ha llegado un aviso de presión que no encaja con la plantilla y que la IA tampoco ha sabido leer.\n` +
      `Falta: ${faltan.join(", ") || "(no se reconoce nada)"}.\n` +
      `No se ha creado ninguna incidencia y NO se ha inventado ningún dato.`);
  }

  fila.origen_datos = "ia";
  fila.matricula = leido.matricula ?? null;
  fila.id_flota = leido.idFlota ?? null;
  fila.presion_bar = leido.presionBar ?? null;
  fila.presion_recomendada_bar = leido.presionRecomendadaBar ?? null;
  fila.rango = leido.rango ?? null;
  fila.codigo_posicion = leido.rueda ?? null;

  return await registrar(fila, "pendiente_confirmacion", [], cuerpo,
    `Ha llegado un aviso de presión con la plantilla cambiada. La IA cree que dice esto, ` +
    `pero NO se ha creado ninguna incidencia: hay que confirmarlo a mano.\n\n` +
    `  Matrícula: ${leido.matricula ?? "?"}\n` +
    `  ID de flota: ${leido.idFlota ?? "?"}\n` +
    `  Rueda: ${leido.rueda ?? "?"}\n` +
    `  Presión: ${leido.presionBar ?? "?"} bar (recomendada ${leido.presionRecomendadaBar ?? "?"})\n` +
    `  Rango: ${leido.rango ?? "?"}\n\n` +
    `Falta en la plantilla: ${faltan.join(", ")}.`);
}

// ── Piezas ──────────────────────────────────────────────────────────────────

async function registrar(
  fila: Record<string, any>,
  estado: EstadoAviso,
  notas: string[],
  cuerpo: string | undefined,
  detalle: string,
  incidenciaId: string | null = null,
  veces = 1,
): Promise<ResultadoAviso> {
  const { error } = await supabase.from("tc_avisos_presion").insert({
    ...fila,
    estado,
    notas,
    // El cuerpo sólo se guarda cuando no se pudo leer: es lo que permitirá
    // arreglar el analizador sin pedirle a nadie que reenvíe el correo.
    cuerpo: cuerpo ? cuerpo.slice(0, 8000) : null,
    aviso_enviado: !!detalle,
  });
  // 23505 = unique_violation. Aquí sólo puede ser el message_id, es decir que
  // el correo ya estaba registrado: no es un fallo, es la red haciendo su
  // trabajo. Cualquier otro error sí sube, y el correo se queda sin leer.
  if (error && error.code !== "23505") {
    throw new Error("Registro del aviso: " + error.message);
  }
  return { estado, incidenciaId: incidenciaId ?? fila.incidencia_id ?? null, matricula: fila.matricula ?? null, detalle, veces };
}

/**
 * De la rueda del aviso a la posición del vehículo.
 *
 * Tres intentos, como el importador:
 *  1. Por código exacto (E2_IZQ_EXT).
 *  2. Por las señas (eje, lado, interior/exterior): los tipos sembrados en la
 *     Fase 3 llaman DEL_IZQ a lo que aquí es E1_IZQ.
 *  3. Si el aviso dijo interior/exterior pero ese eje es de rueda simple, por
 *     el código sin gemelos. Es la trampa del arco —emite cuatro huecos por
 *     eje y mete la rueda única en el "Interior"— vista desde el otro lado.
 */
async function resolverPosicion(veh: Vehiculo, aviso: AvisoPresion): Promise<string | null> {
  if (!veh.tipo_vehiculo_id) return null;
  const { data, error } = await supabase.from("tc_posiciones_vehiculo")
    .select("id, codigo_posicion, eje, lado, interior_exterior")
    .eq("tipo_vehiculo_id", veh.tipo_vehiculo_id).eq("activo", true);
  if (error) throw new Error("Posiciones: " + error.message);
  const ps = (data ?? []) as any[];

  const p = ps.find((x) => String(x.codigo_posicion).toUpperCase() === aviso.codigoPosicion)
    ?? ps.find((x) => x.eje === aviso.eje && String(x.lado ?? "") === aviso.lado
          && (x.interior_exterior ?? null) === aviso.interiorExterior)
    ?? (aviso.interiorExterior
          ? ps.find((x) => x.eje === aviso.eje && String(x.lado ?? "") === aviso.lado
              && (x.interior_exterior ?? null) === null)
          : undefined);
  return p?.id ?? null;
}

async function montajeActual(vehiculoId: string, posicionId: string): Promise<string | null> {
  const { data } = await supabase.from("tc_montajes_actuales")
    .select("neumatico_id").eq("vehiculo_id", vehiculoId).eq("posicion_id", posicionId).maybeSingle();
  return (data as any)?.neumatico_id ?? null;
}

/**
 * La incidencia abierta de esa rueda, si la hay.
 *
 * No se filtra por origen a propósito: si un técnico ya abrió con la APK la
 * incidencia de presión de esa misma rueda, el aviso del arco se suma a la
 * suya en vez de duplicarla. Es el mismo problema físico; que lo haya visto
 * antes una persona no lo convierte en otro.
 */
async function incidenciaAbierta(vehiculoId: string, posicionId: string): Promise<IncidenciaAbierta | null> {
  const { data, error } = await supabase.from("tc_incidencias")
    .select("id, gravedad, estado, problemas:tc_incidencia_problemas(tipo, estado)")
    .eq("vehiculo_id", vehiculoId).eq("posicion_id", posicionId)
    .not("estado", "in", CERRADAS)
    .order("detectada_at", { ascending: false });
  if (error) throw new Error("Incidencias: " + error.message);

  for (const i of (data ?? []) as any[]) {
    const tienePresion = (i.problemas ?? []).some(
      (p: any) => p.tipo === "presion_baja" && p.estado !== "solucionado");
    if (tienePresion) return { id: i.id, gravedad: (i.gravedad ?? "leve") as Gravedad };
  }
  return null;
}

/** Cuándo se midió cada aviso anterior de esa incidencia. */
async function avisosDe(incidenciaId: string): Promise<Date[]> {
  const { data, error } = await supabase.from("tc_avisos_presion")
    .select("medido_at").eq("incidencia_id", incidenciaId).not("medido_at", "is", null);
  if (error) throw new Error("Avisos anteriores: " + error.message);
  return ((data ?? []) as any[]).map((r) => new Date(r.medido_at)).filter((d) => !isNaN(d.getTime()));
}

/**
 * La IA sólo pule la frase; los números ya están y no los toca.
 *
 * Se llama al CREAR la incidencia, nunca en los avisos repetidos: es una frase
 * para leer de un vistazo, no algo por lo que merezca pagar cinco veces. Si no
 * hay clave o el modelo falla, se queda la frase determinista.
 */
async function pulirAccion(base: string, aviso: AvisoPresion): Promise<string> {
  if (!hayIA()) return base;
  const r = await pedirIA({
    operacion: "tyrecontrol.avisoPresion.accion",
    proposito: "documento",
    maxTokens: 300,
    prompt:
      "Eres el jefe de taller de una flota de autobuses. Reescribe en UNA frase clara, " +
      "en español de España, la acción recomendada para el técnico. NO cambies, redondees " +
      "ni añadas ningún número: usa exactamente los que se te dan. No inventes causas.\n\n" +
      `Rueda: ${aviso.codigoPosicion} (eje ${aviso.eje}).\n` +
      `Presión medida: ${aviso.presionBar} bar.\n` +
      `Presión recomendada: ${aviso.presionRecomendadaBar ?? "no consta"}.\n` +
      `Desviación: ${aviso.desviacionPct ?? "no consta"}%.\n\n` +
      `Borrador: ${base}`,
  });
  const texto = String(r.texto ?? "").trim();
  return r.ok && texto ? texto.slice(0, 500) : base;
}

interface LecturaIA {
  matricula: string | null;
  idFlota: string | null;
  rueda: string | null;
  presionBar: number | null;
  presionRecomendadaBar: number | null;
  rango: string | null;
}

/** Le pide al modelo que lea el correo, con permiso explícito para no saber. */
async function leerConIA(cuerpo: string): Promise<LecturaIA | null> {
  if (!hayIA()) return null;
  const r = await pedirIA<LecturaIA & { no_se: boolean }>({
    operacion: "tyrecontrol.avisoPresion.leer",
    proposito: "documento",
    maxTokens: 600,
    prompt:
      "Este correo debería ser un aviso de presión baja de un arco de medición de neumáticos, " +
      "pero no encaja con la plantilla conocida. Extrae los campos SOLO si los ves escritos " +
      "literalmente. Si no estás seguro de alguno, déjalo a null; si el correo no es un aviso " +
      "de presión, pon no_se = true. NO deduzcas, NO calcules y NO completes nada.\n\n" +
      "--- CORREO ---\n" + cuerpo.slice(0, 6000),
    esquema: {
      nombre: "aviso_presion",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["no_se", "matricula", "idFlota", "rueda", "presionBar", "presionRecomendadaBar", "rango"],
        properties: {
          no_se: { type: "boolean" },
          matricula: { type: ["string", "null"] },
          idFlota: { type: ["string", "null"] },
          rueda: { type: ["string", "null"] },
          presionBar: { type: ["number", "null"] },
          presionRecomendadaBar: { type: ["number", "null"] },
          rango: { type: ["string", "null"] },
        },
      },
    },
  });
  const d = r.datos;
  if (!r.ok || !d || d.no_se) return null;
  // Si no ha sacado ni matrícula ni presión, no ha leído nada útil.
  if (!d.matricula && d.presionBar == null) return null;
  return d;
}
