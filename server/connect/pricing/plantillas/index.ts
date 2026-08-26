/**
 * Plantillas de tarifario para una central que empieza.
 *
 * Quien compra la licencia se encuentra con un motor que sabe tarificar y una
 * base vacía. Estas plantillas le dan la ESTRUCTURA montada —las franjas, las
 * reglas, los suplementos y el calendario— para que solo tenga que poner sus
 * precios.
 *
 * ⚠ LAS PLANTILLAS NO TRAEN PRECIOS, Y ES A PROPÓSITO
 *
 * Todos los importes nacen a cero y la versión nace como borrador. La
 * tentación de meter "precios de mercado orientativos" es fuerte y es
 * exactamente el error que este motor lleva doce fases evitando: un número
 * inventado que alguien publica con prisa y acaba en una factura. Un cero se
 * ve, se corrige y —mientras tanto— la revisión previa a publicar lo canta.
 *
 * Lo que sí traen es lo que cuesta acertar y no depende del cliente: que el
 * nocturno cruce la medianoche bien, que el festivo gane al horario, que el
 * suplemento se dispare por umbral y no siempre, y que las prioridades no
 * empaten.
 *
 * Son DATOS. El motor no sabe que existen y añadir una plantilla es añadir un
 * fichero como este, sin tocar lógica.
 */

import type { DefinicionTarifario, DefDiaCalendario } from "../tarifario.ts";
import { festivosNacionales } from "./festivos.ts";

export interface Plantilla {
  code: string;
  nombre: string;
  /** Para quién es, en una línea, para poder elegir sin abrirla. */
  paraQuien: string;
  descripcion: string;
  /** Lo que hay que rellenar antes de publicar. Se enseña en la pantalla. */
  aRellenar: string[];
  construir(o: OpcionesPlantilla): DefinicionTarifario;
}

export interface OpcionesPlantilla {
  code: string;
  nombre: string;
  /** Año del calendario laboral que se genera. */
  anio: number;
  pais?: string;
  zonaHoraria?: string;
  moneda?: string;
  vigenteDesde?: string;
}

const base = (o: OpcionesPlantilla) => ({
  code: o.code,
  name: o.nombre,
  currency: o.moneda ?? "EUR",
  timezone: o.zonaHoraria ?? "Europe/Madrid",
  version: String(o.anio),
  vigenteDesde: o.vigenteDesde ?? `${o.anio}-01-01`,
  vigenteHasta: `${o.anio + 1}-01-01`,
  fuente: "Plantilla del sistema — los importes los pone la central",
});

function calendario(o: OpcionesPlantilla): { code: string; name: string; dias: DefDiaCalendario[] } {
  return {
    code: `${o.pais ?? "ES"}_${o.anio}`,
    name: `Calendario laboral ${o.anio}`,
    dias: festivosNacionales(o.pais ?? "ES", o.anio),
  };
}

const zonaPais = (o: OpcionesPlantilla) => [{
  code: o.pais ?? "ES",
  name: o.pais === "PT" ? "Portugal" : "España",
  type: "COUNTRY" as const,
  miembros: [{ tipo: "country" as const, valor: o.pais ?? "ES" }],
}];

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Asistencia en carretera 24 h.
 *
 * La estructura que usa casi todo el sector: un forfait por franja horaria, con
 * kilómetros y tiempo incluidos, y suplemento cuando se pasa del umbral. Los
 * festivos ganan al horario, y la Navidad y el Año Nuevo ganan al festivo.
 *
 * El fin de semana va como VENTANA CONTINUA (viernes noche → lunes por la
 * mañana) y no como "sábado y domingo", porque un servicio del viernes a las
 * 23:00 es de fin de semana aunque el viernes sea laborable. Es el detalle que
 * más se falla al configurar esto a mano.
 */
