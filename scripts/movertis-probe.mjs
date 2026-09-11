#!/usr/bin/env node
// ============================================================================
// Sonda de Movertis (telemática de Autocares Plana, *.hellomovertis.com).
//
// Movertis es el proveedor que viene DESPUÉS de Webfleet en el Telematics Hub
// (ver server/integration-hub/domain/telematics.ts). Antes de cerrar su
// conector hay que saber qué forma tiene su API: qué rutas responden, cómo se
// autentica y con qué nombres devuelve odómetro, posición y matrícula.
//
// ── La prueba de control, y por qué la sonda nació coja ─────────────────────
//
// La primera versión de esta sonda daba un veredicto tajante —«el upstream de
// Movertis está caído»— y lo repitió durante horas. Era FALSO, y el error de
// método es instructivo: `*.hellomovertis.com` tiene DNS COMODÍN, así que
// cualquier subdominio resuelve, exista o no. Un `noexiste-xyz-12345.` se
// comportaba exactamente igual que `api.`: mismo 502, misma página de nginx
// por el puerto 80. La sonda estaba midiendo el comodín y llamándolo Movertis.
//
// Por eso ahora lo PRIMERO que hace es sondear un subdominio inventado al
// azar, y comparar. Si el host que interesa se comporta igual que un nombre
// que no existe, no se ha demostrado nada sobre Movertis. Si se comporta
// distinto —otra IP, otro `server`, cabeceras de aplicación—, entonces hay un
// servicio de verdad detrás y se puede decir algo.
//
// ── Qué se mira para saber si hay servidor ──────────────────────────────────
//
// Un 404 NO significa «no hay nadie». Un Express vivo devuelve 404 a toda ruta
// que no tenga registrada, y eso es un servidor sano contestando que esa ruta
// no existe. Lo que delata a la aplicación son sus cabeceras (`x-powered-by`,
// las de Helmet, CORS) y que responda a un OPTIONS. Distinguir «no hay
// servidor» de «hay servidor y no conozco sus rutas» es el trabajo de esta
// sonda, porque son dos problemas distintos con dos soluciones distintas:
// esperar a que vuelva, o conseguir la documentación.
//
// ── Los dos esquemas ────────────────────────────────────────────────────────
//
// Se prueban HTTPS y HTTP. No es paranoia: en Movertis el puerto 80 alcanza la
// aplicación real y el 443 da 502 por la pasarela, así que mirar solo HTTPS
// llevaba a concluir que no había nada cuando sí lo había.
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
//   node scripts/movertis-probe.mjs                 (diagnóstico + barrido)
//   node scripts/movertis-probe.mjs --path /api/vehicles
//   node scripts/movertis-probe.mjs --path /api/login --method POST \
//        --body '{"user":"x"}'
//   node scripts/movertis-probe.mjs --raw           (vuelca el cuerpo entero)
//   node scripts/movertis-probe.mjs --base https://app.hellomovertis.com
//   node scripts/movertis-probe.mjs --sin-control   (se salta la comparación)
//
// Códigos de salida: 0 alguna ruta viva · 2 servidor vivo sin rutas conocidas
//                    3 indistinguible del comodín · 4 nada alcanzable
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
const sinControl = args.includes("--sin-control");
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
async function llamar(ruta, { method = "GET", body = null, base = baseUrl } = {}) {
  const url = ruta.startsWith("http") ? ruta : `${base}${ruta.startsWith("/") ? "" : "/"}${ruta}`;
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
    const cab = {};
    r.headers.forEach((v, k) => { cab[k.toLowerCase()] = v; });
    return { ok: r.ok, http: r.status, ms, url, texto, datos, cabeceras: cab,
             contentType: cab["content-type"] || "",
             location: cab["location"] || null };
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

// ── ¿Hay una aplicación detrás, o solo el comodín? ──────────────────────────

/**
 * Cabeceras que delatan una aplicación real, no un nginx de fábrica.
 *
 * `x-powered-by` lo pone Express; el resto son las de Helmet, que casi nadie
 * añade a mano. Un servidor que las emite está ejecutando código de alguien,
 * aunque conteste 404 a todo lo que le preguntemos.
 */
const MARCAS_APP = [
  "x-powered-by", "access-control-allow-origin", "x-frame-options",
  "x-content-type-options", "strict-transport-security", "x-dns-prefetch-control",
  "x-download-options", "x-xss-protection", "access-control-allow-methods",
];

function marcasDe(res) {
  if (!res || res.error || !res.cabeceras) return [];
  return MARCAS_APP.filter((m) => res.cabeceras[m] !== undefined);
}

/**
 * Huella de una respuesta, para comparar dos hosts sin mirar el cuerpo entero.
 *
 * Incluye el tamaño porque dos páginas por defecto de nginx son idénticas byte
 * a byte, y esa igualdad es justo lo que revela que detrás no hay nada propio.
 */
function huella(res) {
  if (!res) return "sin-respuesta";
  if (res.error) return `error:${res.error}`;
  return [res.http, res.cabeceras?.server ?? "-", res.cabeceras?.["content-length"] ?? res.texto.length].join("|");
}

/** Un subdominio que no puede existir, para comparar. */
function hostDeControl(base) {
  const { hostname, protocol } = new URL(base);
  const partes = hostname.split(".");
  const dominio = partes.slice(-2).join(".");
  const azar = Math.random().toString(36).slice(2, 10);
  return `${protocol}//noexiste-${azar}.${dominio}`;
}

/** Sondea la raíz de una base por los dos esquemas. */
async function sondearRaiz(base) {
  const { hostname } = new URL(base);
  const https = await llamar("/", { base: `https://${hostname}` });
  const http = await llamar("/", { base: `http://${hostname}` });
  const options = await llamar("/", { base: `http://${hostname}`, method: "OPTIONS" });
  return { hostname, https, http, options };
}

function describirEsquema(nombre, res) {
  if (res.error) return `  ${nombre.padEnd(6)} ✗ ${res.error}`;
  const marcas = marcasDe(res);
  const extra = marcas.length ? ` · marcas de app: ${marcas.length} (${marcas.slice(0, 3).join(", ")}…)` : "";
  return `  ${nombre.padEnd(6)} HTTP ${res.http} · server=${res.cabeceras?.server ?? "-"}${extra}`;
}

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
  let res = await llamar(unaRuta, { method: metodo, body: cuerpo });
  informar(unaRuta, res);

  /*
   * Si la pasarela no llega, se reintenta por el OTRO esquema antes de dar el
   * asunto por perdido. No es un capricho: en Movertis la aplicación contesta
   * por HTTP y el 443 da 502, así que probar solo el esquema de la base es
   * exactamente el error que esta sonda existe para no repetir. Quien traiga
   * una ruta buena merece verla funcionar, no un 503 que no es suyo.
   */
  if (!res.error && res.http >= 502 && res.http <= 504) {
    const u = new URL(baseUrl);
    const otro = u.protocol === "https:" ? "http" : "https";
    console.log(`\n  (5xx de pasarela por ${u.protocol.replace(":", "")}: se reintenta por ${otro})`);
    res = await llamar(unaRuta, { method: metodo, body: cuerpo, base: `${otro}://${u.hostname}` });
    informar(`${unaRuta} [${otro}]`, res);
  }
  process.exit(res.error || !res.ok ? 1 : 0);
}

