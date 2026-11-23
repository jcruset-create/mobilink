/**
 * «🧹 Depurar catálogo»: lógica pura (sin red ni base de datos), con pruebas.
 *
 * Las gomas de flota guardan marca, modelo y medida como TEXTO. Una goma
 * «encaja» con una referencia del catálogo si ese texto es el de la referencia
 * (la misma regla que tc_referencia_de_neumatico en la base) o si hay una
 * EQUIVALENCIA guardada para ese texto. Aquí se agrupan las que no encajan y
 * se sugiere a qué referencia corresponden; nunca se toca la goma.
 */

/** Como lo guarda la base: upper(btrim(x)), '' si vacío. */
export const textoClave = (s: unknown) => String(s ?? "").trim().toUpperCase();

/** Igual que tc_medida_base: «315/80 R22.5» → «315/80R22.5»; «225/75R16CP» → «225/75R16». */
export function medidaClave(p: unknown): string {
  const t = String(p ?? "").replace(/\s+/g, "").toUpperCase();
  const m = t.match(/([0-9]{2,3})(?:\/([0-9]{2,3}))?R?([0-9]{1,2}(?:[.,][0-9])?)/);
  if (!m) return t;
  return `${m[1]}${m[2] ? `/${m[2]}` : ""}R${m[3].replace(",", ".")}`;
}

/** Para comparar nombres: sin espacios, guiones ni puntos, pero el «+» cuenta (HD3 ≠ HD3+). */
export const nombreClave = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9+]/g, "");
/** Para ver si se PARECEN: también sin «+». */
const parecidoClave = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** ¿Este trozo es un índice de carga/velocidad, lonas o XL? («154M», «156/150L», «121R120», «10P», «XL»). */
const esIndice = (t: string) =>
  /^\(?\d{2,3}(\/\d{2,3})?[A-Z]{1,2}(\d{2,3}[A-Z]?)?\)?$/.test(t) || /^(XL|TL|\d{1,2}PR?)$/.test(t);

/** El modelo sin los índices que lleva pegados detrás: «AH51 154M» → «AH51», «K135 101W XL» → «K135». */
export function quitarIndices(modelo: unknown): string {
  const trozos = String(modelo ?? "").trim().toUpperCase().split(/\s+/).filter(Boolean);
  const fuera = trozos.findIndex((t, i) => i > 0 && esIndice(t));
  return (fuera === -1 ? trozos : trozos.slice(0, fuera)).join(" ");
}

/**
 * El índice de carga de un texto: el ÚLTIMO número de 2-3 cifras quitando la
 * medida («Hankook K135 225/45R17 94W» → 94; «AH51 156/150L» → 156).
 */
export function indiceDe(texto: unknown): string | null {
  const t = String(texto ?? "").toUpperCase();
  const sinMedida = t.replace(/\d{2,3}(\/\d{2})?\s?R\s?\d{2}(\.\d)?/g, " ");
  const todos = [...sinMedida.matchAll(/(?:^|[^\d])(\d{2,3})(?:\/\d{2,3})?[A-Z]?(?!\d)/g)];
  return todos.length ? todos[todos.length - 1][1] : null;
}
/** El índice que lleva pegado el modelo de flota («AH51 154M» → 154; «AH51» → null). */
export const indiceDelModelo = (modelo: unknown): string | null => {
  const t = String(modelo ?? "").trim().toUpperCase();
  const resto = t.slice(quitarIndices(t).length);
  return resto.trim() ? indiceDe(resto) : null;
};

