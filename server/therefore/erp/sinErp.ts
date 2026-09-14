/**
 * La implementación de serie del puerto del ERP: no lo sé.
 *
 * Devuelve `null` siempre, que en el contrato significa «no tengo forma de
 * saberlo», y no `existe: false`, que significaría «he mirado y el albarán no
 * está». La diferencia importa: con lo segundo, la pantalla diría que el
 * albarán falta del ERP cuando lo que pasa es que nadie ha preguntado.
 *
 * `disponible()` en `false` hace que la pantalla ni siquiera ofrezca la
 * consulta y escriba «sin datos del ERP». Un botón que siempre contesta lo
 * mismo enseña a no pulsarlo, y el día que funcione ya nadie lo usará.
 */

import type { ConsultaAlbaranesErp, EstadoAlbaranErp } from "./puerto.ts";

export const sinErp: ConsultaAlbaranesErp = {
  fuente: "ninguna",
  disponible: () => false,
  // Sin parámetros: no se usan, y declararlos sólo para ignorarlos haría creer
  // que aquí hay una consulta que depende de algo.
  async consultarAlbaran(): Promise<EstadoAlbaranErp | null> {
    return null;
  },
};

/**
 * Quién contesta a las preguntas sobre albaranes.
 *
 * Una función y no una constante para que el día que haya un adaptador de
 * verdad se decida aquí —mirando la configuración de la empresa— sin tocar a
 * quien la llama. Hoy no recibe la empresa porque no hay nada que decidir con
 * ella; el día que lo haya, se le añade el parámetro y nada más cambia.
 */
export function consultaErpDe(): ConsultaAlbaranesErp {
  return sinErp;
}
