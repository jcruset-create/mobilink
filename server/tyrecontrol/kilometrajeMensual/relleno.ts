/**
 * El relleno de kilómetros mes a mes, vehículo a vehículo.
 *
 * ── Para qué ────────────────────────────────────────────────────────────────
 *
 * La sincronización normal (`MonthlyMileageSyncService`) pide lotes de 25
 * unidades y se cruza la flota entera en un rato. Eso está bien de noche, pero
 * no sirve cuando hay que rellenar un mes viejo de 751 autobuses con el
 * proveedor en marcha: un pico de peticiones seguidas es justo lo que hace que
 * la cuenta se quede sin cupo para lo demás.
 *
 * Este módulo hace lo contrario: UNA unidad por petición y una petición cada
 * veinte segundos, hasta terminar. Tres peticiones por minuto, quince por
 * ventana de cinco minutos, frente a las cien que el sistema tiene asignadas
 * de la cuota de Movertis. El barrido de presencia y el job de la noche siguen
 * teniendo sitio de sobra.
 *
 * El coste es el tiempo: 751 vehículos a 20 s son 4 h 10 min. Por eso esto no
 * es un bucle, es una tarea con ticks (ver `rellenoWorker.ts`).
 *
 * ── Por qué el pendiente sale de la base y no de una lista ──────────────────
 *
 * Cuatro horas es más de lo que dura un proceso en Render entre despliegues.
 * Si el pendiente viviera en memoria, cada reinicio empezaría de cero. Sale de
 * los datos: pendiente es el par (vehículo, mes) que todavía NO tiene fila
 * guardada. Reanudar es volver a preguntar, y un reinicio cuesta un tick.
 *
 * ── Qué cuenta como hecho ───────────────────────────────────────────────────
 *
 * `ok` (trajo kilómetros) y `empty` (el proveedor contestó y ese vehículo no
 * tiene viajes ese mes). Un `empty` es un dato: el equipo estuvo parado, o
 * apagado. Lo que NO cuenta como hecho es `error`, que se reintenta hasta
 * `maxIntentos` y luego se deja en paz para no martillear al proveedor con el
 * mismo vehículo durante cuatro horas.
 *
 * Ojo con el `empty` de un mes cerrado: el servicio solo da por cerrado un
 * «sin datos» cuando alguien más del mismo lote trajo kilómetros, y aquí el
 * lote es de uno, así que nunca se cierra. Por eso el pendiente de este módulo
 * mira la FILA, no el `closed`: si no, los vehículos sin viajes en enero se
 * repetirían en bucle hasta el fin de los tiempos.
 *
 * Todo lo de aquí es puro: entra lo que hay, sale lo que falta. Las peticiones
 * y el reloj están en `rellenoWorker.ts`.
 */

import type { Mes } from "../../integration-hub/domain/meses.ts";

/** Cada cuánto se pide una unidad, en segundos. */
export const INTERVALO_SEGUNDOS_POR_DEFECTO = 20;
/**
 * Suelo del intervalo. Por debajo de cinco segundos esto deja de ser «un
 * vehículo cada tanto» y vuelve a ser una ráfaga, que es lo que se evita.
 */
export const INTERVALO_SEGUNDOS_MINIMO = 5;
/** Cuántas veces se reintenta un vehículo que falla, dentro de la misma tarea. */
export const MAX_INTENTOS_POR_DEFECTO = 3;

/** Un paso del relleno: un vehículo y un mes. Es una petición al proveedor. */
export interface Paso {
  mobilinkId: string;
  externalCode: string;
  /** Cómo se llama ese autobús para un humano: matrícula si se sabe. */
  etiqueta: string;
  year: number;
  month: number;
}

export function clavePaso(p: { mobilinkId: string; year: number; month: number }): string {
  return `${p.mobilinkId}|${p.year}-${String(p.month).padStart(2, "0")}`;
}

export interface Enlace {
  mobilinkId: string;
  externalCode: string;
  /** Matrícula guardada al enlazar, si la hay. */
  matricula?: string | null;
}

/**
 * Con qué nombre se ordena y se enseña un vehículo.
 *
 * La matrícula si se sabe; el código de unidad del proveedor si no. Ordenar
 * por el código interno de Movertis daría un orden estable pero ilegible, y
 * quien mira el progreso necesita reconocer el autobús que toca ahora.
 */
export function etiquetaDe(e: Enlace): string {
  const m = (e.matricula ?? "").trim();
  return m || e.externalCode;
}

/**
 * Lo que falta, en orden estable.
 *
 * El orden es por mes y, dentro del mes, por matrícula (ver `etiquetaDe`), con
 * el código de unidad como desempate para que dos vehículos sin matrícula no
 * bailen entre pasadas. Estable a propósito: quien mira el progreso tiene que
 * poder decir por dónde va y qué autobús toca ahora, y tras un reinicio el
 * orden debe ser el mismo o reanudar dejaría huecos.
 */
