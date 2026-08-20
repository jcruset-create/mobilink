/**
 * Cambio a devolver con existencias limitadas.
 *
 * El problema NO es el cambio de libro de texto. En el de libro de texto hay
 * monedas infinitas y con el sistema euro el algoritmo voraz (coger siempre la
 * pieza mayor que quepa) da la solución óptima. Aquí las piezas son las que hay
 * físicamente en el cajón, y en cuanto el stock es limitado el voraz deja de
 * funcionar: se queda sin billetes de 10 € a mitad y no sabe volver atrás,
 * cuando existía una combinación exacta con lo que quedaba.
 *
 * Peor todavía: puede haber dinero de sobra en la caja y aun así NO existir
 * ninguna combinación exacta (hay que devolver 3 € y solo quedan billetes de
 * 50 €). Eso no es un fallo, es un resultado legítimo del negocio, y el
 * operador tiene que verlo escrito antes de confirmar nada.
 *
 * ── Cómo se resuelve ────────────────────────────────────────────────────────
 *
 * Programación dinámica exacta sobre importes en céntimos, con las cantidades
 * acotadas por el stock real:
 *
 *     piezas[i][a] = mínimo de piezas para formar `a` con las i primeras
 *                    denominaciones, sin pasarse del stock de ninguna
 *
 * La recurrencia natural es `min` sobre k = 0..tope de `piezas[i-1][a-k·v] + k`,
 * que es correcta pero cuesta O(importe × tope) por denominación: con 500
 * monedas de un céntimo eso son cientos de millones de operaciones.
 *
 * Se calcula igual de exacta en O(importe) con un mínimo deslizante. Fijado el
 * resto `r = a mod v`, escribiendo `a = r + j·v` la recurrencia queda
 *
 *     piezas[i][r + j·v] = j + min{ piezas[i-1][r + m·v] − m }  con m ∈ [j−tope, j]
 *
 * que es una ventana móvil de anchura `tope` sobre `P[m] − m`: un deque
 * monótono la recorre en tiempo lineal. Es la misma recurrencia, no una
 * heurística — no hay ningún caso en el que devuelva NO_SOLUTION existiendo
 * combinación.
 *
 * Los empates (misma cantidad de piezas) se resuelven a favor de gastar la
 * denominación más grande, porque el catálogo se recorre de mayor a menor y el
 * deque conserva el índice más antiguo. Así el menudo se queda en la caja para
 * los cambios siguientes.
 */

import type { Centimos } from "./money.ts";
import {
  type Inventario,
  type LineaDenominacion,
  cantidadDe,
  inventarioDesdeLineas,
  lineasDesdeInventario,
  totalInventario,
} from "./inventory.ts";

/**
 * Techo del importe que se resuelve automáticamente: 2.000 €.
 *
 * La tabla ocupa (denominaciones × importe) enteros de 32 bits; con este techo
 * son unos 12 MB en el peor caso. Un cambio por encima de 2.000 € no es una
 * operación de caja de taller, es un error de tecleo, y vale más decirlo y
 * dejar que se indique a mano que reservar cientos de megas por si acaso.
 */
export const CAMBIO_MAXIMO_CENTIMOS = 200_000;

/** Sentinela de "importe no alcanzable". Cabe de sobra en un Int32. */
const INF = 0x3fff_ffff;

export type MotivoCambioImposible =
  | "NO_SOLUTION"
  | "STOCK_INSUFICIENTE"
  | "IMPORTE_NO_VALIDO"
  | "IMPORTE_EXCESIVO";

export type ResultadoCambio =
  | { ok: true; lineas: LineaDenominacion[]; piezas: number }
  | { ok: false; motivo: MotivoCambioImposible; mensaje: string };

