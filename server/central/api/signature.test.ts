/**
 * Firma de webhooks: pruebas puras, sin base de datos.
 *
 * Es la parte que un integrador va a implementar del otro lado, así que tiene
 * que estar fijada: si la firma cambiara sin darse cuenta, todos los receptores
 * empezarían a rechazar envíos legítimos a la vez.
 */

import { describe, expect, it } from "vitest";
import { cabeceraFirma, firmar, firmaValida } from "./signature.ts";

describe("firma de webhooks", () => {
  const secreto = "un-secreto-cualquiera";
  const cuerpo = JSON.stringify({ tipo: "incident.opened", valor: 2000 });
  const marca = 1_800_000_000_000;

  it("la misma entrada da siempre la misma firma", () => {
    expect(firmar(secreto, marca, cuerpo)).toBe(firmar(secreto, marca, cuerpo));
    expect(firmar(secreto, marca, cuerpo)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("acepta la suya y rechaza cualquier otra", () => {
    const firma = firmar(secreto, marca, cuerpo);
    expect(firmaValida(secreto, marca, cuerpo, firma)).toBe(true);
    expect(firmaValida("otro-secreto", marca, cuerpo, firma)).toBe(false);
    expect(firmaValida(secreto, marca, cuerpo, "0".repeat(64))).toBe(false);
  });

  /*
   * La marca de tiempo entra en la firma, y no solo el cuerpo. Sin eso, un
   * envío legítimo capturado se podría reenviar para siempre: el receptor no
   * tendría cómo saber que es viejo.
   */
  it("la marca de tiempo forma parte de la firma", () => {
    const firma = firmar(secreto, marca, cuerpo);
    expect(firmaValida(secreto, marca + 1, cuerpo, firma)).toBe(false);
  });

  it("la cabecera lleva marca y firma, en el formato que espera un integrador", () => {
    expect(cabeceraFirma(secreto, marca, cuerpo)).toMatch(
      new RegExp(`^t=${marca},v1=[0-9a-f]{64}$`)
    );
  });

  it("cambiar un solo número del cuerpo invalida la firma", () => {
    const firma = firmar(secreto, marca, cuerpo);
    const manipulado = JSON.stringify({ tipo: "incident.opened", valor: 20 });
    expect(firmaValida(secreto, marca, manipulado, firma)).toBe(false);
  });
});
