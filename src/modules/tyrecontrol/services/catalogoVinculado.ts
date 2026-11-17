/**
 * El catálogo de neumáticos visto con sus vínculos.
 *
 * Las tablas son cinco: medidas, índices de carga, códigos de velocidad,
 * combinaciones (`tyre_sizes`: medida + índice sencillo/gemelo + velocidad) y
 * referencias (`tc_referencias_neumatico`: un modelo en una combinación). Las
 * combinaciones y su vínculo con el modelo se crean al dar de alta un
 * neumático. Aquí se cruzan para contestar, en Configuración:
 *
 *   · de una medida, qué combinaciones tiene y qué modelos hay en cada una;
 *   · de un índice de carga, en qué medidas se usa y si de sencillo o gemelo;
 *   · de un código de velocidad, qué medidas y modelos lo llevan;
 *   · de un modelo, en qué combinaciones existe, y de ahí sus medidas y sus
 *     velocidades.
 *
 * Es código puro: recibe las filas ya leídas.
 */

export interface MedidaCat { id: string; valor: string; categoria?: string | null }
export interface IndiceCargaCat { id: string; valor: string; kg?: number | null }
export interface VelocidadCat { id: string; valor: string; km_h?: number | null }
export interface CombinacionCat {
  id: string;
  medida_id?: string | null;
  medida: string;
  indice_carga_simple: string;
  indice_carga_doble?: string | null;
  codigo_velocidad?: string | null;
}
export interface ReferenciaCat {
  id: string;
  modelo_id: string;
  tyre_size_id: string;
  modelo?: { id: string; nombre: string; marca?: { nombre: string } | null } | null;
}

export interface ComboVista {
  id: string;
  medida: string;
  ic: string; // «104/102» o «158»
  simple: string;
  doble: string | null;
  cv: string;
  modelos: string[]; // «Hankook RA58»
}

/** «195/70 r15» → «195/70R15». La misma cuenta que tc_medida_normalizada, para comparar. */
export function claveMedida(m: string | null | undefined): string {
  return (m ?? "").toUpperCase().replace(/\s+/g, "").replace(/,/g, ".");
}

const nombreModelo = (r: ReferenciaCat) =>
  [r.modelo?.marca?.nombre, r.modelo?.nombre].filter(Boolean).join(" ");

const porTexto = (a: string, b: string) => a.localeCompare(b, "es", { numeric: true });

export function combosVista(combos: CombinacionCat[], refs: ReferenciaCat[]): ComboVista[] {
  const modelosDe = new Map<string, Set<string>>();
  for (const r of refs) {
    const n = nombreModelo(r);
    if (!n) continue;
    const s = modelosDe.get(r.tyre_size_id) ?? new Set<string>();
    s.add(n);
    modelosDe.set(r.tyre_size_id, s);
  }
  return combos.map((c) => {
    const simple = (c.indice_carga_simple ?? "").trim();
    const doble = (c.indice_carga_doble ?? "").trim() || null;
    return {
      id: c.id,
      // Escrita siempre igual: «195/70 r15» y «195/70R15» son la misma.
      medida: claveMedida(c.medida),
      ic: doble ? `${simple}/${doble}` : simple,
      simple,
      doble,
      cv: (c.codigo_velocidad ?? "").trim().toUpperCase(),
      modelos: [...(modelosDe.get(c.id) ?? [])].sort(porTexto),
    };
  });
}

export interface MedidaVista { medida: MedidaCat; combos: ComboVista[] }

/** Cada medida con sus combinaciones, también las que aún no tienen ninguna. */
export function porMedida(medidas: MedidaCat[], combos: ComboVista[], combosCrudos: CombinacionCat[]): MedidaVista[] {
  const idMedida = new Map(combosCrudos.map((c) => [c.id, c.medida_id ?? null]));
  const clave = new Map(medidas.map((m) => [claveMedida(m.valor), m.id]));
  const de = new Map<string, ComboVista[]>();
  for (const c of combos) {
    const id = idMedida.get(c.id) ?? clave.get(claveMedida(c.medida));
    if (!id) continue;
    const l = de.get(id) ?? [];
    l.push(c);
    de.set(id, l);
  }
  return medidas
    .filter((m) => m.valor && m.valor !== "0")
    .map((m) => ({
      medida: m,
      combos: (de.get(m.id) ?? []).sort((a, b) => porTexto(a.ic + a.cv, b.ic + b.cv)),
    }))
    .sort((a, b) => porTexto(a.medida.valor, b.medida.valor));
}

export interface IndiceVista {
  indice: IndiceCargaCat;
  medidas: string[];
  como: "sencillo" | "gemelo" | "ambos" | null;
}

export function porIndice(indices: IndiceCargaCat[], combos: ComboVista[]): IndiceVista[] {
  return indices
    .map((i) => {
      const v = i.valor.trim();
      const sencillo = combos.filter((c) => c.simple === v);
      const gemelo = combos.filter((c) => c.doble === v);
      const medidas = [...new Set([...sencillo, ...gemelo].map((c) => c.medida))].sort(porTexto);
      const como: IndiceVista["como"] = sencillo.length && gemelo.length ? "ambos"
        : sencillo.length ? "sencillo" : gemelo.length ? "gemelo" : null;
      return { indice: i, medidas, como };
    })
    .sort((a, b) => Number(a.indice.valor) - Number(b.indice.valor) || porTexto(a.indice.valor, b.indice.valor));
}

export interface VelocidadVista { velocidad: VelocidadCat; medidas: string[]; modelos: string[] }

export function porVelocidad(velocidades: VelocidadCat[], combos: ComboVista[]): VelocidadVista[] {
  return velocidades
    .map((v) => {
      const suyos = combos.filter((c) => c.cv === v.valor.trim().toUpperCase());
      return {
        velocidad: v,
        medidas: [...new Set(suyos.map((c) => c.medida))].sort(porTexto),
        modelos: [...new Set(suyos.flatMap((c) => c.modelos))].sort(porTexto),
      };
    })
    // Por velocidad, no por letra: la H (210) va después de la T (190).
    .sort((a, b) => (a.velocidad.km_h ?? 9999) - (b.velocidad.km_h ?? 9999) || porTexto(a.velocidad.valor, b.velocidad.valor));
}

export interface ModeloVista { combos: ComboVista[]; medidas: string[]; velocidades: string[] }

/** Lo que tiene un modelo: sus combinaciones, y de ahí medidas y velocidades. */
export function delModelo(modeloId: string, combos: ComboVista[], refs: ReferenciaCat[]): ModeloVista {
  const ids = new Set(refs.filter((r) => r.modelo_id === modeloId).map((r) => r.tyre_size_id));
  const suyos = combos.filter((c) => ids.has(c.id)).sort((a, b) => porTexto(a.medida + a.ic, b.medida + b.ic));
  return {
    combos: suyos,
    medidas: [...new Set(suyos.map((c) => c.medida))].sort(porTexto),
    velocidades: [...new Set(suyos.map((c) => c.cv).filter(Boolean))].sort(porTexto),
  };
}

/** «104/102» → { simple: "104", doble: "102" }; «158» → { simple: "158", doble: "" }. */
export function partirIndice(ic: string | null | undefined): { simple: string; doble: string } {
  const [s, d] = (ic ?? "").split("/").map((x) => x.trim());
  return { simple: s ?? "", doble: d ?? "" };
}

/** Al revés: lo que se guarda en el neumático. */
export function juntarIndice(simple: string, doble: string): string {
  const s = simple.trim();
  const d = doble.trim();
  return s && d ? `${s}/${d}` : s;
}
