#!/usr/bin/env node
// ============================================================================
// Sonda de Movertis (telemática de Autocares Plana, *.hellomovertis.com).
//
// Movertis es el proveedor que viene DESPUÉS de Webfleet en el Telematics Hub
// (ver server/integration-hub/domain/telematics.ts). Antes de escribir el
// conector hay que saber qué forma tiene su API: qué rutas responden, cómo se
// autentica y con qué nombres devuelve odómetro, posición y matrícula. Esta
// sonda es exactamente eso —una de descubrimiento, hermana de
// scripts/webfleet-logbook-test.mjs—: llama a un puñado de rutas candidatas,
// vuelca el estado y las claves de lo que devuelve, y no da nada por hecho.
//
// Autenticación: en el entorno remoto el proxy INYECTA las credenciales de la
// cuenta «Movertis Autocares Plana» para todo *.hellomovertis.com, así que no
// hacen falta claves. Fuera de ese entorno se pueden pasar por variables de
// entorno o por el .env de la raíz:
//   MOVERTIS_BASE_URL   (por defecto https://api.hellomovertis.com)
//   MOVERTIS_TOKEN      (Bearer)  | MOVERTIS_API_KEY (cabecera X-Api-Key)
//   MOVERTIS_USERNAME + MOVERTIS_PASSWORD  (Basic)
//
// Uso:
//   node scripts/movertis-probe.mjs                 (barre las rutas candidatas)
//   node scripts/movertis-probe.mjs --path /api/vehicles
//   node scripts/movertis-probe.mjs --path /api/positions --method POST \
//        --body '{"from":"2026-09-01"}'
//   node scripts/movertis-probe.mjs --raw           (vuelca el cuerpo entero)
//   node scripts/movertis-probe.mjs --base https://app.hellomovertis.com
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(__dirname, "..");

// ── .env sencillo (sin dependencias), como en la sonda de Webfleet ──────────
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
const soloRaw = args.includes("--raw");
const unaRuta = arg("path");
const metodo = (arg("method", "GET") || "GET").toUpperCase();
const cuerpo = arg("body");
const baseUrl = (arg("base") || process.env.MOVERTIS_BASE_URL || "https://api.hellomovertis.com")
  .replace(/\/+$/, "");

const { MOVERTIS_TOKEN: token, MOVERTIS_API_KEY: apikey,
        MOVERTIS_USERNAME: username, MOVERTIS_PASSWORD: password } = process.env;

// Cabeceras de autenticación. Si el proxy inyecta las credenciales, estas no
// estarán definidas y no pasa nada: el proxy pone lo suyo por encima.
function cabeceras() {
  const h = { Accept: "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  else if (username && password) {
    h.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }
  if (apikey) h["X-Api-Key"] = apikey;
  if (cuerpo) h["Content-Type"] = "application/json";
  return h;
}

const ODO = /odo|mileage|kilomet|\bkm\b|distance|distancia/i;
const POS = /lat|lon|lng|posic|position|coord|gps/i;
const MAT = /plate|matric|matr[ií]cula|license|registration/i;

// ── Una llamada, contada con detalle ─────────────────────────────────────────
async function llamar(ruta, { method = "GET", body = null } = {}) {
  const url = ruta.startsWith("http") ? ruta : `${baseUrl}${ruta.startsWith("/") ? "" : "/"}${ruta}`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method,
      headers: cabeceras(),
      body: body ?? undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    const texto = await r.text();
    const ms = Date.now() - t0;
    let datos = null;
    try { datos = JSON.parse(texto); } catch { /* no era JSON */ }
    return { ok: r.ok, http: r.status, ms, url, texto, datos,
             contentType: r.headers.get("content-type") || "",
             location: r.headers.get("location") || null };
  } catch (e) {
    return { error: e?.name === "TimeoutError" ? "timeout (30s)" : (e?.message || String(e)),
             url, ms: Date.now() - t0 };
  }
}

