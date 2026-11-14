/**
 * Genera el parte PDF de B2_26/4905 (histórico) y el de una intervención
 * normal, con el código del servidor, para mirarlos:
 *   npx tsx scripts/importacion-historico/pdf-visual.mts <dir_salida>
 */
import fs from "node:fs";
import { armarParte } from "../../server/tyrecontrol/parte/armarParte.ts";
import { filasDeOperaciones, filasHistoricas, salidasHistoricas, type OperacionFila } from "../../server/tyrecontrol/parte/filasDeOperaciones.ts";
import { generarPartePdf } from "../../server/tyrecontrol/parte/generarPdf.ts";
const S = process.argv[2] ?? ".";
const hist = (o: Partial<OperacionFila>): OperacionFila => ({ tipo_operacion: "montaje", status: "completada", is_anulada: false, neumatico: null,
  importacion_lote_id: "11111111-1111-4111-8111-111111111111", km_vehiculo: 268659, ...o });
// B2_26/4905: 2 nuevas (E1 deducidas) + 2 usadas sin posición.
const ops4905 = [
  hist({ condicion: "nueva", marca_txt: "Hankook", modelo_txt: "AH51 156L", medida_txt: "315/80R22.5", posicion_fuente: "deducida", posicion_destino: { codigo_posicion: "E1_IZQ" } }),
  hist({ condicion: "nueva", marca_txt: "Hankook", modelo_txt: "AH51 156L", medida_txt: "315/80R22.5", posicion_fuente: "deducida", posicion_destino: { codigo_posicion: "E1_DER" } }),
  hist({ condicion: "usada", medida_txt: "315/80R22.5", posicion_fuente: "desconocida", posicion_destino: null, observaciones: "[USADO]" }),
  hist({ condicion: "usada", medida_txt: "315/80R22.5", posicion_fuente: "desconocida", posicion_destino: null, observaciones: "[USADO]" }),
];
// Fase 2: cada montaje histórico lleva su SALIDA (la goma que ocupaba la
// posición). No se listan una a una —no consta su identidad— pero el papel
// dice cuántas fueron.
const salidas4905: OperacionFila[] = ops4905.map((o) => ({ ...o, tipo_operacion: "desmontaje", estado_anterior: "montado",
  condicion: null, marca_txt: null, modelo_txt: null, medida_txt: null,
  posicion_origen: o.posicion_destino, posicion_destino: null, identidad_retirado: "desconocida" } as OperacionFila));
const todas4905 = [...ops4905, ...salidas4905];
const interv = { numero: "B2_26/4905 · 7724KBM", fecha: "2026-10-10", matricula: "7724KBM", flota: "Empresa Plana S.L.", km: 268659, mecanico_km: 268659,
  historico_etiqueta: "Histórico importado · albarán B2_26/4905 (genes)" } as any;
const parte = armarParte(interv, filasDeOperaciones(todas4905), [{ servicio: "desmontar_montar_cubierta", cantidad: 2 }, { servicio: "quitar_poner_rueda", cantidad: 4 }, { servicio: "equilibrado", cantidad: 2 }], filasHistoricas(todas4905), salidasHistoricas(todas4905));
console.log("montados:", parte.montados?.length, "nuevos:", parte.nuevos?.length, "historicos:", parte.historicos?.length,
            "salidas históricas:", parte.historicos_salidas, "servicios:", parte.servicios);
fs.writeFileSync(`${S}/parte_4905.pdf`, await generarPartePdf(parte));
// Una intervención NORMAL (del taller) con un montaje nuevo del almacén, para comparar.
const normal: OperacionFila[] = [
  { tipo_operacion: "desmontaje", status: "completada", is_anulada: false, estado_anterior: "montado", motivo: "desgaste", destino: "descarte",
    neumatico: { marca: "Hankook", modelo: "AL10", medida: "315/80R22.5", numero_serie: "2640486081", dot: "2325", numero_interno: "NT-2026-000063" }, posicion_origen: { codigo_posicion: "E1_IZQ" } },
  { tipo_operacion: "montaje", status: "completada", is_anulada: false, estado_anterior: "almacen",
    neumatico: { marca: "Hankook", modelo: "AH51", medida: "315/80R22.5", numero_serie: "2640486099", dot: "3426", numero_interno: "NT-2026-000120" }, posicion_destino: { codigo_posicion: "E1_IZQ" } },
];
const p2 = armarParte({ numero: "OP-2026-000301", fecha: "2026-10-09", matricula: "1234ABC", flota: "Empresa Plana S.L.", km: 500000 } as any, filasDeOperaciones(normal), [{ servicio: "equilibrado", cantidad: 1 }], filasHistoricas(normal), salidasHistoricas(normal));
console.log("normal → montados:", p2.montados?.length, "nuevos:", p2.nuevos?.length, "historicos:", p2.historicos);
fs.writeFileSync(`${S}/parte_normal.pdf`, await generarPartePdf(p2));
