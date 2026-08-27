/**
 * Lo único del extractor que se puede probar sin llamar a nadie: qué pasa
 * cuando el servidor no tiene IA configurada.
 *
 * No es un caso de laboratorio. La aplicación corre en sitios donde esa clave
 * puede no estar, y lo que no puede pasar es que el mostrador se quede mirando
 * un error genérico sin saber que lo que tiene que hacer es rellenar el cobro
 * a mano, como toda la vida.
 */

import { afterEach, describe, expect, it } from "vitest";
import { extractorIA } from "./extractor.ts";

const DOCUMENTO = {
  nombre: "factura.pdf",
  mime: "application/pdf",
  contenido: Buffer.from("%PDF-1.4\n", "latin1"),
};

const clave = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (clave === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = clave;
});

describe("sin IA configurada", () => {
  it("lo dice claro y no se queda colgado", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(extractorIA(DOCUMENTO)).rejects.toMatchObject({
      codigo: "ESCANEO_NO_DISPONIBLE",
      estado: 503,
    });
  });

  it("el mensaje dice qué hacer, no qué ha fallado por dentro", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(extractorIA(DOCUMENTO)).rejects.toThrow(/a mano/);
  });
});
