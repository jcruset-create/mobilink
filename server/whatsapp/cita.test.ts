import { describe, expect, it } from "vitest";

import { numeroDeCita } from "./cita.ts";

describe("lo que se ve de verdad en los WhatsApp", () => {
  it("el mensaje que motivó esto", () => {
    // Asistencia #152, tal cual llegó.
    const texto =
      "Asistencia confirmada para el camión 8838NPX, conducido por Onay Leyva " +
      "Simón, por avería en un neumático. Se solicita una rueda nueva de medida " +
      "245/70R17.5. Ubicación registrada en Ocine, Polígono Industrial Les " +
      "Gavarres, Tarragona. Cita 694163.";
    expect(numeroDeCita(texto)).toBe("694163");
  });

  it("con dos puntos, con almohadilla y en mayúsculas", () => {
    expect(numeroDeCita("Cita: 694163")).toBe("694163");
    expect(numeroDeCita("cita nº 694163")).toBe("694163");
    expect(numeroDeCita("CITA Nº: 694163")).toBe("694163");
    expect(numeroDeCita("Nº de cita 694163")).toBe("694163");
    expect(numeroDeCita("N. de cita: 694163")).toBe("694163");
  });

  it("también sirve si lo llaman autorización", () => {
    expect(numeroDeCita("Autorización 88123")).toBe("88123");
    expect(numeroDeCita("Nº de autorizacion: A-4521")).toBe("A-4521");
    expect(numeroDeCita("autorización nº 77-2026")).toBe("77-2026");
  });

  it("números con letras y barras", () => {
    // Las aseguradoras mezclan de todo; mientras lleve un dígito, vale.
    expect(numeroDeCita("cita AB/2026/0031")).toBe("AB/2026/0031");
    expect(numeroDeCita("Cita 2026-4521")).toBe("2026-4521");
  });

  it("se queda con la primera cuando hay más de una", () => {
    // Pasa cuando reenvían un hilo. La primera es la de este servicio; las de
    // más abajo son de la conversación anterior.
    expect(numeroDeCita("Cita 694163. Antes fue la cita 111111.")).toBe("694163");
  });
});

describe("lo que NO puede dar por número de cita", () => {
  /*
   * Un dato inventado aquí es peor que el campo vacío: este número es el que
   * pide después la aseguradora para pagar, así que alguien lo daría por bueno
   * al facturar sin comprobarlo.
   */
  it("«cita previa» no es un número", () => {
    expect(numeroDeCita("Tiene cita previa en el taller")).toBeNull();
  });

  it("«cita para el martes» tampoco", () => {
    expect(numeroDeCita("cita para el martes a las 9")).toBeNull();
  });

  it("una cita sin número no inventa uno", () => {
    expect(numeroDeCita("Confirmada la cita, vamos para allá")).toBeNull();
  });

  it("una palabra sin dígitos nunca vale", () => {
    expect(numeroDeCita("cita pendiente")).toBeNull();
    expect(numeroDeCita("autorización verbal")).toBeNull();
  });

  it("sin la palabra cita ni autorización, no se coge nada", () => {
    // Un número suelto en el mensaje no es una cita: puede ser la medida del
    // neumático, un teléfono o los kilómetros.
    expect(numeroDeCita("Rueda 245/70R17.5, avisar al 694163")).toBeNull();
  });

  it("texto vacío o basura", () => {
    expect(numeroDeCita("")).toBeNull();
    expect(numeroDeCita("   ")).toBeNull();
    expect(numeroDeCita(null)).toBeNull();
    expect(numeroDeCita(undefined)).toBeNull();
    expect(numeroDeCita(12345)).toBeNull();
  });
});

describe("cómo se limpia lo que se coge", () => {
  it("se quita el punto final de la frase", () => {
    expect(numeroDeCita("Cita 694163.")).toBe("694163");
    expect(numeroDeCita("Cita 694163, gracias")).toBe("694163");
    expect(numeroDeCita("(Cita 694163)")).toBe("694163");
  });

  it("pero no el guion ni la barra de dentro", () => {
    expect(numeroDeCita("Cita A-45/21.")).toBe("A-45/21");
  });
});