/**
 * Qué combinación exacta preferir cuando hay varias.
 *
 * · `menos_piezas` — la del cambio al cliente: cuantas menos piezas, mejor.
 * · `mas_piezas`   — la del cambio que se deja en caja al cerrar: interesa
 *                    quedarse con el menudo, porque una caja que abre con un
 *                    billete de 200 € y nada más no puede devolver 3,40 €.
 *
 * Las dos son la MISMA búsqueda exacta; solo cambia el sentido del óptimo.
 */
export type PreferenciaCambio = "menos_piezas" | "mas_piezas";

/**
 * Propone cómo devolver `importe` usando SOLO piezas de `stock`.
 *
 * Por defecto minimiza las piezas, que es lo que se quiere al dar cambio a un
 * cliente. Eso ya cumple de paso lo de "no vaciar denominaciones útiles",
 * porque devolver 20 € en un billete gasta una pieza y hacerlo en monedas de
 * 50 c gasta cuarenta: el óptimo nunca se lleva el menudo si puede evitarlo.
 */
/**
 * La tabla del reparto, sin reconstruir todavía.
 *
 * Se saca aparte porque hay dos preguntas distintas que resuelve la MISMA
 * tabla: «dame exactamente este importe» —el cambio de toda la vida— y «dame
 * lo más parecido a este importe que se pueda formar», que es lo que hace
 * falta al partir un arqueo entre dos cajas de la ERP. Construirla dos veces
 * costaría el doble por nada.
 */
type TablaCambio = {
  valores: number[];
  /** usadas[i][a]: piezas de la denominación i en la solución óptima de `a`. */
  usadas: Int32Array[];
  /** Coste de la última capa. `>= INF` en los importes que no se pueden formar. */
  previo: Int32Array;
  signo: number;
};

function construirTabla(importe: Centimos, stock: Inventario, signo: number): TablaCambio {
  // Solo las denominaciones con existencias, de mayor a menor.
  const valores = [...stock.entries()]
    .filter(([, cantidad]) => cantidad > 0)
    .map(([valor]) => valor)
    .sort((a, b) => b - a);

  const n = valores.length;
  // usadas[i][a] = piezas de la denominación i que emplea la solución óptima de
  // `a` en esa capa. Es lo que permite reconstruir la combinación al final.
  const usadas: Int32Array[] = [];

  let previo = new Int32Array(importe + 1).fill(INF);
  previo[0] = 0;

  // Buffers del deque reutilizados entre capas: guardan índices `m`.
  const deque = new Int32Array(importe + 2);

  for (let i = 0; i < n; i++) {
    const valor = valores[i];
    const tope = cantidadDe(stock, valor);
    const actual = new Int32Array(importe + 1).fill(INF);
    const usoActual = new Int32Array(importe + 1);

    for (let resto = 0; resto < valor && resto <= importe; resto++) {
      let cabeza = 0;
      let cola = 0; // [cabeza, cola) es el contenido del deque

      for (let j = 0, a = resto; a <= importe; j++, a += valor) {
        const p = previo[a];
        if (p < INF) {
          const clave = p - signo * j;
          // Empates: se sale el que ya estaba (`>` estricto), que tiene el
          // índice `m` más pequeño y por tanto gasta MÁS piezas de esta
          // denominación. Como se recorre de mayor a menor, eso equivale a
          // preferir el billete gordo y conservar el menudo.
          while (
            cola > cabeza &&
            previo[resto + deque[cola - 1] * valor] - signo * deque[cola - 1] > clave
          ) {
            cola--;
          }
          deque[cola++] = j;
        }

        // Fuera de la ventana: no se pueden usar más de `tope` piezas.
        while (cola > cabeza && deque[cabeza] < j - tope) cabeza++;

        if (cola > cabeza) {
          const m = deque[cabeza];
          actual[a] = previo[resto + m * valor] - signo * m + signo * j;
          usoActual[a] = j - m;
        }
      }
    }

    usadas.push(usoActual);
    previo = actual;
  }

  return { valores, usadas, previo, signo };
}

