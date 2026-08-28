import { describe, expect, it } from "vitest";

import {
  CLAVES_PROHIBIDAS_EN_API,
  MENSAJE_ESTADO,
  destinoParaApi,
  estadoDestino,
  estadoGlobal,
  motivosMalaConfiguracion,
  sanearError,
  sePuedeEnviar,
} from "./destinos.ts";

/** Simula el entorno del servidor sin tocar process.env. */
function entorno(vars: Record<string, string>) {
  return (nombre: string): "ausente" | "vacia" | "ok" => {
    if (!(nombre in vars)) return "ausente";
    return vars[nombre].trim() === "" ? "vacia" : "ok";
  };
}

const BIEN = {
  active: true,
  baseUrl: "https://central-a.example.com",
  secretName: "CENTRAL_PARTNER_A_API_KEY",
};

describe("estado de un destino", () => {
  it("un destino completo está disponible", () => {
    expect(estadoDestino(BIEN, entorno({ CENTRAL_PARTNER_A_API_KEY: "mkc_live_abc" })))
      .toBe("AVAILABLE");
  });

  /*
   * El caso que motivó todo esto: existe el destino pero falta la variable de
   * entorno. No es «no hay plataformas», es «hay una mal configurada», y llevan
   * a sitios distintos: dar de alta un destino, o crear la variable en Render.
   */
  it("sin la variable de entorno está mal configurado, no ausente", () => {
    expect(estadoDestino(BIEN, entorno({}))).toBe("MISCONFIGURED");
    expect(motivosMalaConfiguracion(BIEN, entorno({})))
      .toEqual(["variable_de_entorno_ausente"]);
  });

  it("una variable vacía cuenta como mal configurado, y se distingue de ausente", () => {
    expect(estadoDestino(BIEN, entorno({ CENTRAL_PARTNER_A_API_KEY: "   " }))).toBe("MISCONFIGURED");
    expect(motivosMalaConfiguracion(BIEN, entorno({ CENTRAL_PARTNER_A_API_KEY: "" })))
      .toEqual(["variable_de_entorno_vacia"]);
  });

  it("sin endpoint o sin nombre de secreto, también", () => {
    expect(motivosMalaConfiguracion({ ...BIEN, baseUrl: "" }, entorno({ CENTRAL_PARTNER_A_API_KEY: "x" })))
      .toContain("sin_endpoint");
    expect(motivosMalaConfiguracion({ ...BIEN, secretName: "" }, entorno({})))
      .toContain("sin_nombre_de_secreto");
  });

  /*
   * Desactivado gana sobre mal configurado: a un destino apagado a propósito
   * no hay que ir a arreglarle la credencial.
   */
  it("desactivado manda sobre cualquier otro problema", () => {
    expect(estadoDestino({ ...BIEN, active: false }, entorno({}))).toBe("DISABLED");
  });

  /*
   * Y la configuración gana sobre la salud guardada: un AUTH_ERROR de la última
   * prueba no dice nada si desde entonces han quitado la variable de entorno.
   */
  it("la configuración manda sobre la salud guardada", () => {
    const d = { ...BIEN, healthStatus: "AUTH_ERROR" };
    expect(estadoDestino(d, entorno({}))).toBe("MISCONFIGURED");
    expect(estadoDestino(d, entorno({ CENTRAL_PARTNER_A_API_KEY: "x" }))).toBe("AUTH_ERROR");
  });

  it("la salud guardada se respeta cuando la configuración está bien", () => {
    const env = entorno({ CENTRAL_PARTNER_A_API_KEY: "x" });
    expect(estadoDestino({ ...BIEN, healthStatus: "UNREACHABLE" }, env)).toBe("UNREACHABLE");
    expect(estadoDestino({ ...BIEN, healthStatus: "AVAILABLE" }, env)).toBe("AVAILABLE");
  });
});

describe("solo un destino disponible puede recibir envíos", () => {
  it("AVAILABLE sí, todo lo demás no", () => {
    expect(sePuedeEnviar("AVAILABLE")).toBe(true);
    for (const e of ["NO_DESTINATIONS", "DISABLED", "MISCONFIGURED", "AUTH_ERROR", "UNREACHABLE"] as const) {
      expect(sePuedeEnviar(e)).toBe(false);
    }
  });
});

describe("estado global de la cartera", () => {
  /* Cero destinos NO es un error: es una instalación que aún no subcontrata. */
  it("sin destinos, NO_DESTINATIONS", () => {
    expect(estadoGlobal([])).toBe("NO_DESTINATIONS");
    expect(MENSAJE_ESTADO.NO_DESTINATIONS).toBe("No hay plataformas configuradas.");
  });

  it("con uno disponible, disponible, aunque los demás fallen", () => {
    expect(estadoGlobal(["MISCONFIGURED", "AVAILABLE", "DISABLED"])).toBe("AVAILABLE");
  });

  it("si ninguno sirve, manda el problema más accionable", () => {
    expect(estadoGlobal(["DISABLED", "MISCONFIGURED"])).toBe("MISCONFIGURED");
    expect(estadoGlobal(["DISABLED", "AUTH_ERROR"])).toBe("AUTH_ERROR");
    expect(estadoGlobal(["DISABLED"])).toBe("DISABLED");
  });

  it("«mal configurado» y «no hay ninguno» nunca dan el mismo mensaje", () => {
    expect(MENSAJE_ESTADO.MISCONFIGURED).not.toBe(MENSAJE_ESTADO.NO_DESTINATIONS);
    expect(MENSAJE_ESTADO.MISCONFIGURED).toBe("Plataforma no disponible por configuración.");
  });
});

