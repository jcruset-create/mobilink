import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { esDireccionPrivada, reiniciarSesionesRutos, Rut241Adapter } from "./rutos.ts";
import type { DispositivoAcceso } from "./types.ts";

/** Un RutOS de mentira: lo justo de la API confirmada (login + change_state). */
let servidor: http.Server;
let base = "";
const peticiones: { metodo: string; ruta: string; cuerpo: unknown; auth: string | undefined }[] = [];
let caducarProximaPeticion = false;
let dormir = 0;

beforeAll(async () => {
  servidor = http.createServer((req, res) => {
    let datos = "";
    req.on("data", (c) => (datos += c));
    req.on("end", async () => {
      const cuerpo = datos ? JSON.parse(datos) : null;
      peticiones.push({ metodo: req.method!, ruta: req.url!, cuerpo, auth: req.headers.authorization });
      if (dormir) await new Promise((r) => setTimeout(r, dormir));
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/login") {
        if (cuerpo?.password !== "secreto") return res.writeHead(401).end(JSON.stringify({ success: false }));
        return res.end(JSON.stringify({ success: true, data: { username: "mobilink", token: `tok-${peticiones.length}`, expires: 299 } }));
      }
      if (!req.headers.authorization?.startsWith("Bearer tok-")) return res.writeHead(401).end("{}");
      if (caducarProximaPeticion) {
        caducarProximaPeticion = false;
        return res.writeHead(401).end("{}");
      }
      if (req.url === "/api/io/status") return res.end(JSON.stringify({ success: true, data: [] }));
      if (req.url?.startsWith("/api/io/dout1/actions/change_state")) return res.end(JSON.stringify({ success: true }));
      res.writeHead(404).end("{}");
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`;
  process.env.SS_PRUEBA_RUT = JSON.stringify({ username: "mobilink", password: "secreto" });
  process.env.SS_PRUEBA_RUT_MALA = JSON.stringify({ username: "mobilink", password: "otra" });
});
afterAll(() => servidor.close());
beforeEach(() => {
  peticiones.length = 0;
  reiniciarSesionesRutos();
  dormir = 0;
});

const dispositivo = (extra: Partial<DispositivoAcceso> = {}): DispositivoAcceso => ({
  id: "rut-1",
  name: "RUT241 Reus",
  manufacturer: "Teltonika",
  model: "RUT241",
  connectionType: "direct_http",
  endpoint: base,
  credentialsSecretName: "SS_PRUEBA_RUT",
  driverOptions: {},
  simulation: {},
  ...extra,
});
const salida = { outputNumber: 1, pulseDurationMs: 1500, outputType: "digital_output" as const };
const rut = new Rut241Adapter();

describe("Rut241Adapter (API RutOS)", () => {
  it("login + pulso nativo con duración; el token no aparece en el resultado", async () => {
    const r = await rut.activateOutput(dispositivo(), salida);
    expect(r).toMatchObject({ ok: true });
    expect(JSON.stringify(r)).not.toMatch(/tok-/);
    expect(peticiones.map((p) => p.ruta)).toEqual(["/api/login", "/api/io/dout1/actions/change_state"]);
    expect(peticiones[1].cuerpo).toEqual({ data: { value: "1", time: 2 } });
  });

  it("firmware antiguo (on_off): enciende y SIEMPRE apaga", async () => {
    const r = await rut.activateOutput(dispositivo({ driverOptions: { pulseMode: "on_off" } }), { ...salida, pulseDurationMs: 100 });
    expect(r.ok).toBe(true);
    const valores = peticiones.filter((p) => p.ruta.includes("change_state")).map((p) => (p.cuerpo as { data: { value: string } }).data.value);
    expect(valores).toEqual(["1", "0"]);
  });

  it("token caducado: vuelve a iniciar sesión una vez y sigue", async () => {
    await rut.testConnection(dispositivo());
    caducarProximaPeticion = true;
    expect((await rut.activateOutput(dispositivo(), salida)).ok).toBe(true);
    expect(peticiones.filter((p) => p.ruta === "/api/login")).toHaveLength(2);
  });

  it("credenciales malas, variable ausente o equipo inalcanzable: fallo con código, sin abrir", async () => {
    expect(await rut.activateOutput(dispositivo({ credentialsSecretName: "SS_PRUEBA_RUT_MALA" }), salida)).toMatchObject({ ok: false, code: "AUTH_FAILED" });
    expect(await rut.activateOutput(dispositivo({ credentialsSecretName: "NO_EXISTE_ESTA" }), salida)).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
    expect(await rut.activateOutput(dispositivo({ endpoint: "http://127.0.0.1:9" }), salida)).toMatchObject({ ok: false, code: "OFFLINE" });
  });

  it("sin API de grupos de teléfonos confirmada, la sincronización falla con NOT_SUPPORTED (no a medias)", async () => {
    expect(await rut.syncAuthorizedPhones(dispositivo(), ["+34600000001"])).toMatchObject({ ok: false, code: "NOT_SUPPORTED" });
    expect(peticiones.filter((p) => p.metodo === "PUT")).toHaveLength(0);
  });

  it("VPN: el endpoint tiene que ser privado", async () => {
    expect(esDireccionPrivada("10.8.0.5")).toBe(true);
    expect(esDireccionPrivada("100.70.1.2")).toBe(true);
    expect(esDireccionPrivada("8.8.8.8")).toBe(false);
    expect(await rut.testConnection(dispositivo({ connectionType: "vpn_http", endpoint: "https://8.8.8.8" }))).toMatchObject({ ok: false, code: "NOT_CONFIGURED" });
  });
});
