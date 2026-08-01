#!/usr/bin/env node
// ============================================================================
// Prueba de la "vía 2": ¿puede Webfleet decirnos el odómetro de un vehículo en
// una fecha/hora concreta del pasado?
//
// Consulta showLogbook (libro de ruta: viajes con hora y odómetro) y, para
// comparar, showTripReportExtern (viajes con distancia). Vuelca las claves que
// devuelve cada acción, señala las que hablan de odómetro/kilómetros y, si hay
// dato suficiente, calcula los km del vehículo en el instante pedido.
//
// Uso:
//   node scripts/webfleet-logbook-test.mjs --objectno 2321HZT
//   node scripts/webfleet-logbook-test.mjs --objectno 2321HZT --dias 30 \
//        --at 2026-07-15T09:40:00Z
//   node scripts/webfleet-logbook-test.mjs --list        (lista los objectno)
//
// Credenciales: WEBFLEET_ACCOUNT, WEBFLEET_USERNAME, WEBFLEET_PASSWORD,
// WEBFLEET_API_KEY (opcional) y WEBFLEET_BASE_URL (opcional). Se leen del
// entorno o del .env de la raíz.
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");

// ── .env sencillo (sin dependencias) ────────────────────────────────────────
function cargarEnv() {
  const f = path.join(raiz, ".env");
  if (!fs.existsSync(f)) return;
  for (const linea of fs.readFileSync(f, "utf8").split("\n")) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const valor = m[2].replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = valor;
  }
}
cargarEnv();

// ── Argumentos ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const arg = (nombre, porDefecto = null) => {
  const i = args.indexOf(`--${nombre}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : porDefecto;
};
const soloListar = args.includes("--list");
const objectno = arg("objectno");
const dias = Math.min(90, Math.max(1, Number(arg("dias", "7"))));
const at = arg("at");

const { WEBFLEET_ACCOUNT: account, WEBFLEET_USERNAME: username, WEBFLEET_PASSWORD: password,
        WEBFLEET_API_KEY: apikey } = process.env;
const baseUrl = process.env.WEBFLEET_BASE_URL || "https://csv.webfleet.com/extern";

if (!account || !username || !password) {
  console.error("Faltan credenciales: WEBFLEET_ACCOUNT / WEBFLEET_USERNAME / WEBFLEET_PASSWORD");
  process.exit(1);
}
if (!soloListar && !objectno) {
  console.error("Falta --objectno (o usa --list para ver los vehículos de la cuenta)");
  process.exit(1);
}

// ── Llamada a Webfleet ──────────────────────────────────────────────────────
async function llamar(action, extra = {}) {
  const params = new URLSearchParams({
    account, action, lang: "es", outputformat: "json", useISO8601: "true", ...extra,
  });
  if (apikey) params.set("apikey", apikey);
  const auth = Buffer.from(`${username}:${password}`).toString("base64");
  const url = `${baseUrl}?${params.toString()}`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Basic ${auth}` },
                                signal: AbortSignal.timeout(30000) });
    const texto = await r.text();
    let datos = null;
    try { datos = JSON.parse(texto); } catch { /* respuesta no JSON */ }
    if (datos && !Array.isArray(datos) && datos.errorCode) {
      return { ok: false, http: r.status, errorCode: datos.errorCode, errorMsg: datos.errorMsg };
    }
    if (!r.ok) return { ok: false, http: r.status, httpError: true, crudo: texto.slice(0, 400) };
    const filas = Array.isArray(datos) ? datos : datos?.data ?? [];
    return { ok: true, http: r.status, filas, crudo: texto.slice(0, 400) };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

const rango = (desdeMs, hastaMs) => ({
  range_pattern: "ud",
  rangefrom_string: new Date(desdeMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
  rangeto_string: new Date(hastaMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
});

const ODO = /odo|mileage|kilomet|km|milage|distance/i;
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);

// ── Fechas en hora local española ───────────────────────────────────────────
// Un "a las 10:00" es hora de España, no UTC: en verano se van dos horas, que
// en carretera son 150 km de diferencia. Se aceptan 29/07/2026 10:00,
// 2026-07-29 10:00 y el ISO con Z o desfase explícito (ese se respeta).
const ZONA = "Europe/Madrid";
function desfaseZona(ts) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONA, hour12: false, year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(ts)).map((x) => [x.type, x.value])
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ts;
}
function parseFecha(s) {
  const txt = String(s).trim().replace(",", ".");
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(txt)) return { ms: new Date(txt).getTime(), zona: "tal cual" };
  let m = txt.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T ]+(\d{1,2})[:.](\d{2}))?/);
  let Y, M, D, h, mi;
  if (m) { [, D, M, Y, h, mi] = m.map(Number); }
  else {
    m = txt.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ]+(\d{1,2})[:.](\d{2}))?/);
    if (!m) return { ms: NaN };
    [, Y, M, D, h, mi] = m.map(Number);
  }
  const supuesto = Date.UTC(Y, M - 1, D, h || 0, mi || 0);
  return { ms: supuesto - desfaseZona(supuesto), zona: ZONA };
}

