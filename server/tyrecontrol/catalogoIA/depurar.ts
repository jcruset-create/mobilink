/**
 * «🧹 Depurar catálogo»: cargar catálogo + flota, diagnosticar (lógica pura en
 * src/modules/tyrecontrol/services/depurarCatalogo.ts) y guardar lo que se
 * decide: equivalencias, desactivar/reactivar marcas y modelos vacíos, y
 * «son distintos». Nunca escribe en tc_neumaticos ni borra nada del catálogo.
 */

import { supabase } from "../../supabase.ts";
import {
  diagnosticar, medidaClave, textoClave,
  type Catalogo, type Diagnostico, type GomaFlota,
} from "../../../src/modules/tyrecontrol/services/depurarCatalogo.ts";

type Fila = Record<string, unknown>;

/** Todas las filas, de mil en mil (ordenadas por id para no saltarse ninguna). */
async function todo<T = Fila>(tabla: string, select: string, soloActivas = false, orden = "id"): Promise<T[]> {
  const out: T[] = [];
  for (let desde = 0; ; desde += 1000) {
    const base = supabase.from(tabla).select(select);
    const { data, error } = await (soloActivas ? base.eq("activo", true) : base).order(orden).range(desde, desde + 999);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function cargarCatalogo(): Promise<Catalogo> {
  const [marcas, aliasMarcas, modelos, aliasModelos, refs, medidas, equivalencias, distintos] = await Promise.all([
    todo("tc_cat_marcas_neumatico", "id, nombre, activo"),
    todo("tc_cat_marcas_alias", "alias, marca_id", false, "alias"),
    todo("tc_cat_modelos_neumatico", "id, marca_id, nombre, activo"),
    todo("tc_cat_modelos_alias", "alias, modelo_id"),
    todo("tc_referencias_neumatico", "id, modelo_id, referencia_completa, activo, tyre_size:tyre_sizes(medida)"),
    todo("tc_cat_medidas_neumatico", "id, valor, activo"),
    todo("tc_cat_equivalencias_flota", "id, marca_texto, modelo_texto, medida_texto, referencia_id, created_at"),
    todo("tc_cat_parecidos_distintos", "tipo, a, b", false, "a"),
  ]);
  const aliasDe = (filas: Fila[], campo: string, id: unknown) =>
    filas.filter((a) => a[campo] === id).map((a) => String(a.alias));
  return {
    marcas: marcas.map((m) => ({ id: String(m.id), nombre: String(m.nombre ?? ""), activo: m.activo !== false, alias: aliasDe(aliasMarcas, "marca_id", m.id) })),
    modelos: modelos.map((m) => ({ id: String(m.id), marcaId: String(m.marca_id), nombre: String(m.nombre ?? ""), activo: m.activo !== false, alias: aliasDe(aliasModelos, "modelo_id", m.id) })),
    refs: refs.map((r) => ({
      id: String(r.id), modeloId: String(r.modelo_id), activo: r.activo !== false,
      medida: String((r.tyre_size as { medida?: unknown } | null)?.medida ?? ""), referenciaCompleta: String(r.referencia_completa ?? ""),
    })),
    medidas: medidas.map((m) => ({ id: String(m.id), valor: String(m.valor ?? ""), activo: m.activo !== false })),
    equivalencias: equivalencias.map((e) => ({
      id: String(e.id), marca: String(e.marca_texto), modelo: String(e.modelo_texto), medida: String(e.medida_texto),
      referenciaId: String(e.referencia_id), createdAt: String(e.created_at ?? ""),
    })),
    distintos: distintos.map((d) => ({ tipo: d.tipo as "modelo" | "medida", a: String(d.a), b: String(d.b) })),
  };
}

async function cargarFlota(): Promise<GomaFlota[]> {
  const filas = await todo("tc_neumaticos",
    "id, marca, modelo, medida, indice_carga, codigo_interno, numero_serie, vehiculo:tc_vehiculos!tc_neumaticos_vehiculo_id_fkey(matricula), empresa:tc_empresas!tc_neumaticos_empresa_id_fkey(nombre)",
    true);
  return filas.map((n) => ({
    id: String(n.id),
    marca: (n.marca as string | null) ?? null, modelo: (n.modelo as string | null) ?? null, medida: (n.medida as string | null) ?? null,
    indiceCarga: (n.indice_carga as string | null) ?? null,
    codigo: (n.codigo_interno as string | null) ?? (n.numero_serie as string | null) ?? null,
    matricula: ((n.vehiculo as { matricula?: string } | null)?.matricula) ?? null,
    empresa: ((n.empresa as { nombre?: string } | null)?.nombre) ?? null,
  }));
}

export async function diagnostico(): Promise<Diagnostico> {
  const [cat, gomas] = await Promise.all([cargarCatalogo(), cargarFlota()]);
  return diagnosticar(cat, gomas);
}

export interface NuevaEquivalencia { marca: string; modelo: string; medida: string; referenciaId: string }

/** Guarda (o cambia) equivalencias «así escrito en flota → referencia». */
export async function guardarEquivalencias(items: NuevaEquivalencia[], usuarioId: string | null): Promise<{ guardadas: number }> {
  const limpios = items
    .map((i) => ({ marca_texto: textoClave(i.marca), modelo_texto: textoClave(i.modelo), medida_texto: textoClave(i.medida), referencia_id: String(i.referenciaId) }))
    .filter((i) => i.marca_texto && i.modelo_texto && i.medida_texto && /^[0-9a-f-]{36}$/i.test(i.referencia_id));
  if (!limpios.length) return { guardadas: 0 };

  // La referencia tiene que existir, estar activa y ser de la MISMA medida base.
  const { data: refs, error } = await supabase.from("tc_referencias_neumatico")
    .select("id, activo, tyre_size:tyre_sizes(medida)").in("id", [...new Set(limpios.map((i) => i.referencia_id))]);
  if (error) throw new Error(error.message);
  const medidaDe = new Map(((refs ?? []) as Fila[]).filter((r) => r.activo !== false)
    .map((r) => [String(r.id), medidaClave((r.tyre_size as { medida?: unknown } | null)?.medida)]));
  const validos = limpios.filter((i) => medidaDe.get(i.referencia_id) === medidaClave(i.medida_texto));
  if (validos.length !== limpios.length) {
    throw new Error("Alguna referencia no existe, está desactivada o es de otra medida");
  }
  const { error: e2 } = await supabase.from("tc_cat_equivalencias_flota")
    .upsert(validos.map((v) => ({ ...v, creado_por: usuarioId })), { onConflict: "marca_texto,modelo_texto,medida_texto" });
  if (e2) throw new Error(e2.message);
  return { guardadas: validos.length };
}

export async function quitarEquivalencias(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from("tc_cat_equivalencias_flota").delete().in("id", ids);
  if (error) throw new Error(error.message);
}

/**
 * Desactivar (o reactivar) marcas y modelos. Desactivar solo lo que sigue
 * vacío: una marca sin modelos activos, un modelo sin referencias activas.
 */
export async function cambiarActivo(f: { marcas: string[]; modelos: string[]; activo: boolean }): Promise<{ marcas: number; modelos: number; saltadas: number }> {
  let marcas = f.marcas, modelos = f.modelos, saltadas = 0;
  if (!f.activo) {
    if (modelos.length) {
      const { data, error } = await supabase.from("tc_referencias_neumatico").select("modelo_id").in("modelo_id", modelos).eq("activo", true);
      if (error) throw new Error(error.message);
      const conRefs = new Set((data ?? []).map((r: { modelo_id: string }) => r.modelo_id));
      saltadas += modelos.filter((m) => conRefs.has(m)).length;
      modelos = modelos.filter((m) => !conRefs.has(m));
    }
    if (marcas.length) {
      const { data, error } = await supabase.from("tc_cat_modelos_neumatico").select("marca_id, id").in("marca_id", marcas).eq("activo", true);
      if (error) throw new Error(error.message);
      // Los modelos que se desactivan ahora mismo ya no cuentan.
      const conModelos = new Set((data ?? []).filter((m: { id: string }) => !modelos.includes(m.id)).map((m: { marca_id: string }) => m.marca_id));
      saltadas += marcas.filter((m) => conModelos.has(m)).length;
      marcas = marcas.filter((m) => !conModelos.has(m));
    }
  }
  if (modelos.length) {
    const { error } = await supabase.from("tc_cat_modelos_neumatico").update({ activo: f.activo }).in("id", modelos);
    if (error) throw new Error(error.message);
  }
  if (marcas.length) {
    const { error } = await supabase.from("tc_cat_marcas_neumatico").update({ activo: f.activo }).in("id", marcas);
    if (error) throw new Error(error.message);
  }
  return { marcas: marcas.length, modelos: modelos.length, saltadas };
}

export async function sonDistintos(tipo: "modelo" | "medida", x: string, y: string, usuarioId: string | null): Promise<void> {
  const [a, b] = x < y ? [x, y] : [y, x];
  const { error } = await supabase.from("tc_cat_parecidos_distintos")
    .upsert({ tipo, a, b, creado_por: usuarioId }, { onConflict: "tipo,a,b", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}
