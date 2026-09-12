/**
 * El kilometraje que se le pone a una revisión del CheckPoint.
 *
 * El arco de Bridgestone lee presión y profundidad de todas las ruedas al pasar
 * el autobús, y **no lee kilómetros**. Su informe entra solo por correo
 * (`server/checkpointMail.ts`) días después de la medición, así que las
 * revisiones que crea el importador nacían con `km_vehiculo` a null. Sin ese
 * número no hay desgaste por 1.000 km, ni planes por km fieles, ni «este
 * neumático se montó a 512.480 y se desmontó a 578.864».
 *
 * Lo que el arco SÍ da es el instante (`medido_at`) y la matrícula. Los
 * kilómetros salen de la telemática, siempre.
 *
 * ── Por qué no sirve el puente que ya existe ────────────────────────────────
 *
 * `kilometrajeOperacion.ts` resuelve el caso hermano —el kilometraje de un
 * montaje o un desmontaje— llamando a `kilometrajeEnOperacion`, que pide una
 * ventana de ±60 min y elige la lectura con odómetro más próxima. Con Movertis
 * eso devuelve `sin_lectura` siempre que el instante sea de hace horas: su
 * histórico (`showtrips`) son POSICIONES, sin odómetro. Y el instante del arco
 * es, por definición, de hace días.
 *
 * Por eso aquí se usa `kilometrajeSiSigueParado`, que le da la vuelta al
 * problema: las posiciones no sirven para calcular kilómetros y sí para
 * demostrar que el vehículo NO se ha movido. Y si no se ha movido, el odómetro
 * de ahora es el de entonces.
 *
 * ── Un informe de presiones no se cae porque falte un kilometraje ───────────
 *
 * Esto NUNCA lanza. Si la telemática está caída, si el vehículo no está
 * enlazado o si se movió después de la medición, devuelve `km: null` y una nota
 * que dice por qué. La importación del CheckPoint trae profundidades y presiones
 * de toda la flota, y perderla porque Movertis no conteste sería cambiar un dato
 * que falta por un informe entero que se pierde.
 */

/*
 * El Hub se importa DENTRO de la función, no arriba, por lo mismo que en
 * `kilometrajeOperacion.ts`: `VehicleOdometerService` arrastra
 * `repositories.ts` → `db.ts`, y `db.ts` LANZA al importarse si no hay
 * `DATABASE_URL`. Con un import estático, cualquier módulo de TyreControl que
 * tocara este fichero dejaría de poder cargarse sin la base del Hub, cosa que
 * TyreControl no necesita porque habla por Supabase.
 */
type ServicioOdometro = typeof import("../integration-hub/application/services/VehicleOdometerService.ts");

async function servicioDelHub(): Promise<ServicioOdometro> {
  return import("../integration-hub/application/services/VehicleOdometerService.ts");
}

/** Lo que se escribe en la revisión, y la explicación de por qué. */
export interface KilometrajeRevision {
  /** Lo que va a `revisiones_vehiculo.km_vehiculo`. `null` si no hay dato fiable. */
  km: number | null;
  /** Lo que va a `origen_km`. Solo se escribe cuando hay número. */
  origen: "telematica" | null;
  /** Lo que va a `km_capturado_at`: cuándo leyó el proveedor ese odómetro. */
  capturadoAt: Date | null;
  /** Lo que va a `km_desfase_min`, con signo: negativo si la lectura es anterior. */
  desfaseMin: number | null;
  /**
   * Explicación en una línea, siempre rellena.
   *
   * También cuando hay kilometraje: un número sin su procedencia ni su desfase
   * es justo lo que el Telematics Hub existe para no producir.
   */
  nota: string;
}

/** Redacta el desfase como lo leería una persona. */
function desfase(minutos: number): string {
  if (minutos === 0) return "en el mismo minuto";
  const abs = Math.abs(minutos);
  if (abs < 120) return minutos < 0 ? `${abs} min antes` : `${abs} min después`;
  const horas = Math.round(abs / 60);
  if (horas < 48) return minutos < 0 ? `${horas} h antes` : `${horas} h después`;
  const dias = Math.round(horas / 24);
  return minutos < 0 ? `${dias} días antes` : `${dias} días después`;
}

/**
 * Kilometraje del vehículo en el momento en que el arco lo midió, o `null` con
 * el motivo.
 *
 * `tcEmpresaId` es el tenant del Hub: el gestor de secretos y los mapeos de
 * telemática ya son por empresa, así que no hay traducción que hacer.
 */
export async function kilometrajeParaRevision(params: {
  tcEmpresaId: string;
  tcVehicleId: string;
  /** Instante en que el arco midió: `revisiones_vehiculo.medido_at`. */
  medidoAt: Date;
  /** Para poder seguir el rastro. */
  correlationId: string;
}): Promise<KilometrajeRevision> {
  const sinDato = (nota: string): KilometrajeRevision => ({
    km: null, origen: null, capturadoAt: null, desfaseMin: null, nota,
  });

  let resultado;
  try {
    const { kilometrajeSiSigueParado } = await servicioDelHub();
    resultado = await kilometrajeSiSigueParado(
      { tenantId: params.tcEmpresaId, correlationId: params.correlationId },
      params.tcVehicleId,
      params.medidoAt,
    );
  } catch (e) {
    return sinDato(`Sin kilometraje: la telemática falló (${(e as Error)?.message ?? e}).`);
  }

  switch (resultado.estado) {
    case "encontrado": {
      const k = resultado.kilometraje;
      const origen = k.odometerSource === "gps" ? " (odómetro por GPS, no del salpicadero)" : "";
      const prueba =
        k.prueba.estado === "quieto"
          ? `el vehículo no se movió de donde estaba (${k.prueba.puntos} posiciones, ` +
            `máximo ${Math.round(k.prueba.desplazamientoMaxM)} m)`
          : "la lectura es anterior a la medición, así que no puede llevar kilómetros posteriores";
      return {
        km: k.odometerKm,
        origen: "telematica",
        capturadoAt: k.capturedAt,
        desfaseMin: k.deltaMinutos,
        nota:
          `Kilometraje ${k.odometerKm} km de ${k.provider}/${k.accountKey}${origen}, ` +
          `leído ${desfase(k.deltaMinutos)} de la medición: ${prueba}.`,
      };
    }
    case "se_movio":
      // La negativa razonada. Se distingue de «no había lectura» a propósito:
      // aquí SÍ hay un odómetro, lo que pasa es que lleva kilómetros que este
      // neumático no había hecho cuando se le midió la profundidad.
      return sinDato(
        "Sin kilometraje: el vehículo salió después de la medición, así que el odómetro " +
          `de ahora incluye kilómetros que aún no había hecho (${resultado.motivo}).`,
      );
    case "sin_lectura":
      return sinDato(
        "Sin kilometraje: se preguntó a " + resultado.cuentasConsultadas.join(", ") +
          " y no hay ninguna lectura con odómetro que se pueda atribuir a ese momento.",
      );
    case "sin_telematica":
      return sinDato(
        "Sin kilometraje: este vehículo no está enlazado con ninguna cuenta de telemática. " +
          "Se enlaza desde la pantalla de conciliación telemática.",
      );
    case "no_disponible":
      return sinDato(`Sin kilometraje: no se pudo consultar la telemática (${resultado.motivo}).`);
  }
}
