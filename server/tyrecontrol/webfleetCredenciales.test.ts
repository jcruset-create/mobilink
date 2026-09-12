/**
 * De dónde salen las credenciales de Webfleet, y en qué orden.
 *
 * Esta pieza decide con QUÉ CUENTA se consulta la telemática de un cliente, y
 * hasta ahora vivía dentro de las 19.000 líneas de `index.ts` sin una sola
 * prueba. Lo que hay que dejar fijado es el orden —gestor de secretos, luego
 * la tabla, luego las globales— y, sobre todo, que cada escalón cae limpiamente
 * al siguiente en vez de devolver un juego de credenciales a medias: unas
 * credenciales incompletas fallan dentro de Webfleet con un error ilegible, en
 * lugar de dejar que responda el escalón que sí las tiene.
 *
 * El gestor de secretos se sustituye con `setSecretsProvider()`, que existe
 * justo para esto. Supabase se simula.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Fila que devolverá el «tc_webfleet_config» simulado (null = no hay). */
let filaConfig: any = null;
/** Error que devolverá la consulta, p. ej. cuando la tabla no existe. */
let errorConfig: any = null;
/** Empresas por las que se ha preguntado a la tabla, para poder afirmarlo. */
let consultadas: string[] = [];

vi.mock("../supabase.ts", () => {
  function from(tabla: string) {
    const api: any = {
      select: () => api,
      eq: (col: string, val: any) => {
        if (tabla === "tc_webfleet_config" && col === "empresa_id") consultadas.push(String(val));
        return api;
      },
      maybeSingle: () =>
        Promise.resolve({ data: errorConfig ? null : filaConfig, error: errorConfig }),
    };
    return api;
  }
  return { supabase: { from } };
});

const { setSecretsProvider } = await import("../integration-hub/infrastructure/secrets.ts");
const {
  buildWebfleetRequest,
  credencialesCompletas,
  resolverCredencialesWebfleet,
  resolveWebfleetCreds,
} = await import("./webfleetCredenciales.ts");

const EMPRESA_A = "11111111-1111-4111-a111-111111111111";
const EMPRESA_B = "22222222-2222-4222-a222-222222222222";

/** Secretos disponibles, por empresa. Vacío = el gestor no tiene nada. */
let secretos: Record<string, Record<string, string>> = {};

const entornoOriginal = { ...process.env };

beforeEach(() => {
  filaConfig = null;
  errorConfig = null;
  consultadas = [];
  secretos = {};

  setSecretsProvider({
    async get(tenantId: string, connectorKey: string, name: string) {
      return secretos[tenantId]?.[`${connectorKey}:${name}`];
    },
  });

  for (const k of Object.keys(process.env)) {
    if (k.startsWith("WEBFLEET_")) delete process.env[k];
  }
});

afterEach(() => {
  process.env = { ...entornoOriginal };
});

function secretosDe(empresa: string, extra: Record<string, string> = {}) {
  secretos[empresa] = {
    "webfleet:ACCOUNT": "cuenta-secreta",
    "webfleet:USERNAME": "usuario-secreto",
    "webfleet:PASSWORD": "clave-secreta",
    ...extra,
  };
}

function filaDeTabla(extra: Record<string, unknown> = {}) {
  return {
    account: "cuenta-tabla", username: "usuario-tabla", password: "clave-tabla",
    apikey: "api-tabla", base_url: "https://tabla", activo: true, ...extra,
  };
}

function globalesPuestas() {
  process.env.WEBFLEET_ACCOUNT = "cuenta-global";
  process.env.WEBFLEET_USERNAME = "usuario-global";
  process.env.WEBFLEET_PASSWORD = "clave-global";
}