const CARRETERA: Plantilla = {
  code: "CARRETERA_24H",
  nombre: "Asistencia en carretera 24 h",
  paraQuien: "Central que despacha asistencia en carretera con forfait por franja horaria",
  descripcion:
    "Cinco forfaits (proximidad, diurno, nocturno, fin de semana y festivos señalados), " +
    "kilómetro y tiempo adicionales por umbral, y anulación con salida realizada.",
  aRellenar: [
    "El importe de cada uno de los cinco forfaits",
    "Los kilómetros y minutos que incluye cada forfait",
    "El precio del kilómetro adicional y de la hora adicional",
    "El porcentaje que se cobra por una anulación con salida realizada",
    "Los festivos autonómicos y locales de donde opere la central",
  ],

  construir(o) {
    const comun = {
      servicio: null, vehiculo: null, zona: o.pais ?? "ES",
      extraKm: "EXTRA_KM",
      disparoExtra: "THRESHOLD_PERCENT" as const,
      umbralPorcentaje: 20,
      importe: "0",
      incluyeKm: 0, incluyeMin: 0,
    };

    return {
      ...base(o),
      descripcion: "Asistencia en carretera con forfait por franja horaria",
      calendario: calendario(o),
      zonas: zonaPais(o),

      franjas: [
        { code: "DIURNO", name: "Diurno", desde: "08:00", hasta: "19:00", dias: [1, 2, 3, 4, 5] },
        {
          code: "NOCTURNO", name: "Nocturno de lunes a viernes",
          desde: "19:00", hasta: "08:00", dias: [1, 2, 3, 4],
          anclajeDia: "band_start",
        },
        {
          code: "FIN_SEMANA_INICIO", name: "Viernes noche",
          desde: "19:00", hasta: "08:00", dias: [5], anclajeDia: "band_start",
        },
        {
          code: "FIN_SEMANA_FIN", name: "Madrugada del lunes",
          desde: "00:00", hasta: "08:00", dias: [1], anclajeDia: "moment",
        },
      ],

      extras: [
        { code: "EXTRA_KM", name: "Kilómetro adicional", calculo: "PER_KM", importe: "0", unidad: "km", tipoLinea: "EXTRA_KM" },
        { code: "EXTRA_TIME_DAY", name: "Hora adicional diurna", calculo: "PER_HOUR", importe: "0", unidad: "h", tipoLinea: "EXTRA_TIME" },
        { code: "EXTRA_TIME_NIGHT", name: "Hora adicional nocturna o festiva", calculo: "PER_HOUR", importe: "0", unidad: "h", tipoLinea: "EXTRA_TIME" },
        { code: "CANCELLATION", name: "Anulación con salida realizada", calculo: "PERCENTAGE", porcentaje: "0", aplicaA: "forfait", tipoLinea: "CANCELLATION" },
      ],

      reglas: [
        { ...comun, code: "FESTIVO_EXTRA", name: "Festivos señalados",
          franja: null, clasesDia: ["christmas", "new_year"],
          extraTiempo: "EXTRA_TIME_NIGHT", prioridad: 100 },
        { ...comun, code: "FESTIVO", name: "Festivos y fin de semana",
          franja: null, clasesDia: ["holiday", "saturday", "sunday"],
          extraTiempo: "EXTRA_TIME_NIGHT", prioridad: 90 },
        { ...comun, code: "FESTIVO_ENTRADA", name: "Fin de semana (viernes noche)",
          franja: "FIN_SEMANA_INICIO", clasesDia: null,
          extraTiempo: "EXTRA_TIME_NIGHT", prioridad: 85 },
        { ...comun, code: "FESTIVO_SALIDA", name: "Fin de semana (madrugada del lunes)",
          franja: "FIN_SEMANA_FIN", clasesDia: null,
          extraTiempo: "EXTRA_TIME_NIGHT", prioridad: 84 },
        { ...comun, code: "NOCTURNO", name: "Nocturno",
          franja: "NOCTURNO", clasesDia: null,
          extraTiempo: "EXTRA_TIME_NIGHT", prioridad: 50 },
        { ...comun, code: "DIURNO_PROX", name: "Diurno proximidad",
          franja: "DIURNO", clasesDia: null, maxKm: 30, maxMin: 90,
          extraTiempo: "EXTRA_TIME_DAY", prioridad: 45 },
        { ...comun, code: "DIURNO", name: "Diurno",
          franja: "DIURNO", clasesDia: null,
          extraTiempo: "EXTRA_TIME_DAY", prioridad: 40 },
      ],
    };
  },
};

