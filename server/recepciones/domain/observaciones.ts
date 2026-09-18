/**
 * Las observaciones del albarán del proveedor: para quién viene la mercancía.
 *
 * Código PURO: recibe las filas ya leídas del PDF y devuelve texto.
 *
 * ── Qué son y por qué importan ──────────────────────────────────────────────
 *
 * El albarán de Soledad termina su tabla con una fila de gestión de NFU, y
 * DESPUÉS mete una fila más con texto y ceros en todas las columnas:
 *
 *     4102999990093  S.I.Gestión de NFU Cat.D1T   4   6,05   24,20
 *                    JORGE+PLANA                  0   0      0,00
 *                                                 0   0      0,00
 *
 * Eso no es un artículo: es lo que se escribió al pedir, y dice a dónde va la
 * mercancía dentro de la casa — «TALLER», o el nombre de quien la espera,
 * «JORGE PLANA». En el muelle es el dato que decide dónde se deja el palé, y
 * sólo viaja en el PDF: el correo no lo trae.
 *
 * Soledad manda los espacios como «+» (viene así de un formulario web), así
 * que «JORGE+PLANA» se guarda como «JORGE PLANA».
 *
 * ── Cómo se reconoce una fila de observación ────────────────────────────────
 *
 * Por su forma, no por su sitio: las columnas numéricas de la derecha están
 * TODAS a cero —una observación nunca lleva precio— y a la izquierda hay algo
 * escrito. Así se distingue de la fila separadora («.»), de las filas de
 * cierre (sólo ceros) y de cualquier artículo (sus números no son cero).
 *
 * «Algo escrito» es una letra, o una ristra de cuatro cifras o más: lo que se
 * teclea al pedir puede ser «TALLER», «JORGE+PLANA» o «PEDRO+610473077», y un
 * teléfono suelto también es una observación. Lo que NO puede ser es un dígito
 * perdido ni un punto.
 *
 * No se usan coordenadas a propósito: la plantilla del proveedor puede mover
 * las columnas, pero «tres ceros al final y algo escrito delante» seguirá
 * siendo cierto.
 *
 * ── Sólo dentro de la tabla ─────────────────────────────────────────────────
 *
 * La búsqueda se acota a las filas que van entre la cabecera de columnas
 * («Artículo Descripción Cantidad Precio Dto. Importe») y el «Importe Bruto:»
 * de los totales, y la ventana se cierra AL CAMBIAR DE PÁGINA.
 *
 * Las dos cosas hacen falta, y lo enseñó un albarán de dos páginas: repite su
 * membrete arriba de la segunda, y «Calle Severo Ochoa, 30 Tel. Pedidos 911
 * 910 910» acaba en tres números. Sin acotar pasaba por artículo; acotando
 * pero sin cerrar en el salto de página, seguía dentro de la ventana que abrió
 * la página anterior. En los dos casos se llevaba por delante la observación,
 * que iba antes.
 */

/**
 * Una fila del PDF: sus palabras en orden de izquierda a derecha, y en qué
 * página está. Sin `pagina` se tratan todas como una sola, que es lo cómodo
 * para escribir pruebas de una página.
 */
export type FilaPdf = { palabras: string[]; pagina?: number };

/** Cuántas columnas numéricas cierran una fila de la tabla: cantidad, precio, importe. */
const COLUMNAS_NUMERICAS = 3;

/** Abre la tabla de productos; lo que va antes es membrete. */
const CABECERA = /ARTICULO.*DESCRIPCION.*CANTIDAD/;
/** La cierra: empiezan los totales. */
const TOTALES = /IMPORTE BRUTO/;

/** «1.039,00», «-4», «6,05», «0». Lo que ocupa una celda de número. */
function comoNumero(palabra: string): number | null {
  if (!/^-?[\d.,]+$/.test(palabra)) return null;
  const n = Number(palabra.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Sin acentos y en mayúsculas, para comparar. */
function normalizar(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/**
 * El texto de una observación: los «+» del proveedor son espacios, y los
 * espacios de más sobran.
 */
export function limpiarObservacion(texto: string): string {
  return texto.replace(/\+/g, " ").replace(/\s+/g, " ").trim();
}

/** ¿Esta fila es una observación? Devuelve su texto, o null si no lo es. */
export function observacionDeFila(fila: FilaPdf): string | null {
  const palabras = fila.palabras.filter((p) => p.trim());
  if (palabras.length <= COLUMNAS_NUMERICAS) return null;

  // Las columnas de números son las últimas; el resto es la descripción.
  const numeros: number[] = [];
  let i = palabras.length - 1;
  while (i >= 0 && numeros.length < COLUMNAS_NUMERICAS) {
    const n = comoNumero(palabras[i]);
    if (n === null) break;
    numeros.unshift(n);
    i -= 1;
  }
  if (numeros.length < COLUMNAS_NUMERICAS || numeros.some((n) => n !== 0)) return null;

  const texto = limpiarObservacion(palabras.slice(0, i + 1).join(" "));
  // Una letra, o un número largo (un teléfono). Un «.» o un dígito suelto, no.
  return /\p{L}/u.test(texto) || /\d{4,}/.test(texto) ? texto : null;
}

/**
 * Las observaciones del albarán: las filas con forma de observación que van
 * DESPUÉS de la última fila de artículo. La de gestión de NFU es siempre la
 * última, y por eso es la referencia; si no estuviera, vale cualquier fila con
 * números distintos de cero, que es lo que define a un artículo.
 */
/** Las filas que están DENTRO de la tabla de productos, de todas las páginas. */
export function filasDeLaTabla(filas: readonly FilaPdf[]): FilaPdf[] {
  const dentro: FilaPdf[] = [];
  let abierta = false;
  let pagina: number | undefined;
  for (const fila of filas) {
    // Página nueva, membrete nuevo: la tabla vuelve a empezar en su cabecera.
    if (fila.pagina !== pagina) {
      pagina = fila.pagina;
      abierta = false;
    }
    const n = normalizar(fila.palabras.join(" "));
    if (CABECERA.test(n)) {
      abierta = true; // la cabecera no cuenta como fila
      continue;
    }
    if (TOTALES.test(n)) {
      abierta = false;
      continue;
    }
    if (abierta) dentro.push(fila);
  }
  return dentro;
}

export function observacionesDelAlbaran(todas: readonly FilaPdf[]): string[] {
  const filas = filasDeLaTabla(todas);
  let ultimoArticulo = -1;
  for (const [i, fila] of filas.entries()) {
    const palabras = fila.palabras.filter((p) => p.trim());
    const numeros = palabras.slice(-COLUMNAS_NUMERICAS).map(comoNumero);
    const esArticulo = numeros.length === COLUMNAS_NUMERICAS && numeros.every((n) => n !== null) && numeros.some((n) => n !== 0);
    if (esArticulo) ultimoArticulo = i;
    // El NFU manda aunque llevara ceros: es el final de la mercancía.
    if (normalizar(palabras.join(" ")).includes("GESTION DE NFU")) ultimoArticulo = i;
  }
  if (ultimoArticulo < 0) return [];

  const salida: string[] = [];
  for (const fila of filas.slice(ultimoArticulo + 1)) {
    const obs = observacionDeFila(fila);
    if (obs && !salida.includes(obs)) salida.push(obs);
  }
  return salida;
}
