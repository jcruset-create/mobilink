import { describe, expect, it, vi, beforeEach } from "vitest";
import { licenciasDeUsuario } from "./data";

// El cliente de Supabase se sustituye por uno de mentira: lo que se prueba es
// que un fallo al consultar NUNCA sale de aquí. Si saliera, se lleva por
// delante la pestaña de Acceso del empleado, que es lo que pasó.
const rpc = vi.fn();
vi.mock("./supabase", () => ({
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    // apiFetch pide la sesión nada más importarse; sin esto ni se carga.
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
}));


describe("licenciasDeUsuario", () => {
  beforeEach(() => {
    rpc.mockReset();
    // El aviso por consola es correcto en producción, pero aquí solo ensucia.
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("devuelve las licencias cuando la consulta va bien", async () => {
    rpc.mockResolvedValue({ data: [{ modulo: "cash", vigente: true }], error: null });
    expect(await licenciasDeUsuario("u1")).toEqual([{ modulo: "cash", vigente: true }]);
  });

  it("null -y no lista vacía- si la base contesta con error", async () => {
    // Lista vacía significaría "no tiene nada contratado" y apagaría el editor.
    rpc.mockResolvedValue({ data: null, error: { message: "function does not exist" } });
    expect(await licenciasDeUsuario("u1")).toBeNull();
  });

  it("null si la llamada LANZA (sin red, CORS, 'Load failed' de Safari)", async () => {
    // La promesa se crea DENTRO de la llamada, no antes: con mockRejectedValue
    // queda una promesa rechazada suelta que el propio vitest denuncia.
    rpc.mockImplementation(() => Promise.reject(new TypeError("Load failed")));
    await expect(licenciasDeUsuario("u1")).resolves.toBeNull();
  });

  it("no lanza nunca, pase lo que pase", async () => {
    rpc.mockImplementation(() => { throw new Error("explota antes de la promesa"); });
    await expect(licenciasDeUsuario(null)).resolves.toBeNull();
  });

  it("lista vacía de la base se respeta: eso sí es 'no tiene nada'", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    expect(await licenciasDeUsuario("u1")).toEqual([]);
  });
});
