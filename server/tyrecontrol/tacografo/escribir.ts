/**
 * Lo único de este módulo que escribe en la base.
 *
 * Está aparte para que se pueda responder sin leer nada más a «¿qué tablas
 * toca esto?». La respuesta es: `tc_tacografo_lotes`,
 * `tc_tacografo_intervenciones`, `tc_tacografo_bloqueados`,
 * `tc_tacografo_medida_propuesta` y —para los informes en PDF—
 * `tc_vehiculo_documentos` y el bucket privado de documentos. Ninguna otra.
 *
 * ── La idempotencia va en DOS sitios, y hace falta ──────────────────────────
 *
 * `preparar()` ya salta los `id_origen` que estaban cuando se leyó la base.
 * Eso basta para el caso normal, pero no para dos personas importando a la
 * vez, ni para un reintento después de un corte a mitad: entre la lectura y
 * la escritura el mundo puede haber cambiado.
 *
 * Por eso el insert va con `onConflict` sobre la clave única
 * `(empresa_id, sistema_origen, id_origen)` e `ignoreDuplicates`. La base es
 * quien decide, y la base no se equivoca con las carreras. Es la diferencia
 * entre «no duplica si todo va bien» y «no puede duplicar».
 *
 * ── Por lotes de 200 ────────────────────────────────────────────────────────
 *
 * 1.744 filas de 50 columnas en una sola petición es un cuerpo enorme y un
 * fallo de todo o nada. De 200 en 200 son nueve peticiones, cada una con su
 * resultado, y lo que entró sigue dentro si la décima falla: volver a pasar
 * el fichero recoge lo que quede, porque la clave única hace el resto.
 */

import { supabase, SUPABASE_DOCS_BUCKET } from "../../supabase.ts";
import { TIPO_DOC_INFORME } from "./datos.ts";
import type { FilaBloqueada, FilaInsert } from "./importar.ts";
import type { PropuestaInsert } from "./propuestas.ts";

/** Filas por petición. Ver la cabecera: ni una sola ni de una en una. */
const TAMANO_LOTE = 200;

export interface CabeceraLote {
  empresa: string;
  archivo: string;
  sistemaOrigen: string;
  archivoFilas: number;
  filasEmpresa: number;
  usuarioId: string | null;
  sha256?: string | null;
}

/** Crea el lote y devuelve su id. Se crea ANTES de insertar nada: las filas lo necesitan. */
export async function crearLote(c: CabeceraLote): Promise<string> {
  const { data, error } = await supabase
    .from("tc_tacografo_lotes")
    .insert({
      empresa_id: c.empresa,
      archivo_nombre: c.archivo,
      sistema_origen: c.sistemaOrigen,
      archivo_filas: c.archivoFilas,
      filas_empresa: c.filasEmpresa,
      importado_por: c.usuarioId,
      archivo_sha256: c.sha256 ?? null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`No se ha podido abrir el lote: ${error.message}`);
  return String((data as any).id);
}

export interface ResultadoEscritura {
  insertadas: number;
  /** Las que la BASE rechazó por duplicadas, además de las que ya saltó `preparar`. */
  duplicadasEnBase: number;
  bloqueadas: number;
}

/**
 * Inserta las filas, en tandas, sin poder duplicar.
 *
 * Devuelve cuántas entraron de verdad: con `ignoreDuplicates`, la base no
 * devuelve las que ya estaban, así que la diferencia entre lo que se mandó y
 * lo que volvió son las que alguien había metido entretanto.
 */
export async function insertarFilas(filas: FilaInsert[]): Promise<{ insertadas: number; duplicadas: number }> {
  let insertadas = 0;
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const tanda = filas.slice(i, i + TAMANO_LOTE);
    const { data, error } = await supabase
      .from("tc_tacografo_intervenciones")
      .upsert(tanda, {
        onConflict: "empresa_id,sistema_origen,id_origen",
        ignoreDuplicates: true,
      })
      .select("id");
    if (error) {
      throw new Error(`Fallo al grabar las filas ${i + 1}–${i + tanda.length}: ${error.message}`);
    }
    insertadas += (data ?? []).length;
  }
  return { insertadas, duplicadas: filas.length - insertadas };
}

/** Deja constancia de lo que no entró y por qué. */
export async function guardarBloqueadas(
  empresa: string, loteId: string, filas: FilaBloqueada[],
): Promise<number> {
  if (filas.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const tanda = filas.slice(i, i + TAMANO_LOTE).map((b) => ({
      lote_id: loteId, empresa_id: empresa,
      fila_origen: b.fila_origen, id_origen: b.id_origen,
      matricula: b.matricula, fecha: b.fecha, motivo: b.motivo, valor: b.valor,
    }));
    const { error } = await supabase.from("tc_tacografo_bloqueados").insert(tanda);
    if (error) throw new Error(`No se han podido guardar las bloqueadas: ${error.message}`);
    n += tanda.length;
  }
  return n;
}

