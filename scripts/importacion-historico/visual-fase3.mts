/**
 * Comprueba en el PANEL REAL lo que la fase 3 tiene que enseñar: el
 * kilometraje anómalo con su ritmo y su límite, el aviso del albarán
 * bloqueado, los motivos por los que un intervalo no entra en las medias, el
 * diálogo de revisión con motivo obligatorio, y la cobertura en el informe de
 * montajes.
 *
 * Necesita el stack local de pruebas levantado (PostgREST + stub de auth +
 * Vite) y una base con el histórico importado. Nada de esto toca producción.
 *
 *   PANEL=http://127.0.0.1:5177 CLAVES=<ruta>/claves.json BASE_DB=esquema_completo \
 *   MATRICULA=1445HWZ SALIDA=<dir> npx tsx scripts/importacion-historico/visual-fase3.mts
 *
 * Imprime una línea OK/MAL por comprobación y sale con código 1 si falla
 * alguna. Deja las capturas en SALIDA.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

// playwright-core NO es dependencia del repositorio: esto es un script de
// desarrollo y no merece arrastrar un paquete pesado al `npm ci` de la CI. Se
// resuelve en tiempo de ejecución, y con PLAYWRIGHT_CORE se puede apuntar a
// una instalación de otra carpeta.
const { chromium } = (await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core")
  .catch(() => {
    console.error("Falta playwright-core. Instálalo (npm i -D playwright-core) o apunta");
    console.error("PLAYWRIGHT_CORE a una instalación existente, por ejemplo:");
    console.error("  PLAYWRIGHT_CORE=/ruta/node_modules/playwright-core/index.mjs");
    process.exit(1);
  })) as typeof import("playwright-core");

const PANEL = process.env.PANEL ?? "http://127.0.0.1:5177";
const CLAVES = process.env.CLAVES ?? "rest/claves.json";
const BASE_DB = process.env.BASE_DB ?? "esquema_completo";
const MATRICULA = process.env.MATRICULA ?? "1445HWZ";
const SALIDA = process.env.SALIDA ?? ".";
const NAVEGADOR = process.env.PLAYWRIGHT_CHROMIUM ?? "/opt/pw-browsers/chromium";

if (!/^(banco_|esquema_completo)/.test(BASE_DB)) {
  console.error(`Base no permitida: '${BASE_DB}'. Solo bases de pruebas.`);
  process.exit(1);
}
fs.mkdirSync(SALIDA, { recursive: true });
const claves = JSON.parse(fs.readFileSync(CLAVES, "utf8")) as Record<string, string>;
const psql = (q: string) =>
  execFileSync("psql", ["-h", process.env.PGHOST ?? "127.0.0.1", "-p", process.env.PGPORT ?? "5433",
    "-U", process.env.PGUSER ?? "mobilink", "-d", BASE_DB, "-At", "-c", q]).toString().trim();

const vehiculo = psql(`select id from tc_vehiculos where matricula='${MATRICULA}' limit 1`);
if (!vehiculo) { console.error(`No hay ningún vehículo ${MATRICULA} en ${BASE_DB}`); process.exit(1); }

let fallos = 0;
const comprobar = (etiqueta: string, ok: boolean) => { if (!ok) fallos++; console.log(`${ok ? "OK  " : "MAL "} ${etiqueta}`); };

const navegador = await chromium.launch({ executablePath: NAVEGADOR, headless: true });
const page = await navegador.newPage({ viewport: { width: 1500, height: 1200 } });
const errores: string[] = [];
page.on("pageerror", (e) => errores.push("pageerror: " + e.message));
const foto = (n: string) => page.screenshot({ path: `${SALIDA}/${n}.png`, fullPage: true });

const ahora = Math.floor(Date.now() / 1000);
await page.goto(`${PANEL}/tyrecontrol/login`);
await page.evaluate((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), {
  access_token: claves.admin, refresh_token: "r", token_type: "bearer", expires_in: 86400, expires_at: ahora + 86400,
  user: { id: "00000000-0000-0000-0000-0000000000aa", aud: "authenticated", role: "authenticated",
          email: "admin.pruebas@local", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
});

// ── La ficha del vehículo ──────────────────────────────────────────────────
await page.goto(`${PANEL}/tyrecontrol/vehiculos/${vehiculo}`);
await page.waitForLoadState("networkidle"); await page.waitForTimeout(2500);
await foto("fase3-vehiculo");
const t = await page.locator("body").innerText();
comprobar("sale la ocupación reconstruida", /OCUPACI[ÓO]N RECONSTRUIDA DEL HIST[ÓO]RICO/i.test(t));
comprobar("el recorrido anómalo se enseña con su cifra, no en blanco", /km \(estimado,/.test(t));
comprobar("el ritmo lleva días y límite", /km\/día en \d+ día\(s\)/.test(t) && /límite [\d.,]+ km\/día/.test(t));
comprobar("avisa del posible montaje intermedio bloqueado", /posible montaje intermedio sin importar/i.test(t));
comprobar("dice si entra en las medias", /fuera de las medias|entra en las medias/.test(t));
comprobar("publica la cobertura de la media", /Sobre \d+ de \d+ intervalos reconstruidos/.test(t));
comprobar("separa los tres grupos de identidad", /identidad respaldada/i.test(t)
  && /ficha reconstruida/i.test(t) && /sin ficha/i.test(t));
comprobar("hay botones de aceptar y rechazar", /Aceptar/.test(t) && /Rechazar/.test(t));
comprobar("los dos ámbitos se ofrecen por separado", /\bkm\b/i.test(t) && /continuidad/i.test(t));

// ── Los dos ámbitos, uno detrás de otro ───────────────────────────────────
//
// Lo que se comprueba aquí es justo lo que no puede pasar: que aceptar los
// kilómetros meta el intervalo en las medias teniendo la continuidad en duda.
/** Acepta en la MISMA fila que ya tiene los km aceptados: el botón de
 *  continuidad es el segundo «Aceptar» de esa fila. */
