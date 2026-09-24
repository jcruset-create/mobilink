import { describe, expect, it } from "vitest";
import { identidadParaRuta, MODULOS_CON_PESTANA } from "./pestanasModulos";
import { BASES } from "./rutasModulos";

describe("identidadParaRuta", () => {
  it("da el título del módulo en su portada y en sus pantallas", () => {
    expect(identidadParaRuta("/cash")?.titulo).toBe("Mobilink Cash");
    expect(identidadParaRuta("/cash/arqueo")?.titulo).toBe("Mobilink Cash");
    expect(identidadParaRuta("/core/empleados/7f3a")?.titulo).toBe("Mobilink Core");
  });

  it("Assist cubre las rutas sueltas del panel original", () => {
    for (const ruta of ["/asistencias", "/asistencias/calidad", "/operativo2", "/flota", "/taller"]) {
      expect(identidadParaRuta(ruta)?.titulo, ruta).toBe("Mobilink Assist");
    }
  });

  it("no se aplica fuera de un módulo", () => {
    for (const ruta of ["/inicio", "/acceso", "/seguimiento/abc123", "/informe/abc123", "/portal"]) {
      expect(identidadParaRuta(ruta), ruta).toBeNull();
    }
  });

  it("compara por segmento entero, no por prefijo de texto", () => {
    // /cashflow no es Mobilink Cash, aunque empiece igual
    expect(identidadParaRuta("/cashflow")).toBeNull();
    expect(identidadParaRuta("/centralita")).toBeNull();
  });

  it("los módulos con logotipo traen sus tres iconos; el resto, ninguno", () => {
    const cash = identidadParaRuta("/cash");
    expect(cash?.iconos.map((i) => i.href)).toEqual([
      "/iconos-modulos/cash-32.png",
      "/iconos-modulos/cash-16.png",
      "/iconos-modulos/cash-180.png",
    ]);
    // Administración no tiene logotipo propio: solo título, favicon genérico
    expect(identidadParaRuta("/administracion")?.iconos).toEqual([]);
  });

  it("todo módulo con base de ruta tiene su título", () => {
    // Si alguien añade un módulo a BASES y se olvida de la pestaña, la pestaña
    // se queda diciendo "Mobilink" sin que nadie se entere. Aquí se entera.
    for (const modulo of Object.keys(BASES)) {
      expect(MODULOS_CON_PESTANA, modulo).toContain(modulo);
      expect(identidadParaRuta(BASES[modulo]), modulo).not.toBeNull();
    }
  });

  it("ningún título repetido: la pestaña distingue de qué módulo se trata", () => {
    const titulos = Object.values(BASES).map((b) => identidadParaRuta(b)?.titulo);
    expect(new Set(titulos).size).toBe(titulos.length);
  });
});
