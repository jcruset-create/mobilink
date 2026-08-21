/**
 * Casador de extracto bancario contra los ingresos de MC Central.
 *
 * Sin base de datos: recibe los movimientos del banco y los ingresos
 * registrados, y propone parejas. Es el mismo patrón que el motor de reglas, y
 * por el mismo motivo: lo que decide si dos apuntes son el mismo dinero tiene
 * que poder probarse a mano y en un milisegundo.
 *
 * ## Por qué «asistida» y no automática
 *
 * El casador **propone, no concilia**. Un ingreso de 1.500 € el día 3 y un
 * apunte de 1.500 € el día 3 casi siempre son lo mismo… salvo cuando ese día se
 * hicieron dos ingresos de 1.500 €. Conciliar automáticamente ahí es equivocarse
 * la mitad de las veces sin que nadie lo sepa. Así que:
 *
 * · Coincidencia **única** por importe y fecha cercana → propuesta **ALTA**.
 * · Varias candidatas igual de buenas → **AMBIGUA**, y las enseña todas.
 * · Coincide el importe pero no la fecha, o al revés → **BAJA**.
 *
 * Confirmar siempre es de una persona. Lo que hace el casador es que confirmar
 * cueste un clic en vez de media mañana con dos pantallas abiertas.
 */

export type ApunteBanco = {
  id: string;
  fecha: string;
  importeCentimos: number;
  concepto: string;
  referencia: string;
};

export type IngresoRegistrado = {
  depositId: number;
  numero: string;
  fecha: string | null;
  importeCentimos: number;
  referencia: string | null;
};

export type Confianza = "ALTA" | "AMBIGUA" | "BAJA";

export type Propuesta = {
  apunteId: string;
  confianza: Confianza;
  candidatos: { depositId: number; numero: string; motivo: string }[];
};

/** Días de margen entre la fecha del ingreso y la del apunte del banco. */
export const MARGEN_DIAS = 4;

function diasEntre(a: string, b: string): number {
  const ms = Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : Math.round(ms / 86_400_000);
}

/** Normaliza una referencia para compararla: el banco recorta y cambia el caso. */
const refNormal = (r: string | null | undefined) =>
  (r ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Propone parejas para cada apunte de entrada de dinero.
 *
 * Los apuntes de salida no se miran: un ingreso de caja siempre entra en la
 * cuenta. Mirarlos solo produciría propuestas absurdas contra comisiones y
 * recibos domiciliados.
 */
export function proponer(
  apuntes: readonly ApunteBanco[],
  ingresos: readonly IngresoRegistrado[]
): Propuesta[] {
  return apuntes
    .filter((a) => a.importeCentimos > 0)
    .map((apunte) => {
      /*
       * La referencia manda sobre todo lo demás.
       *
       * Si el número del ingreso —`TAR1-IB-26-001`— aparece en el concepto o en
       * la referencia del banco, es que alguien lo escribió al hacer el ingreso,
       * y eso no es una coincidencia: es una identificación. Gana aunque el
       * importe no cuadre al céntimo, porque una comisión descontada es más
       * probable que dos números iguales por azar.
       */
      const texto = refNormal(`${apunte.concepto} ${apunte.referencia}`);
      const porReferencia = ingresos.filter(
        (i) => refNormal(i.numero).length >= 6 && texto.includes(refNormal(i.numero))
      );

      if (porReferencia.length === 1) {
        return {
          apunteId: apunte.id,
          confianza: "ALTA" as const,
          candidatos: [
            {
              depositId: porReferencia[0].depositId,
              numero: porReferencia[0].numero,
              motivo: "El número del ingreso aparece en el concepto del banco.",
            },
          ],
        };
      }

      const mismoImporte = ingresos.filter((i) => i.importeCentimos === apunte.importeCentimos);
      const cerca = mismoImporte.filter(
        (i) => i.fecha != null && diasEntre(i.fecha, apunte.fecha) <= MARGEN_DIAS
      );

      if (cerca.length === 1) {
        return {
          apunteId: apunte.id,
          confianza: "ALTA" as const,
          candidatos: [
            {
              depositId: cerca[0].depositId,
              numero: cerca[0].numero,
              motivo: "Mismo importe y fecha cercana, y no hay otro que encaje.",
            },
          ],
        };
      }

      if (cerca.length > 1) {
        return {
          apunteId: apunte.id,
          confianza: "AMBIGUA" as const,
          candidatos: cerca.map((i) => ({
            depositId: i.depositId,
            numero: i.numero,
            motivo: "Mismo importe y fecha; hay varios iguales y hay que elegir.",
          })),
        };
      }

      // Ni referencia ni fecha cercana: queda el importe suelto, que por sí solo
      // no basta pero orienta.
      return {
        apunteId: apunte.id,
        confianza: "BAJA" as const,
        candidatos: mismoImporte.map((i) => ({
          depositId: i.depositId,
          numero: i.numero,
          motivo: "Coincide el importe, pero la fecha queda lejos.",
        })),
      };
    });
}

/** Resumen para la pantalla: cuántos se pueden confirmar de un golpe. */
export function resumir(propuestas: readonly Propuesta[]) {
  return {
    total: propuestas.length,
    altas: propuestas.filter((p) => p.confianza === "ALTA").length,
    ambiguas: propuestas.filter((p) => p.confianza === "AMBIGUA").length,
    sinPareja: propuestas.filter((p) => p.candidatos.length === 0).length,
  };
}
