import { describe, it, expect, vi } from "vitest";
import {
  ESPERAS_MS, motivoDeFallo, pedirAOverpass, reintentable, servidoresDe, servidorDe, SERVIDORES_POR_DEFECTO,
  RespuestaOverpass,
} from "./overpass.ts";

const OFICIAL = "https://overpass-api.de/api/interpreter";
const ESPEJO = "https://espejo.example/api/interpreter";

/** Un fetch de mentira: devuelve lo que se le diga, por orden. */
function fetchFalso(respuestas: Array<Response | Error>) {
  const llamadas: string[] = [];
  const impl = vi.fn(async (url: any) => {
    llamadas.push(String(url));
    const r = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  });
  return { impl: impl as unknown as typeof fetch, llamadas };
}

const ok = (json: unknown) => new Response(JSON.stringify(json), { status: 200 });
const http = (status: number) => new Response("", { status });
/** Lo que lanza Node cuando ni siquiera abre la conexión. */
const sinConexion = () => new TypeError("fetch failed");

// Las esperas no se esperan: la prueba mide la lógica, no el reloj.
const yaEsta = async () => {};

describe("servidoresDe", () => {
  it("sin variable, el oficial", () => {
    // Sin configurar: el oficial primero y los espejos detrás.
    expect(servidoresDe(undefined)).toEqual(SERVIDORES_POR_DEFECTO);
    expect(servidoresDe("")).toEqual(SERVIDORES_POR_DEFECTO);
    expect(SERVIDORES_POR_DEFECTO[0]).toBe(OFICIAL);
    expect(SERVIDORES_POR_DEFECTO.length).toBeGreaterThan(1);
  });

  it("varios separados por comas, con espacios de más", () => {
    expect(servidoresDe(` ${ESPEJO} , ${OFICIAL} `)).toEqual([ESPEJO, OFICIAL]);
  });

  it("lo que no es una URL no entra", () => {
    // Una variable mal puesta no puede dejar el sistema apuntando a nada.
    expect(servidoresDe("pon-aqui-el-espejo")).toEqual(SERVIDORES_POR_DEFECTO);
  });
});

describe("el motivo, dicho para una persona", () => {
  it("«fetch failed» se traduce y dice quién no contesta", () => {
    expect(motivoDeFallo(sinConexion(), OFICIAL)).toBe("OpenStreetMap (overpass-api.de) no contesta");
  });

  it("un HTTP dice el código", () => {
    expect(motivoDeFallo(new RespuestaOverpass(429, OFICIAL), OFICIAL))
      .toBe("OpenStreetMap (overpass-api.de) ha contestado 429");
  });

  it("agotar el tiempo se distingue de no contestar", () => {
    expect(motivoDeFallo(new DOMException("The operation was aborted", "TimeoutError"), OFICIAL))
      .toBe("OpenStreetMap (overpass-api.de) ha tardado demasiado");
  });

  it("del servidor se queda el host, no la URL entera", () => {
    expect(servidorDe(ESPEJO)).toBe("espejo.example");
  });
});

describe("qué se reintenta y qué no", () => {
  it("lo que es «ahora no puedo», sí", () => {
    for (const s of [429, 500, 502, 503, 504]) {
      expect(reintentable(new RespuestaOverpass(s, OFICIAL))).toBe(true);
    }
  });

  it("una consulta mal escrita, NO: repetirla da lo mismo más despacio", () => {
    expect(reintentable(new RespuestaOverpass(400, OFICIAL))).toBe(false);
    expect(reintentable(new RespuestaOverpass(404, OFICIAL))).toBe(false);
  });

  it("no haber podido conectar, sí", () => {
    expect(reintentable(sinConexion())).toBe(true);
  });
});

describe("pedirAOverpass", () => {
  it("si el primer intento va, no insiste", async () => {
    const { impl, llamadas } = fetchFalso([ok({ elements: [] })]);
    const r = await pedirAOverpass("[out:json];", { servidores: [OFICIAL], fetchImpl: impl, esperar: yaEsta });
    expect(r).toEqual({ elements: [] });
    expect(llamadas).toHaveLength(1);
  });

  it("un corte pasajero se supera solo: es el caso de verdad", async () => {
    // Esto es exactamente lo que estaba pasando en producción: la conexión
    // falla una vez y antes eso tiraba el día entero.
    const { impl, llamadas } = fetchFalso([sinConexion(), sinConexion(), ok({ elements: [1] })]);
    const r = await pedirAOverpass("[out:json];", { servidores: [OFICIAL], fetchImpl: impl, esperar: yaEsta });
    expect(r).toEqual({ elements: [1] });
    expect(llamadas).toHaveLength(3);
  });

  it("con dos servidores, el segundo intento ya va al otro", async () => {
    const { impl, llamadas } = fetchFalso([sinConexion(), ok({ elements: [] })]);
    await pedirAOverpass("[out:json];", { servidores: [OFICIAL, ESPEJO], fetchImpl: impl, esperar: yaEsta });
    expect(llamadas).toEqual([OFICIAL, ESPEJO]);
  });

  it("una consulta mal escrita no se repite cuatro veces", async () => {
    const { impl, llamadas } = fetchFalso([http(400)]);
    await expect(pedirAOverpass("mal", { servidores: [OFICIAL], fetchImpl: impl, esperar: yaEsta }))
      .rejects.toThrow("ha contestado 400");
    expect(llamadas).toHaveLength(1);
  });

  it("cuando se acaban los intentos, el motivo es legible", async () => {
    const { impl, llamadas } = fetchFalso([sinConexion()]);
    await expect(pedirAOverpass("[out:json];", { servidores: [OFICIAL], fetchImpl: impl, esperar: yaEsta }))
      .rejects.toThrow("OpenStreetMap (overpass-api.de) no contesta");
    expect(llamadas).toHaveLength(ESPERAS_MS.length + 1);
  });

  it("espera cada vez más entre intentos", async () => {
    const esperas: number[] = [];
    const { impl } = fetchFalso([sinConexion()]);
    await expect(pedirAOverpass("[out:json];", {
      servidores: [OFICIAL], fetchImpl: impl, esperar: async (ms) => { esperas.push(ms); },
    })).rejects.toThrow();
    expect(esperas).toEqual(ESPERAS_MS);
  });
});