/**
 * Deshace la tabla hasta un importe concreto. `null` si no se puede formar.
 */
function reconstruir(t: TablaCambio, objetivo: Centimos): LineaDenominacion[] | null {
  if (objetivo === 0) return [];
  if (t.previo[objetivo] >= INF) return null;

  const lineas: LineaDenominacion[] = [];
  let resto = objetivo;
  for (let i = t.valores.length - 1; i >= 0; i--) {
    const cantidad = t.usadas[i][resto];
    if (cantidad > 0) {
      lineas.push({ valor: t.valores[i], cantidad });
      resto -= t.valores[i] * cantidad;
    }
  }
  if (resto !== 0) return null;
  lineas.sort((a, b) => b.valor - a.valor);
  return lineas;
}

export function calcularCambio(
  importe: Centimos,
  stock: Inventario,
  preferencia: PreferenciaCambio = "menos_piezas"
): ResultadoCambio {
  if (!Number.isSafeInteger(importe) || importe < 0) {
    return {
      ok: false,
      motivo: "IMPORTE_NO_VALIDO",
      mensaje: `Importe de cambio no válido: ${String(importe)}.`,
    };
  }
  if (importe === 0) return { ok: true, lineas: [], piezas: 0 };

  if (importe > CAMBIO_MAXIMO_CENTIMOS) {
    return {
      ok: false,
      motivo: "IMPORTE_EXCESIVO",
      mensaje:
        "El cambio a devolver supera el máximo que se calcula automáticamente. Indica a mano las piezas que entregas.",
    };
  }

  // Comprobación barata que evita montar la tabla cuando ni siquiera hay dinero
  // suficiente. Distingue "no hay bastante" de "hay bastante pero no cuadra",
  // que para quien está en el mostrador son dos problemas distintos.
  if (totalInventario(stock) < importe) {
    return {
      ok: false,
      motivo: "STOCK_INSUFICIENTE",
      mensaje: "No hay efectivo suficiente en caja para devolver el cambio.",
    };
  }

  const tabla = construirTabla(importe, stock, preferencia === "mas_piezas" ? -1 : 1);
  const { valores, usadas, previo, signo } = tabla;

  if (previo[importe] >= INF) {
    return {
      ok: false,
      motivo: "NO_SOLUTION",
      mensaje: "No es posible devolver este importe con las denominaciones disponibles en caja.",
    };
  }

  // Reconstrucción hacia atrás: en cada capa se sabe cuántas piezas de esa
  // denominación gastó la solución óptima del importe que quedaba.
  const lineas = reconstruir(tabla, importe);

  /* Red de seguridad: si la reconstrucción no cierra en cero, la tabla estaba
     mal y es preferible no proponer nada a proponer una combinación que no
     suma. No debería ocurrir nunca; si ocurre, es un fallo del algoritmo y no
     un caso de negocio. */
  if (!lineas) {
    return {
      ok: false,
      motivo: "NO_SOLUTION",
      mensaje: "No se ha podido reconstruir una combinación válida para el cambio.",
    };
  }

  return { ok: true, lineas, piezas: signo * previo[importe] };
}

/**
 * Tope del reparto entre cajas de la ERP.
 *
 * Es otro problema que el cambio al cliente: aquí no se devuelve nada, se
 * PARTE un arqueo, y una gasolinera puede pasar de 2.000 € en un día sin que
 * eso tenga nada de raro. El tope existe solo para acotar la tabla —10.000 €
 * son unos 40 MB en el peor caso— y no como regla de negocio.
 */
export const REPARTO_MAXIMO_CENTIMOS = 1_000_000;

export type RepartoAproximado = {
  lineas: LineaDenominacion[];
  /** Lo que suman de verdad esas piezas. Puede quedarse corto del objetivo. */
  logradoCentimos: Centimos;
};

