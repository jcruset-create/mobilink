/**
 * Un correo de Goodyear, de principio a fin: entenderlo, casarlo y guardarlo.
 *
 * Es la puerta única. El buzón la llama por cada correo que no trae el adjunto
 * del informe, y el día que haya una importación a mano desde el panel llamará
 * aquí también: dos puertas, un solo camino, que es lo que hace que la
 * importación manual y la automática no puedan equivocarse de forma distinta.
 *
 * ── Qué se marca como leído y qué no ───────────────────────────────────────
 *
 * Importa, porque de eso depende que un aviso se pierda o no:
 *
 *   · `alerta` / `repetido` / `no_casado` / `no_es_alerta`  → LEÍDO.
 *     Volver a pasarlos daría exactamente lo mismo. El `no_casado` no se
 *     pierde: queda en `tc_goodyear_avisos` con su motivo y con lo que se
 *     entendió, así que se puede arreglar el casado y repasarlo sin pedirle a
 *     nadie que reenvíe nada.
 *
 *   · `error`  → SIN LEER, para reintentarlo en la pasada siguiente.
 *     Es un fallo pasajero —la base no contesta—, y marcarlo sería descartar
 *     un aviso de presión por un hipo de red.
 *
 * La diferencia entre `no_casado` y `error` es justo ésa: uno es un correo que
 * entendimos y no supimos colocar, y el otro es que no hemos podido mirar.
 */

import { supabase } from "../../supabase.ts";
import { leerAlerta, type AlertaGoodyear } from "./alerta.ts";
import {
  casarPosicion, casarVehiculo, severidadDe,
  type PosicionFicha, type VehiculoFicha,
} from "./casado.ts";

/** Lo que el buzón necesita saber para decidir si marca el correo leído. */
export type ResultadoIngesta =
  | { estado: "no_es_alerta" }
  | { estado: "alerta"; alertaId: string; nueva: boolean }
  | { estado: "repetido" }
  | { estado: "no_casado"; motivo: string }
  | { estado: "error"; motivo: string };

/** Cómo cuenta el correo en la pasada del buzón. */
export type Procesado = "alerta" | "repetido" | "no_casado" | "ignorado" | "error";

/**
 * De lo que ha pasado al apunte de la pasada.
 *
 * Separado y puro a propósito: de esta función y de `seMarcaLeido` depende que
 * un aviso de presión se guarde, se cuente o se pierda, y las dos reglas caben
 * en cuatro líneas que sí se pueden probar sin buzón ni base de datos.
 */
export function clasificar(r: ResultadoIngesta): Procesado {
  switch (r.estado) {
    case "no_es_alerta": return "ignorado";
    // Una alerta que no es nueva es un aviso más de una rueda que ya estaba
    // avisando: cuenta como repetida, no como alerta nueva.
    case "alerta": return r.nueva ? "alerta" : "repetido";
    default: return r.estado;
  }
}

/**
 * ¿Se marca el correo como leído? (También vale para el informe del
 * CheckPoint, que es la otra cosa que llega a este buzón y también se marca.)
 *
 * Todo menos el error. El `no_casado` TAMBIÉN se marca: volver a pasarlo daría
 * exactamente lo mismo, y no se pierde porque queda en `tc_goodyear_avisos`
 * con su motivo y con lo que se entendió. El error no, para que se reintente
 * en la pasada siguiente: marcarlo sería descartar un aviso de presión por un
 * hipo de red.
 */
export function seMarcaLeido(p: Procesado | "importado"): boolean {
  return p !== "error";
}

export interface CorreoGoodyear {
  messageId: string;
  asunto?: string | null;
  html?: string | null;
  texto?: string | null;
  remitente?: string | null;
  fecha?: Date | null;
}

/** El remitente de Goodyear Proactive Solutions. */
export const REMITENTE_GOODYEAR = "proactivesolutions-alerts@ps.goodyear.com";

