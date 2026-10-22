/**
 * La carrera del arranque: una petición que sale antes de que llegue la sesión.
 *
 * Así se veía: la pantalla de OTF pedía las furgonetas nada más abrirse, el
 * token de la sesión todavía no había llegado, la petición salía sin
 * credencial, el servidor contestaba 401 y la lista se quedaba vacía sin decir
 * nada. Las furgonetas estaban; la pantalla no las veía.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

describe("las peticiones esperan a que la sesión esté leída", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("una petición hecha ANTES de que llegue el token sale con el token", async () => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    // Quien entra por el hub no tiene el token clásico: localStorage vacío.
    vi.stubGlobal("localStorage", { getItem: () => null });
    const vistas: Array<string | null> = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      vistas.push(new Headers(init?.headers).get("Authorization"));
      return new Response("[]", { status: 200 });
    });

    const sesion = await import("./sesionToken.ts");
    const { fetchWithTimeout, getAdminHeaders } = await import("./workshopApi.ts");

    // La página empieza a leer la sesión…
    sesion.anunciarCargaSesion();
    // …y la pantalla pide sus datos YA, con las cabeceras hechas sin token.
    const peticion = fetchWithTimeout("/api/roadside-vehicles", { headers: getAdminHeaders() });
    // La sesión llega después.
    sesion.guardarTokenSesion("token-de-la-sesion");
    sesion.sesionCargada();

    await peticion;
    expect(vistas).toEqual(["Bearer token-de-la-sesion"]);
  });

  it("si nadie está cargando una sesión, no se espera nada", async () => {
    // Páginas sin login unificado y pruebas: no hay token que esperar, y la
    // petición no puede quedarse colgada por ello.
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("fetch", async () => new Response("[]", { status: 200 }));
    const { fetchWithTimeout } = await import("./workshopApi.ts");

    const inicio = Date.now();
    await fetchWithTimeout("/api/x");
    expect(Date.now() - inicio).toBeLessThan(500);
  });

  it("si la sesión no llega nunca, la petición sale igual pasado el tope", async () => {
    const sesion = await import("./sesionToken.ts");
    sesion.anunciarCargaSesion();
    const inicio = Date.now();
    await sesion.esperarSesion(150);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(140);
  });

  it("un token que ya lleva la petición no se pisa", async () => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    const vistas: Array<string | null> = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      vistas.push(new Headers(init?.headers).get("Authorization"));
      return new Response("[]", { status: 200 });
    });
    const sesion = await import("./sesionToken.ts");
    const { fetchWithTimeout } = await import("./workshopApi.ts");
    sesion.guardarTokenSesion("de-la-sesion");

    await fetchWithTimeout("/api/x", { headers: { Authorization: "Bearer otro" } });
    expect(vistas).toEqual(["Bearer otro"]);
  });
});
