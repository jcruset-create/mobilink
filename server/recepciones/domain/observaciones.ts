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
 * ── El teléfono, aparte ─────────────────────────────────────────────────────
 *
 * Lo que se teclea al pedir a veces lleva un móvil: «PEDRO+610473077». Ese
 * número se saca a su propio campo, porque un teléfono en medio de una frase
 * no sirve para llamar ni para avisar por WhatsApp, y en una columna sí.
 *
 * Sólo MÓVILES españoles (empiezan por 6 o 7, nueve cifras). Un fijo no vale
 * para WhatsApp, y confundir un número de pedido con un teléfono sería peor
 * que no encontrarlo: se avisaría a un desconocido.
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
 * ── El texto largo se parte en dos líneas ───────────────────────────────────
 *
 * Cuando la observación no cabe, el PDF la sigue en la línea de abajo, en la
 * misma columna y SIN números:
 *
 *     OSCAR+SALVADOR+SANJULIAN   0   0   0,00
 *     +629862105
 *
 * Esa segunda línea es parte de la primera, y es donde suele acabar el
 * teléfono. Se reconoce por lo que le falta: dentro de la tabla, TODA fila de
 * verdad termina en sus tres columnas numéricas, así que una línea que no las
 * trae es la continuación de la anterior. Lo mismo le pasa a los artículos
 * («…SAILUN STR1+» y debajo «164K»).
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

/** Abre la tabla de productos de Soledad; lo que va antes es membrete. */
const CABECERA = /ARTICULO.*DESCRIPCION.*CANTIDAD/;
/** La cierra: empiezan los totales. Vale para las dos plantillas. */
export const TOTALES = /IMPORTE BRUTO/;

/* ── La otra plantilla del grupo: INSA TURBO ──────────────────────────────── */

/** «Referencias Descripción Cantidad Precio % Dto Total» abre su tabla. */
export const CABECERA_INSA = /REFERENCIAS.*DESCRIPCION.*CANTIDAD/;
/** La fila de asteriscos con la que INSA cierra el cuerpo del albarán. */
export const FIN_INSA = /^\*{10,}$/;
/** «PEDIDO Nº 26001072 FECHA 12/08/2026»: agrupa líneas, no es observación. */
export const GRUPO_INSA = /^PEDIDO\s+N[º°O]?\s/;
/** La referencia de artículo de INSA: «021300001012». */
export const REFERENCIA_INSA = /^\d{9,}$/;
/** Su cantidad va pegada a la unidad: «10,000UD». */
export const CANTIDAD_INSA = /\d+(?:[.,]\d+)?\s*UD\b/;
/** Filas de adorno: «*», «-----», «=====». */
export const ADORNO = /^[*\-=._]+$/;

