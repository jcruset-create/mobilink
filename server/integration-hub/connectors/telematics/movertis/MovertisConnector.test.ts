/**
 * Las cabeceras con las que el conector se presenta ante Movertis.
 *
 * Parece poca cosa para un fichero de pruebas, y es justo lo contrario: un
 * prefijo «Bearer» de más devuelve 401 con la credencial CORRECTA, y entonces
 * todo el mundo mira el secreto, el gestor de secretos y la variable de Render
 * antes de sospechar de una palabra en la cabecera. Esto lo fija para que no
 * vuelva a pasar.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { MovertisConnector, esperaPedida, mensajeDeError, motivoDeRed } from "./MovertisConnector.ts";
import { getSecretsProvider, setSecretsProvider } from "../../../infrastructure/secrets.ts";

describe("cabeceras de autenticación", () => {
  it("manda el token EN CRUDO, sin «Bearer», que es lo que pide Movertis", () => {
    // Comprobado contra la cuenta real: con el token en crudo, «Probar
    // conexión» devuelve los 751 vehículos de Autocares Plana.
    const h = new MovertisConnector({}).cabecerasDe({ token: "abc123" });
    expect(h.authorization).toBe("abc123");
    expect(h.authorization).not.toContain("Bearer");
  });

  it("con esquemaToken 'bearer' vuelve al prefijo, sin tocar código", () => {
    const h = new MovertisConnector({ esquemaToken: "bearer" }).cabecerasDe({ token: "abc123" });
    expect(h.authorization).toBe("Bearer abc123");
  });

  it("sin token, usuario y contraseña van en Basic", () => {
    const h = new MovertisConnector({}).cabecerasDe({ username: "u", password: "p" });
    expect(h.authorization).toBe(`Basic ${Buffer.from("u:p").toString("base64")}`);
  });

  it("el token manda sobre el usuario: no se mezclan dos autenticaciones", () => {
    const h = new MovertisConnector({}).cabecerasDe({ token: "t", username: "u", password: "p" });
    expect(h.authorization).toBe("t");
  });

  it("la API key se acumula: hay instalaciones que piden las dos cosas", () => {
    const h = new MovertisConnector({}).cabecerasDe({ token: "t", apiKey: "k" });
    expect(h.authorization).toBe("t");
    expect(h["X-Api-Key"]).toBe("k");
  });

  it("sin credenciales no inventa ninguna cabecera de autenticación", () => {
    const h = new MovertisConnector({}).cabecerasDe({});
    expect(h.authorization).toBeUndefined();
    expect(h["X-Api-Key"]).toBeUndefined();
    expect(h.Accept).toBe("application/json");
  });
});

/**
 * Movertis falla de dos maneras que no se parecen a un fallo, y las dos las
 * tiene que atrapar `mensajeDeError`. Los cuerpos de aquí son literales,
 * copiados de respuestas reales de `devapi.hellomovertis.com`.
 */
describe("mensajeDeError()", () => {
  it("atrapa el HTTP 201 que en realidad es un 500", () => {
    // Esto es lo que devuelve una bandera que no existe: estado 201 en la
    // respuesta HTTP y el error metido en el cuerpo. Si no se mira, entra en el
    // sistema como datos y sale como una flota vacía.
    expect(
      mensajeDeError({
        response: "position - Flag incorrecta",
        status: 500,
        message: "position - Flag incorrecta",
        name: "HttpException",
      }),
    ).toBe("position - Flag incorrecta");
  });

  it("atrapa el 500 con el error de validación", () => {
    expect(
      mensajeDeError({
        statusCode: 500,
        timestamp: "2026-09-12T08:38:34.814Z",
        path: "/vehicle/showvehicles",
        error: "El flag basicData es obligatorio",
      }),
    ).toBe("El flag basicData es obligatorio");
  });

  it("atrapa el error de JavaScript en crudo de un campo que falta", () => {
    expect(
      mensajeDeError({
        statusCode: 500,
        path: "/vehicle/showvehicles",
        error: "Cannot read properties of undefined (reading 'length')",
      }),
    ).toMatch(/Cannot read properties/);
  });

  it("no confunde una respuesta buena con un error", () => {
    // La flota llega como lista, y un vehículo suelto como objeto sin estado.
    expect(mensajeDeError([{ name: "604 - 1678 GCM", idVehicle: 26134116 }])).toBeNull();
    expect(mensajeDeError({ name: "604 - 1678 GCM", idVehicle: 26134116 })).toBeNull();
    expect(mensajeDeError(null)).toBeNull();
  });
});