export async function procesarAvisoGoodyear(correo: CorreoGoodyear): Promise<ResultadoIngesta> {
  const lectura = leerAlerta(correo);
  if ("motivo" in lectura) {
    /*
     * No se ha entendido. Hay dos casos muy distintos y se separan por el
     * remitente: si NO viene de Goodyear es cualquier otro correo que ha caído
     * en el buzón y no es asunto nuestro; si viene de Goodyear y no se
     * entiende, eso es la plantilla cambiada y hay que dejar constancia.
     */
    const deGoodyear = (correo.remitente ?? "").toLowerCase().includes("goodyear");
    if (!deGoodyear) return { estado: "no_es_alerta" };
    await anotar(correo, "no_casado", lectura.motivo, null, null);
    return { estado: "no_casado", motivo: lectura.motivo };
  }
  const alerta = lectura;

  try {
    // ── Ya procesado ───────────────────────────────────────────────────────
    // El `message_id` es único en la tabla, pero se consulta antes para poder
    // distinguir «repetido» de «error» en la cuenta de la pasada.
    const { data: ya, error: eYa } = await supabase
      .from("tc_goodyear_avisos").select("id, estado")
      .eq("message_id", correo.messageId).maybeSingle();
    if (eYa) throw new Error(eYa.message);
    // Un intento que acabó en `error` NO cuenta como procesado: si contara,
    // arreglar la causa no serviría de nada porque el aviso ya estaría dado
    // por visto. Mismo criterio que `tc_checkpoint_ejecuciones`.
    if (ya && ya.estado !== "error") return { estado: "repetido" };
    if (ya) await supabase.from("tc_goodyear_avisos").delete().eq("id", ya.id);

    // ── Qué vehículo ───────────────────────────────────────────────────────
    const { data: candidatos, error: eVeh } = await supabase
      .from("tc_vehiculos")
      .select("id, empresa_id, matricula, numero_unidad, tipo_vehiculo_id")
      .eq("matricula", alerta.matricula);
    if (eVeh) throw new Error(eVeh.message);

    const vehiculo = casarVehiculo((candidatos ?? []) as VehiculoFicha[], alerta);
    if ("motivo" in vehiculo) {
      await anotar(correo, "no_casado", vehiculo.motivo, alerta, null);
      return { estado: "no_casado", motivo: vehiculo.motivo };
    }

    // ── Qué rueda ──────────────────────────────────────────────────────────
    // Se piden TODAS las posiciones del tipo, no las del eje: hace falta ver
    // el eje entero para saber si es de rueda gemela o simple.
    const { data: ruedas, error: ePos } = await supabase
      .from("tc_posiciones_vehiculo")
      .select("id, codigo_posicion, eje, lado, interior_exterior")
      .eq("tipo_vehiculo_id", vehiculo.tipo_vehiculo_id);
    if (ePos) throw new Error(ePos.message);

    const posicion = casarPosicion((ruedas ?? []) as PosicionFicha[], alerta);
    if ("motivo" in posicion) {
      await anotar(correo, "no_casado", posicion.motivo, alerta, vehiculo.id);
      return { estado: "no_casado", motivo: posicion.motivo };
    }

    // ── Qué goma había puesta ──────────────────────────────────────────────
    // Mejor esfuerzo: si no se puede leer, el aviso entra igual. Saber que la
    // rueda está baja importa más que saber cuál es la goma.
    let neumaticoId: string | null = null;
    try {
      const { data: montaje } = await supabase
        .from("tc_montajes_actuales").select("neumatico_id")
        .eq("vehiculo_id", vehiculo.id).eq("posicion_id", posicion.id).maybeSingle();
      neumaticoId = montaje?.neumatico_id ?? null;
    } catch { /* sin goma identificada; el aviso sigue valiendo */ }

    const guardada = await guardarAlerta(alerta, vehiculo, posicion.id, neumaticoId);
    await anotar(correo, guardada.nueva ? "alerta" : "repetido", null, alerta, vehiculo.id, guardada.id);
    return { estado: "alerta", alertaId: guardada.id, nueva: guardada.nueva };
  } catch (e: unknown) {
    const motivo = (e as Error)?.message ?? String(e);
    // Se intenta dejar constancia, pero si esto también falla no se insiste:
    // lo que importa es devolver `error` para que el correo quede SIN LEER.
    try { await anotar(correo, "error", motivo, alerta, null); } catch { /* la base no contesta */ }
    return { estado: "error", motivo };
  }
}

