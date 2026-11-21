/**
 * «✨ Completar fichas con IA»: rellenar los campos VACÍOS de referencias que
 * ya existen en el catálogo.
 *
 * La IA BUSCA y COPIA (con búsqueda web, en esquema estricto). Las reglas de
 * si lo copiado vale están en src/modules/tyrecontrol/services/completarFicha.ts
 * (puro, con pruebas). Lo encontrado se guarda como PROPUESTA en
 * tc_catalogo_propuestas_ia; la referencia solo cambia cuando una persona
 * acepta, y solo en campos vacíos salvo que pida corregir.
 */

import { supabase } from "../../supabase.ts";
import { hayIA, pedirIA } from "../../core/openaiService.ts";
import {
  CAMPOS, CAMPO_POR_CLAVE, coincideReferencia, medidaBase, tipoFuenteValido, urlValida, validarValor,
  type TipoFuente,
} from "../../../src/modules/tyrecontrol/services/completarFicha.ts";

const COLUMNAS = CAMPOS.map((c) => c.clave);
const SELECT_REF =
  `id, referencia_completa, activo, verificacion_notas, fuente_oficial_url, fuente_corroboracion_url, ${COLUMNAS.join(", ")}, ` +
  "modelo:tc_cat_modelos_neumatico(nombre, marca:tc_cat_marcas_neumatico(nombre)), tyre_size:tyre_sizes(medida)";

type FilaRef = Record<string, unknown> & {
  id: unknown; referencia_completa?: unknown; verificacion_notas?: unknown;
  fuente_oficial_url?: unknown; fuente_corroboracion_url?: unknown;
  modelo?: { nombre?: unknown; marca?: { nombre?: unknown } | null } | null;
  tyre_size?: { medida?: unknown } | null;
};
interface ValorIA { campo: string; valor: string | null; url: string | null; tipo_fuente: string | null }
interface RespuestaFicha {
  ficha_leida: { marca: string | null; modelo: string | null; medida: string | null; indice_carga: string | null };
  valores: ValorIA[];
}
interface PropuestaBD { id: string; referencia_id: string; campo: string; valor: string; url: string | null; tipo_fuente: string | null }
const ESQUEMA_IA = (): { nombre: string; schema: Record<string, unknown> } =>
  ESQUEMA as unknown as { nombre: string; schema: Record<string, unknown> };

const vacio = (v: unknown) => v === null || v === undefined || v === "";
const norm = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function aRef(r: FilaRef) {
  return {
    id: String(r.id),
    referenciaCompleta: String(r.referencia_completa ?? ""),
    marca: String(r.modelo?.marca?.nombre ?? ""),
    modelo: String(r.modelo?.nombre ?? ""),
    medida: String(r.tyre_size?.medida ?? ""),
    fila: r,
  };
}

export interface FilaHueco {
  id: string; referenciaCompleta: string; marca: string; modelo: string; medida: string;
  enFlota: number; rellenos: number; total: number; vacios: string[];
}

