import { afterEach, describe, expect, it } from "vitest";

import {
  contentSidDeConfirmacion,
  fechaParaElCliente,
  nombreDelTaller,
  urlBaseParaCallbacks,
  variablesDeConfirmacion,
} from "./envio.ts";

const ENTORNO = { ...process.env };
afterEach(() => {
  process.env = { ...ENTORNO };
});

describe("variablesDeConfirmacion", () => {
  /*
   * Las seis variables son todas cadenas, así que un desajuste de orden manda
   * al cliente la matrícula donde debería ir la hora y ni el compilador ni
   * Twilio dicen nada. Este test es lo único que lo caza.
   */
  it("pone cada dato en su número", () => {
    const v = variablesDeConfirmacion(
      {
        customerName: "Becsa",
        workshopId: "sea-tarragona",
        date: "2026-09-27",
        startTime: "09:00",
        plate: "9780MKY",
      },
      "Pinchazo Turismo"
    );

    expect(v).toEqual({
      "1": "Becsa",
      "2": "Mobilink Tarragona",
      "3": "27/09/2026",
      "4": "09:00",
      "5": "9780MKY",
      "6": "Pinchazo Turismo",
    });
  });

  it("rellena lo que falte sin dejar huecos raros en el mensaje", () => {
    const v = variablesDeConfirmacion({}, "");
    expect(v["1"]).toBe("cliente");
    expect(v["4"]).toBe("-");
    expect(v["5"]).toBe("-");
    expect(v["6"]).toBe("revisión");
  });
});

describe("nombreDelTaller", () => {
  it("da el nombre que se le dice al cliente", () => {
    expect(nombreDelTaller("sea-tarragona")).toBe("Mobilink Tarragona");
    expect(nombreDelTaller("sea-reus")).toBe("Mobilink Reus");
  });

  it("sin taller cae al primero en vez de mandar un hueco", () => {
    expect(nombreDelTaller(null)).toBe("Mobilink Tarragona");
    expect(nombreDelTaller("inventado")).toBe("Mobilink Tarragona");
  });
});

describe("fechaParaElCliente", () => {
  it("la da como se lee en un WhatsApp", () => {
    expect(fechaParaElCliente("2026-09-27")).toBe("27/09/2026");
  });

  it("deja pasar lo que no reconoce en vez de inventar", () => {
    expect(fechaParaElCliente("mañana")).toBe("mañana");
    expect(fechaParaElCliente(null)).toBe("");
  });
});

describe("contentSidDeConfirmacion", () => {
  /*
   * Esto es lo que impide mandar la plantilla vieja. La vieja no tiene
   * botones: pedir que confirmen sin manera de confirmar deja al cliente
   * creyendo que ya avisó, y a la cita igual de sin confirmar.
   */
  it("vacío mientras no esté configurada, y NO cae a la de siempre", () => {
    delete process.env.TWILIO_CONTENT_SID_CONFIRMACION_CITA;
    process.env.TWILIO_CONTENT_SID = "HXplantillaVieja";
    expect(contentSidDeConfirmacion()).toBe("");
  });

  it("unos espacios no cuentan como configurada", () => {
    process.env.TWILIO_CONTENT_SID_CONFIRMACION_CITA = "   ";
    expect(contentSidDeConfirmacion()).toBe("");
  });

  it("la usa cuando está", () => {
    process.env.TWILIO_CONTENT_SID_CONFIRMACION_CITA = "HXnueva";
    expect(contentSidDeConfirmacion()).toBe("HXnueva");
  });
});

describe("urlBaseParaCallbacks", () => {
  it("usa PUBLIC_APP_URL cuando está", () => {
    process.env.PUBLIC_APP_URL = "https://app.mobilink.es/";
    expect(urlBaseParaCallbacks()).toBe("https://app.mobilink.es");
  });

  /*
   * Si el callback apunta a un sitio que no es este servicio, los estados no
   * llegan NUNCA y la ficha se queda en «enviado» para siempre, sin que nada
   * falle de forma visible. Por eso no se usa la URL de cara al cliente.
   */
  it("sin configurar cae al host que sirve la aplicación", () => {
    delete process.env.PUBLIC_APP_URL;
    expect(urlBaseParaCallbacks()).toBe("https://sea-tarragona.onrender.com");
  });

  it("ignora un valor que no sea una URL", () => {
    process.env.PUBLIC_APP_URL = "no-es-una-url";
    expect(urlBaseParaCallbacks()).toBe("https://sea-tarragona.onrender.com");
  });
});
