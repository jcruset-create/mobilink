/**
 * De «2x4x2» a los ejes de un vehículo.
 *
 * Es la misma lectura que hace la tablet en el alta (`ConfiguracionEjes`):
 * cada número son las RUEDAS de ese eje, de delante hacia atrás. Un autobús
 * 2x4x2 lleva 2 ruedas en el eje 1, 4 en el 2 y 2 en el 3.
 *
 * Vive aquí, en el servidor, porque el alta en lote de la conciliación crea
 * los ejes de decenas de vehículos de una vez y no puede fiarse de que el
 * navegador los mande bien: lo que llega de fuera se comprueba.
 */

export interface EjeDeVehiculo {
  eje: number;
  ruedas: number;
}

/** Las ruedas que Mobilink sabe dibujar en un eje. */
const RUEDAS_VALIDAS = [2, 4];

/**
 * Los ejes de una configuración, o null si no se entiende.
 *
 * Devuelve null y no una lista a medias: con un texto raro —«tridem», «3
 * ejes», «2-4-2»— es mejor no crear ningún eje que crear unos inventados que
 * luego nadie revisa y que descuadran el plano del vehículo.
 */
export function ejesDeConfiguracion(config: string | null | undefined): EjeDeVehiculo[] | null {
  const texto = (config ?? "").trim().toLowerCase();
  if (!texto) return null;

  const partes = texto.split("x");
  if (partes.length < 1) return null;

  const ejes: EjeDeVehiculo[] = [];
  for (let i = 0; i < partes.length; i++) {
    const n = Number(partes[i].trim());
    if (!Number.isInteger(n) || !RUEDAS_VALIDAS.includes(n)) return null;
    ejes.push({ eje: i + 1, ruedas: n });
  }
  // Un vehículo de un solo eje no existe en esta flota; casi siempre es un
  // texto mal escrito que por casualidad es un número válido.
  return ejes.length >= 2 ? ejes : null;
}
