/**
 * Pruebas del freno de autenticación.
 *
 * El reloj se pasa como argumento a propósito: probar bloqueos con esperas
 * reales haría una prueba lenta y frágil.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  POLITICA_LOGIN_IDENTIDAD,
  POLITICA_SEGUNDO_FACTOR,
  clave,
  comprobar,
  comprobarIntento,
  configurarPersistencia,
  precargar,
  registrarExito,
  registrarExitoIntento,
  registrarFallo,
  registrarFalloIntento,
  reiniciar,
} from "./rateLimit.ts";

const T0 = 1_700_000_000_000;

beforeEach(() => reiniciar());

describe("bloqueo por fallos repetidos", () => {
  it("deja pasar hasta el máximo y bloquea al alcanzarlo", () => {
    const c = clave("login", "id", "pedro");
    for (let i = 1; i < POLITICA_LOGIN_IDENTIDAD.maxFallos; i++) {
      expect(registrarFallo(c, POLITICA_LOGIN_IDENTIDAD, T0).permitido, `fallo ${i}`).toBe(true);
    }
    const v = registrarFallo(c, POLITICA_LOGIN_IDENTIDAD, T0);
    expect(v.permitido).toBe(false);
    if (!v.permitido) expect(v.reintentarEnS).toBeGreaterThan(0);
  });

  it("al expirar el bloqueo vuelve a dejar pasar", () => {
    const c = clave("login", "id", "pedro");
    for (let i = 0; i < POLITICA_LOGIN_IDENTIDAD.maxFallos; i++) {
      registrarFallo(c, POLITICA_LOGIN_IDENTIDAD, T0);
    }
    expect(comprobar(c, T0).permitido).toBe(false);
    expect(comprobar(c, T0 + POLITICA_LOGIN_IDENTIDAD.bloqueoBaseMs + 1).permitido).toBe(true);
  });

  it("el bloqueo crece con cada tanda y no pasa del tope", () => {
    const c = clave("login", "id", "pedro");
    const duraciones: number[] = [];
    let ahora = T0;
    for (let tanda = 0; tanda < 8; tanda++) {
      for (let i = 0; i < POLITICA_LOGIN_IDENTIDAD.maxFallos; i++) {
        registrarFallo(c, POLITICA_LOGIN_IDENTIDAD, ahora);
      }
      const v = comprobar(c, ahora);
      expect(v.permitido).toBe(false);
      if (!v.permitido) duraciones.push(v.reintentarEnS);
      ahora += POLITICA_LOGIN_IDENTIDAD.bloqueoMaxMs + 1;
    }
    expect(duraciones[1]).toBeGreaterThan(duraciones[0]);
    expect(duraciones[2]).toBeGreaterThan(duraciones[1]);
    const topeS = POLITICA_LOGIN_IDENTIDAD.bloqueoMaxMs / 1000;
    for (const d of duraciones) expect(d).toBeLessThanOrEqual(topeS);
  });

  it("un acceso correcto olvida los fallos", () => {
    const c = clave("login", "id", "pedro");
    for (let i = 0; i < POLITICA_LOGIN_IDENTIDAD.maxFallos - 1; i++) {
      registrarFallo(c, POLITICA_LOGIN_IDENTIDAD, T0);
    }
    registrarExito(c, T0);
    for (let i = 0; i < POLITICA_LOGIN_IDENTIDAD.maxFallos - 1; i++) {
      expect(registrarFallo(c, POLITICA_LOGIN_IDENTIDAD, T0).permitido).toBe(true);
    }
  });

  it("el segundo factor aguanta menos fallos que el login", () => {
    const c = clave("totp", "id", "pedro");
    for (let i = 0; i < POLITICA_SEGUNDO_FACTOR.maxFallos; i++) {
      registrarFallo(c, POLITICA_SEGUNDO_FACTOR, T0);
    }
    expect(comprobar(c, T0).permitido).toBe(false);
    expect(POLITICA_SEGUNDO_FACTOR.maxFallos).toBeLessThan(POLITICA_LOGIN_IDENTIDAD.maxFallos);
  });
});

describe("los dos ámbitos: identidad y origen", () => {
  it("quemar una identidad no bloquea a otra desde la misma IP", async () => {
    const a = { tipo: "login", identidad: "pedro", ip: "1.2.3.4" };
    for (let i = 0; i < POLITICA_LOGIN_IDENTIDAD.maxFallos; i++) registrarFalloIntento(a, T0);

    expect((await comprobarIntento(a, T0)).permitido).toBe(false);
    const otra = { tipo: "login", identidad: "ana", ip: "1.2.3.4" };
    expect((await comprobarIntento(otra, T0)).permitido).toBe(true);
  });

  it("recorrer muchas identidades desde una IP acaba bloqueando la IP", async () => {
    // El ataque real: probar `0000` en cada empleado de la lista pública, sin
    // gastar nunca el cupo de ninguno.
    let ahora = T0;
    for (let n = 0; n < 70; n++) {
      registrarFalloIntento({ tipo: "login", identidad: `empleado${n}`, ip: "9.9.9.9" }, ahora);
      ahora += 1000;
    }
    const v = await comprobarIntento({ tipo: "login", identidad: "nuevo", ip: "9.9.9.9" }, ahora);
    expect(v.permitido).toBe(false);
  });

  it("cambiar de IP no salva a la identidad ya bloqueada", async () => {
    for (let i = 0; i < POLITICA_LOGIN_IDENTIDAD.maxFallos; i++) {
      registrarFalloIntento({ tipo: "login", identidad: "pedro", ip: "1.1.1.1" }, T0);
    }
    const v = await comprobarIntento({ tipo: "login", identidad: "pedro", ip: "8.8.8.8" }, T0);
    expect(v.permitido).toBe(false);
  });

  it("el éxito limpia los dos ámbitos", async () => {
    const a = { tipo: "login", identidad: "pedro", ip: "1.2.3.4" };
    for (let i = 0; i < POLITICA_LOGIN_IDENTIDAD.maxFallos - 1; i++) registrarFalloIntento(a, T0);
    registrarExitoIntento(a, T0);
    expect((await comprobarIntento(a, T0)).permitido).toBe(true);
  });

  it("no distingue mayúsculas en la identidad", () => {
    expect(clave("login", "id", " Pedro ")).toBe(clave("login", "id", "pedro"));
  });
});

describe("persistencia opcional", () => {
  it("recupera un bloqueo guardado tras un reinicio del proceso", async () => {
    const guardado = new Map<string, { bloqueadoHastaMs: number; bloqueos: number }>();
    const c = clave("login", "id", "pedro");
    guardado.set(c, { bloqueadoHastaMs: T0 + 60_000, bloqueos: 3 });

    configurarPersistencia({
      cargar: async (k) => guardado.get(k) ?? null,
      guardar: async (k, e) => void guardado.set(k, e),
    });

    // Memoria vacía, como después de un reinicio.
    await precargar(c, T0);
    expect(comprobar(c, T0).permitido).toBe(false);
  });

  it("escribe el bloqueo cuando se produce", async () => {
    const guardado = new Map<string, { bloqueadoHastaMs: number; bloqueos: number }>();
    configurarPersistencia({
      cargar: async () => null,
      guardar: async (k, e) => void guardado.set(k, e),
    });
    const c = clave("login", "id", "pedro");
    for (let i = 0; i < POLITICA_LOGIN_IDENTIDAD.maxFallos; i++) {
      registrarFallo(c, POLITICA_LOGIN_IDENTIDAD, T0);
    }
    await new Promise((r) => setTimeout(r, 0));
    expect(guardado.get(c)?.bloqueadoHastaMs).toBeGreaterThan(T0);
  });

  it("si la persistencia falla, el freno sigue funcionando en memoria", async () => {
    configurarPersistencia({
      cargar: async () => {
        throw new Error("la tabla no existe");
      },
      guardar: async () => {
        throw new Error("la tabla no existe");
      },
    });
    const c = clave("login", "id", "pedro");
    await precargar(c, T0); // no debe lanzar
    for (let i = 0; i < POLITICA_LOGIN_IDENTIDAD.maxFallos; i++) {
      registrarFallo(c, POLITICA_LOGIN_IDENTIDAD, T0);
    }
    expect(comprobar(c, T0).permitido).toBe(false);
  });
});