/**
 * El token que pide cada cuenta.
 *
 * Un cliente puede tener dos cuentas de Movertis con tokens distintos. Antes de
 * que el gestor de secretos distinguiera cuentas, las dos leían la misma
 * variable: la segunda daba 401 con la credencial correcta o, si el token valía
 * para ambas, devolvía la flota de la primera sin dar ningún error. Esto fija
 * que la cuenta llega hasta la resolución del secreto.
 */
describe("credenciales por cuenta", () => {
  it("pide el secreto de SU cuenta, no el del cliente a secas", async () => {
    const pedidos: Array<[string, string, string, string | undefined]> = [];
    const anterior = getSecretsProvider();
    try {
      setSecretsProvider({
        get: async (tenant, conector, nombre, cuenta) => {
          pedidos.push([tenant, conector, nombre, cuenta]);
          return nombre === "token" && cuenta === "auxiliar" ? "token-auxiliar" : undefined;
        },
      });

      const conector = new MovertisConnector({ baseUrl: "https://api.invalid", accountKey: "auxiliar" });
      const r = await conector.testConnection({ tenantId: "empresa-plana", correlationId: "COR-1" });

      // Todas las lecturas llevan la cuenta.
      expect(pedidos.length).toBeGreaterThan(0);
      expect(pedidos.every(([, , , cuenta]) => cuenta === "auxiliar")).toBe(true);
      // Y con credencial encontrada NO se queda en «sin credenciales».
      expect(r.message).not.toContain("sin credenciales");
    } finally {
      setSecretsProvider(anterior);
    }
  });

  it("sin cuenta declarada no inventa ninguna", async () => {
    const cuentas: Array<string | undefined> = [];
    const anterior = getSecretsProvider();
    try {
      setSecretsProvider({
        get: async (_t, _c, _n, cuenta) => {
          cuentas.push(cuenta);
          return undefined;
        },
      });
      await new MovertisConnector({ baseUrl: "https://api.invalid" }).testConnection({
        tenantId: "empresa-plana",
        correlationId: "COR-1",
      });
      expect(cuentas.every((c) => c === undefined)).toBe(true);
    } finally {
      setSecretsProvider(anterior);
    }
  });
});

/**
 * Por qué no se pudo ni hablar con Movertis.
 *
 * «fetch failed» a secas costó una tarde de diagnóstico: no distingue una URL
 * mal escrita de un certificado roto de una salida de red cerrada, y las tres
 * se arreglan en sitios distintos. Esto fija que el motivo real —que Node
 * esconde en `cause`— llega hasta el mensaje, y que la URL va con él.
 */
describe("motivoDeRed()", () => {
  const url = "https://api.hellomovertis.com/vehicle/showvehicles";
  const conCausa = (code: string) =>
    Object.assign(new Error("fetch failed"), { cause: Object.assign(new Error(code), { code }) });

  it("desenvuelve el DNS que no resuelve, que es el fallo más probable de una URL mal puesta", () => {
    const m = motivoDeRed(conCausa("ENOTFOUND"), url);
    expect(m).toContain("DNS");
    expect(m).toContain("ENOTFOUND");
    expect(m).not.toBe("fetch failed");
  });

  it("distingue un certificado caducado de todo lo demás", () => {
    expect(motivoDeRed(conCausa("CERT_HAS_EXPIRED"), url)).toContain("caducado");
  });

  it("dice cuándo el servidor rechaza la conexión", () => {
    expect(motivoDeRed(conCausa("ECONNREFUSED"), url)).toContain("rechaza la conexión");
  });

  it("siempre incluye la URL: con dos entornos, saber cuál se intentó es media respuesta", () => {
    expect(motivoDeRed(conCausa("ENOTFOUND"), url)).toContain(url);
    expect(motivoDeRed(new Error("lo que sea"), url)).toContain(url);
  });

  it("el timeout se dice como timeout, no como un código de red", () => {
    const m = motivoDeRed(Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }), url);
    expect(m).toContain("no contestó a tiempo");
  });

  it("un código desconocido no se traga el mensaje: se enseña tal cual", () => {
    expect(motivoDeRed(conCausa("ERARO_1234"), url)).toContain("ERARO_1234");
  });
});

