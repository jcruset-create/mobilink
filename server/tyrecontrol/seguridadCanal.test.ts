/**
 * Que no se escape ningún secreto, y que el canal avise de permisos de más.
 *
 * Se comprueba de verdad, capturando lo que el módulo escribe en la consola y
 * lo que devuelve, y buscando dentro los valores concretos. Una revisión a ojo
 * del código no serviría: lo que se filtra suele filtrarse por un `error.message`
 * que alguien reenvió sin mirar.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PASSWORD = "contrasena-secreta-de-integracion-9f2a";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ANON.firma";
const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ACCESO.firma";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.SERVICE.firma";

let respuestaLogin: any = null;
let respuestaRpc: any = { data: null, error: null };
let fichaUsuario: any = null;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async () => respuestaLogin,
      getUser: async () => ({ data: { user: { id: "uid-integracion" } } }),
      signOut: async () => ({}),
    },
    rpc: async () => respuestaRpc,
    from: () => {
      const api: any = {
        select: () => api, eq: () => api,
        maybeSingle: async () => ({ data: fichaUsuario, error: null }),
        then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
      };
      return api;
    },
  }),
}));

vi.mock("../supabase.ts", () => ({ supabase: { from: () => ({}) } }));

const { clienteTyreControl, estadoSesionTc, reiniciarSesionTcParaPruebas } = await import("./sesion.ts");
const { probarCanal } = await import("./conector.ts");

/** Todo lo que el módulo escriba en consola durante la prueba. */
let consola: string[] = [];

beforeEach(() => {
  consola = [];
  for (const nivel of ["log", "warn", "error"] as const) {
    vi.spyOn(console, nivel).mockImplementation((...args: unknown[]) => {
      consola.push(args.map((a) => String(a)).join(" "));
    });
  }
  reiniciarSesionTcParaPruebas();
  process.env.TC_SERVICE_USER_EMAIL = "integracion@ejemplo.com";
  process.env.TC_SERVICE_USER_PASSWORD = PASSWORD;
  process.env.SUPABASE_URL = "https://ejemplo.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = ANON;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE;
  respuestaLogin = {
    data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600, access_token: TOKEN },
            user: { id: "uid-integracion" } },
    error: null,
  };
  respuestaRpc = { data: true, error: null };
  fichaUsuario = { nombre: "Mobilink Assist", rol: "operador", es_superadmin: false, acceso_apk: false };
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const v of ["TC_SERVICE_USER_EMAIL", "TC_SERVICE_USER_PASSWORD",
                   "VITE_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) delete process.env[v];
});

/** Busca los secretos concretos dentro de un texto cualquiera. */
function contieneSecretos(texto: string): string[] {
  const encontrados: string[] = [];
  if (texto.includes(PASSWORD)) encontrados.push("contraseña");
  if (texto.includes(TOKEN)) encontrados.push("access token");
  if (texto.includes(ANON)) encontrados.push("clave anónima");
  if (texto.includes(SERVICE)) encontrados.push("clave de servicio");
  return encontrados;
}

describe("Ningún secreto sale del backend", () => {
  it("ni en la consola durante un login correcto", async () => {
    await clienteTyreControl();
    expect(contieneSecretos(consola.join("\n"))).toEqual([]);
  });

  /* El caso peligroso: el mensaje de error que alguien reenvía sin mirar. */
  it("ni en el error de un login rechazado", async () => {
    respuestaLogin = { data: { session: null }, error: { message: "Invalid login credentials" } };
    const e = await clienteTyreControl().catch((x) => x);
    expect(contieneSecretos(`${e.message} ${JSON.stringify(e)} ${consola.join("\n")}`)).toEqual([]);
  });

  it("ni en el estado que se puede consultar", async () => {
    await clienteTyreControl();
    expect(contieneSecretos(JSON.stringify(estadoSesionTc()))).toEqual([]);
  });

  /* Lo que devuelve /api/tyrecontrol/canal va a una pantalla. */
  it("ni en el informe del canal", async () => {
    const informe = await probarCanal();
    expect(contieneSecretos(JSON.stringify(informe))).toEqual([]);
    expect(contieneSecretos(consola.join("\n"))).toEqual([]);
  });
});

describe("El canal avisa de permisos de más", () => {
  it("con los permisos justos no hay avisos", async () => {
    const r = await probarCanal();
    expect(r.ok).toBe(true);
    expect(r.avisos).toEqual([]);
    expect(r.usuarioTc?.rol).toBe("operador");
  });

  /*
   * Un usuario de integración con permisos de administrador funcionaría igual
   * de bien, y ése es el problema: nadie lo notaría hasta que algo tocara lo
   * que no debía.
   */
  it("un superadministrador se señala aunque funcione", async () => {
    fichaUsuario = { nombre: "X", rol: "administrador", es_superadmin: true, acceso_apk: true };
    const r = await probarCanal();
    expect(r.avisos.length).toBe(3);
    expect(r.avisos.join(" ")).toContain("superadministrador");
    expect(r.avisos.join(" ")).toContain("APK");
    expect(r.mensaje).toContain("aviso");
  });

  it("entrar en Supabase sin ficha en tc_usuarios no es estar reconocido", async () => {
    fichaUsuario = null;
    const r = await probarCanal();
    expect(r.ok).toBe(false);
    expect(r.avisos.join(" ")).toContain("tc_usuarios");
  });
});
