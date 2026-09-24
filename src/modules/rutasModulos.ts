/**
 * Dónde vive cada módulo dentro del panel.
 *
 * Estaba dentro de `InicioPage` porque el hub era el único que necesitaba
 * saberlo. Ahora también lo necesita la identidad de la pestaña, y dos listas
 * de rutas que hay que acordarse de tocar a la vez son dos listas que acaban
 * diciendo cosas distintas. Las claves son las de `MODULOS_APP`.
 */
export const BASES: Record<string, string> = {
  administracion: "/administracion",
  almacen: "/almacen-neumaticos",
  tyrecontrol: "/tyrecontrol",
  "sea-core": "/core",
  toolcontrol: "/toolcontrol",
  safety: "/safety",
  presencia: "/presencia",
  workplanner: "/workplanner",
  cash: "/cash",
  central: "/central",
  tacografos: "/tacografos",
  therefore: "/therefore",
  recepciones: "/recepciones",
  "or-manuales": "/or-manuales",
};

/**
 * ¿La ruta cae dentro de esta base? Compara por segmento entero: `/cash` y
 * `/cash/arqueo` sí, pero `/cashflow` no.
 */
export function rutaEmpiezaPor(ruta: string, base: string): boolean {
  return ruta === base || ruta.startsWith(base + "/");
}
