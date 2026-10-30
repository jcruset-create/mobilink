/**
 * ¿Hasta dónde llega el histórico de Webfleet, y con qué acción?
 *
 * De esto depende si se puede reconstruir el kilometraje mensual desde enero
 * de 2026 o si hay que empezar donde empiecen los datos. Antes de programar
 * `getTripSummary` en el conector conviene saberlo, porque la respuesta cambia
 * el plan entero.
 *
 * ── Qué pregunta, y por qué esas tres acciones ──────────────────────────────
 *
 *   showTripSummaryReportExtern  el resumen por vehículo. Es lo que usaría la
 *                                sincronización mensual.
 *   showTripReportExtern         viaje a viaje, con DISTANCIA.
 *   showLogbook                  viaje a viaje, con ODÓMETRO (`end_odometer`,
 *                                en metros). Es la buena: un odómetro a una
 *                                fecha pasada es justo lo que Movertis no da.
 *
 * Las dos primeras ya se llaman hoy en producción desde el endpoint de
 * «Conducción», así que si la pestaña funciona es que están contratadas. La
 * tercera está sin estrenar.
 *
 * ── SOLO LEE ────────────────────────────────────────────────────────────────
 *
 * Tres GET por mes y por acción. No escribe en Webfleet, no toca la base de
 * datos y NO IMPRIME NINGUNA CREDENCIAL: ni en la salida, ni en los errores.
 *
 * ── Cómo se lanza ───────────────────────────────────────────────────────────
 *
 *   WEBFLEET_ACCOUNT=…  WEBFLEET_USERNAME=…  WEBFLEET_PASSWORD=… \
 *   WEBFLEET_API_KEY=… \
 *   OBJETO=010 MESES=2026-01,2026-05,2026-09 \
 *   node scripts/telematica/sondear-historico-webfleet.mjs
 *
 * Las credenciales salen del entorno de quien lo ejecuta, que es donde ya
 * viven: las mismas variables que lee `buildWebfleetRequest` cuando no hay
 * cuenta por empresa. No hace falta dárselas a nadie.
 *
 * OBJETO es el «Webfleet Vehicle ID (objectno)» que sale en la ficha del
 * vehículo. Elige uno que SEGURO circuló en enero: un vehículo parado da
 * vacío y eso no distingue «no hay retención» de «no se movió».
 */

const BASE = process.env.WEBFLEET_BASE_URL || "https://csv.webfleet.com/extern";
const OBJETO = process.env.OBJETO || "";
const MESES = (process.env.MESES || "2026-01,2026-02,2026-05,2026-09")
  .split(",").map((m) => m.trim()).filter(Boolean);
const ACCIONES = ["showTripSummaryReportExtern", "showTripReportExtern", "showLogbook"];

const falta = ["WEBFLEET_ACCOUNT", "WEBFLEET_USERNAME", "WEBFLEET_PASSWORD"]
  .filter((v) => !process.env[v]);
if (falta.length) {
  console.error(`Faltan variables de entorno: ${falta.join(", ")}.`);
  console.error("Se leen del entorno donde se ejecuta esto; no las pegues en un chat.");
  process.exit(1);
}
if (!OBJETO) {
  console.error("Falta OBJETO: el «Webfleet Vehicle ID (objectno)» de un vehículo que circulara en el mes más antiguo que quieras probar.");
  process.exit(1);
}

/** Primer y último instante de un mes `YYYY-MM`, en UTC. */
function limites(mes) {
  const [y, m] = mes.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error(`Mes no válido: '${mes}' (formato YYYY-MM)`);
  return {
    desde: new Date(Date.UTC(y, m - 1, 1, 0, 0, 0)),
    hasta: new Date(Date.UTC(y, m, 1, 0, 0, 0) - 1000),
  };
}
const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

function url(action, extra) {
  const p = new URLSearchParams({
    account: process.env.WEBFLEET_ACCOUNT,
    action, lang: "en", outputformat: "json", useISO8601: "true", ...extra,
  });
  if (process.env.WEBFLEET_API_KEY) p.set("apikey", process.env.WEBFLEET_API_KEY);
  return `${BASE}?${p.toString()}`;
}
const cabeceras = () => ({
  Authorization: "Basic " + Buffer.from(
    `${process.env.WEBFLEET_USERNAME}:${process.env.WEBFLEET_PASSWORD}`).toString("base64"),
});