/**
 * `summarytrips` y el trato al proveedor cuando limita.
 *
 * Con `fetch` sustituido: lo que se fija es el cuerpo que se manda (varias
 * unidades en UNA llamada, fechas en epoch ms), que sin unidad de medida no se
 * llama, y que ante un 429 se obedece `Retry-After` en vez del backoff propio.
 */
describe("getTripSummary()", () => {
  const CTX = { tenantId: "empresa-plana", correlationId: "COR-1" };
  const VENTANA = { from: new Date(1788213600000), to: new Date(1790805600000) };

  function conToken<T>(fn: () => Promise<T>): Promise<T> {
    const anterior = getSecretsProvider();
    setSecretsProvider({ get: async (_t, _c, nombre) => (nombre === "token" ? "tok" : undefined) });
    return fn().finally(() => setSecretsProvider(anterior));
  }

  /** Un `fetch` que contesta con lo que se le diga y apunta lo que recibió. */
  function fingirFetch(respuestas: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
    const llamadas: Array<{ url: string; body: any }> = [];
    let i = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      llamadas.push({ url, body: JSON.parse(init.body) });
      const r = respuestas[Math.min(i++, respuestas.length - 1)];
      const cabeceras = new Map(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
      return {
        status: r.status,
        ok: r.status >= 200 && r.status < 300,
        headers: { get: (n: string) => cabeceras.get(n.toLowerCase()) ?? null },
        text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
      };
    }));
    return llamadas;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("manda varias unidades en UNA petición, con las fechas en epoch ms", async () => {
    const llamadas = fingirFetch([{ status: 201, body: [
      { unit: 1, total_mileage: 7842, initial_mileage: 100, final_mileage: 7942 },
      { unit: 2, total_mileage: 8104 },
    ] }]);
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid", odometroEn: "km", accountKey: "buses" });

    const r = await conToken(() => c.getTripSummary(CTX, ["1", "2"], VENTANA));

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe("https://devapi.invalid/vehicle/summarytrips");
    expect(llamadas[0].body).toEqual({ units: [1, 2], initial_date: 1788213600000, end_date: 1790805600000 });
    expect(r.map((s) => [s.providerVehicleId, s.distanceKm])).toEqual([["1", 7842], ["2", 8104]]);
    expect(r[0].initialOdometerKm).toBe(100);
    expect(r[0].accountKey).toBe("buses");
  });

  it("con `distanciaEn: m` convierte a km; `distanciaEn` manda sobre `odometroEn`", async () => {
    fingirFetch([{ status: 201, body: [{ unit: 1, total_mileage: 7842000 }] }]);
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid", odometroEn: "km", distanciaEn: "m" });
    const r = await conToken(() => c.getTripSummary(CTX, ["1"], VENTANA));
    expect(r[0].distanceKm).toBe(7842);
  });

  it("sin unidad de medida NO llama: metros guardados como km es peor que nada", async () => {
    const llamadas = fingirFetch([{ status: 201, body: [] }]);
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid" });
    await expect(conToken(() => c.getTripSummary(CTX, ["1"], VENTANA))).rejects.toMatchObject({ code: "MOVERTIS_SIN_UNIDAD" });
    expect(llamadas).toHaveLength(0);
  });

  it("una unidad que el proveedor no menciona simplemente no aparece", async () => {
    fingirFetch([{ status: 201, body: [{ unit: 1, total_mileage: 10 }] }]);
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid", odometroEn: "km" });
    const r = await conToken(() => c.getTripSummary(CTX, ["1", "2"], VENTANA));
    expect(r.map((s) => s.providerVehicleId)).toEqual(["1"]);
  });

  it("sin unidades pedidas no llama a nadie", async () => {
    const llamadas = fingirFetch([{ status: 201, body: [] }]);
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid", odometroEn: "km" });
    expect(await conToken(() => c.getTripSummary(CTX, [], VENTANA))).toEqual([]);
    expect(llamadas).toHaveLength(0);
  });

  it("429 con Retry-After: espera lo que pide y reintenta", async () => {
    const esperas: number[] = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => {
      esperas.push(ms ?? 0); fn(); return 0 as any;
    }) as any);
    fingirFetch([
      { status: 429, body: "", headers: { "Retry-After": "7" } },
      { status: 201, body: [{ unit: 1, total_mileage: 5 }] },
    ]);
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid", odometroEn: "km" });

    const r = await conToken(() => c.getTripSummary(CTX, ["1"], VENTANA));

    expect(r[0].distanceKm).toBe(5);
    expect(esperas).toContain(7000);
    vi.restoreAllMocks();
  });

  it("429 persistente: se rinde tras los reintentos con un error transitorio, no infinito", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => { fn(); return 0 as any; }) as any);
    const llamadas = fingirFetch([{ status: 429, body: "", headers: { "Retry-After": "1" } }]);
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid", odometroEn: "km", maxRetries: 2 });

    await expect(conToken(() => c.getTripSummary(CTX, ["1"], VENTANA))).rejects.toMatchObject({
      code: "MOVERTIS_RATE_LIMITED", retryable: true,
    });
    expect(llamadas).toHaveLength(3);
    vi.restoreAllMocks();
  });

  it("500 sin cuerpo útil: transitorio; 500 con mensaje: permanente y sin reintentar", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => { fn(); return 0 as any; }) as any);
    const l1 = fingirFetch([{ status: 500, body: "<html>bad gateway</html>" }]);
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid", odometroEn: "km", maxRetries: 1 });
    await expect(conToken(() => c.getTripSummary(CTX, ["1"], VENTANA))).rejects.toMatchObject({ retryable: true });
    expect(l1).toHaveLength(2);

    const l2 = fingirFetch([{ status: 500, body: { statusCode: 500, message: "Cannot read properties of undefined" } }]);
    await expect(conToken(() => c.getTripSummary(CTX, ["1"], VENTANA))).rejects.toMatchObject({ retryable: false });
    expect(l2).toHaveLength(1);
    vi.restoreAllMocks();
  });

  it("401: error de credencial, sin reintentos", async () => {
    const llamadas = fingirFetch([{ status: 401, body: { error: "No valid auth method" } }]);
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid", odometroEn: "km" });
    await expect(conToken(() => c.getTripSummary(CTX, ["1"], VENTANA))).rejects.toMatchObject({ kind: "AUTH" });
    expect(llamadas).toHaveLength(1);
  });

  it("JSON inválido con 2xx: permanente, y el texto va en el mensaje", async () => {
    fingirFetch([{ status: 201, body: "esto no es json" }]);
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid", odometroEn: "km" });
    await expect(conToken(() => c.getTripSummary(CTX, ["1"], VENTANA))).rejects.toMatchObject({ code: "MOVERTIS_BAD_JSON" });
  });

  it("timeout: transitorio con el motivo de red", async () => {
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void) => { fn(); return 0 as any; }) as any);
    vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }); }));
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid", odometroEn: "km", maxRetries: 0 });
    await expect(conToken(() => c.getTripSummary(CTX, ["1"], VENTANA))).rejects.toMatchObject({ code: "MOVERTIS_NETWORK", retryable: true });
    vi.restoreAllMocks();
  });
});

