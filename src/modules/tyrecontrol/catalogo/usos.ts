/**
 * Las decisiones del alta de catálogo que se pueden probar sin navegador.
 *
 * Son dos, y las dos se equivocan en silencio si nadie las mira: cómo se
 * convierte un nombre nuevo en su código, y qué opciones se le enseñan a
 * alguien que llega con un valor que no está en la lista.
 */

/**
 * El código con el que se guarda un uso nuevo.
 *
 * Se deriva del nombre y no se pide aparte: es lo que va escrito en cada
 * modelo, y dejarlo teclear a mano es pedir que convivan «regional» y
 * «regional_2» para lo mismo.
 *
 * Sin tildes ni mayúsculas, porque es un valor interno que se compara: si
 * «Dirección» generara `dirección`, cualquier consulta escrita sin tilde
 * dejaría de encontrarlo.
 */
export function codigoDeUso(nombre: string): string {
  return nombre
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export interface OpcionSelector {
  valor: string;
  etiqueta: string;
}

/**
 * Las opciones de un desplegable, con lo ya elegido incluido aunque no esté
 * en la lista.
 *
 * Hace falta por «Sin catalogar»: de ahí llegan marca, modelo y medida sacadas
 * de neumáticos REALES, que muchas veces no están en el catálogo —por eso
 * están sin catalogar—. Sin esto, el desplegable se abriría vacío y se
 * perdería lo que el formulario ya traía puesto, que es justo el trabajo que
 * se venía a terminar.
 */
export function opcionesConElegido(valores: string[], elegido: string): OpcionSelector[] {
  const lista = valores.map((v) => ({ valor: v, etiqueta: v }));
  const puesto = elegido.trim();
  if (!puesto) return lista;
  // Se compara sin mayúsculas: si la lista trae «Michelin» y llega
  // «MICHELIN», es el mismo y no se duplica la opción.
  const yaEsta = valores.some((v) => v.toLowerCase() === puesto.toLowerCase());
  if (!yaEsta) lista.unshift({ valor: puesto, etiqueta: `${puesto} (nuevo)` });
  return lista;
}
