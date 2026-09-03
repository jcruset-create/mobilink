/**
 * El cerrojo de escritura.
 *
 * Lo importante: que esté EN EL CONECTOR y no en quien llama. Una protección
 * que depende de que cada sitio se acuerde de comprobarla es una protección que
 * un día no se comprueba.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let rpcLlamados: string[] = [];
let respuestaRpc: any = { data: null, error: null };

vi.mock("./sesion.ts", () => ({
  clienteTyreControl: async () => ({
    rpc: async (nombre: string) => { rpcLlamados.push(nombre); return respuestaRpc; },
  }),
  olvidarSesionTc: () => {},
}));

const { escrituraHabilitada, llamarRpc } = await import("./conector.ts");

beforeEach(() => { rpcLlamados = []; respuestaRpc = { data: { ok: true }, error: null }; });
afterEach(() => { delete process.env.TYRE_CONTROL_WRITE_ENABLED; });

describe("Interruptor de escritura", () => {
  it("por defecto está apagado", () => {
    expect(escrituraHabilitada()).toBe(false);
  });

  /* ÉSTA es la prueba del apartado: con el flag apagado no sale ni un RPC. */
  it("apagado, una operación de escritura NO llega a llamar a TyreControl", async () => {
    const r = await llamarRpc("TC_TYRE_MOUNT", "tc_montar_neumatico", { p_vehiculo: "x" });
    expect(r).toMatchObject({
      ok: false,
      codigo: "tc_write_disabled",
      reintentable: false,   // no es un fallo: es una decisión
    });
    expect(rpcLlamados).toEqual([]);      // no se ha llamado a nada
  });

  it("apagado, la lectura sigue funcionando", async () => {
    const r = await llamarRpc("TC_VEHICLE_STATE", "tc_revision_estado");
    expect(r.ok).toBe(true);
    expect(rpcLlamados).toEqual(["tc_revision_estado"]);
  });

  it("encendido, la escritura ya no la para el conector", async () => {
    process.env.TYRE_CONTROL_WRITE_ENABLED = "true";
    const r = await llamarRpc("TC_TYRE_MOUNT", "tc_montar_neumatico");
    expect(r.ok).toBe(true);
  });

  it("solo «true» lo enciende: cualquier otra cosa lo deja apagado", () => {
    for (const v of ["false", "1", "sí", "TRUE ", ""]) {
      process.env.TYRE_CONTROL_WRITE_ENABLED = v;
      expect(escrituraHabilitada()).toBe(v.toLowerCase().trim() === "true" && v === "true");
    }
  });
});

describe("Errores normalizados", () => {
  it("«Sin permiso» de TC se traduce y no se reintenta", async () => {
    respuestaRpc = { data: null, error: { message: "Sin permiso para montar en esta empresa" } };
    const r = await llamarRpc("TC_VEHICLE_STATE", "loquesea");
    expect(r).toMatchObject({ ok: false, codigo: "tc_permission_denied", reintentable: false });
  });

  it("una medida incompatible no se reintenta", async () => {
    respuestaRpc = { data: null, error: { message: "La medida del neumático no es compatible" } };
    const r = await llamarRpc("TC_VEHICLE_STATE", "loquesea");
    expect(r).toMatchObject({ ok: false, reintentable: false });
  });

  it("un corte de red sí se reintenta", async () => {
    respuestaRpc = { data: null, error: { message: "fetch failed" } };
    const r = await llamarRpc("TC_VEHICLE_STATE", "loquesea");
    expect(r).toMatchObject({ ok: false, reintentable: true });
  });

  /* Un token que vence a mitad de un lote es el caso típico. */
  it("un token caducado se renueva y se vuelve a intentar UNA vez", async () => {
    respuestaRpc = { data: null, error: { message: "JWT expired" } };
    await llamarRpc("TC_VEHICLE_STATE", "tc_revision_estado");
    expect(rpcLlamados).toEqual(["tc_revision_estado", "tc_revision_estado"]);
  });
});
