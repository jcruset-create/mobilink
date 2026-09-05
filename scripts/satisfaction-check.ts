/**
 * `npm run satisfaction:check` — el estado de Satisfaction, sin tocar nada.
 *
 * Solo lectura: ni un UPDATE, ni una llamada a Twilio. Se puede lanzar contra
 * producción sin pensárselo dos veces.
 *
 * De las variables de entorno dice si están, nunca cuánto valen; de los
 * teléfonos, nada. Esto acaba pegado en un chat cuando algo va mal.
 */

import { diagnosticarSatisfaction } from "../server/satisfaction/diagnostico.ts";
import pool from "../server/db.ts";

const si = (v: boolean) => (v ? "sí" : "NO");

async function main() {
  const d = await diagnosticarSatisfaction();

  console.log("\n── Configuración ─────────────────────────────────────────");
  console.log(`  Satisfaction activo ....... ${si(d.configuracion.activo)}`);
  console.log(`  Encuesta al conductor ..... ${si(d.configuracion.conductor)}`);
  console.log(`  Encuesta al cliente ....... ${si(d.configuracion.cliente)}`);
  console.log(`  Recordatorio .............. ${si(d.configuracion.recordatorio)} ` +
    `(a las ${d.configuracion.recordatorioHoras} h)`);
  console.log(`  Retraso del envío ......... ${d.configuracion.retrasoMinutos} min`);
  console.log(`  Caducidad ................. ${d.configuracion.caducidadHoras} h`);

  console.log("\n── Configuración externa (presencia, no valores) ─────────");
  console.log(`  Credenciales de Twilio .... ${si(d.entorno.credencialesTwilio)}`);
  console.log(`  URL pública ............... ${si(d.entorno.urlPublica)}`);
  for (const [k, v] of Object.entries(d.entorno.plantillas)) {
    console.log(`  Plantilla ${k.padEnd(16, ".")} ${si(v)}`);
  }

  console.log("\n── Esquema ───────────────────────────────────────────────");
  for (const t of d.esquema) {
    console.log(`  ${t.tabla.padEnd(28, ".")} ${si(t.existe)}` +
      (t.filas == null ? "" : `  (${t.filas} filas)`));
  }
  const faltan = d.indices.filter((i) => !i.existe);
  console.log(`  Índices críticos .......... ${d.indices.length - faltan.length}/${d.indices.length}`);
  for (const i of faltan) console.log(`    FALTA: ${i.nombre}`);

  console.log("\n── Encuestas por estado ──────────────────────────────────");
  const filas = (m: Record<string, number>) =>
    Object.keys(m).length
      ? Object.entries(m).sort().map(([k, v]) => `  ${k.padEnd(14, ".")} ${v}`).join("\n")
      : "  (ninguna)";
  console.log(filas(d.encuestas));

  console.log("\n── Entregas por estado ───────────────────────────────────");
  console.log(filas(d.entregas));

  if (d.bloqueos.length) {
    console.log("\n── Bloqueadas, y por qué ─────────────────────────────────");
    for (const b of d.bloqueos) console.log(`  ${b.motivo.padEnd(30, ".")} ${b.n}`);
  }

  if (d.ultimosErrores.length) {
    console.log("\n── Errores de los últimos 7 días ─────────────────────────");
    for (const e of d.ultimosErrores) {
      console.log(`  ${String(e.code ?? "?").padEnd(10)} ×${e.n}  ${e.mensaje ?? ""}`);
    }
  }

  console.log("\n── Worker ────────────────────────────────────────────────");
  console.log(`  En cola ................... ${d.worker.encoladasPendientes}`);
  console.log(`  Enviándose ahora .......... ${d.worker.enVuelo}`);
  console.log(`  En duda (por reconciliar) . ${d.worker.enDuda}`);

  console.log("\n── Avisos ────────────────────────────────────────────────");
  if (!d.avisos.length) console.log("  Ninguno.");
  for (const a of d.avisos) console.log(`  · ${a}`);
  console.log("");

  await pool.end();
}

main().catch(async (e) => {
  console.error("No se ha podido diagnosticar:", (e as Error)?.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