/** Las referencias activas con lo que les falta y cuántas gomas hay de ellas en la flota. */
export async function huecos(f: { marca?: string; campo?: string; soloFlota?: boolean }): Promise<{
  filas: FilaHueco[]; resumen: { referencias: number; sinProfundidad: number; sinEtiqueta: number; conHueco: number };
}> {
  const { data, error } = await supabase.from("tc_referencias_neumatico").select(SELECT_REF).eq("activo", true).limit(5000);
  if (error) throw new Error(error.message);

  // Gomas en flota por marca + modelo + medida.
  const flota = new Map<string, number>();
  for (let desde = 0; ; desde += 1000) {
    const { data: ns, error: e2 } = await supabase.from("tc_neumaticos")
      .select("marca, modelo, medida").eq("activo", true).range(desde, desde + 999);
    if (e2) throw new Error(e2.message);
    for (const n of ns ?? []) {
      const k = `${norm(n.marca)}|${norm(n.modelo)}|${medidaBase(n.medida)}`;
      flota.set(k, (flota.get(k) ?? 0) + 1);
    }
    if (!ns || ns.length < 1000) break;
  }

  const todas = ((data ?? []) as unknown as FilaRef[]).map((r) => {
    const ref = aRef(r);
    const vacios = COLUMNAS.filter((c) => vacio(r[c]));
    return {
      id: ref.id, referenciaCompleta: ref.referenciaCompleta, marca: ref.marca, modelo: ref.modelo, medida: ref.medida,
      enFlota: flota.get(`${norm(ref.marca)}|${norm(ref.modelo)}|${medidaBase(ref.medida)}`) ?? 0,
      rellenos: COLUMNAS.length - vacios.length, total: COLUMNAS.length, vacios,
    };
  });
  const resumen = {
    referencias: todas.length,
    sinProfundidad: todas.filter((t) => t.vacios.includes("profundidad_dibujo_mm")).length,
    sinEtiqueta: todas.filter((t) => t.vacios.includes("etiqueta_rr")).length,
    conHueco: todas.filter((t) => t.vacios.length > 0).length,
  };
  const marca = norm(f.marca);
  const filas = todas
    .filter((t) => t.vacios.length > 0)
    .filter((t) => !marca || norm(t.marca).includes(marca))
    .filter((t) => !f.campo || t.vacios.includes(f.campo))
    .filter((t) => !f.soloFlota || t.enFlota > 0)
    .sort((a, b) => b.enFlota - a.enFlota || b.vacios.length - a.vacios.length || a.referenciaCompleta.localeCompare(b.referenciaCompleta));
  return { filas: filas.slice(0, 500), resumen };
}

const ESQUEMA = {
  nombre: "ficha_referencia",
  schema: {
    type: "object", additionalProperties: false,
    required: ["ficha_leida", "valores"],
    properties: {
      ficha_leida: {
        type: "object", additionalProperties: false,
        required: ["marca", "modelo", "medida", "indice_carga"],
        properties: {
          marca: { type: ["string", "null"] }, modelo: { type: ["string", "null"] },
          medida: { type: ["string", "null"] }, indice_carga: { type: ["string", "null"] },
        },
      },
      valores: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          required: ["campo", "valor", "url", "tipo_fuente"],
          properties: {
            campo: { type: "string", enum: COLUMNAS },
            valor: { type: ["string", "null"] },
            url: { type: ["string", "null"] },
            tipo_fuente: { type: ["string", "null"], enum: ["oficial", "eprel", "distribuidor", null] },
          },
        },
      },
    },
  },
} as const;

function instrucciones(ref: ReturnType<typeof aRef>, campos: string[]): string {
  const lista = campos.map((c) => {
    const d = CAMPO_POR_CLAVE.get(c)!;
    return `- ${c}: ${d.etiqueta}${d.unidad ? ` (en ${d.unidad})` : ""}${d.letras ? ` (una de ${d.letras.join(", ")})` : ""}${d.tipo === "bool" ? " (true/false)" : ""}`;
  }).join("\n");
  return [
    "Eres el documentalista técnico de un taller de neumáticos de camión y autobús.",
    "",
    `Busca en Internet la ficha técnica de este neumático EXACTO: «${ref.referenciaCompleta}»`,
    `(marca ${ref.marca}, modelo ${ref.modelo}, medida ${ref.medida}).`,
    "",
    "Y copia SOLO estos datos, que en nuestro catálogo están vacíos:",
    lista,
    "",
    "Reglas, por este orden:",
    "1. USA LA BÚSQUEDA WEB. Nada de memoria: lo que no hayas leído en una página concreta, null.",
    "2. Fuentes, por preferencia: la ficha o el data book del fabricante (tipo_fuente «oficial»);",
    "   la base de etiquetado de la UE EPREL, eprel.ec.europa.eu, para etiqueta, ruido, M+S, 3PMSF",
    "   y EAN (tipo_fuente «eprel»); y solo si no hay otra, un distribuidor europeo serio",
    "   (tipo_fuente «distribuidor»).",
    "3. Cada valor lleva la URL exacta de la página donde lo has leído. Sin URL, null.",
    "4. La ficha tiene que ser de ESA marca, ESE modelo (misma generación: GEN-2 no es GEN-1),",
    "   ESA medida y ESE índice de carga. Copia en `ficha_leida` lo que dice la página.",
    "5. No conviertas, no redondees, no deduzcas por parecido con otra medida o modelo.",
    "   Si un dato viene en 32avos de pulgada, conviértelo a mm (×0,794) y dilo en la URL igual.",
    "6. Lo que no encuentres, valor null. Una lista llena de null es una respuesta buena.",
  ].join("\n");
}

