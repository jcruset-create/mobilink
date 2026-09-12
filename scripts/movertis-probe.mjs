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
//   MOVERTIS_BASE_URL   (por defecto https://devapi.hellomovertis.com, la que contesta)
//   MOVERTIS_TOKEN      (Bearer)  | MOVERTIS_API_KEY (cabecera X-Api-Key)
//   MOVERTIS_USERNAME + MOVERTIS_PASSWORD  (Basic)
//
// Uso:
//   node scripts/movertis-probe.mjs --contrato      (LO NORMAL: la API conocida)
//   node scripts/movertis-probe.mjs                 (descubrimiento a ciegas)
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
import { spawnSync } from "node:child_process";

/*
 * El `fetch` de Node NO lee HTTPS_PROXY, y esta sonda existe para no dar
 * veredictos falsos.
 *
 * En el entorno remoto las credenciales de Movertis las inyecta el proxy. Si
 * las peticiones salen por fuera, llegan sin credencial y vuelven 403: la sonda
 * diría «Movertis nos rechaza» cuando lo que pasa es que nunca ha pasado por el
 * proxy. Es el mismo error de método que el del DNS comodín, con otro disfraz.
 *
 * Se arregla con NODE_USE_ENV_PROXY=1 (Node >= 22.21), que solo se lee al
 * arrancar. Así que si falta, el proceso se vuelve a lanzar con ella en vez de
 * avisar y seguir: un aviso que se puede ignorar acaba ignorándose.
 */