// ── Cómo se cuenta lo que devuelve una ruta ──────────────────────────────────
function informar(etiqueta, res) {
  const cab = `── ${etiqueta} `;
  console.log(`\n${cab}${"─".repeat(Math.max(0, 64 - cab.length))}`);
  console.log(`  ${metodoDe(res)} ${res.url}`);
  if (res.error) { console.log(`  ✗ fallo de red: ${res.error}`); return; }
  const marca = res.ok ? "✓" : (res.http >= 300 && res.http < 400 ? "→" : "✗");
  console.log(`  ${marca} HTTP ${res.http} · ${res.ms} ms · ${res.contentType || "sin content-type"}`);
  if (res.location) console.log(`  redirige a: ${res.location}`);

  if (soloRaw) { console.log(`  cuerpo:\n${sangrar(res.texto.slice(0, 4000))}`); return; }

  if (res.datos == null) {
    // No es JSON: casi siempre HTML de error o de login. Con la primera línea
    // útil basta para no llenar la pantalla.
    const resumen = res.texto.replace(/\s+/g, " ").trim().slice(0, 200);
    console.log(`  cuerpo (no JSON, ${res.texto.length} B): ${resumen || "(vacío)"}`);
    return;
  }

  const filas = Array.isArray(res.datos) ? res.datos
              : Array.isArray(res.datos?.data) ? res.datos.data
              : Array.isArray(res.datos?.items) ? res.datos.items
              : Array.isArray(res.datos?.results) ? res.datos.results
              : null;

  if (!filas) {
    const claves = Object.keys(res.datos);
    console.log(`  JSON (objeto) · claves (${claves.length}): ${claves.join(", ")}`);
    console.log(sangrar(JSON.stringify(res.datos, null, 2).slice(0, 1200)));
    return;
  }

  console.log(`  JSON (lista) · ${filas.length} elementos`);
  if (!filas.length) return;
  const claves = Object.keys(filas[0] ?? {});
  console.log(`  claves (${claves.length}): ${claves.join(", ")}`);
  const marca2 = (re) => claves.filter((k) => re.test(k)).join(", ") || "NINGUNO";
  console.log(`  ► odómetro/km: ${marca2(ODO)}`);
  console.log(`  ► posición:    ${marca2(POS)}`);
  console.log(`  ► matrícula:   ${marca2(MAT)}`);
  console.log(`  muestra:\n${sangrar(JSON.stringify(filas[0], null, 2).slice(0, 1200))}`);
}

const metodoDe = (res) => (unaRuta || cuerpo ? metodo : "GET");
const sangrar = (s) => s.split("\n").map((l) => `    ${l}`).join("\n");

// ── Rutas candidatas para descubrir la API ───────────────────────────────────
// No son las rutas "oficiales" (aún no las conocemos): son sondas. Lo que
// responda algo distinto de 404 marca por dónde seguir.
const CANDIDATAS = [
  "/", "/health", "/status", "/ping", "/version", "/info",
  "/api", "/api/v1", "/api/v2", "/v1", "/v2",
  "/api/vehicles", "/api/v1/vehicles", "/vehicles", "/api/fleet",
  "/api/positions", "/api/v1/positions", "/positions", "/api/tracking",
  "/api/drivers", "/api/users", "/api/me", "/api/account",
  "/docs", "/api-docs", "/swagger.json", "/openapi.json",
];

// ── Ejecución ─────────────────────────────────────────────────────────────────
const tieneCreds = !!(token || apikey || (username && password));
console.log(`Base: ${baseUrl}`);
console.log(`Auth: ${tieneCreds ? "credenciales en el entorno" : "ninguna local (se confía en la inyección del proxy)"}`);

if (unaRuta) {
  const res = await llamar(unaRuta, { method: metodo, body: cuerpo });
  informar(unaRuta, res);
  process.exit(res.error || !res.ok ? 1 : 0);
}

console.log(`\nBarriendo ${CANDIDATAS.length} rutas candidatas…`);
let vivas = 0; // 2xx/3xx o 4xx que NO sea 404: rutas reales que responden algo.
let gateway5xx = 0; // 502/503/504: el proxy llega, pero Movertis no contesta.
let redKo = 0; // ni siquiera hubo respuesta (timeout, reset del propio proxy).
for (const ruta of CANDIDATAS) {
  const res = await llamar(ruta);
  informar(ruta, res);
  if (res.error) redKo++;
  else if (res.http >= 502 && res.http <= 504) gateway5xx++;
  else if (res.http !== 404) vivas++;
}

console.log(`\n${"═".repeat(66)}`);
console.log(`Rutas: ${vivas} vivas · ${gateway5xx} con 5xx de pasarela · ${redKo} sin respuesta` +
            ` (de ${CANDIDATAS.length}).`);
if (vivas === 0 && gateway5xx > 0) {
  console.log(`Veredicto: el proxy alcanza ${baseUrl} pero el upstream de Movertis está caído`);
  console.log(`o rechaza la conexión (5xx «remote connection failure»). No es un problema de`);
  console.log(`rutas ni de credenciales: no hay servidor detrás ahora mismo. Reintentar más tarde.`);
  process.exit(2);
}
if (vivas === 0 && redKo === CANDIDATAS.length) {
  console.log(`Veredicto: ninguna ruta respondió. Revisa la conectividad del proxy hacia ${baseUrl}.`);
  process.exit(2);
}
if (vivas === 0) {
  console.log(`Veredicto: el host contesta pero no por estas rutas (todo 404).`);
  console.log(`Prueba otra base (--base) o una ruta concreta (--path /lo/que/sea).`);
}
process.exit(0);