/** Busca los huecos de UNA referencia y guarda las propuestas. Nunca lanza por la IA. */
export async function completarReferencia(referenciaId: string, usuarioId: string | null): Promise<{
  ok: boolean; aviso: string; propuestas: number; invalidas: number;
}> {
  if (!hayIA()) return { ok: false, aviso: "La IA está apagada: falta OPENAI_API_KEY en el servidor.", propuestas: 0, invalidas: 0 };
  const { data: d, error } = await supabase.from("tc_referencias_neumatico").select(SELECT_REF).eq("id", referenciaId).maybeSingle();
  if (error) throw new Error(error.message);
  const r = d as unknown as FilaRef | null;
  if (!r) return { ok: false, aviso: "La referencia no existe.", propuestas: 0, invalidas: 0 };
  const ref = aRef(r);
  const campos = COLUMNAS.filter((c) => vacio(r[c]));
  if (!campos.length) return { ok: true, aviso: "No le falta nada.", propuestas: 0, invalidas: 0 };

  const ia = await pedirIA<RespuestaFicha>({
    operacion: "tyrecontrol.catalogoIA.completar",
    proposito: "documento",
    prompt: instrucciones(ref, campos),
    esquema: ESQUEMA_IA(),
    herramientas: [{ type: "web_search" }],
    maxTokens: 4000,
    timeoutMs: 180_000,
  });
  if (!ia.ok) return { ok: false, aviso: `No se ha podido buscar: ${ia.error ?? "la IA no ha contestado"}.`, propuestas: 0, invalidas: 0 };
  if (ia.buscoEnWeb === false) {
    return { ok: false, aviso: "La IA ha contestado sin buscar en la web: no se propone nada.", propuestas: 0, invalidas: 0 };
  }
  const leida: Partial<RespuestaFicha["ficha_leida"]> = ia.datos?.ficha_leida ?? {};
  const coincide = coincideReferencia(ref, {
    marca: leida.marca, modelo: leida.modelo, medida: leida.medida, indiceCarga: leida.indice_carga,
  });

  // Las propuestas pendientes anteriores de esta referencia se sustituyen.
  await supabase.from("tc_catalogo_propuestas_ia").delete().eq("referencia_id", ref.id).eq("estado", "pendiente");

  const filas: Array<Record<string, unknown>> = [];
  for (const v of ia.datos?.valores ?? []) {
    if (!campos.includes(v.campo) || vacio(v.valor)) continue;
    const val = validarValor(v.campo, v.valor);
    let motivo = "";
    if (!coincide.ok) motivo = coincide.motivo;
    else if (!urlValida(v.url)) motivo = "Sin una URL que abrir";
    else if (!tipoFuenteValido(v.tipo_fuente)) motivo = "Sin tipo de fuente";
    else if (!val.ok) motivo = (val as { motivo: string }).motivo;
    filas.push({
      referencia_id: ref.id, campo: v.campo,
      valor: val.ok ? String(val.valor) : String(v.valor),
      url: v.url ?? null, tipo_fuente: tipoFuenteValido(v.tipo_fuente) ? v.tipo_fuente : null,
      estado: motivo ? "invalida" : "pendiente", motivo: motivo || null, creado_por: usuarioId,
    });
  }
  if (filas.length) {
    const { error: e3 } = await supabase.from("tc_catalogo_propuestas_ia").insert(filas);
    if (e3) throw new Error(e3.message);
  }
  const propuestas = filas.filter((f) => f.estado === "pendiente").length;
  return {
    ok: true,
    aviso: !coincide.ok ? `Descartado: ${coincide.motivo}.` : propuestas === 0 ? "No se ha encontrado ningún dato con fuente." : "",
    propuestas, invalidas: filas.length - propuestas,
  };
}

