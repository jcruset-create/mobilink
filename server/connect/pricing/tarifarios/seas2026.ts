/**
 * SEAS 24 Horas, S.L. — Tarifa de Servicios Asociados 2026. Datos, no código.
 *
 * Este fichero no tiene lógica y el motor no sabe que existe. Cargar el
 * tarifario de otro cliente es escribir otro fichero como este y pasárselo al
 * mismo cargador.
 *
 * ORIGEN DE LOS NÚMEROS
 *
 * Documento "Asociados_2026_Mayo.pdf", 9 páginas, vigente desde el 1 de enero
 * de 2026. Cada tabla lleva anotada su página para poder contrastarla. Los
 * importes de la versión anterior de este fichero venían del enunciado del
 * encargo y varios eran incorrectos; están corregidos aquí.
 *
 * DOS TARIFARIOS, NO UNO
 *
 * El documento publica DOS tablas distintas (página 3): "TARIFA DE VENTA DE
 * SEAS ASISTENCIA" y "TARIFA DE COMPRA DE SEAS ASISTENCIA". No coinciden. El
 * taller factura a SEAS el precio de compra y SEAS factura a su cliente el
 * precio de venta, así que son dos planes tarifarios: el contrato de venta
 * apunta a `SEAS_2026_VENTA` y el de compra a `SEAS_2026_COMPRA`.
 *
 * ⚠ EL DIURNO PROXIMIDAD VA INVERTIDO RESPECTO AL DOCUMENTO
 *
 * El PDF publica, para el diurno proximidad, 110 € en la tabla de venta y
 * 125 € en la de compra: SEAS pagaría al taller 15 € más de lo que le cobra a
 * su cliente. Se transcribió así, se señaló, y la dirección lo ha resuelto
 * como lo que es —las dos columnas cambiadas en esa fila del documento—, así
 * que aquí van al revés: **125 € de venta y 110 € de compra**.
 *
 * CONFIRMADO POR LA DIRECCIÓN. Jordi Cruset, por escrito, dos veces:
 *   · 17/08/2026 — «cambia la columna para que salga margen positivo
 *     125 venta 110 compra».
 *   · 18/08/2026 — confirmación expresa de esta inversión al cerrar los
 *     pendientes del tarifario.
 * Queda aquí porque este fichero es lo que se carga: quien contraste la
 * tarifa contra el PDF encuentra la explicación en el mismo sitio que la
 * diferencia.
 *
 * Es el ÚNICO importe de este fichero que no coincide con el documento, y está
 * cambiado a propósito. Si alguien contrasta la carga contra el PDF y ve la
 * diferencia: no es una errata de transcripción, no la "corrijas" de vuelta.
 * El resto de filas de las dos tablas sí son literales.
 *
 * LO QUE FALTA CONTRASTAR O DECIDIR
 *
 *  1. La ventana de festivos acaba el lunes a las 08:00 en la tabla de venta y
 *     a las 07:30 en la de compra. Aquí van las dos a las 08:00: en esa media
 *     hora el importe es el mismo (nocturno y festivo valen igual en las dos
 *     tablas), así que la diferencia solo cambiaría la etiqueta.
 *  2. Las medidas 435/50R19.5 y 445/45R19.5 no traen posición en la tabla de
 *     compra; se les ha puesto REMOLQUE porque es la que llevan en la de
 *     venta.
 *  3. La columna GRUPO de la tabla de descuentos (1..8, con valores dobles
 *     como "3,1") no se ha podido cruzar con los grupos de precio neto
 *     (1ª EUROPEAS / import 1 / import 2). No se carga: no se inventa.
 *  4. Tres marcas tienen MÁS descuento en venta que en compra —BARUM, DAYTON y
 *     FORMULA—, o sea margen negativo también ahí. Eso NO se ha tocado: está
 *     en el documento y nadie ha dicho lo contrario. Es el mismo caso que el
 *     diurno proximidad y probablemente merezca la misma revisión.
 *
 * LO QUE EL DOCUMENTO TRAE Y AQUÍ NO SE CARGA, Y POR QUÉ
 *
 *  - GTI (100 € de venta, sin compra, página 3) y los rápeles por volumen
 *    anual (5/6/8/10 % según 25/50/100/150 camiones, excluyendo GTI). El
 *    motor no tiene todavía el concepto de rápel anual.
 *  - Stop & Go, servicios en taller (página 4): son servicios de taller, no
 *    asistencia en carretera, y hoy ninguna asistencia lleva ese tipo de
 *    servicio. Cargarlos sería configuración inalcanzable.
 *  - Tarifas internacionales C1/C2/C3 y autopistas de Francia e Italia
 *    (páginas 4 y 8): el resolutor de zonas asume España porque la asistencia
 *    no guarda país ni provincia (limitación declarada en
 *    docs/PRICING_auditoria_arquitectura.md §3.5). Hasta que se resuelva, esas
 *    reglas no podrían dispararse nunca.
 *  - Llantas y equilibrados (página 5) y la Tarjeta SEAS (página 9): son
 *    catálogos de producto y de seguro, no tarifas de asistencia.
 *
 * Los festivos nacionales de 2026 son los del calendario laboral estatal. Los
 * autonómicos y locales NO están: dependen de dónde opere cada central.
 */

