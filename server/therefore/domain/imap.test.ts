/**
 * Los fallos del buzón, tal y como los lanza ImapFlow.
 *
 * Los objetos de estas pruebas son copias de los que ImapFlow construye en
 * `settleRequest` y en el comando LOGIN: ahí es donde se decide que todo sea
 * «Command failed» y dónde queda lo que el servidor dijo de verdad.
 */

import { describe, expect, it } from "vitest";
import { motivoDelFallo } from "./imap.ts";

describe("motivoDelFallo", () => {
  it("la contraseña rechazada se nombra, con la variable que hay que mirar", () => {
    const e = Object.assign(new Error("Command failed"), {
      responseStatus: "NO",
      authenticationFailed: true,
      serverResponseCode: "AUTHENTICATIONFAILED",
      response: "[AUTHENTICATIONFAILED] Authentication failed.",
    });
    const m = motivoDelFallo(e, "conectar con el servidor de correo");
    expect(m).toContain("conectar con el servidor de correo");
    expect(m).toContain("THEREFORE_IMAP_PASS");
    expect(m).toContain("Authentication failed");
    expect(m).not.toBe("Command failed");
  });

  it("una carpeta que no existe dice qué carpeta y qué contestó el servidor", () => {
    const e = Object.assign(new Error("Command failed"), {
      responseStatus: "NO",
      responseText: "Mailbox doesn't exist: Therefore",
    });
    expect(motivoDelFallo(e, "abrir la carpeta Therefore")).toBe(
      "No se ha podido abrir la carpeta Therefore: Mailbox doesn't exist: Therefore · respuesta NO."
    );
  });

  it("un fallo de red no es respuesta del servidor: se queda con su código", () => {
    const e = Object.assign(new Error("Command failed"), { code: "ECONNREFUSED" });
    expect(motivoDelFallo(e, "conectar con el servidor de correo")).toBe(
      "No se ha podido conectar con el servidor de correo: ECONNREFUSED."
    );
  });

  it("un mensaje que sí dice algo se respeta tal cual", () => {
    expect(motivoDelFallo(new Error("Socket timeout"), "buscar los correos nuevos")).toBe(
      "No se ha podido buscar los correos nuevos: Socket timeout."
    );
  });

  it("sin nada que contar, al menos se sabe en qué paso fue", () => {
    expect(motivoDelFallo(new Error("Command failed"), "buscar los correos nuevos")).toBe(
      "No se ha podido buscar los correos nuevos."
    );
    expect(motivoDelFallo(undefined, "conectar con el servidor de correo")).toBe(
      "No se ha podido conectar con el servidor de correo."
    );
  });
});