describe("Qué se considera un juego de credenciales usable", () => {
  it("hacen falta cuenta, usuario y contraseña", () => {
    expect(credencialesCompletas({ account: "a", username: "u", password: "p" })).toBe(true);
  });

  it("faltando cualquiera de las tres, no vale", () => {
    expect(credencialesCompletas({ username: "u", password: "p" })).toBe(false);
    expect(credencialesCompletas({ account: "a", password: "p" })).toBe(false);
    expect(credencialesCompletas({ account: "a", username: "u" })).toBe(false);
    expect(credencialesCompletas(null)).toBe(false);
    expect(credencialesCompletas(undefined)).toBe(false);
  });

  it("apikey y baseUrl son opcionales: hay cuentas sin apikey", () => {
    expect(credencialesCompletas({ account: "a", username: "u", password: "p", apikey: null })).toBe(true);
  });

  it("una cadena vacía no cuenta como valor", () => {
    expect(credencialesCompletas({ account: "", username: "u", password: "p" })).toBe(false);
  });
});

describe("El orden de los escalones", () => {
  it("el gestor de secretos manda, y ni se consulta la tabla", async () => {
    secretosDe(EMPRESA_A, { "webfleet:BASE_URL": "https://secreta" });
    filaConfig = filaDeTabla();

    const r = await resolverCredencialesWebfleet(EMPRESA_A);
    expect(r.origen).toBe("secretos");
    expect(r.creds?.account).toBe("cuenta-secreta");
    expect(r.creds?.baseUrl).toBe("https://secreta");
    expect(consultadas).toEqual([]);
  });

  it("sin secretos, la tabla de esa empresa", async () => {
    filaConfig = filaDeTabla();

    const r = await resolverCredencialesWebfleet(EMPRESA_A);
    expect(r.origen).toBe("tabla");
    expect(r.creds?.account).toBe("cuenta-tabla");
    expect(r.creds?.baseUrl).toBe("https://tabla");
    expect(consultadas).toEqual([EMPRESA_A]);
  });

  it("sin secretos ni tabla, las globales de entorno", async () => {
    globalesPuestas();

    const r = await resolverCredencialesWebfleet(EMPRESA_A);
    expect(r.origen).toBe("globales");
    expect(r.creds?.account).toBe("cuenta-global");
  });

  it("sin nada, null y origen 'ninguno'", async () => {
    const r = await resolverCredencialesWebfleet(EMPRESA_A);
    expect(r.creds).toBeNull();
    expect(r.origen).toBe("ninguno");
  });
});

describe("Cada escalón cae limpiamente al siguiente", () => {
  it("unos secretos a medias no se usan: se sigue bajando", async () => {
    // Falta PASSWORD. Devolver esto haría fallar la llamada a Webfleet con un
    // error suyo, en vez de dejar que responda la tabla, que sí está completa.
    secretos[EMPRESA_A] = {
      "webfleet:ACCOUNT": "cuenta-secreta",
      "webfleet:USERNAME": "usuario-secreto",
    };
    filaConfig = filaDeTabla();

    const r = await resolverCredencialesWebfleet(EMPRESA_A);
    expect(r.origen).toBe("tabla");
  });

  it("una integración desactivada en la tabla no cuenta", async () => {
    filaConfig = filaDeTabla({ activo: false });
    globalesPuestas();

    const r = await resolverCredencialesWebfleet(EMPRESA_A);
    expect(r.origen).toBe("globales");
  });

  it("una fila de tabla incompleta tampoco", async () => {
    filaConfig = filaDeTabla({ password: null });
    globalesPuestas();

    const r = await resolverCredencialesWebfleet(EMPRESA_A);
    expect(r.origen).toBe("globales");
  });

  it("si la tabla ni siquiera existe, se sigue adelante sin romper", async () => {
    // Es el caso real de producción: tyrecontrol_webfleet_config.sql se pasa a
    // mano y hay proyectos donde no se pasó. La consulta devuelve error y eso
    // significa «aquí no hay credenciales», no «se acabó».
    errorConfig = { code: "42P01", message: 'relation "public.tc_webfleet_config" does not exist' };
    globalesPuestas();

    const r = await resolverCredencialesWebfleet(EMPRESA_A);
    expect(r.origen).toBe("globales");
    expect(r.creds?.account).toBe("cuenta-global");
  });

  it("unas globales a medias no se usan", async () => {
    process.env.WEBFLEET_ACCOUNT = "cuenta-global";
    process.env.WEBFLEET_USERNAME = "usuario-global";
    // sin WEBFLEET_PASSWORD

    const r = await resolverCredencialesWebfleet(EMPRESA_A);
    expect(r.creds).toBeNull();
    expect(r.origen).toBe("ninguno");
  });
});