// ── 1 · ¿Con quién estamos hablando? ────────────────────────────────────────
const objetivo = await sondearRaiz(baseUrl);
let control = null;
if (!sinControl) control = await sondearRaiz(hostDeControl(baseUrl));

console.log(`\n${"═".repeat(66)}`);
console.log(`DIAGNÓSTICO DEL HOST`);
console.log(`\n  ${objetivo.hostname} (el que interesa)`);
console.log(describirEsquema("https", objetivo.https));
console.log(describirEsquema("http", objetivo.http));
console.log(describirEsquema("OPTIONS", objetivo.options));

if (control) {
  console.log(`\n  ${control.hostname} (inventado, NO existe — es la prueba de control)`);
  console.log(describirEsquema("https", control.https));
  console.log(describirEsquema("http", control.http));
}

// El comodín resuelve cualquier nombre, así que «resuelve» no prueba nada. Lo
// que prueba algo es parecerse o no a un nombre que sabemos que no existe.
const mismaHuellaHttp = control && huella(objetivo.http) === huella(control.http);
const mismaHuellaHttps = control && huella(objetivo.https) === huella(control.https);
const indistinguible = control && mismaHuellaHttp && mismaHuellaHttps;

const marcas = [...new Set([...marcasDe(objetivo.http), ...marcasDe(objetivo.https), ...marcasDe(objetivo.options)])];
const hayApp = marcas.length > 0;

