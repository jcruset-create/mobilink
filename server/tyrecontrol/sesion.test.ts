/**
 * Sesión de integración con TyreControl.
 *
 * Lo que más importa aquí es el vuelo único: sin él, veinte operaciones
 * saliendo a la vez del worker harían veinte logins simultáneos del mismo
 * usuario. Y que ni la contraseña ni el token salgan por ningún sitio.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let logins = 0;
let respuesta: any = null;
let retraso = 0;

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async () => {
        logins++;
        if (retraso) await new Promise((r) => setTimeout(r, retraso));
        return respuesta;
      },
    },
  }),
}));

const { clienteTyreControl, estadoSesionTc, olvidarSesionTc, reiniciarSesionTcParaPruebas, ErrorSesionTc } =
  await import("./sesion.ts");

const SESION_BUENA = {
  data: {
    session: { expires_at: Math.floor(Date.now() / 1000) + 3600 },
    user: { id: "uid-integracion" },
  },
  error: null,
};

beforeEach(() => {
  logins = 0; retraso = 0; respuesta = SESION_BUENA;
  reiniciarSesionTcParaPruebas();
  process.env.TC_SERVICE_USER_EMAIL = "integracion@ejemplo.com";
  process.env.TC_SERVICE_USER_PASSWORD = "una-contraseña-cualquiera";
  process.env.SUPABASE_URL = "https://ejemplo.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = "anon";
});

afterEach(() => {
  delete process.env.TC_SERVICE_USER_EMAIL;
  delete process.env.TC_SERVICE_USER_PASSWORD;
});

describe("Credenciales", () => {
  it("sin credenciales lo dice con un código propio, no revienta por dentro", async () => {
    delete process.env.TC_SERVICE_USER_EMAIL;
    delete process.env.TC_SERVICE_USER_PASSWORD;
    reiniciarSesionTcParaPruebas();
    await expect(clienteTyreControl()).rejects.toThrow(ErrorSesionTc);
    await expect(clienteTyreControl()).rejects.toMatchObject({ codigo: "tc_credentials_missing" });
    expect(logins).toBe(0);   // ni se ha intentado entrar
  });

  it("el estado dice si faltan credenciales sin destaparlas", () => {
    delete process.env.TC_SERVICE_USER_PASSWORD;
    expect(estadoSesionTc().hayCredenciales).toBe(false);
  });

  it("un login rechazado se traduce a un error con motivo", async () => {
    respuesta = { data: { session: null }, error: { message: "Invalid login credentials" } };
    await expect(clienteTyreControl()).rejects.toMatchObject({ codigo: "tc_login_failed" });
  });
});

describe("Caché de sesión", () => {
  /* Un login por operación sería una llamada de red y un hash por cada rueda. */
  it("no entra otra vez si la sesión sigue valiendo", async () => {
    await clienteTyreControl();
    await clienteTyreControl();
    await clienteTyreControl();
    expect(logins).toBe(1);
  });

  it("una sesión a punto de caducar se renueva", async () => {
    // Caduca dentro de 30 s: por debajo del margen de un minuto.
    respuesta = { data: { session: { expires_at: Math.floor(Date.now() / 1000) + 30 }, user: { id: "u" } }, error: null };
    await clienteTyreControl();
    await clienteTyreControl();
    expect(logins).toBe(2);
  });

  it("olvidar la sesión obliga a entrar de nuevo", async () => {
    await clienteTyreControl();
    olvidarSesionTc();
    await clienteTyreControl();
    expect(logins).toBe(2);
  });

  it("el estado no expone ni contraseña ni token", async () => {
    await clienteTyreControl();
    const e = estadoSesionTc();
    const texto = JSON.stringify(e).toLowerCase();
    expect(texto).not.toContain("contraseña");
    expect(texto).not.toContain("password");
    expect(texto).not.toContain("token");
    expect(texto).not.toContain("una-contrase");
    expect(e.activa).toBe(true);
  });
});

describe("Un solo vuelo", () => {
  /*
   * ÉSTA es la prueba del apartado: veinte operaciones simultáneas del worker
   * no pueden provocar veinte logins.
   */
  it("veinte llamadas a la vez producen UN login", async () => {
    retraso = 20;
    const todas = await Promise.all(Array.from({ length: 20 }, () => clienteTyreControl()));
    expect(logins).toBe(1);
    expect(todas).toHaveLength(20);
  });

  /* Si el vuelo falla, el siguiente tiene que poder intentarlo otra vez. */
  it("un vuelo fallido no deja el módulo bloqueado", async () => {
    respuesta = { data: { session: null }, error: { message: "boom" } };
    await Promise.all(Array.from({ length: 5 }, () => clienteTyreControl().catch(() => null)));
    expect(logins).toBe(1);

    respuesta = SESION_BUENA;
    await clienteTyreControl();
    expect(logins).toBe(2);
  });
});

describe("Los secretos no salen en los errores", () => {
  it("el mensaje de un login fallido no lleva la contraseña", async () => {
    respuesta = { data: { session: null }, error: { message: "Invalid login credentials" } };
    const e = await clienteTyreControl().catch((x) => x);
    expect(String(e.message)).not.toContain("una-contraseña-cualquiera");
    expect(String(e.message)).not.toContain(process.env.VITE_SUPABASE_ANON_KEY);
  });
});