/**
 * Las piezas que más se acercan a `objetivo` sin pasarse.
 *
 * Existe porque partir un arqueo entre dos cajas de la ERP no siempre se puede
 * hacer clavado: si la gasolinera movió 50 € pero ese billete ya salió en un
 * cambio, en el cajón puede no quedar ninguna combinación que sume 50 € justos.
 * Rendirse ahí sería lo cómodo y lo inútil —quien tiene que cerrar en Genes se
 * queda sin poder hacerlo—, así que se aparta lo más parecido que se pueda
 * formar y se dice EXACTAMENTE cuánto es.
 *
 * Que se quede corto y nunca se pase es a propósito: el resto se lo lleva la
 * caja principal, que es la que tiene el fondo y la que puede absorberlo.
 *
 * Devuelve `logradoCentimos` para que quien lo pinte no tenga que volver a
 * sumar las piezas —y sobre todo para que no pueda imprimir un total que no
 * cuadre con su propio desglose, que es lo que rompería el cierre de la ERP.
 */
export function repartoAproximado(
  objetivo: Centimos,
  stock: Inventario,
  preferencia: PreferenciaCambio = "menos_piezas"
): RepartoAproximado {
  if (!Number.isSafeInteger(objetivo) || objetivo <= 0) {
    return { lineas: [], logradoCentimos: 0 };
  }

  // Nunca hace falta mirar por encima de lo que hay: ahorra tabla y evita
  // pedirle al DP un importe que ninguna combinación puede alcanzar.
  const techo = Math.min(objetivo, totalInventario(stock), REPARTO_MAXIMO_CENTIMOS);
  if (techo <= 0) return { lineas: [], logradoCentimos: 0 };

  const tabla = construirTabla(techo, stock, preferencia === "mas_piezas" ? -1 : 1);

  // Del objetivo hacia abajo hasta dar con un importe que sí se pueda formar.
  // El cero siempre lo es, así que el bucle termina.
  for (let a = techo; a >= 0; a--) {
    if (tabla.previo[a] >= INF) continue;
    const lineas = reconstruir(tabla, a);
    if (lineas) return { lineas, logradoCentimos: a };
  }
  return { lineas: [], logradoCentimos: 0 };
}

/** Atajo cómodo para las pruebas y para la API, que hablan en líneas. */
export function calcularCambioDesdeLineas(
  importe: Centimos,
  stock: readonly LineaDenominacion[],
  preferencia: PreferenciaCambio = "menos_piezas"
): ResultadoCambio {
  return calcularCambio(importe, inventarioDesdeLineas(stock), preferencia);
}

/**
 * Valida un cambio elegido a mano por el operador (botón "Modificar cambio").
 *
 * Se comprueban las dos cosas que pueden ir mal por separado, porque los
 * mensajes son distintos: que el importe no cuadre, y que se estén sacando
 * piezas que no hay.
 */
export function validarCambioManual(
  importeRequerido: Centimos,
  lineas: readonly LineaDenominacion[],
  stock: Inventario
):
  | { ok: true; inventario: Inventario }
  | { ok: false; motivo: "IMPORTE_NO_CUADRA" | "STOCK_INSUFICIENTE"; mensaje: string } {
  const inventario = inventarioDesdeLineas(lineas);
  const total = totalInventario(inventario);

  if (total !== importeRequerido) {
    return {
      ok: false,
      motivo: "IMPORTE_NO_CUADRA",
      mensaje: `El cambio indicado suma ${total} céntimos y tienen que ser ${importeRequerido}.`,
    };
  }

  for (const { valor, cantidad } of lineasDesdeInventario(inventario)) {
    const disponible = cantidadDe(stock, valor);
    if (cantidad > disponible) {
      return {
        ok: false,
        motivo: "STOCK_INSUFICIENTE",
        mensaje: `Se quieren entregar ${cantidad} piezas de ${valor} céntimos y en caja hay ${disponible}.`,
      };
    }
  }

  return { ok: true, inventario };
}