describe("Cada cliente con lo suyo", () => {
  it("los secretos de una empresa no valen para otra", async () => {
    secretosDe(EMPRESA_A);
    globalesPuestas();

    expect((await resolverCredencialesWebfleet(EMPRESA_A)).origen).toBe("secretos");
    // B no tiene los suyos: baja hasta las globales, no hereda los de A.
    const rb = await resolverCredencialesWebfleet(EMPRESA_B);
    expect(rb.origen).toBe("globales");
    expect(rb.creds?.account).toBe("cuenta-global");
  });

  it("se pregunta al gestor por la empresa que toca", async () => {
    const pedidas: string[] = [];
    setSecretsProvider({
      async get(tenantId: string) { pedidas.push(tenantId); return undefined; },
    });

    await resolverCredencialesWebfleet(EMPRESA_B);
    expect(new Set(pedidas)).toEqual(new Set([EMPRESA_B]));
  });

  it("sin empresa no se consulta nada y no hay credenciales de cliente", async () => {
    globalesPuestas();
    const r = await resolverCredencialesWebfleet("");
    expect(consultadas).toEqual([]);
    // Cae a las globales, que no dependen de la empresa.
    expect(r.origen).toBe("globales");
  });
});

describe("La forma corta que usan los endpoints", () => {
  it("devuelve solo las credenciales", async () => {
    secretosDe(EMPRESA_A);
    const creds = await resolveWebfleetCreds(EMPRESA_A);
    expect(creds?.username).toBe("usuario-secreto");
  });

  it("y null cuando no hay ninguna", async () => {
    expect(await resolveWebfleetCreds(EMPRESA_A)).toBeNull();
  });
});

describe("Construir la petición: las credenciales no se mezclan", () => {
  /** Los parámetros de la URL, para poder mirarlos sin depender del orden. */
  function params(url: string) {
    return Object.fromEntries(new URL(url).searchParams.entries());
  }
  /** Usuario y contraseña van en Basic, así que hay que deshacerlo para verlos. */
  function basic(headers: Record<string, string>) {
    const b64 = headers.Authorization.replace(/^Basic /, "");
    const [usuario, clave] = Buffer.from(b64, "base64").toString().split(":");
    return { usuario, clave };
  }

  it("con credenciales de cliente NO se cuela la apikey global", () => {
    // Este era el fallo: cada campo caía por su cuenta a su variable de entorno,
    // así que un cliente con cuenta propia pero sin apikey propia mandaba la
    // apikey de la casa junto a su cuenta y su usuario.
    process.env.WEBFLEET_API_KEY = "apikey-de-la-casa";
    process.env.WEBFLEET_BASE_URL = "https://global";
    globalesPuestas();

    const { url, headers } = buildWebfleetRequest("showObjectReportExtern", {}, {
      account: "cuenta-cliente", username: "usuario-cliente", password: "clave-cliente",
      // sin apikey y sin baseUrl propias
    });

    const p = params(url);
    expect(p.account).toBe("cuenta-cliente");
    expect(p.apikey).toBeUndefined();
    expect(url.startsWith("https://csv.webfleet.com/extern")).toBe(true);
    expect(basic(headers)).toEqual({ usuario: "usuario-cliente", clave: "clave-cliente" });
  });

  it("si el cliente tiene apikey y URL propias, se usan las suyas", () => {
    process.env.WEBFLEET_API_KEY = "apikey-de-la-casa";

    const { url } = buildWebfleetRequest("showObjectReportExtern", {}, {
      account: "cuenta-cliente", username: "u", password: "p",
      apikey: "apikey-cliente", baseUrl: "https://cliente",
    });

    expect(params(url).apikey).toBe("apikey-cliente");
    expect(url.startsWith("https://cliente")).toBe(true);
  });

  it("sin credenciales sigue leyendo el entorno, como el módulo de asistencia", () => {
    globalesPuestas();
    process.env.WEBFLEET_API_KEY = "apikey-de-la-casa";

    const { url, headers } = buildWebfleetRequest("showObjectReportExtern");
    const p = params(url);
    expect(p.account).toBe("cuenta-global");
    expect(p.apikey).toBe("apikey-de-la-casa");
    expect(basic(headers)).toEqual({ usuario: "usuario-global", clave: "clave-global" });
  });

  it("sin credenciales por ningún lado, avisa en vez de llamar a medias", () => {
    expect(() => buildWebfleetRequest("showObjectReportExtern")).toThrow(/no configuradas/i);
  });

  it("los parámetros extra llegan a la URL", () => {
    globalesPuestas();
    const { url } = buildWebfleetRequest("showObjectReportExtern", { objectno: "ABC-1" });
    expect(params(url).objectno).toBe("ABC-1");
  });
});