export async function propuestasDe(referenciaIds: string[]) {
  const { data, error } = await supabase.from("tc_catalogo_propuestas_ia")
    .select("id, referencia_id, campo, valor, url, tipo_fuente, estado, motivo, created_at")
    .in("referencia_id", referenciaIds).in("estado", ["pendiente", "invalida"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

const aColumna = (campo: string, valor: string): string | number | boolean => {
  const v = validarValor(campo, valor);
  if (!v.ok) throw new Error(`${campo}: ${(v as { motivo: string }).motivo}`);
  return v.valor;
};

/** Copia las propuestas aceptadas a la referencia. Solo en campos vacíos, salvo `corregir`. */
export async function aceptar(ids: string[], corregir: boolean): Promise<{ aceptadas: number; saltadas: number }> {
  const { data: ps, error } = await supabase.from("tc_catalogo_propuestas_ia")
    .select("id, referencia_id, campo, valor, url, tipo_fuente").in("id", ids).eq("estado", "pendiente");
  if (error) throw new Error(error.message);
  let aceptadas = 0, saltadas = 0;
  const porRef = new Map<string, PropuestaBD[]>();
  for (const p of (ps ?? []) as PropuestaBD[]) porRef.set(p.referencia_id, [...(porRef.get(p.referencia_id) ?? []), p]);

  for (const [refId, lista] of porRef) {
    const { data: d, error: e2 } = await supabase.from("tc_referencias_neumatico").select(SELECT_REF).eq("id", refId).maybeSingle();
    const r = d as unknown as FilaRef | null;
    if (e2 || !r) { saltadas += lista.length; continue; }
    const cambios: Record<string, unknown> = {};
    const notas: string[] = [];
    const hechas: string[] = [], saltar: string[] = [];
    let oficial: string | null = null, corrob: string | null = null;
    for (const p of lista) {
      if (!vacio(r[p.campo]) && !corregir) { saltar.push(p.id); continue; }
      cambios[p.campo] = aColumna(p.campo, p.valor);
      const t = p.tipo_fuente as TipoFuente;
      notas.push(`${CAMPO_POR_CLAVE.get(p.campo)?.etiqueta ?? p.campo} = ${p.valor} (IA, ${t}: ${p.url})`);
      if (t === "oficial") oficial ??= p.url; else corrob ??= p.url;
      hechas.push(p.id);
    }
    if (hechas.length) {
      if (oficial && vacio(r.fuente_oficial_url)) cambios.fuente_oficial_url = oficial;
      if (corrob && vacio(r.fuente_corroboracion_url)) cambios.fuente_corroboracion_url = corrob;
      cambios.verificacion_notas = [r.verificacion_notas, ...notas].filter((x) => !vacio(x)).join(" · ");
      cambios.updated_at = new Date().toISOString();
      const { error: e3 } = await supabase.from("tc_referencias_neumatico").update(cambios).eq("id", refId);
      if (e3) throw new Error(e3.message);
      await supabase.from("tc_catalogo_propuestas_ia").update({ estado: "aceptada", resuelta_at: new Date().toISOString() }).in("id", hechas);
      aceptadas += hechas.length;
    }
    if (saltar.length) {
      await supabase.from("tc_catalogo_propuestas_ia")
        .update({ estado: "descartada", motivo: "El campo ya tenía dato", resuelta_at: new Date().toISOString() }).in("id", saltar);
      saltadas += saltar.length;
    }
  }
  return { aceptadas, saltadas };
}

export async function descartar(ids: string[]): Promise<void> {
  const { error } = await supabase.from("tc_catalogo_propuestas_ia")
    .update({ estado: "descartada", motivo: "Descartada a mano", resuelta_at: new Date().toISOString() })
    .in("id", ids).eq("estado", "pendiente");
  if (error) throw new Error(error.message);
}
