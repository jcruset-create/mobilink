/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Lo que se le da al modelo para resumir una ficha de vehículo.
 *
 * ── Quién calcula qué ───────────────────────────────────────────────────────
 *
 * Todo lo que sea una cuenta —días abiertos, kilómetros desde el montaje, si
 * un plan está vencido, si el kilometraje está viejo— lo hace AQUÍ, en el
 * servidor. Al modelo le llegan números ya hechos y su trabajo es redactar.
 * Un modelo restando fechas es un modelo equivocándose en silencio.
 *
 * ── Referencias, no identificadores ─────────────────────────────────────────
 *
 * Cada dato que puede respaldar una afirmación lleva una referencia corta
 * (`IV1`, `OP3`, `RV2`…). El modelo cita esas referencias y NUNCA un uuid ni
 * una URL: un uuid se puede inventar con pinta creíble, y una referencia que
 * no esté en la lista sencillamente no resuelve. Las rutas las construye el
 * servidor en `evidencias.ts`.
 *
 * ── Ventana ─────────────────────────────────────────────────────────────────
 *
 * El histórico reciente se corta a VENTANA_MESES. Dos excepciones, porque
 * cortarlas daría una foto falsa: los MONTAJES VIVOS y las INCIDENCIAS
 * ABIERTAS entran aunque sean de antes. Un neumático montado hace tres años
 * sigue montado hoy.
 *
 * Y si se recorta por volumen, se dice: `recortes` lo lleva a la respuesta
 * para que nadie lea «dos intervenciones» creyendo que fueron todas.
 *
 * ── Aislamiento ─────────────────────────────────────────────────────────────
 *
 * ⚠️ El cliente `supabase` del servidor usa SERVICE ROLE y NO aplica RLS. Cada
 * consulta de este fichero filtra `empresa_id` de forma explícita con la
 * empresa ya validada por el router. No copiar nada de aquí sin ese filtro.
 */
import { createHash } from "node:crypto";
import { supabase } from "../../supabase.ts";

/** Ventana del histórico reciente, en meses. */
export const VENTANA_MESES = 24;

const TOPE_INTERVENCIONES = 5;
const TOPE_OPERACIONES = 10;
const TOPE_REVISIONES = 3;
const TOPE_INCIDENCIAS = 20;

/** Kilometraje con más de esto se considera viejo y se avisa. */
const KM_VIEJO_DIAS = 30;

export type TipoRef =
  | "vehiculo" | "intervencion" | "operacion" | "revision"
  | "incidencia" | "montaje" | "neumatico" | "plan";

export interface Ref {
  ref: string;
  tipo: TipoRef;
  id: string;
  /** Lo que lee la persona en el enlace. Lo escribe el servidor. */
  etiqueta: string;
}

export interface DatoQueFalta { clave: string; texto: string }

export interface DatosResumen {
  generado_at: string;
  ventana: { meses: number; desde: string };
  vehiculo: Record<string, unknown>;
  montajes_vivos: Record<string, unknown>[];
  intervenciones: Record<string, unknown>[];
  operaciones: Record<string, unknown>[];
  revisiones: Record<string, unknown>[];
  incidencias_abiertas: Record<string, unknown>[];
  planes: Record<string, unknown>[];
  datos_que_faltan: DatoQueFalta[];
  contradicciones: string[];
  recortes: string[];
}

export interface Reunido {
  datos: DatosResumen;
  /** ref → qué es. El validador solo acepta lo que esté aquí. */
  refs: Map<string, Ref>;
  /** Si no hay nada que contar, no se llama al modelo. */
  hayAlgoQueResumir: boolean;
  /** Huella de la entrada, para la caché. */
  huella: string;
  empresaId: string;
}

const dias = (desde: string | Date | null | undefined, hasta: Date): number | null => {
  if (!desde) return null;
  const d = new Date(desde);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((hasta.getTime() - d.getTime()) / 86_400_000);
};
const soloFecha = (v: unknown): string | null =>
  typeof v === "string" ? v.slice(0, 10) : v instanceof Date ? v.toISOString().slice(0, 10) : null;
const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Reúne la ficha. `empresaId` tiene que venir YA validado contra la sesión.
 */
