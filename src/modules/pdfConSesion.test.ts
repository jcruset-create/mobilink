import { describe, expect, it, vi } from "vitest";

import { cuerpoDelPdf, mensajeDeError, type Peticion } from "./pdfConSesion.ts";

/** Una respuesta de `fetch` de mentira, con lo justo que se le mira. */
function respuesta(
  estado: number,
  opciones: { json?: unknown; blob?: unknown } = {}
): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    json: async () => {
      if (opciones.json === undefined) throw new Error("no es JSON");
      return opciones.json;
    },
    blob: async () => opciones.blob,
  } as unknown as Response;
}

describe("qué se le dice a quien pulsa cuando no sale el informe", () => {
  /*
   * El mensaje importa más de lo que parece. La avería que motivó esto se vio
   * como «{"error":"No autorizado"}» en una pestaña en blanco, y con eso no hay
   * forma de saber si falta un permiso, si el informe no existe o si el panel
   * está roto. Si el servidor se ha molestado en explicarse, se le hace caso.
   */
  it("manda el mensaje del servidor cuando lo hay", () => {
    expect(mensajeDeError(404, { error: "Asistencia no encontrada" })).toBe(
      "Asistencia no encontrada"
    );
  });

  it("sin mensaje, un 401 o un 403 se explican como lo que son", () => {
    expect(mensajeDeError(401, null)).toBe("No tienes permiso para ver este informe.");
    expect(mensajeDeError(403, {})).toBe("No tienes permiso para ver este informe.");
  });

  it("y cualquier otro al menos lleva el código, para poder preguntar", () => {
    expect(mensajeDeError(500, null)).toBe("No se pudo abrir el informe (error 500).");
  });

  it("un «error» vacío o que no es texto no cuenta como mensaje", () => {
    expect(mensajeDeError(500, { error: "   " })).toBe(
      "No se pudo abrir el informe (error 500)."
    );
    expect(mensajeDeError(500, { error: 42 })).toBe(
      "No se pudo abrir el informe (error 500)."
    );
  });
});

describe("la descarga del PDF", () => {
  it("devuelve el fichero cuando el servidor contesta bien", async () => {
    const pdf = { tipo: "pdf" };
    const peticion = vi.fn(async () => respuesta(200, { blob: pdf })) as unknown as Peticion;
    await expect(cuerpoDelPdf(peticion, "/api/informe.pdf")).resolves.toBe(pdf);
  });

  it("la petición va por el fetch que se le da, que es el que lleva la sesión", async () => {
    /*
     * Éste es el fondo del arreglo. Antes se abría la URL con el token pegado
     * en la cadena de consulta, y una navegación del navegador no puede llevar
     * cabeceras; con el login del hub ese token ya no existe y el enlace salía
     * vacío. Pasando por `fetch`, la sesión viaja donde tiene que viajar.
     */
    const peticion = vi.fn(async () => respuesta(200, { blob: {} }));
    await cuerpoDelPdf(peticion as unknown as Peticion, "/api/informe.pdf");
    expect(peticion).toHaveBeenCalledWith("/api/informe.pdf", { method: "GET" });
  });

  it("no se cuela ninguna credencial en la URL", async () => {
    const vistas: string[] = [];
    const peticion: Peticion = async (url) => {
      vistas.push(url);
      return respuesta(200, { blob: {} });
    };
    await cuerpoDelPdf(peticion, "/api/informe.pdf");
    expect(vistas[0]).not.toContain("token=");
  });

  it("un 401 se convierte en un error que se puede enseñar", async () => {
    const peticion = vi.fn(async () =>
      respuesta(401, { json: { error: "No autorizado" } })
    ) as unknown as Peticion;
    await expect(cuerpoDelPdf(peticion, "/api/informe.pdf")).rejects.toThrow(
      "No autorizado"
    );
  });

  it("y si la respuesta de error ni siquiera es JSON, tampoco revienta", async () => {
    // Pasa cuando contesta el proxy o cae el servidor: devuelve HTML.
    const peticion = vi.fn(async () => respuesta(502)) as unknown as Peticion;
    await expect(cuerpoDelPdf(peticion, "/api/informe.pdf")).rejects.toThrow(
      "No se pudo abrir el informe (error 502)."
    );
  });
});
