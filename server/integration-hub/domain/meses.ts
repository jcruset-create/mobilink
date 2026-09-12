/**
 * Meses naturales en una zona horaria: dónde empieza y dónde acaba cada uno.
 *
 * ── Por qué no vale `new Date(año, mes, 1)` ─────────────────────────────────
 *
 * Eso construye la medianoche en la zona DEL SERVIDOR, y Render corre en UTC.
 * Para Autocares Plana el 1 de septiembre empieza a las 00:00 de Madrid, que
 * son las 22:00 UTC del 31 de agosto. Cortar en UTC metería las dos primeras
 * horas de cada mes en el mes anterior —una hora en invierno—, y un autobús
 * nocturno acumularía kilómetros en el mes equivocado sin que nada chirríe.
 *
 * ── Cómo se convierte ───────────────────────────────────────────────────────
 *
 * Node trae ICU completo, así que `Intl.DateTimeFormat` sabe qué hora es en
 * Europe/Madrid para cualquier instante. Lo que NO ofrece es la inversa
 * («medianoche de Madrid → instante»), y se resuelve por aproximación: se toma
 * la medianoche UTC del día 1, se mira qué hora local es en ese instante, y se
 * corrige la diferencia. Dos vueltas bastan incluso cuando el ajuste cruza un
 * cambio de hora.
 *
 * Los instantes que salen son epoch en ms absolutos: Movertis los recibe tal
 * cual y no tiene que interpretar ninguna zona. La zona solo decide DÓNDE se
 * corta el mes, que es lo único que debe decidir.
 *
 * ── El final del mes es el principio del siguiente ──────────────────────────
 *
 * `hasta` es exclusivo: la medianoche del día 1 del mes que viene. Así los
 * meses encajan sin hueco ni solape, incluido el de 31 días y el de 28, y el
 * cambio de hora de marzo (23 h el último domingo) o el de octubre (25 h) se
 * reparte solo, sin contarlo dos veces ni perderlo.
 */

export interface Mes {
  year: number;
  /** 1..12, como lo escribe una persona. */
  month: number;
}

export interface LimitesDeMes extends Mes {
  /** Primer instante del mes (inclusive). */
  desde: Date;
  /** Primer instante del mes siguiente (exclusivo). */
  hasta: Date;
  zonaHoraria: string;
}

export const ZONA_HORARIA_POR_DEFECTO = "Europe/Madrid";

/** Hora local de un instante en una zona, en sus componentes. */
function componentesLocales(instante: number, zona: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: zona,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(instante)).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour), minute: Number(p.minute), second: Number(p.second),
  };
}

/**
 * El instante en que una zona horaria marca la medianoche de una fecha.
 *
 * Aproximación por corrección: ver la cabecera. Si la zona no existe,
 * `Intl` lanza un `RangeError`, y se deja subir: una zona mal escrita en la
 * config tiene que romper en la primera prueba, no cortar meses en UTC en
 * silencio.
 */
export function medianocheEn(year: number, month: number, day: number, zona: string): Date {
  const objetivo = Date.UTC(year, month - 1, day, 0, 0, 0);
  let t = objetivo;
  for (let i = 0; i < 3; i++) {
    const c = componentesLocales(t, zona);
    const local = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
    const desvio = local - objetivo;
    if (desvio === 0) break;
    t -= desvio;
  }
  return new Date(t);
}

/** Los límites de un mes natural en una zona. */
export function limitesDelMes(mes: Mes, zona = ZONA_HORARIA_POR_DEFECTO): LimitesDeMes {
  validarMes(mes);
  const siguiente = mesSiguiente(mes);
  return {
    ...mes,
    desde: medianocheEn(mes.year, mes.month, 1, zona),
    hasta: medianocheEn(siguiente.year, siguiente.month, 1, zona),
    zonaHoraria: zona,
  };
}

/** En qué mes está un instante, visto desde una zona. */
export function mesDe(instante: Date, zona = ZONA_HORARIA_POR_DEFECTO): Mes {
  const c = componentesLocales(instante.getTime(), zona);
  return { year: c.year, month: c.month };
}

export function mesSiguiente(m: Mes): Mes {
  return m.month === 12 ? { year: m.year + 1, month: 1 } : { year: m.year, month: m.month + 1 };
}

export function mesAnterior(m: Mes): Mes {
  return m.month === 1 ? { year: m.year - 1, month: 12 } : { year: m.year, month: m.month - 1 };
}

/** Todos los meses de `desde` a `hasta`, los dos inclusive, en orden. */
export function mesesEntre(desde: Mes, hasta: Mes): Mes[] {
  validarMes(desde);
  validarMes(hasta);
  const lista: Mes[] = [];
  let m = desde;
  // Tope defensivo: nadie pide de verdad 600 meses, y un bucle que se pasa de
  // largo por un `hasta` anterior a `desde` no debe colgar el proceso.
  for (let i = 0; i < 600 && compararMeses(m, hasta) <= 0; i++) {
    lista.push(m);
    m = mesSiguiente(m);
  }
  return lista;
}

/** Negativo si a < b, 0 si iguales, positivo si a > b. */
export function compararMeses(a: Mes, b: Mes): number {
  return a.year !== b.year ? a.year - b.year : a.month - b.month;
}

/** Clave estable `YYYY-MM`, para mapas y para leer en un log. */
export function claveDeMes(m: Mes): string {
  return `${m.year}-${String(m.month).padStart(2, "0")}`;
}

/**
 * ¿Ha terminado ya este mes, visto a `ahora`?
 *
 * Con un margen: el proveedor cierra sus resúmenes con retraso, y pedir
 * agosto a las 00:05 del 1 de septiembre puede dar un agosto al que le falta
 * la última noche. Seis horas es suficiente para cualquier viaje que acabe de
 * madrugada, y no retrasa nada que alguien vaya a mirar.
 */
export const MARGEN_CIERRE_MS = 6 * 60 * 60 * 1000;

export function mesCerrado(mes: Mes, zona: string, ahora: Date): boolean {
  const { hasta } = limitesDelMes(mes, zona);
  return ahora.getTime() >= hasta.getTime() + MARGEN_CIERRE_MS;
}

function validarMes(m: Mes): void {
  if (!Number.isInteger(m.year) || !Number.isInteger(m.month) || m.month < 1 || m.month > 12) {
    throw new RangeError(`Mes inválido: ${JSON.stringify(m)}`);
  }
}