/**
 * Dos cuentas de Webfleet del mismo cliente.
 *
 * El gestor de secretos ya distingue cuentas. Aquí se comprueba que la cuenta
 * llega de verdad hasta él desde este módulo, y que quien no la pasa —los tres
 * endpoints del panel, que no saben de cuentas— resuelve igual que siempre.
 */
describe("credenciales por cuenta", () => {
  it("cada cuenta resuelve las suyas", async () => {
    setSecretsProvider({
      async get(tenantId: string, connectorKey: string, name: string, accountKey?: string) {
        const juego = accountKey === "auxiliar"
          ? { ACCOUNT: "cuenta-aux", USERNAME: "user-aux", PASSWORD: "pass-aux" }
          : { ACCOUNT: "cuenta-buses", USERNAME: "user-buses", PASSWORD: "pass-buses" };
        return connectorKey === "webfleet" ? (juego as Record<string, string>)[name] : undefined;
      },
    });

    const buses = await resolverCredencialesWebfleet("empresa-1", "buses");
    const aux = await resolverCredencialesWebfleet("empresa-1", "auxiliar");

    expect(buses.origen).toBe("secretos");
    expect(buses.creds?.account).toBe("cuenta-buses");
    expect(aux.creds?.account).toBe("cuenta-aux");
  });

  it("una cuenta sin secreto propio cae al del cliente, no se queda sin nada", async () => {
    setSecretsProvider({
      async get(_t: string, connectorKey: string, name: string, accountKey?: string) {
        // Solo hay secreto del cliente: el proveedor real haría este fallback,
        // así que aquí se imita devolviendo lo mismo con o sin cuenta.
        if (connectorKey !== "webfleet") return undefined;
        void accountKey;
        return { ACCOUNT: "cuenta-cliente", USERNAME: "u", PASSWORD: "p" }[name];
      },
    });

    const r = await resolverCredencialesWebfleet("empresa-1", "una-cuenta-nueva");
    expect(r.origen).toBe("secretos");
    expect(r.creds?.account).toBe("cuenta-cliente");
  });

  it("sin cuenta se comporta igual que antes del cambio", async () => {
    secretosDe("empresa-1");
    const r = await resolverCredencialesWebfleet("empresa-1");
    expect(r.origen).toBe("secretos");
    expect(r.creds?.account).toBe("cuenta-secreta");
  });
});
