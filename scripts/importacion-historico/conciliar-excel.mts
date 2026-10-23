/**
 * Concilia el Excel del histórico con el MISMO código que usa el panel y
 * escribe los lotes de la prueba pequeña. Solo lee el fichero.
 *
 *   npx tsx scripts/importacion-historico/conciliar-excel.mts <ruta.xlsx> [lotes.json]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  agruparAlbaranes, albaranParaRpc, conciliarAlbaran, leerHoja1, leerHoja2, porPeriodo, resumir,
  type AlbaranConciliado,
} from "../../src/modules/tyrecontrol/services/importHistorico.ts";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

const [ruta, salida] = process.argv.slice(2);
if (!ruta) { console.error("Uso: conciliar-excel.mts <ruta.xlsx> [lotes.json]"); process.exit(2); }
const wb = XLSX.read(fs.readFileSync(ruta), { cellDates: true });
const hojas = wb.SheetNames.map((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: "" }) as Record<string, unknown>[]);
const h1 = leerHoja1(hojas.find((h) => h[0] && "Documento" in h[0]) ?? []);
const h2 = leerHoja2(hojas.find((h) => h[0] && "Cod. Articulo" in h[0]) ?? []);
const { albaranes, entradas, salidasSinAlbaran } = agruparAlbaranes(h1, h2);
const out: AlbaranConciliado[] = [];
for (const a of albaranes) out.push(await conciliarAlbaran(a));
const r = resumir(out, entradas.length, salidasSinAlbaran.length);

console.log(`Hoja1 ${h1.length} líneas · Hoja2 ${h2.length} movimientos · ${albaranes.length} albaranes`);
console.log(`Importables ${r.importables} · bloqueados ${r.bloqueados} · sin contenido ${r.sinContenido}`);
console.log(`Operaciones ${r.operaciones} = nuevas ${r.porCondicion.nueva} + usadas ${r.porCondicion.usada} + recauchutadas ${r.porCondicion.recauchutada}`);
console.log(`Servicios ${r.servicios} · líneas ${r.lineas} · entradas del depósito (no se importan) ${r.entradasDeposito}`);
const motivos = new Map<string, number>();
for (const a of out) if (a.bloqueante) { const k = a.bloqueante.split(" · ")[0].replace(/«[^»]*»/g, "«…»").replace(/\d[\d.,]*/g, "#"); motivos.set(k, (motivos.get(k) ?? 0) + 1); }
console.log("Bloqueantes por motivo:"); for (const [k, n] of [...motivos].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);

// La prueba pequeña: los albaranes acordados más uno de cada caso que no esté.
const ELEGIDOS = ["B2_26/4905|7724KBM", "B2_26/4508|2966JMJ", "B2_26/4499|5239KVW", "B2_26/4310|9005KMR", "B2_26/4005|6034LRF",
  "B2_26/1590|1445HWZ", "B2_26/4799|9909GLS", "B2_26/1730|1595HPW", "B2_26/722|3696JNX", "B2_26/0|5838HDP", "B2_26/4334|1312JJC", "B2_26/4668|7694HCH"];
const elegidos = out.filter((a) => ELEGIDOS.includes(a.origen_doc));
for (const extra of [
  out.find((a) => a.estado === "importable" && a.operaciones.length > 0 && a.km == null),
  out.find((a) => a.bloqueante?.includes("Carcasa")),
  out.find((a) => a.estado === "sin_contenido"),
]) if (extra && !elegidos.includes(extra)) elegidos.push(extra);
console.log("\nPrueba pequeña:");
for (const a of elegidos) console.log(` ${a.origen_doc.padEnd(22)} ${a.fecha ?? "—"} ${a.estado.padEnd(13)} ops=${a.operaciones.length} srv=${a.servicios.length} lin=${a.lineas.length} nuevas=${a.nuevas_total}/${a.nuevas_una_referencia ? "1ref" : "mixto"} ${a.bloqueante ?? a.incidencias.join(" · ")}`);
if (salida) {
  const lotes = [...porPeriodo(elegidos)].map(([periodo, albs]) => ({ periodo, fichero: path.basename(ruta), albaranes: albs.map(albaranParaRpc) }));
  fs.writeFileSync(salida, JSON.stringify({ lotes, matriculas: [...new Set(elegidos.map((a) => a.matricula).filter(Boolean))] }));
  console.log(`\n${lotes.length} lote(s) → ${salida}`);
}
