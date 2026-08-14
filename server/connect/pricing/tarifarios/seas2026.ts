/**
 * SEAS Nacional 2026 — datos, no código.
 *
 * Este fichero no tiene lógica y el motor no sabe que existe. Cargar el
 * tarifario de otro cliente es escribir otro fichero como este y pasárselo al
 * mismo cargador. Ese es el criterio de éxito nº 1 y nº 3 del encargo, y la
 * forma de comprobarlo es que en `server/connect/pricing/` no aparece la
 * palabra SEAS en ningún sitio salvo aquí.
 *
 * ⚠ ORIGEN DE LOS NÚMEROS
 *
 * Los importes vienen del enunciado del encargo, NO del tarifario original.
 * El propio encargo pide contrastarlos con el documento fuente antes de dar la
 * carga por definitiva, así que la versión nace como BORRADOR y no factura
 * nada hasta que alguien la publique a conciencia.
 *
 * Lo que hay que confirmar contra el documento:
 *
 *  1. Los importes de los cinco forfaits y de los cuatro suplementos.
 *  2. Si el nocturno de lunes a viernes cubre la madrugada del sábado. Aquí se
 *     ha puesto que NO (anclaje 'moment'): el sábado a las 02:00 es sábado. Si
 *     el tarifario dice lo contrario, se cambia `anclajeDia` a 'band_start'.
 *  3. Qué días entran en "festivos extra". Aquí solo el 25 de diciembre y el 1
 *     de enero.
 *  4. Si el tiempo extra nocturno se aplica también en festivo, y si el umbral
 *     del 20 % vale igual para kilómetros y para tiempo.
 *  5. Los precios de neumático y los descuentos sobre baremo, que aquí van dos
 *     de muestra para poder probar los dos modelos.
 *
 * Los festivos nacionales de 2026 son los del calendario laboral estatal. Los
 * autonómicos y locales NO están: dependen de dónde opere cada central y se
 * cargan aparte.
 */

import type { DefinicionTarifario } from "../tarifario.ts";

/** Suplementos y forfaits comparten estas condiciones. */
const CAMION = "truck";
const NEUMATICO = "tyres";

