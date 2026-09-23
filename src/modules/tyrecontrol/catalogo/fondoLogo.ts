/**
 * Quitar el fondo blanco de los logos de marca.
 *
 * Los logos del catálogo se subieron tal cual venían: el de Mercedes es un PNG
 * con transparencia y se ve bien sobre el panel oscuro, pero los de Volvo, MAN
 * o Scania traen su recuadro blanco pegado dentro de la imagen y quedan como
 * un sello de correos.
 *
 * El recorte va por los BORDES, no por umbral a secas: se borra el blanco que
 * toca el borde y lo que sea blanco pegado a él. Un umbral global se llevaría
 * por delante los blancos de dentro del dibujo — las letras de MAN, el fondo
 * de la rejilla de Volvo—, que es justo lo que no se puede tocar.
 */

/** Cuánto hay que acercarse al blanco para considerarlo fondo. */
const UMBRAL = 236;

/**
 * Pone a transparente el blanco que llega desde los bordes.
 *
 * Trabaja sobre los bytes RGBA de un canvas (`ImageData.data`) y devuelve
 * cuántos píxeles ha borrado: si son cero, la imagen ya estaba bien y no hace
 * falta reescribirla.
 */
export function borrarFondoDesdeLosBordes(
  datos: Uint8ClampedArray | number[],
  ancho: number,
  alto: number,
  umbral: number = UMBRAL,
): number {
  if (ancho <= 0 || alto <= 0) return 0;

  const esFondo = (i: number): boolean => {
    const a = datos[i + 3];
    if (a === 0) return true;                       // ya transparente
    return datos[i] >= umbral && datos[i + 1] >= umbral && datos[i + 2] >= umbral;
  };

  const visto = new Uint8Array(ancho * alto);
  const cola: number[] = [];
  const encolar = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= ancho || y >= alto) return;
    const p = y * ancho + x;
    if (visto[p]) return;
    if (!esFondo(p * 4)) return;
    visto[p] = 1;
    cola.push(p);
  };

  for (let x = 0; x < ancho; x++) { encolar(x, 0); encolar(x, alto - 1); }
  for (let y = 0; y < alto; y++) { encolar(0, y); encolar(ancho - 1, y); }

  let borrados = 0;
  while (cola.length) {
    const p = cola.pop() as number;
    const i = p * 4;
    if (datos[i + 3] !== 0) { datos[i + 3] = 0; borrados++; }
    const x = p % ancho;
    const y = (p - x) / ancho;
    encolar(x - 1, y); encolar(x + 1, y); encolar(x, y - 1); encolar(x, y + 1);
  }
  return borrados;
}

// Cada logo se limpia una vez y se guarda: en un listado de 726 vehículos hay
// las mismas cinco o seis marcas repitiéndose.
const cache = new Map<string, Promise<string>>();

/**
 * La misma imagen sin su recuadro blanco, como data: URL.
 *
 * Devuelve la url original cuando no hay nada que quitar, cuando el navegador
 * no deja leer los píxeles (el almacenamiento tendría que responder con CORS)
 * o cuando la imagen no carga: un logo con fondo se ve peor, pero se ve.
 */
export function logoSinFondo(url: string): Promise<string> {
  const guardado = cache.get(url);
  if (guardado) return guardado;

  const tarea = new Promise<string>((resolver) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const lienzo = document.createElement("canvas");
        lienzo.width = img.naturalWidth;
        lienzo.height = img.naturalHeight;
        const ctx = lienzo.getContext("2d");
        if (!ctx) { resolver(url); return; }
        ctx.drawImage(img, 0, 0);
        const datos = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
        const borrados = borrarFondoDesdeLosBordes(datos.data, lienzo.width, lienzo.height);
        if (borrados === 0) { resolver(url); return; }
        ctx.putImageData(datos, 0, 0);
        resolver(lienzo.toDataURL("image/png"));
      } catch {
        resolver(url);
      }
    };
    img.onerror = () => resolver(url);
    img.src = url;
  });

  cache.set(url, tarea);
  return tarea;
}