/** Cierra el lote con sus números, para que la pantalla no tenga que recontarlos. */
export async function cerrarLote(
  loteId: string,
  r: { importadas: number; duplicadas: number; sinVehiculo: number; bloqueadas: number },
): Promise<void> {
  const { error } = await supabase
    .from("tc_tacografo_lotes")
    .update({
      importadas: r.importadas, duplicadas: r.duplicadas,
      sin_vehiculo: r.sinVehiculo, bloqueadas: r.bloqueadas,
    })
    .eq("id", loteId);
  if (error) throw new Error(`No se ha podido cerrar el lote: ${error.message}`);
}

/**
 * Borra las filas del lote y lo marca como deshecho.
 *
 * El lote NO se borra: queda con `estado='deshecho'`. Que alguien importara
 * 1.744 filas y las deshiciera media hora después es historia que explica
 * cosas, y borrarla la perdería.
 *
 * Solo toca filas con ESE `lote_id`: las que este lote se saltó por estar ya
 * importadas conservan el del lote que las metió de verdad, así que no son
 * suyas y no se las lleva. Eso no es una comprobación, sale de cómo se graba.
 */
export async function borrarLote(
  loteId: string, empresa: string, usuarioId: string | null,
): Promise<number> {
  const { data, error } = await supabase
    .from("tc_tacografo_intervenciones")
    .delete()
    .eq("lote_id", loteId)
    .eq("empresa_id", empresa)   // cinturón y tirantes: el lote ya se comprobó
    .select("id");
  if (error) throw new Error(`No se han podido borrar las filas del lote: ${error.message}`);

  const { error: e2 } = await supabase
    .from("tc_tacografo_lotes")
    .update({ estado: "deshecho", deshecho_en: new Date().toISOString(), deshecho_por: usuarioId })
    .eq("id", loteId)
    .eq("empresa_id", empresa);
  if (e2) throw new Error(`Filas borradas pero el lote no se ha marcado: ${e2.message}`);

  return (data ?? []).length;
}

// ── Fase 5: las propuestas de medida ───────────────────────────────────────
//
// Aquí se amplía la respuesta a «¿qué tablas toca esto?» con dos más:
// `tc_tacografo_medida_propuesta` y —solo al aceptar, y solo la columna
// `medida_id`— `tc_vehiculos`. Sigue sin tocarse ni un montaje, ni un
// neumático, ni un eje, ni `km_actual`.

/**
 * Guarda las propuestas pendientes de un lote.
 *
 * Sin `onConflict`: el índice único de esta tabla es PARCIAL (solo para las
 * pendientes) y PostgREST no sabe expresar el `where` de un `on conflict`,
 * así que pedírselo daría «no unique or exclusion constraint matching». Las
 * repetidas las filtra `filasPropuesta` antes de llegar aquí, contra las que
 * ya hay en la base.
 *
 * Aun así se tolera el choque: si dos importaciones coinciden en el tiempo,
 * la segunda se encuentra el índice y lo que NO puede pasar es que por eso
 * se caiga una importación de 1.744 intervenciones que ya están dentro. Se
 * cuenta como no insertada y se sigue.
 */
export async function insertarPropuestas(filas: PropuestaInsert[]): Promise<{ insertadas: number; chocadas: number }> {
  if (filas.length === 0) return { insertadas: 0, chocadas: 0 };
  let insertadas = 0;
  let chocadas = 0;
  for (let i = 0; i < filas.length; i += TAMANO_LOTE) {
    const tanda = filas.slice(i, i + TAMANO_LOTE);
    const { data, error } = await supabase
      .from("tc_tacografo_medida_propuesta")
      .insert(tanda)
      .select("id");
    if (error) {
      // 23505 es la violación de unicidad. Cualquier otra cosa sí es un fallo.
      if (String((error as any).code) !== "23505") {
        throw new Error(`No se han podido guardar las propuestas: ${error.message}`);
      }
      chocadas += tanda.length;
      continue;
    }
    insertadas += (data ?? []).length;
  }
  return { insertadas, chocadas };
}

export interface Aplicacion {
  propuestaId: string;
  empresa: string;
  vehiculoId: string;
  medidaId: string;
  medidaValor: string;
  exacta: boolean;
  /** La medida que el vehículo tenía cuando se creó la propuesta. */
  medidaPreviaId: string | null;
  usuarioId: string | null;
}