describe("esperaPedida()", () => {
  const con = (status: number, v: string | null) => ({ status, headers: { get: () => v } });

  it("segundos → ms", () => expect(esperaPedida(con(429, "30"))).toBe(30_000));
  it("solo ante 429/503", () => expect(esperaPedida(con(500, "30"))).toBeUndefined());
  it("sin cabecera, nada", () => expect(esperaPedida(con(429, null))).toBeUndefined());
  it("una fecha HTTP futura se convierte", () => {
    const en10s = new Date(Date.now() + 10_000).toUTCString();
    const ms = esperaPedida(con(429, en10s))!;
    expect(ms).toBeGreaterThan(8_000);
    expect(ms).toBeLessThanOrEqual(10_000);
  });
  it("se acota: una hora pedida son dos minutos obedecidos", () => expect(esperaPedida(con(429, "3600"))).toBe(120_000));
  it("basura: nada", () => expect(esperaPedida(con(429, "mañana"))).toBeUndefined());
});

/**
 * El barrido de la flota: una petición para todos.
 *
 * Lo que se fija aquí es el cuerpo. La bandera se llama `lastMessagePosition`
 * y `id: []` significa «toda la flota»: equivocarse en cualquiera de las dos
 * no da un error, da un 201 con «Flag incorrecta» dentro o la respuesta de un
 * solo vehículo, que son fallos que entran como datos.
 */