if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(
    process.execPath,
    ["--no-warnings", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } },
  );
  process.exit(r.status ?? 1);
}

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
const baseUrl = (arg("base") || process.env.MOVERTIS_BASE_URL || "https://devapi.hellomovertis.com")
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
async function llamar(ruta, { method = "GET", body = null, base = baseUrl, contentType = false } = {}) {
  const url = ruta.startsWith("http") ? ruta : `${base}${ruta.startsWith("/") ? "" : "/"}${ruta}`;
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      method,
      headers: contentType ? { ...cabeceras(), "Content-Type": "application/json" } : cabeceras(),
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
    return { ok: r.ok, http: r.status, ms, url, texto, datos, cabeceras: cab, metodo: method,
             contentType: cab["content-type"] || "",
             location: cab["location"] || null };
  } catch (e) {
    return { error: e?.name === "TimeoutError" ? "timeout (30s)" : (e?.message || String(e)),
             url, metodo: method, ms: Date.now() - t0 };
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

// El método que se ENSEÑA. Antes salía «GET» para todo lo que no viniera por
// --path, y el modo contrato manda POST: un informe que miente sobre el verbo
// no sirve para copiar la llamada a mano.
const metodoDe = (res) => res.metodo ?? (unaRuta || cuerpo ? metodo : "GET");
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

// ── El contrato REAL, una vez conocido ──────────────────────────────────────
//
// El barrido de abajo es de cuando no se sabía nada. Ya se sabe, así que lo
// primero que debe hacer la sonda es comprobar lo que el conector va a usar de
// verdad. Dos rutas, las dos POST, y ninguna se parece a lo que se adivinó:
//
//   POST /vehicle/showvehicles  {"flags":{...},"id":[]}   ← id vacío = toda la flota
//   POST /vehicle/showtrips     [{"id":N,"initial_date":ms,"end_date":ms}]
//
// Las dos contestan 201, no 200, y validan los nombres de las banderas: una
// bandera que no existe devuelve «Flag incorrecta» dentro de un cuerpo 201, lo
// cual es su manera de decir 500. Y un campo que falta devuelve un 500 con el
// error de JavaScript en crudo («Cannot read properties of undefined»), así que
// probar a ciegas aquí sale caro: se prueba con lo que se sabe.
const FLAGS_CONOCIDAS = ["basicData", "counters", "sensors"];
const CENTINELAS = [-348201.3876, 0];

async function postJson(ruta, cuerpoObj) {
  const body = JSON.stringify(cuerpoObj);
  console.log(`\n  cuerpo enviado: ${body.length > 200 ? body.slice(0, 200) + "…" : body}`);
  return llamar(ruta, { method: "POST", body, contentType: true });
}

async function modoContrato() {
  console.log(`\n${"═".repeat(66)}`);
  console.log(`CONTRATO CONOCIDO DE LA API`);

  // ── 1 · La flota ──────────────────────────────────────────────────────────
  const flota = await postJson("/vehicle/showvehicles", { flags: { basicData: true }, id: [] });
  informar("POST /vehicle/showvehicles · basicData", flota);
  if (!Array.isArray(flota.datos) || !flota.datos.length) {
    console.log(`\n✗ showvehicles no devolvió flota. Sin esto no se puede seguir.`);
    return 4;
  }
  const flotaOk = flota.datos;
  const conNombre = flotaOk.filter((v) => v?.idVehicle != null);
  console.log(`\n  ► ${flotaOk.length} vehículos · con idVehicle: ${conNombre.length}`);
  console.log(`  ► OJO: no hay NI UN campo de posición en showvehicles.`);

  // ── 2 · Contadores y sensores de uno ──────────────────────────────────────
  const uno = conNombre[1] ?? conNombre[0];
  const det = await postJson("/vehicle/showvehicles", {
    flags: { basicData: true, counters: true, sensors: true },
    id: [uno.idVehicle],
  });
  informar(`POST /vehicle/showvehicles · ${uno.name}`, det);
  const fila = Array.isArray(det.datos) ? det.datos[0] : null;
  if (fila?.counters) {
    console.log(`\n  ► counters: ${Object.keys(fila.counters).join(", ")}`);
    console.log(`  ► odometer = ${fila.counters.odometer}`);
  }
  if (fila?.sensors) {
    const ss = Object.values(fila.sensors);
    const sinDato = ss.filter((x) => CENTINELAS.includes(x?.value));
    console.log(`  ► sensores: ${ss.length} · sin dato (${CENTINELAS.join(" / ")}): ${sinDato.length}`);
    // La unidad del odómetro no se adivina por la magnitud, pero Movertis la
    // delata: si algún sensor calcula `odometer/1000` y lo llama KM, entonces
    // el crudo va en metros y `counters.odometer` —que vale lo mismo— va en km.
    const pista = ss.filter((x) => /odometer/i.test(x?.formula ?? ""));
    for (const x of pista) console.log(`  ► pista de unidad: «${x.name}» = ${x.value}  (formula: ${x.formula})`);
  }

  // ── 3 · Histórico ─────────────────────────────────────────────────────────
  const end = Date.now();
  const ini = end - 24 * 60 * 60 * 1000;
  const trips = await postJson("/vehicle/showtrips", [
    { id: uno.idVehicle, initial_date: ini, end_date: end },
  ]);
  informar(`POST /vehicle/showtrips · últimas 24 h de ${uno.name}`, trips);
  const unidad = Array.isArray(trips.datos) ? trips.datos[0] : null;
  const coords = unidad?.coords ?? [];
  console.log(`\n  ► ${coords.length} posiciones`);
  if (coords.length) {
    console.log(`  ► claves de cada punto: ${Object.keys(coords[0]).join(", ")}`);
    console.log(`  ► última: ${coords[coords.length - 1].timeString} · ${coords[coords.length - 1].pos}`);
    const conOdo = Object.keys(coords[0]).filter((k) => ODO.test(k));
    console.log(`  ► odómetro/distancia en el histórico: ${conOdo.length ? conOdo.join(", ") : "NINGUNO"}`);
  }

  // ── Veredicto ─────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(66)}`);
  console.log(`Lo que esto significa para el conector:`);
  console.log(`  1. POST con cuerpo JSON, no GET con query. Es lo que ya hace`);
  console.log(`     MovertisConnector.postear(); para comprobar el conector`);
  console.log(`     entero: RUN_MOVERTIS=1 npx vitest run …/MovertisConnector.integration`);
  console.log(`  2. El odómetro REAL está en counters.odometer de showvehicles,`);
  console.log(`     y solo del instante actual.`);
  console.log(`  3. El histórico es de POSICIONES. No hay odómetro por fecha, así`);
  console.log(`     que getTelemetryAt no puede dar kilometraje de un instante`);
  console.log(`     pasado: sirve para demostrar que el vehículo no se ha movido.`);
  console.log(`  4. showvehicles NO trae posición. La posición actual se saca de`);
  console.log(`     showtrips con una ventana corta, y un vehículo parado no emite`);
  console.log(`     nada: hay que ensanchar la ventana y coger el último punto.`);
  const ok = coords.length > 0 && fila?.counters?.odometer != null;
  console.log(`\n${ok ? "✓ Las dos rutas responden con datos reales." : "⚠ Alguna ruta respondió vacía: mira arriba."}`);
  return ok ? 0 : 2;
}

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

if (args.includes("--contrato")) {
  process.exit(await modoContrato());
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
