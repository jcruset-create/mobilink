/**
 * El número de flota que el proveedor lleva escondido en el nombre.
 *
 * En Movertis, la flota de autobuses se nombra poniendo el número de bus
 * delante de la matrícula:
 *
 *   1807 7523-NNB      1808-8774-NMX      1810-7524-NNB
 *
 * Ese número es `tc_vehiculos.numero_unidad` —el «Nº de unidad (flota)» de la
 * ficha—, y en TyreControl estaba en blanco en media flota: el alta desde el
 * proveedor acepta el campo desde siempre, pero la pantalla nunca lo mandaba,
 * así que cada bus creado desde Movertis nacía sin él.
 *
 * ── Por qué no vale con «coge las cifras de delante» ────────────────────────
 *
 * Porque una matrícula española EMPIEZA por cifras. Si el proveedor nombra un
 * vehículo solo con su matrícula —`7523-NNB`—, esa regla propone 7523 como
 * número de bus, que no lo es: es media matrícula. Y un número de flota falso
 * es peor que el hueco, porque el hueco se ve y el falso se usa.
 *
 * Por eso se exige que lo que queda detrás del número SEA la matrícula del
 * vehículo. Es la comprobación que distingue «1807 7523-NNB» (número + placa)
 * de «7523-NNB» (placa a secas), y la que permite pisar un valor existente sin
 * que la propuesta salga de una corazonada.
 */

import { normalizarMatricula } from "../../tyrecontrol/matricula.ts";

/** Hasta seis cifras: una flota con números de siete no existe. */
const PATRON = /^(\d{1,6})[\s\-_/.]+(.+)$/;

/**
 * El número de flota que dice este nombre, o `null` si no lo dice.
 *
 * `matricula` es la del vehículo de TyreControl con el que ya está enlazado:
 * es lo que confirma que lo de delante es un número y no media placa.
 */
export function numeroDeFlotaDeNombre(
  nombre: unknown,
  matricula: unknown
): string | null {
  const encontrado = String(nombre ?? "").trim().match(PATRON);
  if (!encontrado) return null;

  const placa = normalizarMatricula(matricula);
  if (placa === "") return null;
  if (normalizarMatricula(encontrado[2]) !== placa) return null;

  // Sin ceros de relleno: «0042» y «42» son el mismo bus, y guardados
  // distintos son dos filas que no casan el día que se cruce con otra lista.
  const numero = String(Number(encontrado[1]));
  return numero === "0" ? null : numero;
}

/** Un vehículo enlazado, con lo justo para proponerle número. */
export interface VehiculoConNombre {
  vehiculoId: string;
  matricula: string;
  /** El nombre que el proveedor le da ahora mismo. */
  nombreProveedor: string | null;
  /** Lo que hay hoy en `numero_unidad`. */
  numeroActual: string | null;
}

export type TipoCambio =
  /** Estaba en blanco: se rellena. */
  | "rellena"
  /** Ya tenía otro número: el del proveedor lo pisa. */
  | "conflicto";

export interface CambioNumeroFlota {
  vehiculoId: string;
  matricula: string;
  nombreProveedor: string;
  numeroActual: string | null;
  numeroPropuesto: string;
  tipo: TipoCambio;
}

/**
 * Qué vehículos cambiarían, separando los huecos de los conflictos.
 *
 * Los que ya tienen el número que toca no salen: no son un cambio, y
 * enseñarlos escondería los pocos que sí lo son entre cientos que no.
 *
 * El conflicto se marca aparte a propósito. Pisar un número escrito a mano
 * puede estar bien —es lo que se pidió— pero no puede hacerse sin que se vea:
 * si alguien corrigió ese número porque el proveedor lo tenía mal, esto se lo
 * lleva por delante, y quien pulse tiene que poder verlo antes.
 */
export function cambiosDeNumeroFlota(
  vehiculos: VehiculoConNombre[]
): CambioNumeroFlota[] {
  const cambios: CambioNumeroFlota[] = [];
  for (const v of vehiculos) {
    const propuesto = numeroDeFlotaDeNombre(v.nombreProveedor, v.matricula);
    if (propuesto === null) continue;

    const actual = String(v.numeroActual ?? "").trim() || null;
    if (actual !== null && String(Number(actual)) === propuesto) continue;

    cambios.push({
      vehiculoId: v.vehiculoId,
      matricula: v.matricula,
      nombreProveedor: String(v.nombreProveedor),
      numeroActual: actual,
      numeroPropuesto: propuesto,
      tipo: actual === null ? "rellena" : "conflicto",
    });
  }
  return cambios;
}