function informar(titulo, res) {
  console.log(`\n── ${titulo} ${"─".repeat(Math.max(0, 60 - titulo.length))}`);
  if (res.error) { console.log(`  fallo de red: ${res.error}`); return null; }
  if (res.errorCode != null) {
    console.log(`  Webfleet error ${res.errorCode}: ${res.errorMsg}`);
    console.log(`  (errorCode 9 = acción desconocida/no contratada, 21 = parámetro inválido)`);
    return null;
  }
  if (res.httpError) {
    console.log(`  HTTP ${res.http} — la petición no llegó a Webfleet o fue rechazada`);
    console.log(`  respuesta: ${res.crudo}`);
    return null;
  }
  const filas = res.filas ?? [];
  console.log(`  HTTP ${res.http} · ${filas.length} filas`);
  if (filas.length === 0) { console.log(`  sin datos en el rango`); return filas; }
  const claves = Object.keys(filas[0]);
  console.log(`  claves (${claves.length}): ${claves.join(", ")}`);
  const odo = claves.filter((k) => ODO.test(k));
  console.log(`  ► campos de odómetro/km: ${odo.length ? odo.join(", ") : "NINGUNO"}`);
  const muestra = filas.slice(0, 2).map((f) => {
    const r = {};
    for (const k of claves) if (/time|date|odo|mileage|km|distance|objectno/i.test(k)) r[k] = f[k];
    return r;
  });
  console.log(`  muestra: ${JSON.stringify(muestra, null, 2).replace(/\n/g, "\n  ")}`);
  return filas;
}

// ── Km en un instante, a partir de las filas de un informe ──────────────────
function kmEn(filas, tsMs, anclaKm = null) {
  const conFecha = filas
    .map((f) => {
      const fin = f.end_time ?? f.endtime ?? f.stop_time ?? f.time ?? null;
      const ini = f.start_time ?? f.starttime ?? null;
      const odoFin = num(f.end_odometer ?? f.odometer_end ?? f.end_odo ?? f.odometer ?? f.end_mileage);
      const odoIni = num(f.start_odometer ?? f.odometer_start ?? f.start_odo ?? f.start_mileage);
      return { ini: ini ? new Date(ini).getTime() : null, fin: fin ? new Date(fin).getTime() : null,
               odoIni, odoFin, distancia: num(f.distance) };
    })
    .filter((f) => f.fin != null)
    .sort((a, b) => a.fin - b.fin);

  // 1) Lectura directa: último viaje terminado antes de T con odómetro.
  const previos = conFecha.filter((f) => f.fin <= tsMs && (f.odoFin != null || f.odoIni != null));
  if (previos.length) {
    const p = previos[previos.length - 1];
    const km = p.odoFin ?? p.odoIni;
    return { km, metodo: "lectura directa del libro de ruta", referencia: new Date(p.fin).toISOString(),
             precision: "±0 (es la lectura del propio viaje)" };
  }
  // 2) Reconstrucción: odómetro conocido más antiguo menos las distancias intermedias.
  const conOdo = conFecha.filter((f) => f.odoIni != null || f.odoFin != null);
  if (conOdo.length) {
    const ref = conOdo[0];
    const base = ref.odoIni ?? ref.odoFin;
    const entre = conFecha.filter((f) => f.fin > tsMs && f.fin <= ref.fin);
    const restar = entre.reduce((s, f) => s + (f.distancia ?? 0), 0);
    return { km: base - restar / 1000, metodo: "reconstruido hacia atrás desde el odómetro conocido",
             referencia: new Date(ref.fin).toISOString(),
             precision: `±${(entre.length ? Math.max(...entre.map((f) => (f.distancia ?? 0) / 1000)) : 0).toFixed(1)} km` };
  }
  // 3) Vía 1 pura: sin odómetro en las filas, se resta al odómetro actual la
  //    distancia de todo lo recorrido después de T (interpolando el viaje que
  //    contenga T, si lo hay).
  if (anclaKm != null) {
    let recorridoDespues = 0;
    let dentro = 0;
    for (const f of conFecha) {
      const d = (f.distancia ?? 0) / 1000;
      if (f.ini != null && f.ini >= tsMs) recorridoDespues += d;
      else if (f.ini != null && f.fin > tsMs && f.ini < tsMs) {
        const parte = (f.fin - tsMs) / (f.fin - f.ini);
        recorridoDespues += d * parte;
        dentro = d;
      }
    }
    return { km: anclaKm - recorridoDespues,
             metodo: "reconstruido desde el odómetro actual restando los viajes posteriores",
             referencia: "odómetro actual",
             precision: dentro ? `±${dentro.toFixed(1)} km (T cae dentro de un viaje: interpolado)` : "±0,1 km (T entre viajes)" };
  }
  return null;
}

