/**
 * La descarga de un adjunto de Twilio sigue la redirección a su CDN.
 *
 * ── La avería que fija esta prueba ──────────────────────────────────────────
 *
 * Twilio no sirve el adjunto desde «api.twilio.com»: contesta con un 307 hacia
 * «media.twiliocdn.com», y de ahí baja el fichero. `fetchSeguro` deja las
 * redirecciones a CERO por defecto —lo correcto para una URL que elige un
 * desconocido— y la descarga de Twilio se quedó en cero sin querer al
 * endurecerse en la Fase 0.
 *
 * Resultado: cada descarga reventaba en la primera redirección, el fallo se
 * tragaba para no perder el mensaje, y NINGÚN adjunto de WhatsApp tuvo copia
 * desde entonces. Se vio como «las fotos no se ven», y costó tres arreglos
 * equivocados —firmar enlaces, no apuntar a Twilio, mirar la cuota— llegar
 * aquí. Esta prueba existe para que nadie tenga que volver a hacer ese camino.
 *
 * ── Sin red ─────────────────────────────────────────────────────────────────
 *
 * Se finge el DNS —`validarUrlSegura` resuelve el host de verdad— y el `fetch`
 * global. Así la prueba dice lo mismo en la CI y en un portátil sin salida, y
 * no depende de que Twilio esté levantado.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  default: {
    // Una dirección pública cualquiera: lo que se prueba no es el DNS, sino
    // que la redirección se sigue y a dónde no se sigue.
    lookup: async () => [{ address: "54.10.20.30", family: 4 }],
  },
}));

const API = "https://api.twilio.com/2010-04-01/Accounts/AC1/Messages/MM1/Media/ME1";
const CDN = "https://media.twiliocdn.com/AC1/ME1?Signature=abc";
const BYTES = Buffer.from("foto-de-prueba");

type Llamada = { url: string; authorization: string | undefined };

/** Un `fetch` fingido que contesta según el host, y apunta cada llamada. */
function fetchFingido(redirigirA: string): { llamadas: Llamada[]; fn: typeof fetch } {
  const llamadas: Llamada[] = [];
  const fn = (async (entrada: any, init?: RequestInit) => {
    const url = String(entrada);
    const cabeceras = (init?.headers ?? {}) as Record<string, string>;
    llamadas.push({ url, authorization: cabeceras.Authorization });
    if (url.startsWith("https://api.twilio.com/")) {
      return new Response(null, { status: 307, headers: { location: redirigirA } });
    }
    return new Response(BYTES, {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": String(BYTES.length) },
    });
  }) as unknown as typeof fetch;
  return { llamadas, fn };
}

describe("descargarMedioTwilio", () => {
  let descargarMedioTwilio: typeof import("./medioTwilio.ts").descargarMedioTwilio;

  beforeAll(async () => {
    // `medioTwilio.ts` arrastra el cliente de Supabase, que revienta al
    // cargarse sin credenciales; aquí no se usa, pero tiene que poder cargar.
    process.env.SUPABASE_URL ??= "https://dummy.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "dummy";
    process.env.TWILIO_ACCOUNT_SID = "AC_prueba";
    process.env.TWILIO_AUTH_TOKEN = "token_prueba";
    ({ descargarMedioTwilio } = await import("./medioTwilio.ts"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sigue el 307 de api.twilio.com a media.twiliocdn.com y baja el fichero", async () => {
    const { llamadas, fn } = fetchFingido(CDN);
    vi.stubGlobal("fetch", fn);

    const r = await descargarMedioTwilio(API);

    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("image/jpeg");
    expect(Buffer.compare(r.cuerpo, BYTES)).toBe(0);
    expect(r.urlFinal).toBe(CDN);
    expect(llamadas.map((l) => l.url)).toEqual([API, CDN]);
  });

  it("la primera petición lleva las credenciales de la cuenta de Twilio", async () => {
    const { llamadas, fn } = fetchFingido(CDN);
    vi.stubGlobal("fetch", fn);

    await descargarMedioTwilio(API);

    const esperado =
      "Basic " + Buffer.from("AC_prueba:token_prueba").toString("base64");
    expect(llamadas[0].authorization).toBe(esperado);
  });

  it("una redirección fuera de Twilio se rechaza, y la credencial no viaja allí", async () => {
    /*
     * Lo que el endurecimiento cerró tiene que seguir cerrado: seguir la
     * redirección no puede convertirse en «seguirla a cualquier sitio». Si
     * Twilio —o quien se haga pasar por Twilio— redirige a un host ajeno, no
     * se visita, y la cabecera Basic con el SID y el token no sale de casa.
     */
    const { llamadas, fn } = fetchFingido("https://atacante.tld/recoge-credenciales");
    vi.stubGlobal("fetch", fn);

    await expect(descargarMedioTwilio(API)).rejects.toThrow();
    expect(llamadas.map((l) => l.url)).toEqual([API]);
    expect(llamadas.some((l) => l.url.includes("atacante.tld"))).toBe(false);
  });
});