describe("getFleetPositions()", () => {
  const CTX = { tenantId: "empresa-plana", correlationId: "COR-1" };

  function conToken<T>(fn: () => Promise<T>): Promise<T> {
    const anterior = getSecretsProvider();
    setSecretsProvider({ get: async (_t, _c, nombre) => (nombre === "token" ? "tok" : undefined) });
    return fn().finally(() => setSecretsProvider(anterior));
  }

  function fingirFetch(body: unknown) {
    const llamadas: Array<{ url: string; body: any }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
      llamadas.push({ url, body: JSON.parse(init.body) });
      return {
        status: 201,
        ok: true,
        headers: { get: () => null },
        text: async () => JSON.stringify(body),
      };
    }));
    return llamadas;
  }

  afterEach(() => vi.unstubAllGlobals());

  const FILA = {
    idVehicle: 26053725,
    name: "604 - 1678 GCM",
    counters: { odometer: 809052 },
    lastPosition: { date: 1789229448, lat: 41.1299667358, lon: 1.18569278717, speed: 0, course: 166 },
  };

  it("pide la flota entera con la bandera de posición, en UNA petición", async () => {
    const llamadas = fingirFetch([FILA, { ...FILA, idVehicle: 30089320 }]);
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid", odometroEn: "km", accountKey: "buses" });

    const r = await conToken(() => c.getFleetPositions(CTX));

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe("https://devapi.invalid/vehicle/showvehicles");
    expect(llamadas[0].body).toEqual({
      flags: { basicData: true, counters: true, lastMessagePosition: true },
      id: [],
    });
    expect(r.map((p) => p.providerVehicleId)).toEqual(["26053725", "30089320"]);
    expect(r[0].latitude).toBeCloseTo(41.1299667358);
    expect(r[0].odometerKm).toBe(809052);
  });

  it("los vehículos sin posición utilizable no salen: ausencia, no coordenada vacía", async () => {
    fingirFetch([
      FILA,
      { idVehicle: 1, name: "NO FUNCIONA" },
      { idVehicle: 2, name: "sin fijación", lastPosition: { date: 1789229448, lat: 0, lon: 0 } },
    ]);
    const c = new MovertisConnector({ baseUrl: "https://devapi.invalid", odometroEn: "km" });

    const r = await conToken(() => c.getFleetPositions(CTX));

    expect(r).toHaveLength(1);
    expect(r[0].providerVehicleId).toBe("26053725");
  });

  it("sin baseUrl no llama a nadie y devuelve vacío, no una flota inventada", async () => {
    const llamadas = fingirFetch([FILA]);
    const r = await conToken(() => new MovertisConnector({}).getFleetPositions(CTX));
    expect(r).toEqual([]);
    expect(llamadas).toHaveLength(0);
  });
});