/**
 * Servicios en taller.
 *
 * Sin franjas nocturnas ni festivos: lo que se hace en horario comercial de
 * taller. Fuera de ese horario deja de ser un servicio de taller y pasa a ser
 * asistencia en carretera, que es otro tarifario.
 */
const TALLER: Plantilla = {
  code: "TALLER",
  nombre: "Servicios en taller",
  paraQuien: "Trabajos hechos en el taller, en horario comercial",
  descripcion: "Un precio por tipo de trabajo, sin forfait de desplazamiento ni suplementos por horario.",
  aRellenar: [
    "El precio de cada trabajo",
    "El horario comercial, si no es de 08:00 a 19:00 de lunes a viernes",
  ],

  construir(o) {
    const comun = {
      servicio: null, vehiculo: null, zona: o.pais ?? "ES",
      franja: "COMERCIAL", clasesDia: null,
      importe: "0", incluyeKm: null, incluyeMin: null,
      extraKm: null, extraTiempo: null,
      disparoExtra: "ALWAYS" as const,
    };

    return {
      ...base(o),
      descripcion: "Trabajos realizados en el taller",
      calendario: calendario(o),
      zonas: zonaPais(o),
      franjas: [
        { code: "COMERCIAL", name: "Horario comercial", desde: "08:00", hasta: "19:00", dias: [1, 2, 3, 4, 5] },
      ],
      extras: [
        { code: "MATERIAL", name: "Material", calculo: "PER_UNIT", importe: "0", unidad: "ud", tipoLinea: "MATERIAL" },
      ],
      reglas: [
        { ...comun, code: "TRABAJO", name: "Trabajo en taller", prioridad: 10 },
      ],
    };
  },
};

/**
 * Mínima: un forfait plano.
 *
 * Para la central que cobra lo mismo siempre, o para empezar por algo y
 * construir encima. No trae franjas: la regla aplica a cualquier hora.
 */
const MINIMA: Plantilla = {
  code: "MINIMA",
  nombre: "Precio único",
  paraQuien: "Central que cobra lo mismo a cualquier hora, o para empezar de cero",
  descripcion: "Un solo forfait sin franjas horarias, con kilómetro adicional.",
  aRellenar: ["El importe del forfait", "Los kilómetros incluidos y el precio del kilómetro adicional"],

  construir(o) {
    return {
      ...base(o),
      descripcion: "Forfait único",
      calendario: calendario(o),
      zonas: zonaPais(o),
      franjas: [],
      extras: [
        { code: "EXTRA_KM", name: "Kilómetro adicional", calculo: "PER_KM", importe: "0", unidad: "km", tipoLinea: "EXTRA_KM" },
      ],
      reglas: [
        {
          code: "SERVICIO", name: "Servicio",
          servicio: null, vehiculo: null, zona: o.pais ?? "ES",
          franja: null, clasesDia: null,
          importe: "0", incluyeKm: 0, incluyeMin: null,
          extraKm: "EXTRA_KM", extraTiempo: null,
          disparoExtra: "THRESHOLD_PERCENT", umbralPorcentaje: 20,
          prioridad: 10,
        },
      ],
    };
  },
};

export const PLANTILLAS: Plantilla[] = [CARRETERA, TALLER, MINIMA];

export function plantilla(code: string): Plantilla | null {
  return PLANTILLAS.find((p) => p.code === code) ?? null;
}

/** Lo que necesita la pantalla para dejar elegir sin cargar nada. */
export function catalogoPlantillas() {
  return PLANTILLAS.map((p) => ({
    code: p.code, nombre: p.nombre, paraQuien: p.paraQuien,
    descripcion: p.descripcion, aRellenar: p.aRellenar,
  }));
}