/**
 * Acepta una propuesta: escribe la medida en el vehículo y deja el rastro.
 *
 * ── El update es un compara-y-cambia, no una escritura a ciegas ─────────────
 *
 * La condición de la propia sentencia exige que la medida del vehículo siga
 * siendo la que la propuesta vio: `is null` si estaba vacía, `eq` si tenía
 * una. Así la comprobación la hace LA BASE en el momento de escribir, no una
 * lectura de hace dos segundos. Si alguien la cambió entremedias, no se
 * escribe nada y se dice; si no, es imposible pisarle la decisión.
 *
 * ── Y el orden importa ──────────────────────────────────────────────────────
 *
 * Primero se escribe el vehículo y después se marca la propuesta. Si se
 * hiciera al revés y el update del vehículo fallara, la propuesta quedaría
 * «aceptada» sin que la medida esté puesta: una mentira en la pantalla. Al
 * revés, el peor caso es una medida escrita con la propuesta aún pendiente,
 * que se ve, se entiende y se puede rehacer.
 */
export async function aplicarPropuesta(a: Aplicacion): Promise<{ ok: boolean; motivo?: string }> {
  let q = supabase
    .from("tc_vehiculos")
    .update({ medida_id: a.medidaId })
    .eq("id", a.vehiculoId)
    .eq("empresa_id", a.empresa);
  q = a.medidaPreviaId === null ? q.is("medida_id", null) : q.eq("medida_id", a.medidaPreviaId);

  const { data, error } = await q.select("id");
  if (error) throw new Error(`No se ha podido escribir la medida del vehículo: ${error.message}`);
  if ((data ?? []).length === 0) {
    return {
      ok: false,
      motivo: "La medida del vehículo ha cambiado mientras se aceptaba la propuesta, o el "
        + "vehículo no es de esta empresa. No se ha escrito nada.",
    };
  }

  const { error: e2 } = await supabase
    .from("tc_tacografo_medida_propuesta")
    .update({
      estado: "aceptada",
      resuelto_por: a.usuarioId,
      resuelto_en: new Date().toISOString(),
      medida_aplicada_id: a.medidaId,
      medida_aplicada: a.medidaValor,
      aplicada_exacta: a.exacta,
    })
    .eq("id", a.propuestaId)
    .eq("empresa_id", a.empresa)
    .eq("estado", "pendiente");
  if (e2) {
    throw new Error(
      `La medida «${a.medidaValor}» SÍ se ha escrito en el vehículo, pero la propuesta no se ha `
      + `marcado como aceptada: ${e2.message}. Aparecerá todavía pendiente.`,
    );
  }
  return { ok: true };
}

/** Rechaza una propuesta. No escribe nada en el vehículo, que es el punto. */
export async function rechazarPropuesta(
  propuestaId: string, empresa: string, usuarioId: string | null, nota: string | null,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("tc_tacografo_medida_propuesta")
    .update({
      estado: "rechazada",
      resuelto_por: usuarioId,
      resuelto_en: new Date().toISOString(),
      nota,
    })
    .eq("id", propuestaId)
    .eq("empresa_id", empresa)
    .eq("estado", "pendiente")
    .select("id");
  if (error) throw new Error(`No se ha podido rechazar la propuesta: ${error.message}`);
  return (data ?? []).length > 0;
}

// ════════════════════════════════════════════════════════════════════════════
// Los informes técnicos en PDF
// ════════════════════════════════════════════════════════════════════════════

/**
 * Una intervención creada leyendo un informe en PDF.
 *
 * Va con `onConflict` por lo mismo que el importador: entre comprobar que no
 * estaba y escribirla, otra persona puede haber importado el Excel. Si la
 * base dice que ya está, se devuelve la que hay en vez de reventar: lo que
 * quería quien subió el PDF era adjuntarlo, y eso sigue pudiéndose hacer.
 */
export async function insertarIntervencionDePdf(
  fila: FilaInsert,
): Promise<{ id: string; yaEstaba: boolean }> {
  const { data, error } = await supabase
    .from("tc_tacografo_intervenciones")
    .insert(fila)
    .select("id")
    .single();
  if (!error) return { id: String((data as any).id), yaEstaba: false };

  if ((error as any).code !== "23505") {
    throw new Error(`No se ha podido crear la intervención: ${error.message}`);
  }
  const { data: ya, error: e2 } = await supabase
    .from("tc_tacografo_intervenciones")
    .select("id")
    .eq("empresa_id", fila.empresa_id)
    .eq("sistema_origen", fila.sistema_origen)
    .eq("id_origen", fila.id_origen)
    .single();
  if (e2) throw new Error(`No se ha podido crear la intervención: ${error.message}`);
  return { id: String((ya as any).id), yaEstaba: true };
}

