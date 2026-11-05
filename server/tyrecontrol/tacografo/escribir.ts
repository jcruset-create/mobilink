/**
 * Lo único de este módulo que escribe en la base.
 *
 * Está aparte para que se pueda responder sin leer nada más a «¿qué tablas
 * toca esto?». La respuesta es: `tc_tacografo_lotes`,
 * `tc_tacografo_intervenciones` y `tc_tacografo_bloqueados`. Ninguna otra.
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

import { supabase } from "../../supabase.ts";
import type { FilaBloqueada, FilaInsert } from "./importar.ts";

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
