/**
 * Cómo se ordena la lista de vehículos dados de alta desde la tablet.
 *
 * La lista sirve para una cosa: ir a buscarlos y completarles la ficha. Así
 * que ordenar «por posición» no es ordenar el texto de la chapa por orden
 * alfabético —eso dejaría «En ruta» entre «En Calafell» y «En Reus»— sino
 * agrupar por DÓNDE hay que ir:
 *
 *   1. Los que están en una base AHORA, juntos por base: se cogen todos los
 *      de Reus de una vez.
 *   2. Los que estuvieron en una base y hace rato que no emiten, también por
 *      base: se puede pasar a mirar, con menos confianza.
 *   3. Los que van en ruta: no se puede ir a por ellos, pero se sabe que
 *      existen y se mueven.
 *   4. Los que no dicen nada: sin señal, sin posición o posición no válida.
 *      Al final, porque no hay a dónde ir.
 *
 * Dentro de cada grupo, por matrícula, para que la lista no baile entre dos
 * cargas con los mismos datos.
 */

import type { PresenciaEnBase, VehiculoWebfleetEstado } from "../types";
import { etiquetaBase, ubicacionDeVehiculo } from "./presenciaVista";

export type OrdenPendientes = "matricula" | "unidad" | "posicion";

/** Dónde está un vehículo, reducido a lo que el orden necesita. */
export interface Sitio {
  /** El mismo tono que pinta la chapa: `base` es el único que afirma. */
  tono: "base" | "ruta" | "viejo" | "desconocido";
  /** Nombre de la base, cuando se sabe cuál es. */
  base: string | null;
}

/**
 * Dónde está un vehículo, leído de las MISMAS dos funciones que pintan la
 * chapa en pantalla: `etiquetaBase` cuando se le puede poner una base, y
 * `ubicacionDeVehiculo` para el resto.
 *
 * Que el orden salga de lo mismo que el texto no es un detalle: un criterio
 * paralelo se despista el día que una de las dos cambie, y entonces la lista
 * se ordena por algo que nadie puede ver.
 */
export function sitioDeVehiculo(
  presencia: PresenciaEnBase | undefined,
  webfleet: VehiculoWebfleetEstado | undefined,
): Sitio {
  const enBase = etiquetaBase(presencia, webfleet);
  if (enBase) return { tono: enBase.ahora ? "base" : "viejo", base: enBase.base };
  return { tono: ubicacionDeVehiculo({ presencia, webfleet }).tono, base: null };
}

export interface FilaPendiente {
  id: string;
  matricula: string;
  unidad: string | null;
  sitio: Sitio;
}

/**
 * El grupo al que pertenece un sitio. Menor es «más a mano».
 *
 * Un `viejo` SIN base no es lo mismo que uno con base: del primero no se sabe
 * a dónde ir, así que cae al cajón de los desconocidos en vez de colarse
 * entre los que sí tienen sitio.
 */
export function grupoDeSitio(s: Sitio): number {
  if (s.tono === "base" && s.base) return 0;
  if (s.tono === "viejo" && s.base) return 1;
  if (s.tono === "ruta") return 2;
  return 3;
}

const comparador = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/** Compara matrículas como las lee una persona: 9266KKK antes que 9986CDL. */
export function compararMatricula(a: string, b: string): number {
  return comparador.compare(a ?? "", b ?? "");
}

/**
 * El número de unidad es un número escrito como texto («1096»). Se ordena
 * como número cuando lo es, y los que no lo tienen van al final: un hueco no
 * es un cero.
 */
export function compararUnidad(a: string | null, b: string | null): number {
  const va = (a ?? "").trim();
  const vb = (b ?? "").trim();
  if (!va && !vb) return 0;
  if (!va) return 1;
  if (!vb) return -1;
  return comparador.compare(va, vb);
}

export function compararPosicion(a: Sitio, b: Sitio): number {
  const ga = grupoDeSitio(a);
  const gb = grupoDeSitio(b);
  if (ga !== gb) return ga - gb;
  // Dentro del grupo, por nombre de base. Los dos últimos grupos no tienen
  // base, así que esto no los mueve.
  return comparador.compare(a.base ?? "", b.base ?? "");
}

export function ordenarPendientes(filas: FilaPendiente[], orden: OrdenPendientes): FilaPendiente[] {
  const copia = [...filas];
  copia.sort((a, b) => {
    if (orden === "unidad") {
      const porUnidad = compararUnidad(a.unidad, b.unidad);
      if (porUnidad !== 0) return porUnidad;
    } else if (orden === "posicion") {
      const porSitio = compararPosicion(a.sitio, b.sitio);
      if (porSitio !== 0) return porSitio;
    }
    // La matrícula es el desempate de todos y el orden por defecto: es lo
    // único que no se repite y evita que la lista baile entre dos cargas.
    return compararMatricula(a.matricula, b.matricula);
  });
  return copia;
}

/** Cuántos hay en cada grupo, para poder decirlo sin contar a ojo. */
export function recuentoPorGrupo(filas: FilaPendiente[]): { enBase: number; ultimaVez: number; enRuta: number; sinSenal: number } {
  const r = { enBase: 0, ultimaVez: 0, enRuta: 0, sinSenal: 0 };
  for (const f of filas) {
    const g = grupoDeSitio(f.sitio);
    if (g === 0) r.enBase += 1;
    else if (g === 1) r.ultimaVez += 1;
    else if (g === 2) r.enRuta += 1;
    else r.sinSenal += 1;
  }
  return r;
}