/**
 * Abre la alerta, o actualiza la que ya estaba abierta para esa rueda.
 *
 * Una fila por RUEDA y no por correo: en diez avisos reales, tres ruedas
 * aparecían dos veces con un día de diferencia y sin arreglar. El índice único
 * parcial de la migración garantiza que no haya dos abiertas a la vez; aquí se
 * busca la abierta antes de insertar.
 */
async function guardarAlerta(
  alerta: AlertaGoodyear,
  vehiculo: VehiculoFicha,
  posicionId: string,
  neumaticoId: string | null,
): Promise<{ id: string; nueva: boolean }> {
  const medido = alerta.medidoAt.toISOString();

  const { data: abierta, error: eAbierta } = await supabase
    .from("tc_alertas_presion").select("id, avisos, ultimo_aviso_at")
    .eq("vehiculo_id", vehiculo.id).eq("posicion_id", posicionId)
    .eq("estado", "abierta").maybeSingle();
  if (eAbierta) throw new Error(eAbierta.message);

  const lectura = {
    tipo: alerta.tipo,
    severidad: severidadDe(alerta.tipo),
    presion_recomendada_bar: alerta.presionRecomendadaBar,
    presion_bar: alerta.presionBar,
    desviacion_pct: alerta.desviacionPct,
    umbral_pct: alerta.umbralPct,
    medido_at: medido,
    neumatico_id: neumaticoId,
  };

  if (abierta) {
    /*
     * Un aviso MÁS VIEJO que el último no pisa la lectura.
     *
     * Pasa al cargar atrasados o si el buzón se lee a destiempo: el correo de
     * ayer llegaría después del de hoy y dejaría la ficha diciendo una presión
     * que ya no es. Se cuenta el aviso, que para eso está `avisos`, pero la
     * lectura que se enseña es la más reciente.
     */
    const masNuevo = medido > String(abierta.ultimo_aviso_at);
    const { error } = await supabase.from("tc_alertas_presion").update({
      ...(masNuevo ? lectura : { neumatico_id: neumaticoId }),
      avisos: (abierta.avisos ?? 1) + 1,
      ultimo_aviso_at: masNuevo ? medido : abierta.ultimo_aviso_at,
      actualizado_at: new Date().toISOString(),
    }).eq("id", abierta.id);
    if (error) throw new Error(error.message);
    return { id: abierta.id, nueva: false };
  }

  const { data, error } = await supabase.from("tc_alertas_presion").insert({
    empresa_id: vehiculo.empresa_id,
    vehiculo_id: vehiculo.id,
    posicion_id: posicionId,
    ...lectura,
    estado: "abierta",
    avisos: 1,
    primer_aviso_at: medido,
    ultimo_aviso_at: medido,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, nueva: true };
}

/** El rastro del correo. Nunca lanza hacia fuera: es constancia, no proceso. */
async function anotar(
  correo: CorreoGoodyear,
  estado: "alerta" | "repetido" | "no_casado" | "ignorado" | "error",
  motivo: string | null,
  alerta: AlertaGoodyear | null,
  _vehiculoId: string | null,
  alertaId?: string,
): Promise<void> {
  const { error } = await supabase.from("tc_goodyear_avisos").insert({
    message_id: correo.messageId,
    asunto: correo.asunto ?? null,
    remitente: correo.remitente ?? null,
    fecha_correo: correo.fecha ? correo.fecha.toISOString() : null,
    estado,
    motivo,
    alerta_id: alertaId ?? null,
    // Lo que se entendió, aunque no se pudiera casar: es lo que permite
    // arreglar el casado después y repasar los apartados sin reenviar nada.
    leido: alerta ? { ...alerta, medidoAt: alerta.medidoAt.toISOString() } : null,
  });
  if (error) throw new Error(error.message);
}