/** Una llamada. Devuelve `{filas}` o `{error}`, nunca lanza y nunca enseña credenciales. */
async function pedir(action, mes) {
  const { desde, hasta } = limites(mes);
  const destino = url(action, {
    objectno: OBJETO,
    range_pattern: "ud",
    rangefrom_string: iso(desde),
    rangeto_string: iso(hasta),
  });
  try {
    const r = await fetch(destino, { headers: cabeceras(), signal: AbortSignal.timeout(30_000) });
    if (r.status === 401 || r.status === 403) return { error: `credenciales rechazadas (HTTP ${r.status})` };
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const d = await r.json().catch(() => null);
    // Webfleet contesta 200 con errorCode en el cuerpo. El 9 es «acción
    // desconocida o NO CONTRATADA», que es permanente: reintentar no la contrata.
    if (d && !Array.isArray(d) && d.errorCode != null) {
      const n = Number(d.errorCode);
      return { error: n === 9 ? `NO CONTRATADA (error 9: ${d.errorMsg ?? ""})` : `error ${n}: ${d.errorMsg ?? ""}` };
    }
    return { filas: Array.isArray(d) ? d : (d?.data ?? []) };
  } catch (e) {
    return { error: `no se pudo llamar (${e?.message ?? e})` };
  }
}

/** Qué se saca de las filas, sin enseñar el contenido entero. */
function resumir(action, filas) {
  if (filas.length === 0) return "0 filas";
  const n = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const partes = [`${filas.length} fila(s)`];
  const distancia = filas.reduce((s, f) => s + n(f.distance ?? f.total_distance), 0);
  if (distancia > 0) partes.push(`${Math.round(distancia / 1000).toLocaleString("es-ES")} km`);
  // Lo que de verdad se viene a buscar: ¿trae odómetro?
  const conOdo = filas.filter((f) => n(f.end_odometer ?? f.odometer_end ?? f.end_odo) > 0);
  if (conOdo.length) {
    const ultimo = n(conOdo[conOdo.length - 1].end_odometer ?? conOdo[conOdo.length - 1].odometer_end
      ?? conOdo[conOdo.length - 1].end_odo);
    partes.push(`CON ODÓMETRO (${conOdo.length}/${filas.length}, último ${Math.round(ultimo / 1000).toLocaleString("es-ES")} km)`);
  } else if (action === "showLogbook") {
    partes.push("sin odómetro en las filas");
  }
  return partes.join(" · ");
}

console.log(`Sonda del histórico de Webfleet · objeto ${OBJETO}`);
console.log(`Meses: ${MESES.join(", ")}`);
console.log("Solo lectura: tres GET por mes, nada se escribe.\n");

let fallos = 0;
for (const mes of MESES) {
  console.log(`── ${mes}`);
  for (const action of ACCIONES) {
    const r = await pedir(action, mes);
    if (r.error) {
      fallos += 1;
      console.log(`   ${action.padEnd(28)} ERROR · ${r.error}`);
    } else {
      console.log(`   ${action.padEnd(28)} ${resumir(action, r.filas)}`);
    }
    // Un respiro entre llamadas: el cupo de Webfleet lo comparte con el resto.
    await new Promise((s) => setTimeout(s, 1500));
  }
}

console.log(`
Cómo se lee esto:
  · Filas en 2026-01  → el histórico llega hasta enero y el relleno es posible.
  · 0 filas en enero y filas en un mes reciente → o ese vehículo no se movió,
    o no hay retención tan atrás. Repítelo con otro vehículo antes de concluir.
  · «NO CONTRATADA» en showLogbook → habrá que tirar de showTripReportExtern:
    da distancia pero NO odómetro, y el kilometraje mensual sale de sumar en
    vez de restar dos lecturas.
  · Credenciales rechazadas → son las de otra cuenta, no un problema de fechas.
${fallos ? `\n${fallos} llamada(s) con error.` : ""}`);