import type { DefinicionTarifario, DefPrecioNeumatico, DefRegla } from "../tarifario.ts";

type Lado = "venta" | "compra";

const CAMION = "truck";
const NEUMATICO = "tyres";
const FUENTE = "Asociados_2026_Mayo.pdf (SEAS 24 Horas, S.L.), vigente desde 2026-01-01";

// ─────────────────────────────────────────────────────────────────────────────
// Forfaits y suplementos — página 3
// ─────────────────────────────────────────────────────────────────────────────

/** Importe del forfait en cada lado, con lo que incluye. */
const FORFAITS = {
  DIURNO_PROX:   { venta: "125", compra: "110", km: 30,  min: 90 },   // ⚠ invertido respecto al PDF, ver cabecera
  DIURNO:        { venta: "198", compra: "170", km: 100, min: 180 },
  NOCTURNO:      { venta: "331", compra: "275", km: 100, min: 180 },
  FESTIVO:       { venta: "331", compra: "275", km: 100, min: 180 },
  FESTIVO_EXTRA: { venta: "424", compra: "400", km: 100, min: 180 },
} as const;

const SUPLEMENTOS = {
  km:              { venta: "1.25", compra: "1.10" },
  tiempoDiurno:    { venta: "50",   compra: "45" },
  tiempoNocturno:  { venta: "80",   compra: "75" },
  neumaticoExtra:  { venta: "60",   compra: "50" },
  anulacion:       { venta: "50",   compra: "50" },   // porcentaje del forfait
} as const;

/**
 * Franjas horarias.
 *
 * La ventana de festivos del documento —"VIERNES 19:00 A LUNES 08:00"— dura 61
 * horas y no cabe en una sola franja, así que se parte en dos: la entrada del
 * viernes por la noche y la madrugada del lunes. El sábado y el domingo
 * completos los cubre la clase de día, no la franja.
 *
 * El nocturno queda de lunes a jueves porque el viernes a las 19:00 ya empieza
 * el fin de semana. Con anclaje `band_start`, un martes a las 02:00 pertenece
 * a la franja que arrancó el lunes a las 19:00, que es lo que quiere decir
 * "LUNES A VIERNES 19:00 - 08:00".
 */
const FRANJAS = [
  { code: "DIURNO", name: "Diurno", desde: "08:00", hasta: "19:00", dias: [1, 2, 3, 4, 5] },
  {
    code: "NOCTURNO", name: "Nocturno de lunes a viernes",
    desde: "19:00", hasta: "08:00", dias: [1, 2, 3, 4],
    anclajeDia: "band_start" as const,
  },
  {
    code: "FIN_SEMANA_INICIO", name: "Viernes noche",
    desde: "19:00", hasta: "08:00", dias: [5],
    anclajeDia: "band_start" as const,
  },
  {
    code: "FIN_SEMANA_FIN", name: "Madrugada del lunes",
    desde: "00:00", hasta: "08:00", dias: [1],
    anclajeDia: "moment" as const,
  },
];