export const SEAS_2026: DefinicionTarifario = {
  code: "SEAS_NACIONAL",
  name: "SEAS Nacional",
  descripcion: "Tarifario nacional de asistencia en carretera para vehículo industrial",
  currency: "EUR",
  timezone: "Europe/Madrid",
  version: "2026",
  vigenteDesde: "2026-01-01",
  vigenteHasta: "2027-01-01",
  fuente: "Enunciado del encargo (pendiente de contrastar con el tarifario original)",

  calendario: {
    code: "ES_2026",
    name: "Calendario laboral estatal 2026",
    dias: [
      // Días con tarifa propia: tienen que poder ganar al festivo general
      { fecha: "2026-12-25", ambito: "special", clase: "christmas", nombre: "Navidad", anual: true },
      { fecha: "2026-01-01", ambito: "special", clase: "new_year", nombre: "Año Nuevo", anual: true },

      // Festivos nacionales
      { fecha: "2026-01-06", ambito: "national", nombre: "Epifanía del Señor", anual: true },
      { fecha: "2026-04-03", ambito: "national", nombre: "Viernes Santo" },
      { fecha: "2026-05-01", ambito: "national", nombre: "Fiesta del Trabajo", anual: true },
      { fecha: "2026-08-15", ambito: "national", nombre: "Asunción de la Virgen", anual: true },
      { fecha: "2026-10-12", ambito: "national", nombre: "Fiesta Nacional de España", anual: true },
      { fecha: "2026-11-02", ambito: "national", nombre: "Todos los Santos (trasladado)" },
      { fecha: "2026-12-07", ambito: "national", nombre: "Día de la Constitución (trasladado)" },
      { fecha: "2026-12-08", ambito: "national", nombre: "Inmaculada Concepción", anual: true },
    ],
  },

  franjas: [
    {
      code: "DIURNO", name: "Diurno",
      desde: "08:00", hasta: "19:00", dias: [1, 2, 3, 4, 5],
    },
    {
      code: "NOCTURNO", name: "Nocturno",
      desde: "19:00", hasta: "08:00", dias: [1, 2, 3, 4, 5],
      // Pendiente de confirmar: con 'moment', el sábado a las 02:00 es sábado
      // y no entra en el nocturno de lunes a viernes.
      anclajeDia: "moment",
    },
  ],

  zonas: [
    {
      code: "ES", name: "España", type: "COUNTRY",
      miembros: [{ tipo: "country", valor: "ES" }],
    },
  ],

  extras: [
    { code: "EXTRA_KM", name: "Kilómetro adicional", calculo: "PER_KM", importe: "1.25", unidad: "km", tipoLinea: "EXTRA_KM" },
    { code: "EXTRA_TIME_DAY", name: "Tiempo adicional diurno", calculo: "PER_HOUR", importe: "50", unidad: "h", tipoLinea: "EXTRA_TIME" },
    { code: "EXTRA_TIME_NIGHT", name: "Tiempo adicional nocturno o festivo", calculo: "PER_HOUR", importe: "80", unidad: "h", tipoLinea: "EXTRA_TIME" },
    { code: "ADDITIONAL_TIRE", name: "Neumático adicional", calculo: "PER_UNIT", importe: "60", unidad: "ud", tipoLinea: "ADDITIONAL_TIRE" },
    { code: "CANCELLATION", name: "Anulación con salida realizada", calculo: "PERCENTAGE", porcentaje: "50", aplicaA: "forfait", tipoLinea: "CANCELLATION" },
  ],

  /*
   * Prioridades: lo más excepcional gana. Navidad por encima de festivo, y
   * festivo por encima del horario, porque un festivo a las 22:00 se cobra
   * como festivo y no como nocturno.
   */
  reglas: [
    {
      code: "FESTIVO_EXTRA", name: "Festivos extra (Navidad y Año Nuevo)",
      servicio: NEUMATICO, vehiculo: CAMION, zona: "ES",
      franja: null, clasesDia: ["christmas", "new_year"],
      importe: "424", incluyeKm: 100, incluyeMin: 180,
      extraKm: "EXTRA_KM", extraTiempo: "EXTRA_TIME_NIGHT",
      disparoExtra: "THRESHOLD_PERCENT", umbralPorcentaje: 20,
      prioridad: 100,
    },
    {
      code: "FESTIVO", name: "Festivos",
      servicio: NEUMATICO, vehiculo: CAMION, zona: "ES",
      franja: null, clasesDia: ["holiday", "sunday"],
      importe: "331", incluyeKm: 100, incluyeMin: 180,
      extraKm: "EXTRA_KM", extraTiempo: "EXTRA_TIME_NIGHT",
      disparoExtra: "THRESHOLD_PERCENT", umbralPorcentaje: 20,
      prioridad: 90,
    },
    {
      code: "NOCTURNO", name: "Nocturno",
      servicio: NEUMATICO, vehiculo: CAMION, zona: "ES",
      franja: "NOCTURNO", clasesDia: null,
      importe: "331", incluyeKm: 100, incluyeMin: 180,
      extraKm: "EXTRA_KM", extraTiempo: "EXTRA_TIME_NIGHT",
      disparoExtra: "THRESHOLD_PERCENT", umbralPorcentaje: 20,
      prioridad: 50,
    },
    {
      code: "DIURNO_PROX", name: "Diurno proximidad",
      servicio: NEUMATICO, vehiculo: CAMION, zona: "ES",
      franja: "DIURNO", clasesDia: null,
      maxKm: 30, maxMin: 90,
      importe: "110", incluyeKm: 30, incluyeMin: 90,
      extraKm: "EXTRA_KM", extraTiempo: "EXTRA_TIME_DAY",
      disparoExtra: "THRESHOLD_PERCENT", umbralPorcentaje: 20,
      prioridad: 45,
    },
    {
      code: "DIURNO", name: "Diurno",
      servicio: NEUMATICO, vehiculo: CAMION, zona: "ES",
      franja: "DIURNO", clasesDia: null,
      importe: "198", incluyeKm: 100, incluyeMin: 180,
      extraKm: "EXTRA_KM", extraTiempo: "EXTRA_TIME_DAY",
      disparoExtra: "THRESHOLD_PERCENT", umbralPorcentaje: 20,
      prioridad: 40,
    },
  ],

  gruposMarca: [
    { code: "PREMIUM", name: "Premium", marcas: ["Michelin", "Bridgestone", "Continental", "Goodyear"] },
    { code: "EUROPEAN_1", name: "Europeas 1", marcas: ["Pirelli", "Dunlop", "Firestone", "Fulda"] },
    { code: "IMPORT_1", name: "Importación 1", marcas: ["Hankook", "Falken"] },
  ],

  // Dos de muestra, uno por modelo de precio, para poder probar los dos
  // caminos. El catálogo completo entra cuando llegue el documento.
  preciosNeumaticos: [
    {
      medida: "315/70R22.5", marca: "Bridgestone", posicion: "STEER",
      modelo: "NET_PRICE", neto: "485.49", prioridad: 20,
    },
    {
      medida: "295/80R22.5", grupoMarca: "PREMIUM", posicion: "ANY",
      modelo: "DISCOUNT_FROM_LIST", descuento: "39", prioridad: 10,
    },
  ],
};