/** «1.039,00», «-4», «6,05», «0». Lo que ocupa una celda de número. */
function comoNumero(palabra: string): number | null {
  if (!/^-?[\d.,]+$/.test(palabra)) return null;
  const n = Number(palabra.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Sin acentos y en mayúsculas, para comparar. */
export function normalizar(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

/**
 * El texto de una observación: los «+» del proveedor son espacios, y los
 * espacios de más sobran.
 */
export function limpiarObservacion(texto: string): string {
  return texto.replace(/\+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Un móvil español dentro del texto: nueve cifras que empiezan por 6 o 7, con
 * el prefijo +34 opcional y admitiendo espacios, puntos o guiones por medio,
 * que es como los escribe la gente.
 */
const MOVIL = /(?:\+?34[\s.-]?)?([67](?:[\s.-]?\d){8})(?!\d)/;

/** Las nueve cifras, sin adornos. */
function soloDigitos(v: string): string {
  return v.replace(/\D/g, "");
}

/**
 * Parte una observación en lo que dice y a quién se llama.
 *
 *     «PEDRO 610473077» → { texto: "PEDRO", telefono: "610473077" }
 *     «TALLER»          → { texto: "TALLER", telefono: null }
 *     «610473077»       → { texto: "",       telefono: "610473077" }
 */
export function partirObservacion(observacion: string): { texto: string; telefono: string | null } {
  const m = observacion.match(MOVIL);
  if (!m) return { texto: observacion.trim(), telefono: null };
  const telefono = soloDigitos(m[1]);
  if (telefono.length !== 9) return { texto: observacion.trim(), telefono: null };
  /*
   * Lo que queda al quitarlo. Se limpian SÓLO los separadores que rodeaban al
   * número, no la puntuación de toda la frase: en el albarán de INSA la
   * observación es una frase de verdad («CASCOS HANKOOK o CONTINENTAL, PED.
   * ALBERTO 610473077») y arrasar con las comas y los puntos la dejaba
   * irreconocible.
   */
  const antes = observacion.slice(0, m.index).replace(/[\s.,;:/-]+$/, "");
  const despues = observacion.slice((m.index ?? 0) + m[0].length).replace(/^[\s.,;:/-]+/, "");
  const texto = [antes, despues].filter((t) => t.trim()).join(" ").replace(/\s+/g, " ").trim();
  return { texto, telefono };
}

/** Una fila ya partida en sus dos mitades: lo que dice y lo que cuesta. */
export type FilaTabla = { descripcion: string[]; numeros: number[] };

/**
 * Parte una fila en descripción y columnas numéricas. Las columnas son las
 * ÚLTIMAS palabras que son números; si no hay tres, no es una fila completa
 * —será la continuación de la de arriba— y se devuelve `null`.
 */
export function partirFila(palabras: readonly string[]): FilaTabla | null {
  const limpias = palabras.filter((p) => p.trim());
  const numeros: number[] = [];
  let i = limpias.length - 1;
  while (i >= 0 && numeros.length < COLUMNAS_NUMERICAS) {
    const n = comoNumero(limpias[i]);
    if (n === null) break;
    numeros.unshift(n);
    i -= 1;
  }
  if (numeros.length < COLUMNAS_NUMERICAS) return null;
  return { descripcion: limpias.slice(0, i + 1), numeros };
}

/**
 * Las filas de la tabla con sus continuaciones ya pegadas. Una línea sin
 * columnas numéricas es la segunda línea de la anterior, y su texto va a la
 * DESCRIPCIÓN, no detrás de los números.
 */
export function filasConContinuaciones(filas: readonly FilaPdf[]): FilaTabla[] {
  const salida: FilaTabla[] = [];
  for (const fila of filas) {
    const partida = partirFila(fila.palabras);
    if (partida) {
      salida.push(partida);
      continue;
    }
    const anterior = salida[salida.length - 1];
    if (anterior) anterior.descripcion.push(...fila.palabras.filter((p) => p.trim()));
  }
  return salida;
}

/** ¿Esta fila es una observación? Devuelve su texto, o null si no lo es. */
export function observacionDeFila(fila: FilaPdf | FilaTabla): string | null {
  const f = "palabras" in fila ? partirFila(fila.palabras) : fila;
  if (!f || f.descripcion.length === 0 || f.numeros.some((n) => n !== 0)) return null;

  const texto = limpiarObservacion(f.descripcion.join(" "));
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

/**
 * Qué plantilla es este albarán, por su cabecera de columnas. `null` si no se
 * reconoce ninguna: entonces no se saca nada, que es mejor que adivinar.
 */
export function formatoDelAlbaran(filas: readonly FilaPdf[]): "SOLEDAD" | "INSA" | null {
  for (const fila of filas) {
    const n = normalizar(fila.palabras.join(" "));
    if (CABECERA.test(n)) return "SOLEDAD";
    if (CABECERA_INSA.test(n)) return "INSA";
  }
  return null;
}

/**
 * Las observaciones del albarán de entrega de INSA TURBO.
 *
 * Otra casa del grupo (Industrias del Neumático SAU) y otra plantilla, que no
 * se parece en nada a la de Soledad: aquí las observaciones NO son filas con
 * las columnas a cero al final de la tabla, sino líneas de texto suelto DEBAJO
 * de su artículo, dentro del cuerpo del albarán:
 *
 *     PEDIDO Nº 26001072 FECHA 12/08/2026
 *     021300001012 295/80X22.5 INSA TURBO K25 BASE 1ª  10,000UD  190,000 EUR 0,00 1.900,000
 *     CASCOS HANKOOK o CONTINENTAL, PED. ALBERTO
 *     TALLER RIU CLAR
 *     *
 *
 * Así que aquí una observación se reconoce por lo que NO es: ni un artículo
 * (referencia de nueve cifras o más y cantidad «10,000UD»), ni la cabecera de
 * un pedido, ni una fila de adorno, ni un renglón sin una sola letra.
 *
 * El cuerpo acaba en su fila de asteriscos larga, y eso importa: justo debajo
 * viene «CAMION (TRUCK) 26,000», que tiene letras y pasaría por observación.
 *
 * Un albarán de INSA trae VARIOS pedidos, cada uno con sus líneas. Eso no se
 * modela aquí: esto sólo lee texto.
 */
export function observacionesInsa(todas: readonly FilaPdf[]): string[] {
  const salida: string[] = [];
  let dentro = false;
  for (const fila of todas) {
    const palabras = fila.palabras.filter((p) => p.trim());
    if (palabras.length === 0) continue;
    const crudo = palabras.join(" ");
    const n = normalizar(crudo);

    if (!dentro) {
      if (CABECERA_INSA.test(n)) dentro = true;
      continue;
    }
    if (TOTALES.test(n) || FIN_INSA.test(palabras.join(""))) break;

    if (GRUPO_INSA.test(n)) continue;
    if (palabras.every((p) => ADORNO.test(p))) continue;
    // Un artículo: su referencia delante y su cantidad en unidades.
    if (REFERENCIA_INSA.test(palabras[0]) && CANTIDAD_INSA.test(n)) continue;

    const texto = limpiarObservacion(crudo);
    if (!/\p{L}/u.test(texto)) continue;
    if (!salida.includes(texto)) salida.push(texto);
  }
  return salida;
}

export function observacionesDelAlbaran(todas: readonly FilaPdf[]): string[] {
  // Cada proveedor del grupo tiene su plantilla y su forma de escribir esto:
  // se mira cuál es ANTES de leer, en vez de hacer que una regla sirva para
  // las dos, que es como se acaba sacando un artículo por observación.
  if (formatoDelAlbaran(todas) === "INSA") return observacionesInsa(todas);

  /*
   * Se miran TODAS las filas de la tabla, no sólo las de después del último
   * artículo.
   *
   * Antes se buscaba detrás de la línea de gestión de NFU, porque ahí es donde
   * salía en los albaranes que se vieron primero. Pero el albarán 2028472911
   * la pone justo DEBAJO de su artículo y antes del NFU:
   *
   *     0106052880097 245/45X18 CONT.ECOCONTC6  2  109,575  219,15
   *                   96W
   *     JUAN+LECHUGA+603472809                  0  0        0,00
   *     .                                       0  0        0,00
   *     4102999990070 S.I.Gestión de NFU Cat.N2 2  1,8      3,60
   *
   * Con la regla vieja, «JUAN LECHUGA» y su móvil se perdían: nadie sabía para
   * quién era la mercancía ni a quién avisar. Y la posición no es lo que
   * distingue una observación —eso lo hace su FORMA: las tres columnas a cero
   * y algo escrito delante—, así que se mira por la forma y en toda la tabla.
   */
  const salida: string[] = [];
  for (const fila of filasConContinuaciones(filasDeLaTabla(todas))) {
    const obs = observacionDeFila(fila);
    if (obs && !salida.includes(obs)) salida.push(obs);
  }
  return salida;
}