/**
 * Vincula a un vehículo una intervención que estaba sin él.
 *
 * Con `is("vehiculo_id", null)` dentro del UPDATE y no antes: si entretanto
 * alguien la ha vinculado a mano, esto no la mueve. Devuelve si lo hizo.
 */
export async function vincularIntervencion(
  intervencionId: string, vehiculoId: string, usuarioId: string | null,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("tc_tacografo_intervenciones")
    .update({ vehiculo_id: vehiculoId, vinculado_en: new Date().toISOString(), vinculado_por: usuarioId })
    .eq("id", intervencionId)
    .is("vehiculo_id", null)
    .select("id");
  if (error) throw new Error(`No se ha podido vincular la intervención: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * Completa las filas que creó un informe en PDF con lo que trae el Excel.
 *
 * El parche lo calcula `parcheParaCompletar()`, que solo rellena nulos. Aquí
 * solo se aplica, de una en una: son pocas —las que alguien adjuntó entre dos
 * importaciones— y así un fallo en una no se lleva las demás.
 */
export async function completarDePdf(
  empresa: string, parches: Array<{ idOrigen: string; parche: Record<string, unknown> }>,
): Promise<number> {
  let completadas = 0;
  for (const { idOrigen, parche } of parches) {
    const { data, error } = await supabase
      .from("tc_tacografo_intervenciones")
      .update(parche)
      .eq("empresa_id", empresa)
      .eq("id_origen", idOrigen)
      // Solo si sigue siendo una fila a medias: si otra importación la
      // completó mientras, esto no la vuelve a tocar.
      .eq("creada_de_pdf", true)
      .select("id");
    if (error) throw new Error(`No se ha podido completar ${idOrigen}: ${error.message}`);
    completadas += (data ?? []).length;
  }
  return completadas;
}

export interface InformeParaGuardar {
  empresa: string;
  /**
   * `null` cuando la matrícula del impreso no está en TyreControl. El informe
   * se guarda igual, colgando de su intervención: tirarlo obligaría a que
   * alguien se acordara de volver a subirlo semanas después, y el papel que
   * se pierde es el que nadie echa de menos hasta que hace falta.
   */
  vehiculoId: string | null;
  intervencionId: string;
  pdf: Buffer;
  nombreOriginal: string;
  sha256: string;
  paginas: number | null;
  idOrigen: string;
  usuarioId: string | null;
}

/**
 * Sube el PDF al bucket privado y lo deja apuntando a su intervención.
 *
 * El orden importa y es éste: primero el fichero, después la fila. Si falla
 * la fila queda un objeto huérfano en el bucket, que no se ve y no estorba;
 * al revés quedaría una fila en la ficha con un clip que no abre nada.
 *
 * `vigente` se queda como venga y `ocr_*` sin tocar: ver la migración.
 */
export async function guardarInformePdf(i: InformeParaGuardar): Promise<{ id: string; ruta: string }> {
  // Sin vehículo, bajo «sin-vehiculo»: la carpeta tiene que existir igual, y
  // así se ve de un vistazo en el bucket lo que está esperando un alta.
  const ruta = `${i.empresa}/${i.vehiculoId ?? "sin-vehiculo"}/tacografo/${i.idOrigen}-${Date.now()}.pdf`;
  const { error: subida } = await supabase.storage
    .from(SUPABASE_DOCS_BUCKET)
    .upload(ruta, i.pdf, { contentType: "application/pdf", upsert: false });
  if (subida) throw new Error(`No se ha podido guardar el PDF: ${subida.message}`);

  const { data, error } = await supabase
    .from("tc_vehiculo_documentos")
    .insert({
      vehiculo_id: i.vehiculoId,
      empresa_id: i.empresa,
      tipo: TIPO_DOC_INFORME,
      storage_path: ruta,
      nombre_original: i.nombreOriginal,
      mime_type: "application/pdf",
      paginas: i.paginas,
      tamano_bytes: i.pdf.length,
      hash_sha256: i.sha256,
      intervencion_id: i.intervencionId,
      subido_por: i.usuarioId,
    })
    .select("id")
    .single();
  if (error) throw new Error(`No se ha podido registrar el informe: ${error.message}`);
  return { id: String((data as any).id), ruta };
}

/** La URL firmada con la que el panel abre o descarga un informe. */
export async function urlFirmadaDeInforme(ruta: string, segundos = 3600): Promise<string | null> {
  const { data } = await supabase.storage.from(SUPABASE_DOCS_BUCKET).createSignedUrl(ruta, segundos);
  return data?.signedUrl ?? null;
}
