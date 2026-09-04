/**
 * Lo que se lee del flanco de un neumático, y qué se puede hacer con ello.
 *
 * Este módulo NO habla con la IA ni con la base de datos: recibe lo que el
 * modelo dice haber leído y decide qué es utilizable. Está separado a
 * propósito, porque es donde están las decisiones que hay que poder probar sin
 * levantar nada: qué se descarta por poco fiable, cómo se normaliza una medida
 * escrita de catorce maneras distintas, y qué se considera una coincidencia.
 */

/** Un dato leído, con lo seguro que está el modelo de haberlo leído bien. */
export interface CampoFlanco {
  valor: string | null;
  /** 0..1. null cuando el modelo no la da. */
  confianza: number | null;
}

/** Lo que la IA dice haber visto. Todo puede venir vacío. */
export interface LecturaFlanco {
  marca: CampoFlanco;
  modelo: CampoFlanco;
  medida: CampoFlanco;
  indice_carga_simple: CampoFlanco;
  indice_carga_doble: CampoFlanco;
  codigo_velocidad: CampoFlanco;
  dot: CampoFlanco;
  numero_serie: CampoFlanco;
  /** Otros textos del flanco, tal cual. Para que el técnico los vea. */
  otros_textos: string[];
  /** Motivo por el que no se ha podido leer, si aplica. */
  aviso?: string | null;
}

/**
 * Por debajo de esto el dato se enseña VACÍO y pendiente de escribir a mano.
 *
 * No es un número mágico: un flanco sucio o a contraluz produce lecturas
 * plausibles y falsas —un 156 que es un 158, una R que es una P—, y un dato
 * equivocado con aspecto de bueno es peor que un hueco, porque el técnico lo
 * confirma sin mirar. Ante la duda, que lo teclee.
 */
export const CONFIANZA_MINIMA = 0.7;

/** El valor si es fiable; null si no lo es o no viene. */
export function valorFiable(c: CampoFlanco | undefined | null, minima = CONFIANZA_MINIMA): string | null {
  if (!c) return null;
  const v = (c.valor ?? "").trim();
  if (!v) return null;
  // Sin confianza declarada se acepta: el modelo no siempre la da, y
  // descartar por eso tiraría lecturas buenas.
  if (c.confianza != null && c.confianza < minima) return null;
  return v;
}

/**
 * Normaliza una medida a la forma canónica del catálogo: sin espacios y en
 * mayúsculas. "315/80 R 22.5" y "315/80r22.5" son la misma.
 */
export function normalizarMedida(t: string | null | undefined): string {
  return (t ?? "").toUpperCase().replace(/\s+/g, "");
}

/** Igual para marcas y modelos, donde además el guion es decorativo. */
export function normalizarNombre(t: string | null | undefined): string {
  return (t ?? "").toUpperCase().replace(/[\s-]+/g, "");
}

/**
 * El DOT son cuatro dígitos (semana + año). El flanco suele llevar delante el
 * código de fábrica, así que se coge el último grupo de cuatro.
 */
