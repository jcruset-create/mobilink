import { describe, it, expect } from "vitest";
import {
  PLANTILLAS,
  aCentimos,
  errorDeImportes,
  euros,
  plantillaPorId,
  type DatosPlantilla,
} from "./plantillas";

const DATOS: DatosPlantilla = {
  cliente: "Jordi",
  senalCentimos: 5000,
  totalCentimos: 25000,
  concepto: "Pedido de neumáticos",
  enlace: "https://checkout.stripe.com/c/pay/abc",
};

describe("euros", () => {
  it("omite los céntimos cuando son cero", () => {
    expect(euros(25000)).toBe("250 €");
  });

  it("los pinta cuando los hay", () => {
    expect(euros(5050)).toBe("50,50 €");
    expect(euros(5005)).toBe("50,05 €");
  });

  it("separa los miles", () => {
    expect(euros(123456)).toBe("1.234,56 €");
  });
});

describe("plantilla de paga y señal de neumáticos", () => {
  const plantilla = plantillaPorId("senal-neumaticos");

  it("calcula el restante como total menos señal", () => {
    expect(plantilla.condiciones(DATOS)).toContain("Importe restante: 200 €");
  });

  it("repite el importe de la señal en las tres cláusulas", () => {
    const texto = plantilla.condiciones(DATOS);
    // El 250 € del total también acaba en "50 €": solo cuentan los sueltos.
    expect(texto.match(/(?<![\d.])50 €/g)).toHaveLength(3);
  });

  it("no arrastra el enlace ni el saludo a las condiciones", () => {
    // Lo que se guarda como aceptado es esto: si llevara el enlace dentro,
    // dos cobros idénticos darían condiciones distintas.
    const texto = plantilla.condiciones(DATOS);
    expect(texto).not.toContain(DATOS.enlace);
    expect(texto).not.toContain("Hola");
  });

  it("mete las condiciones y el enlace en el mensaje", () => {
    const texto = plantilla.mensaje(DATOS);
    expect(texto.startsWith("Hola Jordi,")).toBe(true);
    expect(texto).toContain(plantilla.condiciones(DATOS));
    expect(texto.trimEnd().endsWith(DATOS.enlace)).toBe(true);
  });

  it("saluda sin nombre si no lo hay", () => {
    expect(plantilla.mensaje({ ...DATOS, cliente: "  " }).startsWith("Hola, ")).toBe(true);
  });
});

describe("plantilla libre", () => {
  it("no impone condiciones que aceptar", () => {
    expect(plantillaPorId("libre").condiciones(DATOS)).toBe("");
  });

  it("es la que sale con un id desconocido o vacío", () => {
    // Un cobro guardado antes de que existieran las plantillas no tiene id.
    expect(plantillaPorId(null).id).toBe("libre");
    expect(plantillaPorId("la-que-borramos").id).toBe("libre");
  });
});

describe("errorDeImportes", () => {
  const conTotal = plantillaPorId("senal-neumaticos");
  const sinTotal = plantillaPorId("libre");

  it("exige el mínimo de Stripe", () => {
    expect(errorDeImportes(sinTotal, 99, 0)).toMatch(/mínimo/);
  });

  it("no deja un restante negativo", () => {
    expect(errorDeImportes(conTotal, 5000, 3000)).toMatch(/menor que la paga y señal/);
  });

  it("acepta que la señal sea el pedido entero", () => {
    expect(errorDeImportes(conTotal, 5000, 5000)).toBeNull();
  });

  it("ignora el total en las plantillas que no lo piden", () => {
    expect(errorDeImportes(sinTotal, 5000, 0)).toBeNull();
  });
});

describe("aCentimos", () => {
  it("lee punto y coma igual", () => {
    expect(aCentimos("50.5")).toBe(5050);
    expect(aCentimos("50,5")).toBe(5050);
  });

  it("aguanta el euro y los espacios pegados desde el presupuesto", () => {
    expect(aCentimos(" 250 € ")).toBe(25000);
  });

  it("da 0 con lo que no es un importe", () => {
    expect(aCentimos("")).toBe(0);
    expect(aCentimos("abc")).toBe(0);
    expect(aCentimos("-50")).toBe(0);
  });

  it("no arrastra los decimales binarios", () => {
    expect(aCentimos("18.7")).toBe(1870);
  });
});

describe("catálogo", () => {
  it("no repite ids", () => {
    const ids = PLANTILLAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
