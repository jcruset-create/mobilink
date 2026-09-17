import { supabase } from "../services/supabase";

/**
 * Lo que el panel necesita del etiquetado: leer lotes y fotos, y dejar que
 * una persona confirme los números antes de imprimirlos.
 *
 * NO HAY NADA DE INVENTARIO AQUÍ. Ni se crean neumáticos, ni se monta, ni se
 * mueve stock, ni se genera coste. Confirmar un número significa «este número
 * es el que se imprime», y nada más.
 */

export type EstadoLoteEtiquetas = "abierto" | "cerrado";

export type EstadoFotoEtiqueta =
  | "pendiente"      // subida, sin leer
  | "detectada"      // la IA leyó un número con confianza
  | "revisar"        // leyó algo, pero poco claro
  | "no_detectada"   // no se ve número en la foto
  | "confirmada"     // una persona dijo que este es el número
  | "impresa"
  | "descartada";

export interface FotoEtiqueta {
  id: string;
  lote_id: string;
  empresa_id: string;
  foto_url: string;
  serie_detectada: string | null;
  confianza: number | null;
  dudoso: boolean;
  serie_confirmada: string | null;
  estado: EstadoFotoEtiqueta;
  revisado_por: string | null;
  revisado_at: string | null;
  impreso_at: string | null;
  created_at: string;
}

export interface LoteEtiquetas {
  id: string;
  empresa_id: string;
  codigo: string;
  estado: EstadoLoteEtiquetas;
  created_at: string;
  cerrado_at: string | null;
  empresa?: { id: string; nombre: string } | null;
  /** Recuentos del lote, calculados a partir de sus fotos. */
  fotos: number;
  por_revisar: number;
  confirmadas: number;
  impresas: number;
}

/** El número que se imprime: el que confirmó una persona. */
export const serieAImprimir = (f: FotoEtiqueta): string | null =>
  f.serie_confirmada?.trim() || null;

const PENDIENTES: EstadoFotoEtiqueta[] = ["pendiente", "detectada", "revisar", "no_detectada"];

/**
 * Los lotes con sus recuentos.
 *
 * Los recuentos se calculan de las fotos que vienen en la misma consulta, no
 * con cinco `count` aparte: así el número de la lista y lo que hay dentro del
 * lote no pueden contradecirse.
 */
export async function listarLotesEtiquetas(empresaId?: string | null): Promise<LoteEtiquetas[]> {
  let q = supabase
    .from("tc_etiquetas_lote")
    .select("*, empresa:tc_empresas(id, nombre), tc_etiquetas_foto(id, estado)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (empresaId) q = q.eq("empresa_id", empresaId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return ((data ?? []) as any[]).map((l) => {
    const fotos = (l.tc_etiquetas_foto ?? []) as { estado: EstadoFotoEtiqueta }[];
    return {
      ...l,
      fotos: fotos.length,
      por_revisar: fotos.filter((f) => PENDIENTES.includes(f.estado)).length,
      confirmadas: fotos.filter((f) => f.estado === "confirmada").length,
      impresas: fotos.filter((f) => f.estado === "impresa").length,
    } as LoteEtiquetas;
  });
}

export async function obtenerLoteEtiquetas(id: string): Promise<LoteEtiquetas | null> {
  const lotes = await listarLotesEtiquetas();
  return lotes.find((l) => l.id === id) ?? null;
}

export async function listarFotosLote(loteId: string): Promise<FotoEtiqueta[]> {
  const { data, error } = await supabase
    .from("tc_etiquetas_foto")
    .select("*")
    .eq("lote_id", loteId)
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as FotoEtiqueta[];
}

/**
 * Confirma el número de una foto. Es lo único que habilita imprimir.
 *
 * `serie_detectada` NO se toca: lo que leyó la máquina se conserva aunque la
 * persona lo corrija, porque es lo único que permite saber después si el
 * lector acierta.
 */
export async function confirmarSerie(fotoId: string, serie: string): Promise<void> {
  const limpia = serie.replace(/\s+/g, "").toUpperCase();
  if (!limpia) throw new Error("Sin número no se puede confirmar");
  const { error } = await supabase
    .from("tc_etiquetas_foto")
    .update({
      serie_confirmada: limpia,
      estado: "confirmada",
      revisado_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", fotoId);
  if (error) throw new Error(error.message);
}

/** Una foto que no sirve: borrosa, repetida o de una rueda que no era. */
export async function descartarFoto(fotoId: string): Promise<void> {
  const { error } = await supabase
    .from("tc_etiquetas_foto")
    .update({ estado: "descartada", revisado_at: new Date().toISOString(),
              updated_at: new Date().toISOString() })
    .eq("id", fotoId);
  if (error) throw new Error(error.message);
}

/** Vuelve a dejarla por revisar. Para deshacer un descarte o una confirmación. */
export async function reabrirFoto(fotoId: string): Promise<void> {
  const { error } = await supabase
    .from("tc_etiquetas_foto")
    .update({ estado: "revisar", updated_at: new Date().toISOString() })
    .eq("id", fotoId);
  if (error) throw new Error(error.message);
}

/**
 * Marca como impresas las etiquetas que se acaban de mandar a la impresora.
 *
 * Se llama DESPUÉS de imprimir, y solo sobre las que estaban confirmadas: una
 * etiqueta sin confirmar no se imprime, así que tampoco puede quedar marcada
 * como impresa.
 */
export async function marcarImpresas(fotoIds: string[]): Promise<void> {
  if (fotoIds.length === 0) return;
  const { error } = await supabase
    .from("tc_etiquetas_foto")
    .update({ estado: "impresa", impreso_at: new Date().toISOString(),
              updated_at: new Date().toISOString() })
    .in("id", fotoIds)
    .eq("estado", "confirmada");
  if (error) throw new Error(error.message);
}

export async function cerrarLoteEtiquetas(loteId: string): Promise<void> {
  const { error } = await supabase
    .from("tc_etiquetas_lote")
    .update({ estado: "cerrado", cerrado_at: new Date().toISOString() })
    .eq("id", loteId);
  if (error) throw new Error(error.message);
}
