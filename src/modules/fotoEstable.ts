/**
 * La misma foto, la misma dirección: para que no parpadee.
 *
 * La foto de un técnico enlazado con Core llega como una dirección FIRMADA,
 * que lleva un sello distinto cada vez que el servidor la firma. El panel
 * recarga los técnicos cada 15 segundos; si pusiera en el `<img>` la que
 * acaba de llegar, el navegador la vería como otra imagen, la volvería a
 * descargar y la tele del taller parpadearía cuatro veces por minuto.
 *
 * Dos direcciones son «la misma foto» si coinciden en todo menos en el sello
 * (lo que va detrás de `?`). Cada foto nueva se guarda en una ruta nueva, así
 * que si la ruta no cambia, la foto tampoco. Aquí se recuerda la primera
 * dirección que se vio de cada ruta y se sigue usando esa.
 *
 * No para siempre: una dirección firmada caduca. Se renueva pasadas unas
 * horas —bastante antes de que deje de valer—, que es lo que hace falta en
 * una pantalla que se queda encendida días.
 */

/** Una dirección se reutiliza, como mucho, este tiempo. El servidor las firma para 12 h. */
export const REUSAR_FOTO_MS = 5 * 60 * 60 * 1000;

const vistas = new Map<string, { url: string; desdeMs: number }>();

/** Solo para las pruebas. */
export function olvidarFotos(): void {
  vistas.clear();
}

export function fotoEstable<T extends string | null | undefined>(url: T, ahoraMs = Date.now()): T {
  if (!url) return url;
  const corte = url.indexOf("?");
  // Sin sello no es una dirección firmada: no hay nada que estabilizar.
  if (corte < 0) return url;
  const ruta = url.slice(0, corte);
  const vista = vistas.get(ruta);
  if (vista && ahoraMs - vista.desdeMs < REUSAR_FOTO_MS) return vista.url as T;
  vistas.set(ruta, { url, desdeMs: ahoraMs });
  return url;
}
