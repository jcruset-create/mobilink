/**
 * Sonda de combustible: ¿alguna cuenta de telemática da litros de verdad?
 *
 * Los conectores de Webfleet y Movertis dejan fuera el combustible a
 * propósito: en las sondas anteriores Webfleet devolvía `fuel_usage` SIEMPRE a
 * 0 (equipos sin enlace CAN/FMS) y los sensores de depósito de Movertis venían
 * «sin dato». Un cero de sensor ausente no se distingue de un depósito vacío
 * una vez guardado, así que se decidió no mapearlo.
 *
 * Antes de cambiar esa decisión hay que mirar otra vez, porque la flota cambia.
 * Esto mira SIN escribir nada: recorre lo que el proveedor devuelve en crudo y
 * hace inventario de los campos que huelen a combustible, con cuántas veces
 * vienen, cuántas con un valor distinto de cero y entre qué valores.
 *
 * Lo que NO devuelve, a propósito: matrículas, identificadores, posiciones ni
 * la respuesta cruda. Solo nombres de campo y números agregados.
 */

/** Nombres de campo que pueden ser combustible, en lo que use cada proveedor. */
const PATRON_CRUDO = /fuel|combust|litro|liter|litre|tank|deposit|consum|adblue|fms/i;

/** Sin tildes: «Nivel depósito» tiene que casar con «deposit». */
const PATRON = {
  test: (t: string) => PATRON_CRUDO.test(t.normalize("NFD").replace(/[\u0300-\u036f]/g, "")),
};

export interface CampoCombustible {
  /** Ruta del campo en la respuesta: "counters.fuel_used", "sensors[].value"… */
  campo: string;
  /** En cuántas lecturas aparece. */
  apariciones: number;
  /** En cuántas con un número distinto de cero. Es lo que importa. */
  conValor: number;
  /** Las que vienen pero no son un número (texto, «sin dato»…). */
  noNumericas: number;
  min: number | null;
  max: number | null;
  /** Hasta tres valores de ejemplo, para ver la escala (litros, %, ml…). */
  ejemplos: (number | string)[];
}

/**
 * Inventario de los campos de combustible de un montón de lecturas crudas.
 *
 * Se recorre el objeto entero porque cada proveedor lo esconde en un sitio:
 * Webfleet en el primer nivel (`fuel_usage`), Movertis dentro de `counters` o
 * de una lista de `sensors` con nombre y valor. En una lista de sensores, lo
 * que dice qué es cada uno es su NOMBRE, no la clave, así que un elemento cuyo
 * nombre huela a combustible cuenta aunque sus claves sean `name` y `value`.
 */
export function inventarioCombustible(lecturas: unknown[]): CampoCombustible[] {
  const campos = new Map<string, CampoCombustible>();

  const anotar = (ruta: string, valor: unknown) => {
    const c = campos.get(ruta) ?? {
      campo: ruta, apariciones: 0, conValor: 0, noNumericas: 0, min: null, max: null, ejemplos: [],
    };
    c.apariciones++;
    const n = typeof valor === "number" ? valor
      : typeof valor === "string" && valor.trim() !== "" && Number.isFinite(Number(valor)) ? Number(valor)
      : null;
    if (n === null) {
      c.noNumericas++;
      if (c.ejemplos.length < 3 && valor != null && !c.ejemplos.includes(String(valor))) {
        c.ejemplos.push(String(valor).slice(0, 40));
      }
    } else if (n !== 0) {
      c.conValor++;
      c.min = c.min === null ? n : Math.min(c.min, n);
      c.max = c.max === null ? n : Math.max(c.max, n);
      if (c.ejemplos.length < 3 && !c.ejemplos.includes(n)) c.ejemplos.push(n);
    }
    campos.set(ruta, c);
  };

  const recorrer = (v: unknown, ruta: string, dentroDeCombustible: boolean, profundidad: number) => {
    if (profundidad > 6 || v == null) return;
    if (Array.isArray(v)) {
      for (const x of v) recorrer(x, `${ruta}[]`, dentroDeCombustible, profundidad + 1);
      return;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      // Un sensor con nombre: { name: "Nivel depósito", value: 43 }.
      const nombre = String(o.name ?? o.nombre ?? o.label ?? o.description ?? "");
      const esSensorDeCombustible = PATRON.test(nombre);
      for (const [k, x] of Object.entries(o)) {
        const r = ruta ? `${ruta}.${k}` : k;
        const aqui = dentroDeCombustible || PATRON.test(k);
        if (esSensorDeCombustible && /^(value|valor|val|last|lastValue)$/i.test(k)) {
          anotar(`${ruta}{${nombre.slice(0, 40)}}.${k}`, x);
        } else if (x !== null && typeof x === "object") {
          recorrer(x, r, aqui, profundidad + 1);
        } else if (aqui) {
          anotar(r, x);
        }
      }
      return;
    }
  };

  for (const l of lecturas) recorrer(l, "", false, 0);
  return [...campos.values()].sort((a, b) => b.conValor - a.conValor || a.campo.localeCompare(b.campo));
}

/** El veredicto en una frase, para no tener que leer la tabla. */
export function veredictoCombustible(campos: CampoCombustible[], lecturas: number): string {
  if (lecturas === 0) return "No ha llegado ninguna lectura: no se puede decir nada.";
  const utiles = campos.filter((c) => c.conValor > 0);
  if (campos.length === 0) return `Ninguna de las ${lecturas} lecturas trae campos de combustible.`;
  if (utiles.length === 0) {
    return `Hay campos de combustible, pero en las ${lecturas} lecturas vienen a cero o sin dato: ` +
      `no hay sensor detrás.`;
  }
  return `${utiles.length} campo(s) de combustible traen valores reales: ` +
    utiles.map((c) => `${c.campo} (${c.conValor}/${c.apariciones})`).join(", ") + ".";
}