console.log(`\n  Veredicto del host:`);
if (indistinguible) {
  console.log(`  ⚠ ${objetivo.hostname} responde IGUAL que un subdominio inventado.`);
  console.log(`    Hay DNS comodín: que el nombre resuelva no demuestra que exista`);
  console.log(`    ese servicio. No se ha probado nada sobre Movertis.`);
} else if (hayApp) {
  console.log(`  ✓ Hay una APLICACIÓN detrás (${marcas.length} cabeceras propias:`);
  console.log(`    ${marcas.join(", ")}).`);
  console.log(`    Un 404 suyo significa «esa ruta no existe», no «no hay servidor».`);
} else {
  console.log(`  · Se distingue del comodín, pero no emite cabeceras de aplicación.`);
}

// El esquema por el que sí se alcanza la aplicación. No siempre es HTTPS.
const esquemaUtil = marcasDe(objetivo.http).length ? "http"
                  : marcasDe(objetivo.https).length ? "https"
                  : null;
if (esquemaUtil && new URL(baseUrl).protocol !== `${esquemaUtil}:`) {
  console.log(`\n  ⚠ La aplicación contesta por ${esquemaUtil.toUpperCase()}, no por` +
              ` ${new URL(baseUrl).protocol.replace(":", "").toUpperCase()}.`);
  console.log(`    El barrido usará ${esquemaUtil.toUpperCase()}; si la API debe ir cifrada,`);
  console.log(`    el problema está en el TLS del proveedor o en la salida del proxy.`);
}
const baseBarrido = esquemaUtil ? `${esquemaUtil}://${objetivo.hostname}` : baseUrl;

// ── 2 · Barrido de rutas ────────────────────────────────────────────────────
console.log(`\n${"═".repeat(66)}`);
console.log(`Barriendo ${CANDIDATAS.length} rutas candidatas sobre ${baseBarrido}…`);

let vivas = 0;      // 2xx/3xx, o 4xx que no sea 404: la ruta EXISTE.
let noExisten = 0;  // 404 de una aplicación viva: la ruta no está registrada.
let pasarela = 0;   // 502/503/504: no se llegó al servidor.
let redKo = 0;      // ni respuesta.
const encontradas = [];

for (const ruta of CANDIDATAS) {
  const res = await llamar(ruta, { base: baseBarrido });
  informar(ruta, res);
  if (res.error) redKo++;
  else if (res.http >= 502 && res.http <= 504) pasarela++;
  else if (res.http === 404) noExisten++;
  else { vivas++; encontradas.push(`${ruta} → ${res.http}`); }
}

// ── 3 · Veredicto ───────────────────────────────────────────────────────────
console.log(`\n${"═".repeat(66)}`);
console.log(`Rutas: ${vivas} vivas · ${noExisten} inexistentes (404) · ` +
            `${pasarela} con 5xx de pasarela · ${redKo} sin respuesta (de ${CANDIDATAS.length}).`);

if (vivas > 0) {
  console.log(`\n✓ HAY RUTAS VIVAS. Por aquí se sigue:`);
  for (const e of encontradas) console.log(`    ${e}`);
  console.log(`\n  Mira arriba sus claves para fijar el mapeo en el conector`);
  console.log(`  (server/integration-hub/connectors/telematics/movertis/mapeo.ts).`);
  process.exit(0);
}

if (hayApp && noExisten > 0) {
  console.log(`\n⚠ EL SERVIDOR ESTÁ VIVO, PERO NO CONOCEMOS SUS RUTAS.`);
  console.log(`  Contesta 404 a las ${noExisten} candidatas, que son nombres inventados`);
  console.log(`  por esta sonda, no los suyos. Esto NO se arregla reintentando: hace`);
  console.log(`  falta la documentación de la API de Movertis, o una URL de ejemplo.`);
  console.log(`  Con una ruta real se comprueba al momento:  --path /la/que/sea`);
  process.exit(2);
}

if (indistinguible) {
  console.log(`\n⚠ NO SE PUEDE AFIRMAR NADA SOBRE MOVERTIS.`);
  console.log(`  Este host responde igual que un subdominio inventado: lo que se está`);
  console.log(`  midiendo es el comodín del dominio. Hace falta la URL base de verdad.`);
  process.exit(3);
}

if (pasarela > 0) {
  console.log(`\n✗ No se llega al servidor por ${baseBarrido} (5xx de pasarela).`);
  console.log(`  Ojo: esto por sí solo NO demuestra que Movertis esté caído — puede`);
  console.log(`  ser un host equivocado o un TLS que no levanta. Compara con la`);
  console.log(`  prueba de control de arriba antes de concluir.`);
  process.exit(4);
}

console.log(`\n✗ Nada respondió. Revisa la conectividad del proxy hacia ${baseBarrido}.`);
process.exit(4);