/** Distancia de edición (Levenshtein). */
function distancia(a: string, b: string): number {
  const f = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = f[0]; f[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = f[j];
      f[j] = Math.min(f[j] + 1, f[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return f[b.length];
}

/** Parecido de dos nombres de modelo, de 0 a 1. Si uno contiene al otro (≥3 letras) cuenta como 0,8; si las cifras no coinciden, solo vale contener. */
export function parecido(a: unknown, b: unknown): number {
  const x = parecidoClave(a), y = parecidoClave(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // Las cifras mandan: AH31 y AH51 se parecen en letras pero son modelos distintos.
  const cx = x.replace(/\D/g, ""), cy = y.replace(/\D/g, "");
  const sim = cx && cy && cx !== cy ? 0 : 1 - distancia(x, y) / Math.max(x.length, y.length);
  const contiene = Math.min(x.length, y.length) >= 3 && (x.includes(y) || y.includes(x));
  return Math.max(sim, contiene ? 0.8 : 0);
}

// ── Datos de entrada ─────────────────────────────────────────────────────
export interface MarcaCat { id: string; nombre: string; activo: boolean; alias: string[] }
export interface ModeloCat { id: string; marcaId: string; nombre: string; activo: boolean; alias: string[] }
export interface RefCat { id: string; modeloId: string; medida: string; referenciaCompleta: string; activo: boolean }
export interface MedidaCat { id: string; valor: string; activo: boolean }
export interface GomaFlota {
  id: string; marca: string | null; modelo: string | null; medida: string | null; indiceCarga: string | null;
  codigo?: string | null; matricula?: string | null; empresa?: string | null;
}
export interface Equivalencia { id: string; marca: string; modelo: string; medida: string; referenciaId: string; createdAt?: string }
export interface Distinto { tipo: "modelo" | "medida"; a: string; b: string }

export interface Catalogo {
  marcas: MarcaCat[]; modelos: ModeloCat[]; refs: RefCat[]; medidas: MedidaCat[];
  equivalencias: Equivalencia[]; distintos: Distinto[];
}

// ── Resultado ────────────────────────────────────────────────────────────
export type TipoSugerencia = "auto" | "parecido" | "sin_medida" | "sin_modelo" | "sin_marca";
export interface Opcion { referenciaId: string; texto: string; parecido: number }
export interface GrupoSinReferencia {
  clave: string; marca: string; modelo: string; medida: string; gomas: number;
  tipo: TipoSugerencia; motivo: string;
  /** La referencia sugerida (auto o parecido). */
  referenciaId: string | null;
  /** Referencias activas de la misma medida para elegir a mano: primero la marca, luego el parecido. */
  opciones: Opcion[];
  /** Para «Dar de alta con IA»: la marca del catálogo y la medida. */
  marcaCatalogo: string | null;
}
export interface Sobrante { marcas: { id: string; nombre: string }[]; modelos: { id: string; nombre: string; marca: string }[]; refsSinGomas: { id: string; texto: string }[] }
export interface Parecido { tipo: "modelo" | "medida"; a: { id: string; nombre: string; refs: number }; b: { id: string; nombre: string; refs: number }; marca?: string }
export interface Diagnostico {
  resumen: { gomas: number; encajan: number; porEquivalencia: number; automaticas: number; gomasAutomaticas: number; modelosQueFaltan: number; incompletas: number };
  sinReferencia: GrupoSinReferencia[];
  equivalencias: (Equivalencia & { texto: string; gomas: number })[];
  sobrante: Sobrante;
  parecidos: Parecido[];
  incompletas: GomaFlota[];
  desactivadas: { marcas: { id: string; nombre: string }[]; modelos: { id: string; nombre: string; marca: string }[] };
}

const claveGrupo = (marca: unknown, modelo: unknown, medida: unknown) =>
  `${textoClave(marca)}|${textoClave(modelo)}|${textoClave(medida)}`;

/** Diagnóstico completo del catálogo frente a la flota. */
export function diagnosticar(cat: Catalogo, gomas: GomaFlota[]): Diagnostico {
  const marcaPorId = new Map(cat.marcas.map((m) => [m.id, m]));
  const modeloPorId = new Map(cat.modelos.map((m) => [m.id, m]));
  const refPorId = new Map(cat.refs.map((r) => [r.id, r]));
  const textoRef = (r: RefCat) => {
    const mo = modeloPorId.get(r.modeloId);
    const ma = mo ? marcaPorId.get(mo.marcaId) : undefined;
    return r.referenciaCompleta || `${ma?.nombre ?? ""} ${mo?.nombre ?? ""} ${r.medida}`.trim();
  };

  // La regla exacta de la base: upper(trim) de marca y modelo, y la medida base.
  const exacta = new Map<string, string>(); // marca|modelo|medidaClave → ref (activa primero)
  for (const r of [...cat.refs].sort((a, b) => Number(a.activo) - Number(b.activo))) {
    const mo = modeloPorId.get(r.modeloId); const ma = mo ? marcaPorId.get(mo.marcaId) : undefined;
    if (!mo || !ma) continue;
    exacta.set(`${textoClave(ma.nombre)}|${textoClave(mo.nombre)}|${medidaClave(r.medida)}`, r.id);
  }
  const equiv = new Map(cat.equivalencias.map((e) => [claveGrupo(e.marca, e.modelo, e.medida), e]));

  // Marca del catálogo por nombre o alias (INSATRUCK → Insa).
  const marcaPorClave = new Map<string, MarcaCat>();
  for (const m of cat.marcas) {
    for (const n of [m.nombre, ...m.alias]) {
      const k = parecidoClave(n);
      if (k && (!marcaPorClave.has(k) || m.activo)) marcaPorClave.set(k, m);
    }
  }

  const refsActivas = cat.refs.filter((r) => r.activo);
  const refsPorMarcaMedida = new Map<string, RefCat[]>();
  const refsPorMedida = new Map<string, RefCat[]>();
  for (const r of refsActivas) {
    const mo = modeloPorId.get(r.modeloId); if (!mo) continue;
    const k = `${mo.marcaId}|${medidaClave(r.medida)}`;
    refsPorMarcaMedida.set(k, [...(refsPorMarcaMedida.get(k) ?? []), r]);
    const km = medidaClave(r.medida);
    refsPorMedida.set(km, [...(refsPorMedida.get(km) ?? []), r]);
  }

  // Agrupar la flota.
  const grupos = new Map<string, { marca: string; modelo: string; medida: string; gomas: number; indices: Map<string, number> }>();
  const incompletas: GomaFlota[] = [];
  let encajan = 0, porEquivalencia = 0;
  const gomasPorRef = new Map<string, number>();
  const gomasPorEquiv = new Map<string, number>();
  const marcasEnFlota = new Set<string>();
  const modelosEnFlota = new Set<string>(); // marcaId|nombreClave(modelo sin índices)

  for (const g of gomas) {
    const ma = marcaPorClave.get(parecidoClave(g.marca));
    if (ma) {
      marcasEnFlota.add(ma.id);
      modelosEnFlota.add(`${ma.id}|${parecidoClave(quitarIndices(g.modelo))}`);
    }
    if (!textoClave(g.marca) || !textoClave(g.modelo) || !textoClave(g.medida)) { incompletas.push(g); continue; }
    const k = claveGrupo(g.marca, g.modelo, g.medida);
    const e = equiv.get(k);
    if (e) {
      porEquivalencia++; encajan++;
      gomasPorRef.set(e.referenciaId, (gomasPorRef.get(e.referenciaId) ?? 0) + 1);
      gomasPorEquiv.set(e.id, (gomasPorEquiv.get(e.id) ?? 0) + 1);
      continue;
    }
    const r = exacta.get(`${textoClave(g.marca)}|${textoClave(g.modelo)}|${medidaClave(g.medida)}`);
    if (r) { encajan++; gomasPorRef.set(r, (gomasPorRef.get(r) ?? 0) + 1); continue; }
    const gr = grupos.get(k) ?? { marca: String(g.marca).trim(), modelo: String(g.modelo).trim(), medida: String(g.medida).trim(), gomas: 0, indices: new Map() };
    gr.gomas++;
    const ic = indiceDe(g.indiceCarga) ?? indiceDelModelo(g.modelo);
    if (ic) gr.indices.set(ic, (gr.indices.get(ic) ?? 0) + 1);
    grupos.set(k, gr);
  }

  const sinReferencia: GrupoSinReferencia[] = [];
  for (const [clave, g] of grupos) {
    const ma = marcaPorClave.get(parecidoClave(g.marca)) ?? null;
    const med = medidaClave(g.medida);
    const limpio = quitarIndices(g.modelo);
    const base: Omit<GrupoSinReferencia, "tipo" | "motivo" | "referenciaId"> = {
      clave, marca: g.marca, modelo: g.modelo, medida: g.medida, gomas: g.gomas, opciones: [], marcaCatalogo: ma?.nombre ?? null,
    };
    // Opciones para elegir a mano: las de la marca y medida, luego las demás de la medida.
    const deMarca = ma ? (refsPorMarcaMedida.get(`${ma.id}|${med}`) ?? []) : [];
    const puntua = (r: RefCat) => {
      const mo = modeloPorId.get(r.modeloId);
      return Math.max(parecido(limpio, mo?.nombre), ...(mo?.alias ?? []).map((a) => parecido(limpio, a)));
    };
    const opciones = (rs: RefCat[]) => rs.map((r) => ({ referenciaId: r.id, texto: textoRef(r), parecido: puntua(r) }))
      .sort((a, b) => b.parecido - a.parecido || a.texto.localeCompare(b.texto));
    const otras = (refsPorMedida.get(med) ?? []).filter((r) => !deMarca.includes(r));
    base.opciones = [...opciones(deMarca), ...opciones(otras)].slice(0, 60);

    if (!ma) {
      sinReferencia.push({ ...base, tipo: "sin_marca", motivo: `La marca «${g.marca}» no está en el catálogo`, referenciaId: null });
      continue;
    }
    // ¿El modelo, sin índices, es uno del catálogo (o un alias)?
    const kModelo = nombreClave(limpio);
    const modelos = cat.modelos.filter((m) => m.marcaId === ma.id && m.activo &&
      [m.nombre, ...m.alias].some((n) => nombreClave(n) === kModelo));
    const mismos = deMarca.filter((r) => modelos.some((m) => m.id === r.modeloId));
    if (mismos.length) {
      // El índice que más se repite en flota decide entre referencias, y si
      // contradice al del catálogo no es automática (AH51 156 ≠ AH51 154).
      const ic = [...g.indices.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const conIndice = ic ? mismos.filter((r) => indiceDe(r.referenciaCompleta) === ic) : [];
      let elegida: RefCat | undefined = conIndice.length === 1 ? conIndice[0] : undefined;
      if (!elegida && mismos.length === 1) {
        const icRef = indiceDe(mismos[0].referenciaCompleta);
        if (ic && icRef && ic !== icRef) {
          sinReferencia.push({ ...base, tipo: "parecido", referenciaId: mismos[0].id,
            motivo: `Mismo modelo, pero en flota pone índice ${ic} y el catálogo ${icRef}: compruébalo` });
          continue;
        }
        elegida = mismos[0];
      }
      if (elegida) {
        sinReferencia.push({ ...base, tipo: "auto", referenciaId: elegida.id,
          motivo: nombreClave(g.modelo) === kModelo ? "Mismo modelo escrito de otra forma" : "Mismo modelo con el índice pegado al nombre" });
      } else {
        sinReferencia.push({ ...base, tipo: "parecido", referenciaId: mismos[0].id, motivo: "Mismo modelo, varias referencias en esta medida: elige la buena" });
      }
      continue;
    }
    if (modelos.length) {
      sinReferencia.push({ ...base, tipo: "sin_medida", referenciaId: null, motivo: `${modelos[0].nombre} está en el catálogo, pero no en ${g.medida}` });
      continue;
    }
    const mejor = base.opciones.find((o) => deMarca.some((r) => r.id === o.referenciaId) && o.parecido >= 0.6);
    if (mejor) {
      sinReferencia.push({ ...base, tipo: "parecido", referenciaId: mejor.referenciaId, motivo: "Nombre parecido: compruébalo" });
      continue;
    }
    sinReferencia.push({ ...base, tipo: "sin_modelo", referenciaId: null, motivo: `El modelo no está en el catálogo de ${ma.nombre}` });
  }
  const ORDEN: Record<TipoSugerencia, number> = { auto: 0, parecido: 1, sin_medida: 2, sin_modelo: 3, sin_marca: 4 };
  sinReferencia.sort((a, b) => ORDEN[a.tipo] - ORDEN[b.tipo] || b.gomas - a.gomas);

  // Lo que sobra: vacío en el catálogo Y sin gomas en flota.
  const modelosActivosPorMarca = new Map<string, number>();
  for (const m of cat.modelos) if (m.activo) modelosActivosPorMarca.set(m.marcaId, (modelosActivosPorMarca.get(m.marcaId) ?? 0) + 1);
  const refsActivasPorModelo = new Map<string, number>();
  const refsPorModelo = new Map<string, number>();
  for (const r of cat.refs) {
    refsPorModelo.set(r.modeloId, (refsPorModelo.get(r.modeloId) ?? 0) + 1);
    if (r.activo) refsActivasPorModelo.set(r.modeloId, (refsActivasPorModelo.get(r.modeloId) ?? 0) + 1);
  }
  const porNombre = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre);
  const sobrante: Sobrante = {
    marcas: cat.marcas.filter((m) => m.activo && !modelosActivosPorMarca.get(m.id) && !marcasEnFlota.has(m.id))
      .map((m) => ({ id: m.id, nombre: m.nombre })).sort(porNombre),
    modelos: cat.modelos.filter((m) => m.activo && !refsActivasPorModelo.get(m.id) &&
      ![m.nombre, ...m.alias].some((n) => modelosEnFlota.has(`${m.marcaId}|${parecidoClave(n)}`)))
      .map((m) => ({ id: m.id, nombre: m.nombre, marca: marcaPorId.get(m.marcaId)?.nombre ?? "" }))
      .sort((a, b) => a.marca.localeCompare(b.marca) || a.nombre.localeCompare(b.nombre)),
    refsSinGomas: refsActivas.filter((r) => !gomasPorRef.get(r.id))
      .map((r) => ({ id: r.id, texto: textoRef(r) })).sort((a, b) => a.texto.localeCompare(b.texto)),
  };

  // Parecidos: mismo nombre salvo espacios, guiones y «+»; las medidas, misma medida base.
  const yaDistintos = new Set(cat.distintos.map((d) => `${d.tipo}|${d.a}|${d.b}`));
  const par = (tipo: "modelo" | "medida", x: string, y: string) => (x < y ? `${tipo}|${x}|${y}` : `${tipo}|${y}|${x}`);
  const parecidos: Parecido[] = [];
  const modelosAct = cat.modelos.filter((m) => m.activo);
  for (let i = 0; i < modelosAct.length; i++) {
    for (let j = i + 1; j < modelosAct.length; j++) {
      const a = modelosAct[i], b = modelosAct[j];
      if (a.marcaId !== b.marcaId || parecidoClave(a.nombre) !== parecidoClave(b.nombre)) continue;
      if (yaDistintos.has(par("modelo", a.id, b.id))) continue;
      parecidos.push({ tipo: "modelo", marca: marcaPorId.get(a.marcaId)?.nombre,
        a: { id: a.id, nombre: a.nombre, refs: refsPorModelo.get(a.id) ?? 0 }, b: { id: b.id, nombre: b.nombre, refs: refsPorModelo.get(b.id) ?? 0 } });
    }
  }
  const medidasAct = cat.medidas.filter((m) => m.activo);
  for (let i = 0; i < medidasAct.length; i++) {
    for (let j = i + 1; j < medidasAct.length; j++) {
      const a = medidasAct[i], b = medidasAct[j];
      if (medidaClave(a.valor) !== medidaClave(b.valor) || yaDistintos.has(par("medida", a.id, b.id))) continue;
      parecidos.push({ tipo: "medida", a: { id: a.id, nombre: a.valor, refs: 0 }, b: { id: b.id, nombre: b.valor, refs: 0 } });
    }
  }

  const automaticas = sinReferencia.filter((s) => s.tipo === "auto");
  return {
    resumen: {
      gomas: gomas.length, encajan, porEquivalencia,
      automaticas: automaticas.length, gomasAutomaticas: automaticas.reduce((s, x) => s + x.gomas, 0),
      modelosQueFaltan: sinReferencia.filter((s) => s.tipo === "sin_modelo").length,
      incompletas: incompletas.length,
    },
    sinReferencia,
    equivalencias: cat.equivalencias.map((e) => {
      const r = refPorId.get(e.referenciaId);
      return { ...e, texto: r ? textoRef(r) : "(referencia borrada)", gomas: gomasPorEquiv.get(e.id) ?? 0 };
    }).sort((a, b) => b.gomas - a.gomas),
    sobrante,
    parecidos,
    incompletas,
    desactivadas: {
      marcas: cat.marcas.filter((m) => !m.activo).map((m) => ({ id: m.id, nombre: m.nombre })).sort(porNombre),
      modelos: cat.modelos.filter((m) => !m.activo)
        .map((m) => ({ id: m.id, nombre: m.nombre, marca: marcaPorId.get(m.marcaId)?.nombre ?? "" })).sort(porNombre),
    },
  };
}