describe("saneado de errores", () => {
  /*
   * El motivo de que exista: un error de red trae con frecuencia la URL entera
   * o el eco de la cabecera, y esa columna se enseña en el panel y se guarda.
   */
  it("quita una clave concreta que se le pase", () => {
    const limpio = sanearError("fallo con mkc_live_deadbeefcafe1234", ["mkc_live_deadbeefcafe1234"]);
    expect(limpio).not.toContain("deadbeef");
    expect(limpio).toContain("«oculto»");
  });

  it("quita claves de la casa aunque no se le avise", () => {
    expect(sanearError("Bearer mkc_test_aabbccdd11223344 rechazado"))
      .not.toContain("aabbccdd");
  });

  it("quita cabeceras Authorization y credenciales en la URL", () => {
    expect(sanearError('{"authorization":"Bearer secretazo123"}')).not.toContain("secretazo123");
    expect(sanearError("connect ECONNREFUSED https://usuario:clave@central.example.com"))
      .not.toContain("clave@");
  });

  it("quita parámetros de query con pinta de secreto", () => {
    const limpio = sanearError("GET https://x.com/api?api_key=abc123def&limit=1 falló");
    expect(limpio).not.toContain("abc123def");
    expect(limpio).toContain("limit=1");
  });

  it("deja legible lo que sirve para arreglarlo", () => {
    expect(sanearError("El destino no respondió en 10 s")).toBe("El destino no respondió en 10 s");
  });

  it("no se rompe con nulos ni objetos", () => {
    expect(sanearError(null)).toBe("Error desconocido");
    expect(sanearError(new Error("vaya"))).toBe("vaya");
  });

  it("recorta para que no se pueda llenar la columna con basura", () => {
    expect(sanearError("x".repeat(5000)).length).toBeLessThanOrEqual(500);
  });
});

describe("lo que sale por la API", () => {
  /*
   * LA prueba de seguridad: se le pasa una fila que lleva de todo, incluida
   * una credencial, y se comprueba que no sale nada de eso.
   */
  it("una credencial NUNCA llega al frontend", () => {
    const fila = {
      id: 1, uuid: "u", name: "Plataforma A", kind: "central",
      baseUrl: "https://a.example.com", secretName: "CENTRAL_A_KEY",
      // Basura que podría acabar en la fila por un SELECT * o una columna nueva
      apiKey: "mkc_live_supersecreto", token: "tok_123", keyHash: "abcdef123",
      password: "hunter2", secret: "otro",
    };
    const salida = destinoParaApi(fila as any, "AVAILABLE");
    const texto = JSON.stringify(salida);

    expect(texto).not.toContain("mkc_live_supersecreto");
    expect(texto).not.toContain("tok_123");
    expect(texto).not.toContain("abcdef123");
    expect(texto).not.toContain("hunter2");
    for (const clave of CLAVES_PROHIBIDAS_EN_API) {
      expect(Object.keys(salida)).not.toContain(clave);
    }
  });

  /*
   * El NOMBRE de la variable sí sale, y tiene que salir: sin él, quien
   * configura no sabe cuál crear en Render. El nombre no es el secreto.
   */
  it("el nombre de la variable de entorno sí sale, su valor no", () => {
    const salida = destinoParaApi(
      { id: 1, uuid: "u", name: "A", baseUrl: "https://a", secretName: "CENTRAL_A_KEY" } as any,
      "MISCONFIGURED",
      ["variable_de_entorno_ausente"],
    );
    expect(salida.apiKeyEnvName).toBe("CENTRAL_A_KEY");
    expect(salida.motivos[0]).toContain("no existe");
  });

  it("el último error sale ya saneado aunque la fila sea antigua", () => {
    const salida = destinoParaApi(
      { id: 1, uuid: "u", name: "A", baseUrl: "https://a", secretName: "K",
        lastError: "falló con Bearer mkc_live_viejacochina" } as any,
      "AUTH_ERROR",
    );
    expect(salida.lastError).not.toContain("viejacochina");
  });

  it("el mensaje acompaña siempre al estado", () => {
    const salida = destinoParaApi({ id: 1, uuid: "u", name: "A", baseUrl: "b", secretName: "K" } as any, "DISABLED");
    expect(salida.mensaje).toBe(MENSAJE_ESTADO.DISABLED);
  });
});