// ── Ejecución ───────────────────────────────────────────────────────────────
console.log(`Cuenta: ${account} · base: ${baseUrl}`);

if (soloListar) {
  const res = await llamar("showObjectReportExtern");
  const filas = informar("showObjectReportExtern (lista de vehículos)", res) ?? [];
  for (const o of filas.slice(0, 40)) {
    console.log(`  ${String(o.objectno).padEnd(16)} ${String(o.objectname ?? "").padEnd(24)} ` +
                `odómetro=${o.odometer_long ?? o.odometer ?? "-"}`);
  }
  process.exit(0);
}

const hasta = Date.now();
const desde = hasta - dias * 24 * 3600 * 1000;
console.log(`Vehículo: ${objectno} · rango: últimos ${dias} días`);

// Odómetro actual, como referencia.
const actual = await llamar("showObjectReportExtern", { objectno });
let odometroActualKm = null;
if (actual.filas?.length) {
  const o = actual.filas[0];
  const km = o.odometer_long ? Number(o.odometer_long) / 1000
           : o.odometer ? Number(o.odometer) / 10 : null;
  odometroActualKm = km;
  console.log(`\nOdómetro actual (showObjectReportExtern): ${km != null ? `${km} km` : "no informado"}` +
              ` [odometer_long=${o.odometer_long ?? "-"} odometer=${o.odometer ?? "-"}` +
              ` can_odometer=${o.can_odometer ?? "-"}]`);
}

// Vía 2: libro de ruta. Se prueban las dos acciones y dos formas de rango,
// porque la documentación de Webfleet no es accesible y el nombre exacto del
// parámetro puede variar según la versión de la API contratada.
const intentos = [
  ["showLogbook", { objectno, ...rango(desde, hasta) }],
  ["showLogbook", { objectno }],
  ["showLogbook_history", { objectno, ...rango(desde, hasta) }],
];
let filasLibro = null;
let libroRespondio = false; // la API contestó (aunque fuera con 0 filas)
for (const [accion, params] of intentos) {
  const res = await llamar(accion, params);
  const filas = informar(`${accion} ${params.range_pattern ? "(con rango)" : "(sin rango)"}`, res);
  if (filas) libroRespondio = true;
  if (filas?.length) { filasLibro = filas; break; }
}

// Comparación: viajes (vía 1), que ya usamos en el backend.
const viajes = informar("showTripReportExtern (comparación, vía 1)",
                        await llamar("showTripReportExtern", { objectno, ...rango(desde, hasta) }));

// Km en el instante pedido.
if (at) {
  const { ms: tsMs, zona } = parseFecha(at);
  if (!Number.isFinite(tsMs)) {
    console.log(`\n--at no es una fecha válida: ${at}`);
    console.log(`   formatos: 29/07/2026 10:00 · 2026-07-29 10:00 · 2026-07-29T08:00:00Z`);
  } else if (tsMs > Date.now()) {
    console.log(`\n⚠ ${at} está en el FUTURO: Webfleet no puede saber los km de una fecha que no ha llegado.`);
  } else if (tsMs < Date.now() - dias * 24 * 3600 * 1000) {
    console.log(`\n⚠ ${at} queda fuera del rango consultado (${dias} días): repite con --dias mayor.`);
  } else {
    const local = new Intl.DateTimeFormat("es-ES", { timeZone: ZONA, dateStyle: "short", timeStyle: "short" }).format(new Date(tsMs));
    console.log(`\n══ Km del vehículo ${objectno} el ${local} (${zona}) = ${new Date(tsMs).toISOString()} ══`);
    for (const [etiqueta, filas, ancla] of [["libro de ruta", filasLibro, null],
                                            ["viajes", viajes, odometroActualKm]]) {
      if (!filas?.length) { console.log(`  ${etiqueta}: sin datos`); continue; }
      const r = kmEn(filas, tsMs, ancla);
      console.log(r ? `  ${etiqueta}: ${r.km?.toFixed?.(1) ?? r.km} km · ${r.metodo} · ` +
                      `referencia ${r.referencia} · precisión ${r.precision}`
                    : `  ${etiqueta}: las filas no traen ningún campo de odómetro`);
    }
  }
}

console.log("\nVeredicto: " + (
  filasLibro?.length
    ? "la vía 2 (libro de ruta) responde con datos en esta cuenta — mira arriba si trae campos de odómetro."
    : libroRespondio
      ? "la vía 2 responde pero sin filas en este rango: prueba con --dias mayor o con otro vehículo."
      : "la vía 2 no ha respondido (error de Webfleet o de red): revisa los mensajes de arriba antes de descartarla."
));