export function pasosPendientes(params: {
  enlaces: Enlace[];
  meses: Mes[];
  /** Claves (`clavePaso`) que ya tienen fila guardada: `ok` o `empty`. */
  hechos: Set<string>;
  /** Intentos fallidos de esta tarea, por clave. */
  intentos?: Map<string, number>;
  maxIntentos?: number;
}): Paso[] {
  const intentos = params.intentos ?? new Map<string, number>();
  const tope = Math.max(1, Math.floor(params.maxIntentos ?? MAX_INTENTOS_POR_DEFECTO));

  const enlaces = [...params.enlaces].sort((a, b) =>
    // `numeric` para que B-100 vaya detrás de B-20 y no delante.
    etiquetaDe(a).localeCompare(etiquetaDe(b), "es", { numeric: true }) ||
    a.externalCode.localeCompare(b.externalCode, "es", { numeric: true }),
  );
  const meses = [...params.meses].sort((a, b) => a.year - b.year || a.month - b.month);

  const salida: Paso[] = [];
  for (const mes of meses) {
    for (const e of enlaces) {
      const paso: Paso = {
        mobilinkId: e.mobilinkId, externalCode: e.externalCode, etiqueta: etiquetaDe(e),
        year: mes.year, month: mes.month,
      };
      const clave = clavePaso(paso);
      if (params.hechos.has(clave)) continue;
      if ((intentos.get(clave) ?? 0) >= tope) continue;
      salida.push(paso);
    }
  }
  return salida;
}

/**
 * Cuánto queda, en tiempo de reloj.
 *
 * Se enseña porque «faltan 612» no le dice nada a nadie y «faltan 3 h 24 min»
 * sí: es la diferencia entre esperar y pensar que se ha colgado.
 */
export function minutosRestantes(pendientes: number, intervaloSegundos: number): number {
  if (pendientes <= 0) return 0;
  return Math.ceil((pendientes * intervaloSegundos) / 60);
}

export function enPalabras(minutos: number): string {
  if (minutos <= 0) return "nada";
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * «2026-01» → `{ year: 2026, month: 1 }`.
 *
 * El inverso de `claveDeMes`. Hace falta porque la tarea se guarda con los
 * meses en texto y al reanudarla tras un reinicio hay que volver a tenerlos:
 * un mes que no se pueda leer se descarta en vez de adivinarse.
 */
export function mesDesdeClave(clave: string): Mes | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(clave ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

export function intervaloValido(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < INTERVALO_SEGUNDOS_MINIMO) return INTERVALO_SEGUNDOS_POR_DEFECTO;
  return Math.min(3600, Math.floor(n));
}

/** Cómo acabó una unidad: es lo que decide si se reintenta o no. */
export type Desenlace =
  | { tipo: "ok"; km: number | null }
  | { tipo: "sin_datos" }
  | { tipo: "error"; mensaje: string }
  /** El limitador dice «ahora no»: se reintenta sin gastarle un intento al vehículo. */
  | { tipo: "esperar"; mensaje: string }
  /** Credencial rechazada o cuenta caída: no es de este vehículo, para la tarea. */
  | { tipo: "abandonar"; mensaje: string };

/**
 * Traduce el resumen de `syncMonthlyMileage` (pensado para la flota entera) al
 * desenlace de la única unidad que se ha pedido.
 *
 * La regla que importa: un 401/403 no se apunta contra el vehículo. Seguir
 * pidiendo con una credencial rechazada es quemar cupo y acercar el bloqueo
 * del token, así que se para la tarea entera y se dice por qué.
 */
export function desenlaceDe(resumen: {
  cuentas: {
    vehiculosConKm?: number;
    vehiculosSinDatos?: number;
    kmTotales?: number;
    errores?: number;
    muestraErrores?: string[];
    abandonada?: string;
    sinCupo?: boolean;
    peticiones?: number;
  }[];
}): Desenlace {
  const c = resumen.cuentas[0];
  if (!c) return { tipo: "error", mensaje: "La cuenta ya no existe o está desactivada" };

  if (c.abandonada) {
    const auth = /^AUTH:/.test(c.abandonada);
    // Sin cupo no es un fallo: es el limitador diciendo «ahora no». Se
    // reintenta en el siguiente tick sin gastarle un intento al vehículo.
    if (c.sinCupo) return { tipo: "esperar", mensaje: c.abandonada };
    if (auth) return { tipo: "abandonar", mensaje: c.abandonada };
    return { tipo: "error", mensaje: c.abandonada };
  }
  if ((c.errores ?? 0) > 0) {
    return { tipo: "error", mensaje: c.muestraErrores?.[0] ?? "Error del proveedor" };
  }
  if ((c.vehiculosConKm ?? 0) > 0) {
    return { tipo: "ok", km: c.kmTotales ?? null };
  }
  if ((c.vehiculosSinDatos ?? 0) > 0) return { tipo: "sin_datos" };
  // Ni km, ni sin-datos, ni error: no se llegó a pedir (el vehículo ya tenía
  // el mes cerrado, o el enlace se desactivó). No es un fallo suyo.
  return { tipo: "sin_datos" };
}
