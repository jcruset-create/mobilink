/**
 * Qué se guarda de una hoja de parte en papel, y cuándo NO se puede guardar.
 *
 * La pantalla `ImportarPartesPapel` lee cada hoja y la casa con un vehículo y
 * con sus ruedas. Aquí se decide si esa hoja está lista para convertirse en
 * revisión y se preparan las filas para `importRevisiones`, el mismo que usa
 * el Fleetcheck: solo apunta mediciones en ruedas que ya tienen neumático, no
 * crea neumáticos ni montajes, y no toca un vehículo que ya tenga revisión ese
 * día.
 *
 * Dos clases de problema:
 *
 *   · BLOQUEOS: sin ellos resueltos no hay revisión que guardar. Vehículo sin
 *     reconocer o sin plano, filas sin rueda o sin profundidad, sin fecha.
 *   · AVISOS: la hoja se puede guardar, pero alguien tiene que mirar el papel
 *     antes y decir que sí. Matrícula que no cuadra con la unidad, letra
 *     dudosa, croquis distinto del plano.
 *
 * Es código puro.
 */
import type { FilaLeidaFlotas } from "./parteFlotas";

export interface FilaParaGuardar {
  matricula: string;
  fecha_revision: string;
  codigo_posicion: string;
  profundidad_mm: number;
  medida: string | null;
  marca_neumatico: string | null;
  modelo_neumatico: string | null;
}

export interface EstadoGuardado {
  bloqueos: string[];
  /** Hay que confirmar que se ha mirado el papel. */
  avisos: string[];
  filas: FilaParaGuardar[];
  fecha: string | null;
}

/** «16-11-2026», «16/11/26», «2026-11-16» → «2026-11-16». Null si no se entiende. */
export function fechaDelParte(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let a: number, me: number, d: number;
  if (m) { a = Number(m[1]); me = Number(m[2]); d = Number(m[3]); }
  else {
    m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
    if (!m) return null;
    d = Number(m[1]); me = Number(m[2]); a = Number(m[3]);
    if (a < 100) a += 2000;
  }
  const f = new Date(Date.UTC(a, me - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== me - 1 || f.getUTCDate() !== d) return null;
  return `${a}-${String(me).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function estadoParaGuardar(p: {
  matricula: string | null;
  fechaLeida: string | null;
  filas: FilaLeidaFlotas[];
  /** Fila del papel → código de la rueda del vehículo. Null si no hay plano. */
  ruedaDe: (pos: number | null) => string | null;
  sinPlano: boolean;
  avisosDeLectura: string[];
  hoy: string;
}): EstadoGuardado {
  const bloqueos: string[] = [];
  if (!p.matricula) bloqueos.push("No se ha reconocido el vehículo.");
  if (p.sinPlano) bloqueos.push("El vehículo no tiene tipo asignado: asígnaselo y vuelve a subir el parte.");

  const fecha = fechaDelParte(p.fechaLeida);
  if (!fecha) bloqueos.push("No se ha leído la fecha del parte.");
  else if (fecha > p.hoy) bloqueos.push(`La fecha leída (${fecha}) es posterior a hoy.`);

  const sinRueda = p.filas.filter((f) => !p.ruedaDe(f.pos));
  if (!p.sinPlano && sinRueda.length) {
    bloqueos.push(`${sinRueda.length} fila(s) sin rueda del vehículo (${sinRueda.map((f) => f.pos ?? "R").join(", ")}).`);
  }
  const sinProfundidad = p.filas.filter((f) => f.profundidad_mm == null);
  if (sinProfundidad.length) bloqueos.push(`${sinProfundidad.length} profundidad(es) sin leer.`);

  // Dos filas en la misma rueda: el papel o la numeración están mal.
  const vistas = new Map<string, number>();
  for (const f of p.filas) {
    const r = p.ruedaDe(f.pos);
    if (r) vistas.set(r, (vistas.get(r) ?? 0) + 1);
  }
  const repetidas = [...vistas].filter(([, n]) => n > 1).map(([r]) => r);
  if (repetidas.length) bloqueos.push(`Dos filas caen en la misma rueda: ${repetidas.join(", ")}.`);

  if (p.filas.length === 0) bloqueos.push("La hoja no tiene ninguna fila con datos.");

  const filas: FilaParaGuardar[] = bloqueos.length || !p.matricula || !fecha ? [] : p.filas.map((f) => ({
    matricula: p.matricula!,
    fecha_revision: fecha,
    codigo_posicion: p.ruedaDe(f.pos)!,
    profundidad_mm: f.profundidad_mm!,
    medida: f.medida,
    marca_neumatico: f.marca,
    modelo_neumatico: f.modelo,
  }));

  return { bloqueos, avisos: p.avisosDeLectura, filas, fecha };
}

/** «Importada del parte en papel 20261117.pdf, hoja 3». */
export const origenDelParte = (fichero: string, hoja: number) =>
  `Importada del parte en papel ${fichero}, hoja ${hoja}`;