const CALENDARIO = {
  code: "ES_2026",
  name: "Calendario laboral estatal 2026",
  dias: [
    // Días con tarifa propia: tienen que poder ganar al festivo general
    { fecha: "2026-12-25", ambito: "special" as const, clase: "christmas", nombre: "Navidad", anual: true },
    { fecha: "2026-01-01", ambito: "special" as const, clase: "new_year", nombre: "Año Nuevo", anual: true },

    { fecha: "2026-01-06", ambito: "national" as const, nombre: "Epifanía del Señor", anual: true },
    { fecha: "2026-04-03", ambito: "national" as const, nombre: "Viernes Santo" },
    { fecha: "2026-05-01", ambito: "national" as const, nombre: "Fiesta del Trabajo", anual: true },
    { fecha: "2026-08-15", ambito: "national" as const, nombre: "Asunción de la Virgen", anual: true },
    { fecha: "2026-10-12", ambito: "national" as const, nombre: "Fiesta Nacional de España", anual: true },
    { fecha: "2026-11-02", ambito: "national" as const, nombre: "Todos los Santos (trasladado)" },
    { fecha: "2026-12-07", ambito: "national" as const, nombre: "Día de la Constitución (trasladado)" },
    { fecha: "2026-12-08", ambito: "national" as const, nombre: "Inmaculada Concepción", anual: true },
  ],
};

function extras(lado: Lado) {
  return [
    { code: "EXTRA_KM", name: "Kilómetro adicional", calculo: "PER_KM" as const,
      importe: SUPLEMENTOS.km[lado], unidad: "km", tipoLinea: "EXTRA_KM" },
    { code: "EXTRA_TIME_DAY", name: "Tiempo adicional diurno", calculo: "PER_HOUR" as const,
      importe: SUPLEMENTOS.tiempoDiurno[lado], unidad: "h", tipoLinea: "EXTRA_TIME" },
    { code: "EXTRA_TIME_NIGHT", name: "Tiempo adicional nocturno o festivo", calculo: "PER_HOUR" as const,
      importe: SUPLEMENTOS.tiempoNocturno[lado], unidad: "h", tipoLinea: "EXTRA_TIME" },
    // "NO ES APLICABLE TIEMPO EXTRA" al neumático adicional (página 3)
    { code: "ADDITIONAL_TIRE", name: "Neumático adicional", calculo: "PER_UNIT" as const,
      importe: SUPLEMENTOS.neumaticoExtra[lado], unidad: "ud", tipoLinea: "ADDITIONAL_TIRE" },
    { code: "CANCELLATION", name: "Anulación con salida realizada", calculo: "PERCENTAGE" as const,
      porcentaje: SUPLEMENTOS.anulacion[lado], aplicaA: "forfait" as const, tipoLinea: "CANCELLATION" },
  ];
}

/**
 * Reglas de forfait.
 *
 * Prioridades: lo más excepcional gana. Navidad por encima de festivo, festivo
 * por encima del horario —un festivo a las 22:00 se cobra como festivo, no
 * como nocturno— y proximidad por encima del diurno normal, porque es el caso
 * acotado (menos de 30 km y hora y media).
 *
 * El umbral del 20 % es literal del documento: "los tiempos extra o kms.
 * adicionales se facturarán cuando uno de los dos tramos (KM - Horas) supere
 * el 20 % del tramo de FORFAIT".
 */
