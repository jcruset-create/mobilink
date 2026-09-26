/**
 * Versión que se enseña en la cabecera.
 *
 * Se sube A MANO en el PR que cambia algo del panel o del servidor, y por eso
 * se quedó tres días sin tocar mientras entraban arreglos: en pantalla seguía
 * poniendo v2.21.3 y no había forma de saber si lo desplegado los llevaba.
 *
 * Para eso está ahora el commit que devuelve `/api/health`: ese no depende de
 * que nadie se acuerde. Este número sirve para hablar, el commit para
 * comprobar.
 */
export const APP_VERSION = "v2.28.0";