async function aceptarContinuidadDeLaFila(motivo: string) {
  const fila = page.locator("tr").filter({ hasText: "km: aceptado" }).first();
  const b = fila.getByRole("button", { name: "Aceptar" }).last();
  if (!(await b.count())) return false;
  await b.click(); await page.waitForTimeout(600);
  const guardar = page.getByRole("button", { name: "Guardar", exact: true });
  const deshabilitado = await guardar.isDisabled();
  await page.locator("textarea").first().fill(motivo);
  const habilitado = !(await guardar.isDisabled());
  await guardar.click(); await page.waitForTimeout(2500);
  return deshabilitado && habilitado;
}
const aceptar = page.getByRole("button", { name: "Aceptar" }).first();
if (await aceptar.count()) {
  await aceptar.click(); await page.waitForTimeout(600);
  await foto("fase3-dialogo-revision");
  const d = await page.locator("body").innerText();
  comprobar("el diálogo pide motivo obligatorio", /MOTIVO \(OBLIGATORIO\)/i.test(d));
  comprobar("avisa de que no lo convierte en rendimiento confirmado", /No lo convierte en rendimiento confirmado/i.test(d));
  comprobar("y de que aceptar los km NO resuelve la continuidad", /NO resuelve la continuidad/i.test(d));
  const guardar = page.getByRole("button", { name: "Guardar", exact: true });
  comprobar("Guardar está deshabilitado sin motivo", await guardar.isDisabled());
  await page.locator("textarea").first().fill("Comprobación automática: kilómetros");
  comprobar("y se habilita al escribir el motivo", !(await guardar.isDisabled()));
  await guardar.click(); await page.waitForTimeout(2500);
  await foto("fase3-tras-aceptar-km");
  const t2 = await page.locator("body").innerText();
  comprobar("consta quién decidió, cuándo y por qué", /km: aceptado el /.test(t2) && /Comprobación automática/.test(t2));
  comprobar("el recorrido no cambia y sigue siendo estimado", /km \(estimado, aceptado a mano\)/.test(t2));
  // Con la continuidad en duda, aceptar los km NO basta.
  const hayDuda = /posible montaje intermedio sin importar/i.test(t2);
  if (hayDuda) {
    comprobar("con la continuidad en duda, aceptar los km no mete el intervalo en las medias",
      /fuera de las medias/.test(t2) && /continuidad pendiente/i.test(t2));
    const ok2 = await aceptarContinuidadDeLaFila("Comprobación automática: continuidad");
    comprobar("la continuidad también pide su motivo", ok2);
    await foto("fase3-tras-aceptar-continuidad");
    const t3 = await page.locator("body").innerText();
    comprobar("con las DOS decisiones, ya entra en las medias", /entra en las medias/.test(t3));
    comprobar("y las dos constan por separado", /km: aceptado/.test(t3) && /continuidad: aceptada/.test(t3));
  } else {
    comprobar("sin dudas de continuidad, con los km aceptados ya entra", /entra en las medias/.test(t2));
  }
}

// ── El informe de montajes ────────────────────────────────────────────────
await page.goto(`${PANEL}/tyrecontrol/informes/montajes`);
await page.waitForLoadState("networkidle"); await page.waitForTimeout(1200);
const desde = page.locator('input[type="date"]').first(), hasta = page.locator('input[type="date"]').nth(1);
if (await desde.count()) { await desde.fill("2026-01-01"); await hasta.fill("2026-12-31"); await page.waitForTimeout(2500); }
await foto("fase3-informe-cobertura");
const t3 = await page.locator("body").innerText();
comprobar("el informe publica el recorrido estimado", /recorrido estimado del hist[óo]rico/i.test(t3));
comprobar("y dice que no es rendimiento confirmado", /no (es|son) rendimiento confirmado/i.test(t3));
comprobar("separa los tres grupos de identidad", /identidad respaldada por una persona/i.test(t3)
  && /ficha reconstruida por la importaci[óo]n/i.test(t3) && /ocupaci[óo]n de posici[óo]n sin ficha/i.test(t3));
comprobar("enseña los motivos de exclusión", /fuera de la media/i.test(t3));
comprobar("avisa de que los motivos se solapan", /no suma el total/i.test(t3));
comprobar("dice el límite de plausibilidad aplicado", /L[íi]mite de plausibilidad aplicado/i.test(t3));

if (errores.length) { console.log("ERRORES DE PÁGINA:\n" + errores.join("\n")); fallos += errores.length; }
await navegador.close();
console.log(fallos === 0 ? "todo en verde" : `${fallos} comprobación(es) sin pasar`);
process.exit(fallos === 0 ? 0 : 1);
