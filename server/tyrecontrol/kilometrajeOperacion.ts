/**
 * El kilometraje que se manda a TyreControl en una operación de neumático.
 *
 * Es el puente entre el Telematics Hub (fase 8) y el vocabulario de
 * TyreControl. Existe porque los dos sitios que construyen llamadas al RPC
 * llevaban el mismo `p_km: null` con el mismo comentario:
 *
 *   «Sin odómetro fiable no se manda: `serviceKm` son los km del
 *    desplazamiento, no el cuentakilómetros del vehículo.»
 *
 * Ese comentario no describía una tarea pendiente de hacer, describía una
 * ausencia: no había odómetro fiable que mandar. Ahora lo hay —con su
 * procedencia, su desfase y su peldaño de tolerancia—, así que el null deja de
 * ser la única respuesta honesta para las operaciones en las que el
 * cuentakilómetros significa algo.
 *
 * ── Dónde SÍ y dónde NO ─────────────────────────────────────────────────────
 *
 * En un montaje o un desmontaje el odómetro del vehículo es exactamente el
 * dato que se busca: marca el principio y el final de la vida útil de ese
 * neumático en esa posición.
 *
 * En una reparación EN TALLER no. El neumático ya está desmontado, a veces
 * desde hace días, y el vehículo ha seguido rodando sin él. Mandar ahí el
 * cuentakilómetros de hoy no completaría el dato: lo falsearía, atribuyendo al
 * neumático kilómetros que no hizo. Por eso `repararEnTaller` sigue mandando
 * null, y ahora se dice por qué en vez de dejarlo a la interpretación del que
 * pase por allí.
 *
 * ── La telemática no puede tumbar una sustitución ───────────────────────────
 *
 * Si el proveedor está caído o el vehículo no está enlazado, esto devuelve
 * `null` y una nota. NUNCA lanza. Una sustitución de neumático que fallara
 * porque Webfleet no contesta sería un fallo peor que el que evita: el
 * kilometraje es un dato valioso del registro, no un requisito para cambiar
 * una rueda.
 */

/*
 * El Hub se importa DENTRO de la función, no arriba, y no es una manía.
 *
 * `VehicleOdometerService` arrastra `repositories.ts`, que arrastra `db.ts`, y
 * `db.ts` LANZA al importarse si no hay `DATABASE_URL`. Con un import estático,
 * cualquier módulo de TyreControl que tocara este fichero dejaba de poder
 * cargarse sin la base del Hub —cosa que TyreControl no necesita, porque habla
 * por Supabase—, y se caía en la importación, antes de ejecutar nada.
 *
 * Diferirlo deja el acoplamiento donde corresponde: solo hay que tener la base
 * del Hub si de verdad se va a preguntar un kilometraje.
 */
type ServicioOdometro = typeof import("../integration-hub/application/services/VehicleOdometerService.ts");

async function servicioDelHub(): Promise<ServicioOdometro> {
  return import("../integration-hub/application/services/VehicleOdometerService.ts");
}

export type KilometrajeOperacion = {
  /** Lo que se manda como `p_km`. `null` si no hay dato fiable. */
  km: number | null;
  /**
   * Explicación en una línea, para los avisos del simulacro y el registro.
   *
   * Siempre se rellena, también cuando hay kilometraje: un número sin su
   * procedencia ni su desfase es justo lo que la fase 8 evita producir.
   */
  nota: string;
};

/** Redacta el desfase como lo leería una persona. */
function desfase(minutos: number): string {
  if (minutos === 0) return "en el mismo minuto";
  const abs = Math.abs(minutos);
  return minutos < 0 ? `${abs} min antes` : `${abs} min después`;
}

/**
 * Kilometraje del vehículo en el instante de una operación de montaje o
 * desmontaje, o `null` con el motivo.
 *
 * `tcEmpresaId` es el tenant del Hub: el gestor de secretos y los mapeos de
 * telemática ya son por empresa, así que no hay traducción que hacer.
 */
export async function kilometrajeParaMontaje(params: {
  tcEmpresaId: string;
  tcVehicleId: string;
  /** Instante de la operación. Por defecto, ahora. */
  at?: Date;
  /** Para poder seguir el rastro; se construye a partir de lo que la originó. */
  correlationId: string;
}): Promise<KilometrajeOperacion> {
  const at = params.at ?? new Date();

  let resultado;
  try {
    const { kilometrajeEnOperacion } = await servicioDelHub();
    resultado = await kilometrajeEnOperacion(
      { tenantId: params.tcEmpresaId, correlationId: params.correlationId },
      params.tcVehicleId,
      at,
    );
  } catch (e) {
    // Un fallo inesperado del Hub tampoco tumba la operación.
    return { km: null, nota: `Sin kilometraje: la telemática falló (${(e as Error)?.message ?? e}).` };
  }

  switch (resultado.estado) {
    case "encontrado": {
      const k = resultado.kilometraje;
      const origen = k.odometerSource === "gps" ? " (odómetro por GPS, no del salpicadero)" : "";
      return {
        km: k.odometerKm,
        nota:
          `Kilometraje ${k.odometerKm} km de ${k.provider}/${k.accountKey}${origen}, ` +
          `leído ${desfase(k.deltaMinutos)} de la operación (tolerancia ±${k.toleranciaMin} min).`,
      };
    }
    case "sin_lectura":
      return {
        km: null,
        nota:
          "Sin kilometraje: se preguntó a " + resultado.cuentasConsultadas.join(", ") +
          " y no hay ninguna lectura en la hora anterior ni posterior. " +
          "Es lo normal en un vehículo parado en el taller.",
      };
    case "sin_telematica":
      return { km: null, nota: "Sin kilometraje: este vehículo no está enlazado con ninguna cuenta de telemática." };
    case "no_disponible":
      return { km: null, nota: `Sin kilometraje: no se pudo consultar la telemática (${resultado.motivo}).` };
  }
}