function reglas(lado: Lado): DefRegla[] {
  const comun = {
    servicio: NEUMATICO, vehiculo: CAMION, zona: "ES",
    extraKm: "EXTRA_KM",
    disparoExtra: "THRESHOLD_PERCENT" as const,
    umbralPorcentaje: 20,
  };
  const f = (k: keyof typeof FORFAITS) => ({
    importe: FORFAITS[k][lado],
    incluyeKm: FORFAITS[k].km,
    incluyeMin: FORFAITS[k].min,
  });

  return [
    { ...comun, ...f("FESTIVO_EXTRA"),
      code: "FESTIVO_EXTRA", name: "Festivos extra (Navidad y Año Nuevo)",
      franja: null, clasesDia: ["christmas", "new_year"],
      extraTiempo: "EXTRA_TIME_NIGHT", prioridad: 100 },

    { ...comun, ...f("FESTIVO"),
      code: "FESTIVO", name: "Festivos y fin de semana",
      franja: null, clasesDia: ["holiday", "saturday", "sunday"],
      extraTiempo: "EXTRA_TIME_NIGHT", prioridad: 90 },

    /*
     * Misma tarifa que la anterior, otra puerta de entrada: el viernes a las
     * 22:00 y el lunes a las 03:00 son festivo por HORA, no por día. Dos
     * reglas con el mismo importe explican mejor el porqué que una sola con
     * una condición retorcida.
     */
    { ...comun, ...f("FESTIVO"),
      code: "FESTIVO_ENTRADA", name: "Fin de semana (viernes noche)",
      franja: "FIN_SEMANA_INICIO", clasesDia: null,
      extraTiempo: "EXTRA_TIME_NIGHT", prioridad: 85 },

    { ...comun, ...f("FESTIVO"),
      code: "FESTIVO_SALIDA", name: "Fin de semana (madrugada del lunes)",
      franja: "FIN_SEMANA_FIN", clasesDia: null,
      extraTiempo: "EXTRA_TIME_NIGHT", prioridad: 84 },

    { ...comun, ...f("NOCTURNO"),
      code: "NOCTURNO", name: "Nocturno",
      franja: "NOCTURNO", clasesDia: null,
      extraTiempo: "EXTRA_TIME_NIGHT", prioridad: 50 },

    { ...comun, ...f("DIURNO_PROX"),
      code: "DIURNO_PROX", name: "Diurno proximidad",
      franja: "DIURNO", clasesDia: null,
      maxKm: 30, maxMin: 90,
      extraTiempo: "EXTRA_TIME_DAY", prioridad: 45 },

    { ...comun, ...f("DIURNO"),
      code: "DIURNO", name: "Diurno",
      franja: "DIURNO", clasesDia: null,
      extraTiempo: "EXTRA_TIME_DAY", prioridad: 40 },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Neumáticos — páginas 5, 6 y 7
// ─────────────────────────────────────────────────────────────────────────────

/** Grupos de precio neto (páginas 6 y 7, columnas de la derecha). */
const GRUPOS_MARCA = [
  {
    code: "EUROPEAS_1", name: "1ª Europeas",
    marcas: ["Apollo", "Firestone", "Semperit", "Barum", "Fulda", "BFGoodrich", "Kumo",
             "Uniroyal", "Falken", "Sava", "Kormoran", "Debica", "Hankook", "Yokohama"],
  },
  {
    code: "IMPORT_1", name: "Importación 1",
    marcas: ["Double Coin", "Jinyu", "Formula", "Westlake", "Riken", "Evergreen", "Blacklion",
             "Kelly", "Otani", "Taurus", "GT Radial", "Giti", "Dayton", "Lasa"],
  },
  {
    code: "IMPORT_2", name: "Importación 2",
    marcas: ["Anaite", "Aplus", "Antyre", "Aurora", "Gondelglon", "Goodride", "Linglong", "Leao",
             "Lanvigator", "Ovation", "Starmaxx", "Torque", "Winforce", "Windpower"],
  },
];

/**
 * Precios netos por medida y posición.
 *
 * Las columnas van en el mismo orden que en el documento. Un `null` es una
 * celda vacía o un "0,00 €" del PDF: en los dos casos significa QUE NO HAY
 * PRECIO, no que el neumático sea gratis, y por eso no se carga ninguna fila.
 * Cargar un cero aquí lo facturaría.
 */
const COLUMNAS = [
  { marca: "Hankook" }, { marca: "Continental" },
  { marca: "Bridgestone" }, { marca: "Pirelli" }, { marca: "Goodyear" }, { marca: "Dunlop" },
  { grupo: "EUROPEAS_1" }, { grupo: "IMPORT_1" }, { grupo: "IMPORT_2" },
] as const;

type FilaNeta = [string, "STEER" | "DRIVE" | "TRAILER", ...(string | null)[]];

/** Página 6 — COMPRA NEUMÁTICOS. */
const NETOS_COMPRA: FilaNeta[] = [
  //  medida          posición    HAN    CONT   BRID   PIR    GY     DUN    EUR1   IMP1   IMP2
  ["315/70R22.5", "STEER",   "480", "520", "460", "460", "500", "460", "410", "335", "300"],
  ["315/70R22.5", "DRIVE",   "480", "520", "460", "460", "500", "460", "410", "335", "300"],
  ["315/80R22.5", "STEER",   "480", "510", "460", "460", "510", "460", "410", "335", "300"],
  ["315/80R22.5", "DRIVE",   "480", "510", "460", "460", "510", "460", "410", "335", "300"],
  ["385/55R22.5", "STEER",   "510", "555", "480", "470", "550", "490", "430", "335", "300"],
  ["385/55R22.5", "TRAILER", "450", "510", "470", "460", "525", "480", "420", "335", "300"],
  ["385/65R22.5", "STEER",   "490", "540", "480", "470", "520", "465", "420", "345", "300"],
  ["385/65R22.5", "TRAILER", "450", "498", "460", "430", "500", "450", "400", "345", "300"],
  ["295/80R22.5", "STEER",   "460", "510", "470", "420", "510", "445", "400", "330", "290"],
  ["295/80R22.5", "DRIVE",   "460",  null,  null,  null, "510", "445",  null,  null,  null],
  ["435/50R19.5", "TRAILER",  null, "565", "590", "480", "565", "550", "580", "400", "350"],
  ["445/45R19.5", "TRAILER",  null, "595", "670", "490", "620",  null, "590", "400", "350"],
];

/** Página 7 — VENTA NEUMÁTICOS. */
const NETOS_VENTA: FilaNeta[] = [
  //  medida          posición       HAN       CONT      BRID      PIR       GY        DUN       EUR1      IMP1      IMP2
  ["315/70R22.5", "STEER",   "506.60", "548.81", "485.49", "485.49", "527.70", "485.49", "436.17", "364.13", "327.87"],
  ["315/70R22.5", "DRIVE",   "506.60", "548.81", "485.49", "485.49", "527.70", "485.49", "436.17", "364.13", "327.87"],
  ["315/80R22.5", "STEER",   "506.60", "538.26", "485.49", "485.49", "538.26", "485.49", "436.17", "364.13", "327.87"],
  ["315/80R22.5", "DRIVE",   "506.60", "538.26", "485.49", "485.49", "538.26", "485.49", "436.17", "364.13", "327.87"],
  ["385/55R22.5", "STEER",   "538.26", "585.75", "506.60", "496.04", "580.47", "517.15", "457.45", "364.13", "327.87"],
  ["385/55R22.5", "TRAILER", "474.93", "538.26", "496.04", "485.49", "554.09", "506.60", "446.81", "364.13", "327.87"],
  ["385/65R22.5", "STEER",   "517.15", "569.92", "506.60", "496.04", "548.81", "490.77", "446.81", "375.00", "327.87"],
  ["385/65R22.5", "TRAILER", "474.93", "525.59", "485.49", "453.83", "527.70", "474.93", "425.53", "375.00", "327.87"],
  ["295/80R22.5", "STEER",   "485.49", "538.26", "496.04", "443.27", "538.26", "469.66", "425.53", "358.70", "316.94"],
  ["295/80R22.5", "DRIVE",   "485.49",     null,     null,     null, "538.26", "469.66",     null,     null,     null],
  ["435/50R19.5", "TRAILER",     null, "596.31", "622.69", "506.60", "596.31", "580.47", "617.02", "434.78", "382.51"],
  ["445/45R19.5", "TRAILER",     null, "627.97", "707.12", "517.15", "654.35",     null, "627.66", "434.78", "382.51"],
];

/**
 * Descuentos sobre el baremo del fabricante — página 5.
 *
 * "Condiciones aplicables a todos los neumáticos que no figuran con precio
 * neto en la página siguiente", así que van con prioridad más baja que los
 * netos y sin medida: valen para cualquiera que no tenga precio escrito.
 *
 * El porcentaje es el DESCUENTO sobre el baremo publicado por el fabricante,
 * no el precio resultante.
 */
const DESCUENTOS: [string, string, string][] = [
  // marca            compra  venta
  ["Michelin",        "43", "39"],
  ["Bridgestone",     "54", "51"],
  ["Continental",     "37", "34"],
  ["Goodyear",        "43", "41"],
  ["Dunlop",          "43", "41"],
  ["Pirelli",         "48", "46"],
  ["Firestone",       "52", "50"],
  ["Fulda",           "47", "45"],
  ["Semperit",        "42", "39"],
  ["BF Goodrich",     "35", "33"],
  ["Barum",           "35", "39"],   // ⚠ más descuento en venta que en compra
  ["Debica",          "42", "27"],
  ["Dayton",          "30", "45"],   // ⚠ ídem
  ["Falken",          "47", "45"],
  ["Formula",         "47", "49"],   // ⚠ ídem
  ["Sava",            "51", "37"],
  ["Remix",           "40", "28"],   // carcasa aparte
];

function preciosNeumaticos(lado: Lado): DefPrecioNeumatico[] {
  const filas = lado === "venta" ? NETOS_VENTA : NETOS_COMPRA;
  const salida: DefPrecioNeumatico[] = [];

  for (const [medida, posicion, ...celdas] of filas) {
    celdas.forEach((neto, i) => {
      if (neto == null) return;          // celda vacía o 0,00 € = no hay precio
      const col = COLUMNAS[i];
      salida.push({
        medida, posicion,
        marca: "marca" in col ? col.marca : null,
        grupoMarca: "grupo" in col ? col.grupo : null,
        modelo: "NET_PRICE",
        neto,
        // La marca concreta por encima del grupo, y las dos por encima del
        // descuento sobre baremo, que es el comodín.
        prioridad: "marca" in col ? 20 : 10,
      });
    });
  }

  for (const [marca, compra, venta] of DESCUENTOS) {
    salida.push({
      medida: null, marca, posicion: "ANY",
      modelo: "DISCOUNT_FROM_LIST",
      descuento: lado === "venta" ? venta : compra,
      prioridad: 5,
    });
  }

  return salida;
}

// ─────────────────────────────────────────────────────────────────────────────

function tarifario(lado: Lado): DefinicionTarifario {
  return {
    code: lado === "venta" ? "SEAS_NACIONAL_VENTA" : "SEAS_NACIONAL_COMPRA",
    name: lado === "venta" ? "SEAS Nacional (venta)" : "SEAS Nacional (compra)",
    descripcion: lado === "venta"
      ? "Lo que SEAS factura a su cliente por una asistencia en carretera"
      : "Lo que el taller factura a SEAS por una asistencia en carretera",
    currency: "EUR",
    timezone: "Europe/Madrid",
    version: "2026",
    vigenteDesde: "2026-01-01",
    vigenteHasta: "2027-01-01",
    fuente: `${FUENTE} — tabla de ${lado}`,
    calendario: CALENDARIO,
    franjas: FRANJAS,
    zonas: [{ code: "ES", name: "España", type: "COUNTRY", miembros: [{ tipo: "country", valor: "ES" }] }],
    extras: extras(lado),
    reglas: reglas(lado),
    gruposMarca: GRUPOS_MARCA,
    preciosNeumaticos: preciosNeumaticos(lado),
  };
}

export const SEAS_2026_VENTA = tarifario("venta");
export const SEAS_2026_COMPRA = tarifario("compra");

/** El lado de venta, que es el que se enseña cuando se habla de "la tarifa". */
export const SEAS_2026 = SEAS_2026_VENTA;