export async function reunir(vehiculoId: string, empresaId: string, ahora = new Date()): Promise<Reunido | null> {
  const refs = new Map<string, Ref>();
  let n = 0;
  const anotar = (tipo: TipoRef, id: string, etiqueta: string): string => {
    const ref = `${{ vehiculo: "VH", intervencion: "IV", operacion: "OP", revision: "RV",
                     incidencia: "IN", montaje: "MT", neumatico: "NM", plan: "PL" }[tipo]}${++n}`;
    refs.set(ref, { ref, tipo, id, etiqueta });
    return ref;
  };

  const { data: vFila } = await supabase
    .from("tc_vehiculos")
    .select("id, empresa_id, matricula, numero_unidad, marca, modelo, km_actual, origen_km, " +
            "tipo_vehiculo_id, medida_id, tipo_llanta_id, activo, webfleet_vehicle_id, updated_at")
    .eq("id", vehiculoId)
    .eq("empresa_id", empresaId)          // el filtro que la RLS no va a poner
    .maybeSingle();
  // El cliente tipado devuelve una unión con el tipo de error; aquí ya está
  // comprobado que hay fila y se trabaja sobre ella como registro plano.
  const v = (vFila ?? null) as Record<string, any> | null;
  if (!v) return null;

  const desde = new Date(ahora);
  desde.setMonth(desde.getMonth() - VENTANA_MESES);
  const desdeIso = desde.toISOString();

  const refVehiculo = anotar("vehiculo", String(v.id), `Ficha de ${v.matricula}`);

  // ── Consultas. Todas con empresa_id explícito. ───────────────────────────
  const [montajes, intervenciones, operaciones, revisiones, incidencias, planes] = await Promise.all([
    // Montajes VIVOS: sin ventana, a propósito.
    supabase.from("tc_montajes_actuales")
      .select("id, posicion_id, neumatico_id, fecha_montaje, km_montaje, " +
              "neumatico:tc_neumaticos(id, marca, modelo, medida, numero_serie, dot, profundidad_actual_mm), " +
              "posicion:tc_posiciones_vehiculo(nombre, codigo_posicion, eje)")
      .eq("empresa_id", empresaId).eq("vehiculo_id", vehiculoId),
    supabase.from("tc_intervenciones")
      .select("id, numero, fecha, resumen, n_operaciones, n_neumaticos, tipo_principal, cerrada_at")
      .eq("empresa_id", empresaId).eq("vehiculo_id", vehiculoId)
      .gte("fecha", desdeIso.slice(0, 10)).order("fecha", { ascending: false }),
    supabase.from("operaciones_neumaticos")
      .select("id, tipo_operacion, fecha_operacion, km_vehiculo, condicion, intervencion_id, " +
              "posicion_destino_id, posicion_origen_id, motivo, is_anulada")
      .eq("empresa_id", empresaId).eq("vehiculo_id", vehiculoId)
      .eq("is_anulada", false)
      .gte("fecha_operacion", desdeIso.slice(0, 10)).order("fecha_operacion", { ascending: false }),
    supabase.from("revisiones_vehiculo")
      .select("id, fecha_revision, km_vehiculo, origen_km, estado_revision, tipo_revision, n_neumaticos, km_capturado_at")
      .eq("empresa_id", empresaId).eq("vehiculo_id", vehiculoId)
      .gte("fecha_revision", desdeIso.slice(0, 10)).order("fecha_revision", { ascending: false }),
    // Incidencias ABIERTAS: sin ventana, a propósito.
    supabase.from("tc_incidencias")
      .select("id, gravedad, estado, detectada_at, fecha_recomendada, accion_recomendada, posicion_id, neumatico_id")
      .eq("empresa_id", empresaId).eq("vehiculo_id", vehiculoId)
      .not("estado", "in", '("resuelta","descartada")').order("detectada_at", { ascending: false }),
    supabase.from("tc_planes_mantenimiento")
      .select("id, nombre, proxima_fecha, proxima_km, activo, margen_aviso_dias")
      .eq("empresa_id", empresaId).eq("vehiculo_id", vehiculoId).eq("activo", true),
  ]);

  const recortes: string[] = [];
  const recortar = <T,>(filas: T[] | null, tope: number, nombre: string): T[] => {
    const todas = filas ?? [];
    if (todas.length > tope) {
      recortes.push(`De ${todas.length} ${nombre} en la ventana se envían las ${tope} más recientes.`);
      return todas.slice(0, tope);
    }
    return todas;
  };

  const kmActual = num(v.km_actual);
  const diasKm = dias(v.updated_at as string, ahora);

  // ── Montajes vivos, con los kilómetros hechos desde que se montó ─────────
  const montajesVivos = (montajes.data ?? []).map((m: any) => {
    const kmMontaje = num(m.km_montaje);
    const ref = anotar("montaje", String(m.id),
      `Montaje en ${m.posicion?.nombre ?? m.posicion?.codigo_posicion ?? "posición desconocida"} de ${v.matricula}`);
    return {
      ref,
      posicion: m.posicion?.nombre ?? m.posicion?.codigo_posicion ?? null,
      eje: m.posicion?.eje ?? null,
      marca: m.neumatico?.marca ?? null,
      medida: m.neumatico?.medida ?? null,
      numero_serie: m.neumatico?.numero_serie ?? null,
      dot: m.neumatico?.dot ?? null,
      profundidad_mm: num(m.neumatico?.profundidad_actual_mm),
      fecha_montaje: soloFecha(m.fecha_montaje),
      dias_montado: dias(m.fecha_montaje, ahora),
      km_montaje: kmMontaje,
      // Calculado aquí: el modelo no resta.
      km_desde_montaje: kmActual != null && kmMontaje != null && kmActual >= kmMontaje
        ? kmActual - kmMontaje : null,
      ref_neumatico: m.neumatico?.id
        ? anotar("neumatico", String(m.neumatico.id),
            `Neumático ${m.neumatico.marca ?? ""} ${m.neumatico.medida ?? ""}`.trim())
        : null,
    };
  });

  const ivs = recortar(intervenciones.data as any[], TOPE_INTERVENCIONES, "intervenciones");
  const intervencionesSalida = ivs.map((i: any) => ({
    ref: anotar("intervencion", String(i.id), `Intervención ${i.numero ?? soloFecha(i.fecha) ?? ""}`.trim()),
    numero: i.numero ?? null,
    fecha: soloFecha(i.fecha),
    hace_dias: dias(i.fecha, ahora),
    resumen: i.resumen ?? null,
    n_operaciones: num(i.n_operaciones),
    tipo: i.tipo_principal ?? null,
    cerrada: !!i.cerrada_at,
  }));

  const ops = recortar(operaciones.data as any[], TOPE_OPERACIONES, "operaciones");
  const operacionesSalida = ops.map((o: any) => ({
    // Una operación no tiene pantalla propia: su contexto es la intervención
    // a la que pertenece, y si no tiene, la ficha. Lo resuelve evidencias.ts.
    ref: anotar("operacion", String(o.id),
      `${o.tipo_operacion ?? "Operación"} del ${soloFecha(o.fecha_operacion) ?? "?"}`),
    tipo: o.tipo_operacion ?? null,
    fecha: soloFecha(o.fecha_operacion),
    km: num(o.km_vehiculo),
    condicion: o.condicion ?? null,
    motivo: o.motivo ?? null,
    intervencion_id: o.intervencion_id ?? null,
  }));

  const rvs = recortar(revisiones.data as any[], TOPE_REVISIONES, "revisiones");
  const revisionesSalida = rvs.map((r: any) => ({
    ref: anotar("revision", String(r.id), `Revisión del ${soloFecha(r.fecha_revision) ?? "?"}`),
    fecha: soloFecha(r.fecha_revision),
    hace_dias: dias(r.fecha_revision, ahora),
    km: num(r.km_vehiculo),
    origen_km: r.origen_km ?? null,
    estado: r.estado_revision ?? null,
    tipo: r.tipo_revision ?? null,
    n_neumaticos: num(r.n_neumaticos),
  }));

  const ins = recortar(incidencias.data as any[], TOPE_INCIDENCIAS, "incidencias abiertas");
  const incidenciasSalida = ins.map((i: any) => ({
    ref: anotar("incidencia", String(i.id),
      `Incidencia ${i.gravedad ?? ""} del ${soloFecha(i.detectada_at) ?? "?"}`.trim()),
    gravedad: i.gravedad ?? null,
    estado: i.estado ?? null,
    detectada: soloFecha(i.detectada_at),
    dias_abierta: dias(i.detectada_at, ahora),
    fecha_recomendada: soloFecha(i.fecha_recomendada),
    accion_recomendada: i.accion_recomendada ?? null,
  }));

  const planesSalida = (planes.data ?? []).map((p: any) => {
    const diasRestantes = p.proxima_fecha
      ? -(dias(p.proxima_fecha, ahora) ?? 0) : null;
    const kmRestantes = kmActual != null && num(p.proxima_km) != null
      ? (num(p.proxima_km) as number) - kmActual : null;
    return {
      ref: anotar("plan", String(p.id), `Plan «${p.nombre ?? "mantenimiento"}» de ${v.matricula}`),
      nombre: p.nombre ?? null,
      proxima_fecha: soloFecha(p.proxima_fecha),
      proxima_km: num(p.proxima_km),
      dias_restantes: diasRestantes,
      km_restantes: kmRestantes,
      // Calculado aquí, no deducido por el modelo.
      vencido: (diasRestantes != null && diasRestantes < 0) || (kmRestantes != null && kmRestantes < 0),
    };
  });

  // ── Qué falta. Lo decide el servidor; el modelo solo lo redacta. ─────────
  const faltan: DatoQueFalta[] = [];
  if (!v.tipo_vehiculo_id) faltan.push({ clave: "sin_tipo", texto: "El vehículo no tiene tipo asignado." });
  if (!v.medida_id) faltan.push({ clave: "sin_medida", texto: "No consta la medida de neumático." });
  if (!v.tipo_llanta_id) faltan.push({ clave: "sin_llanta", texto: "No consta el tipo de llanta." });
  if (kmActual == null || kmActual <= 0) faltan.push({ clave: "sin_km", texto: "El vehículo no tiene kilometraje registrado." });
  if (!v.webfleet_vehicle_id) faltan.push({ clave: "sin_telematica", texto: "No consta enlace con telemática: los kilómetros se informan a mano." });
  if (montajesVivos.length === 0) faltan.push({ clave: "sin_montajes", texto: "No hay ningún neumático montado registrado." });
  if (revisionesSalida.length === 0) faltan.push({ clave: "sin_revisiones", texto: `No hay revisiones registradas en los últimos ${VENTANA_MESES} meses.` });
  const sinKm = revisionesSalida.filter((r) => r.km == null).length;
  if (sinKm > 0) faltan.push({ clave: "revisiones_sin_km", texto: `${sinKm} de las revisiones enviadas no tienen kilometraje.` });

  // ── Contradicciones: se señalan, no se resuelven ─────────────────────────
  const contradicciones: string[] = [];
  for (let i = 0; i < revisionesSalida.length - 1; i++) {
    const nueva = revisionesSalida[i], vieja = revisionesSalida[i + 1];
    if (nueva.km != null && vieja.km != null && nueva.km < vieja.km) {
      contradicciones.push(
        `La revisión del ${nueva.fecha} marca ${nueva.km} km, por debajo de los ${vieja.km} km de la del ${vieja.fecha}. Un odómetro no retrocede.`);
    }
  }
  if (kmActual != null) {
    const porEncima = revisionesSalida.find((r) => r.km != null && (r.km as number) > kmActual);
    if (porEncima) {
      contradicciones.push(
        `La revisión del ${porEncima.fecha} marca ${porEncima.km} km, más que los ${kmActual} km que figuran hoy en la ficha.`);
    }
  }

  const avisosKm = diasKm != null && diasKm > KM_VIEJO_DIAS
    ? [{ clave: "km_viejo", texto: `El kilometraje de la ficha se actualizó hace ${diasKm} días.` }]
    : [];
  faltan.push(...avisosKm);

  const datos: DatosResumen = {
    generado_at: ahora.toISOString(),
    ventana: { meses: VENTANA_MESES, desde: desdeIso.slice(0, 10) },
    vehiculo: {
      ref: refVehiculo,
      matricula: v.matricula, numero_unidad: v.numero_unidad ?? null,
      marca: v.marca ?? null, modelo: v.modelo ?? null,
      km_actual: kmActual, origen_km: v.origen_km ?? null,
      km_actualizado_hace_dias: diasKm, activo: v.activo !== false,
    },
    montajes_vivos: montajesVivos,
    intervenciones: intervencionesSalida,
    operaciones: operacionesSalida,
    revisiones: revisionesSalida,
    incidencias_abiertas: incidenciasSalida,
    planes: planesSalida,
    datos_que_faltan: faltan,
    contradicciones,
    recortes,
  };

  const hayAlgoQueResumir =
    montajesVivos.length > 0 || intervencionesSalida.length > 0 ||
    operacionesSalida.length > 0 || revisionesSalida.length > 0 ||
    incidenciasSalida.length > 0 || planesSalida.length > 0;

  return { datos, refs, hayAlgoQueResumir, huella: huellaDe(datos, empresaId), empresaId };
}

/**
 * Huella de la entrada para la caché.
 *
 * Incluye la empresa (dos clientes no comparten resumen ni por accidente) y
 * se le añade fuera la versión del prompt. NO incluye `generado_at`, que
 * cambia en cada llamada y haría la caché inútil.
 */
export function huellaDe(datos: DatosResumen, empresaId: string): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se desestructura para DEJARLO FUERA de la huella
  const { generado_at, ...estable } = datos;
  return createHash("sha256")
    .update(empresaId).update("|")
    .update(JSON.stringify(estable))
    .digest("hex");
}