export function normalizarDot(t: string | null | undefined): string | null {
  const limpio = (t ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  const grupos = limpio.match(/\d{4}/g);
  if (!grupos) return null;
  const dot = grupos[grupos.length - 1];
  const semana = Number(dot.slice(0, 2));
  // Una semana 00 o 63 no es un DOT: es otro número del flanco que tiene
  // cuatro cifras. Mejor no dar ninguno que dar uno inventado.
  if (semana < 1 || semana > 53) return null;
  return dot;
}

/** Lo que se le propone al técnico: solo lo que se puede sostener. */
export interface PropuestaFlanco {
  marca: string | null;
  modelo: string | null;
  medida: string | null;
  indice_carga_simple: string | null;
  indice_carga_doble: string | null;
  codigo_velocidad: string | null;
  dot: string | null;
  /**
   * El número de serie estampado en el flanco, cuando lo lleva.
   *
   * Es lo que identifica ESA rueda y no otra igual, y es lo que pide la
   * columna «Nº Serie / DOT» del parte. No todas lo llevan legible, así que
   * puede venir vacío: eso es un dato, no un fallo.
   */
  numero_serie: string | null;
  otros_textos: string[];
  /** Campos que se leyeron pero no con bastante seguridad. */
  dudosos: string[];
  /** true si hay lo mínimo para buscar en el catálogo. */
  suficienteParaBuscar: boolean;
  aviso: string | null;
}

const CAMPOS = [
  "marca", "modelo", "medida", "indice_carga_simple", "indice_carga_doble",
  "codigo_velocidad", "dot", "numero_serie",
] as const;

/**
 * Convierte lo leído en lo que se le enseña al técnico.
 *
 * Nunca rellena un hueco: lo que no se lee con seguridad se deja vacío y se
 * dice que estaba dudoso, para que se sepa que ahí había algo y no que el
 * flanco no lo llevaba.
 */
export function prepararPropuesta(l: LecturaFlanco | null | undefined): PropuestaFlanco {
  const vacia: PropuestaFlanco = {
    marca: null, modelo: null, medida: null, indice_carga_simple: null,
    indice_carga_doble: null, codigo_velocidad: null, dot: null, numero_serie: null,
    otros_textos: [], dudosos: [], suficienteParaBuscar: false,
    aviso: "No se ha podido leer el flanco",
  };
  if (!l) return vacia;

  const dudosos: string[] = [];
  for (const campo of CAMPOS) {
    const c = l[campo];
    if (c && (c.valor ?? "").trim() && valorFiable(c) === null) dudosos.push(campo);
  }

  const medida = valorFiable(l.medida);
  const marca = valorFiable(l.marca);

  return {
    marca,
    modelo: valorFiable(l.modelo),
    medida: medida ? normalizarMedida(medida) : null,
    indice_carga_simple: valorFiable(l.indice_carga_simple)?.toUpperCase() ?? null,
    indice_carga_doble: valorFiable(l.indice_carga_doble)?.toUpperCase() ?? null,
    codigo_velocidad: valorFiable(l.codigo_velocidad)?.toUpperCase() ?? null,
    dot: normalizarDot(valorFiable(l.dot)),
    // El serie NO se normaliza: cada fabricante lo estampa a su manera y
    // recortarlo o pasarlo a un formato "bonito" sería inventárselo.
    numero_serie: valorFiable(l.numero_serie)?.trim() || null,
    otros_textos: Array.isArray(l.otros_textos) ? l.otros_textos.filter((t) => !!t?.trim()) : [],
    dudosos,
    // Con marca y medida ya se puede buscar; el modelo afina pero no hace
    // falta para enseñar candidatos.
    suficienteParaBuscar: !!(marca && medida),
    aviso: l.aviso ?? null,
  };
}

/** Una referencia del catálogo, reducida a lo que hace falta para casar. */
export interface ReferenciaCatalogo {
  id: string;
  marca: string;
  modelo: string;
  medida: string;
  referencia_completa: string;
}

export interface Coincidencia {
  referencia: ReferenciaCatalogo;
  /** 'exacta' = marca, modelo y medida; 'medida' = misma marca y medida. */
  tipo: "exacta" | "medida";
}

/**
 * Busca en el catálogo lo que se ha leído.
 *
 * Devuelve primero la exacta y después las de la misma marca y medida con
 * otro modelo, que es justo el caso que el encargo quiere enseñar antes de
 * dejar crear nada: "X Multi D" y "X Multi Z" en 315/80R22.5 son dos
 * referencias distintas y confundirlas es fácil.
 *
 * No hay coincidencia "parecida" por distancia de edición a propósito:
 * adivinar por parecido fusiona marcas que de verdad se parecen. Lo mismo que
 * ya se decidió al no fusionar Sailun con Sailong.
 */
export function buscarEnCatalogo(p: PropuestaFlanco, catalogo: ReferenciaCatalogo[]): Coincidencia[] {
  if (!p.suficienteParaBuscar) return [];
  const marca = normalizarNombre(p.marca);
  const medida = normalizarMedida(p.medida);
  const modelo = normalizarNombre(p.modelo);

  const mismaMarcaMedida = catalogo.filter(
    (r) => normalizarNombre(r.marca) === marca && normalizarMedida(r.medida) === medida,
  );
  const exactas = modelo
    ? mismaMarcaMedida.filter((r) => normalizarNombre(r.modelo) === modelo)
    : [];
  const idsExactas = new Set(exactas.map((r) => r.id));

  return [
    ...exactas.map((referencia) => ({ referencia, tipo: "exacta" as const })),
    ...mismaMarcaMedida
      .filter((r) => !idsExactas.has(r.id))
      .map((referencia) => ({ referencia, tipo: "medida" as const })),
  ];
}
