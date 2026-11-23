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

/**
 * La pestaña que lleva horas abierta: el token guardado ha caducado y Supabase
 * no lo ha renovado porque el navegador frena sus temporizadores. Al crear una
 * OTF así, el panel decía «No autorizado» a quien tenía la sesión abierta.
 */
describe("un token caducado se renueva antes de enviar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const jwt = (expSeg: number) => `x.${btoa(JSON.stringify({ exp: expSeg }))}.y`;
  const ahoraSeg = Math.floor(Date.now() / 1000);

  const montar = async (respuestas: number[]) => {
    vi.stubGlobal("window", { setTimeout, clearTimeout });
    vi.stubGlobal("localStorage", { getItem: () => null });
    const vistas: Array<string | null> = [];
    vi.stubGlobal("fetch", async (_url: string, init?: RequestInit) => {
      vistas.push(new Headers(init?.headers).get("Authorization"));
      return new Response("{}", { status: respuestas.shift() ?? 200 });
    });
    const sesion = await import("./sesionToken.ts");
    const { fetchWithTimeout, getAdminHeaders } = await import("./workshopApi.ts");
    return { sesion, fetchWithTimeout, getAdminHeaders, vistas };
  };

  it("sabe cuándo caduca", async () => {
    const { sesion } = await montar([]);
    expect(sesion.tokenCaducado(jwt(ahoraSeg - 60))).toBe(true);
    expect(sesion.tokenCaducado(jwt(ahoraSeg + 10))).toBe(true); // a punto: también
    expect(sesion.tokenCaducado(jwt(ahoraSeg + 3600))).toBe(false);
    expect(sesion.tokenCaducado("no-es-un-jwt")).toBe(false);
  });

  it("caducado: la petición sale con el nuevo, aunque las cabeceras llevaran el viejo", async () => {
    const { sesion, fetchWithTimeout, getAdminHeaders, vistas } = await montar([200]);
    const viejo = jwt(ahoraSeg - 600), nuevo = jwt(ahoraSeg + 3600);
    sesion.guardarTokenSesion(viejo);
    let pedidas = 0;
    sesion.registrarRenovador(async () => { pedidas++; return nuevo; });
    await fetchWithTimeout("/api/otf", { method: "POST", headers: getAdminHeaders() });
    expect(vistas).toEqual([`Bearer ${nuevo}`]);
    expect(pedidas).toBe(1);
  });

  it("401 con un token que parecía bueno: se renueva y se reintenta una vez", async () => {
    const { sesion, fetchWithTimeout, getAdminHeaders, vistas } = await montar([401, 200]);
    const bueno = jwt(ahoraSeg + 3600), nuevo = jwt(ahoraSeg + 7200);
    sesion.guardarTokenSesion(bueno);
    const forzados: boolean[] = [];
    sesion.registrarRenovador(async (forzar) => { forzados.push(forzar); return nuevo; });
    const r = await fetchWithTimeout("/api/otf", { method: "POST", headers: getAdminHeaders() });
    expect(r.status).toBe(200);
    expect(vistas).toEqual([`Bearer ${bueno}`, `Bearer ${nuevo}`]);
    expect(forzados).toEqual([true]);
  });

  it("401 de verdad (la renovación da el mismo token): no se insiste", async () => {
    const { sesion, fetchWithTimeout, getAdminHeaders, vistas } = await montar([401, 200]);
    const bueno = jwt(ahoraSeg + 3600);
    sesion.guardarTokenSesion(bueno);
    sesion.registrarRenovador(async () => bueno);
    const r = await fetchWithTimeout("/api/otf", { headers: getAdminHeaders() });
    expect(r.status).toBe(401);
    expect(vistas).toHaveLength(1);
  });

  it("varias peticiones a la vez comparten una sola renovación", async () => {
    const { sesion, fetchWithTimeout, getAdminHeaders } = await montar([200, 200, 200]);
    sesion.guardarTokenSesion(jwt(ahoraSeg - 600));
    let pedidas = 0;
    sesion.registrarRenovador(async () => { pedidas++; await new Promise((r) => setTimeout(r, 10)); return jwt(ahoraSeg + 3600); });
    await Promise.all([1, 2, 3].map(() => fetchWithTimeout("/api/x", { headers: getAdminHeaders() })));
    expect(pedidas).toBe(1);
  });
});
