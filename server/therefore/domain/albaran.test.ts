import { describe, expect, it } from "vitest";
import {
  claveAlbaran,
  compararAlbaranes,
  elegirAlbaran,
  normalizarAlbaran,
} from "./albaran.ts";

describe("normalizar", () => {
  it("descompone un identificador compuesto", () => {
    const n = normalizarAlbaran("ENT-770199-0501234")!;
    expect(n.completo).toBe("ENT7701990501234");
    expect(n.numeros).toEqual(["770199", "501234"]);
    expect(n.nucleo).toBe("501234");
  });

  it("quita los ceros a la izquierda del núcleo", () => {
    expect(normalizarAlbaran("0501234")!.nucleo).toBe("501234");
    expect(normalizarAlbaran("501234")!.nucleo).toBe("501234");
  });

  it("reconoce el número pegado a un prefijo sin separador", () => {
    expect(normalizarAlbaran("ALB0501234")!.nucleo).toBe("501234");
  });

  /*
   * El sufijo de línea NO es el albarán. Sale gratis al descartar las tiradas
   * de menos de tres dígitos, y si no se descartaran el núcleo de `0501234/2`
   * sería «2» y no cruzaría con nada.
   */
  it("un sufijo corto no se confunde con el número", () => {
    expect(normalizarAlbaran("0501234/2")!.nucleo).toBe("501234");
  });

  it("conserva el texto original para poder enseñarlo", () => {
    expect(normalizarAlbaran("  ENT-770199-0501234 ")!.raw).toBe("ENT-770199-0501234");
  });

  it("lo que no tiene número no es un albarán", () => {
    expect(normalizarAlbaran("ALBARÁN")).toBeNull();
    expect(normalizarAlbaran("S/N")).toBeNull();
    expect(normalizarAlbaran("")).toBeNull();
    expect(normalizarAlbaran(null)).toBeNull();
    expect(normalizarAlbaran(42)).toBeNull();
  });

  it("la clave de cruce es el núcleo", () => {
    expect(claveAlbaran("0501234")).toBe("501234");
    expect(claveAlbaran("ENT-770199-0501234")).toBe("501234");
    expect(claveAlbaran("9011223344")).toBe("9011223344");
    expect(claveAlbaran("sin número")).toBeNull();
  });
});

describe("comparar", () => {
  it("escrito igual: certeza total", () => {
    const c = compararAlbaranes("9011223344", "9011223344");
    expect(c.resultado).toBe("MATCH");
    expect(c.confianza).toBe(1);
  });

  it("los guiones y los espacios no cuentan", () => {
    expect(compararAlbaranes("ENT 770199 0501234", "ENT-770199-0501234").confianza).toBe(1);
  });

  /* El caso del encargo: 0501234 en la incidencia, ENT-770199-0501234 en el PDF. */
  it("reconoce el número dentro de un identificador compuesto", () => {
    const c = compararAlbaranes("0501234", "ENT-770199-0501234");
    expect(c.resultado).toBe("MATCH");
    expect(c.confianza).toBeGreaterThanOrEqual(0.9);
    expect(c.motivo).toContain("ENT-770199-0501234");
  });

  it("los ceros a la izquierda no separan dos albaranes iguales", () => {
    expect(compararAlbaranes("0501234", "501234").resultado).toBe("MATCH");
  });

  /* Lo que nunca puede pasar: dos albaranes consecutivos dados por el mismo. */
  it("dos números parecidos NO son el mismo albarán", () => {
    const c = compararAlbaranes("0501234", "ENT-770199-0501235");
    expect(c.resultado).toBe("NO_MATCH");
    expect(c.parecido).toBe(true);
    expect(c.motivo).toContain("se parece");
  });

  it("un número de serie dentro del identificador se queda en dudoso", () => {
    const c = compararAlbaranes("770199", "ENT-770199-0501234");
    expect(c.resultado).toBe("UNCERTAIN");
    expect(c.confianza).toBeLessThan(0.9);
  });

  it("dos albaranes sin nada que ver no coinciden ni se parecen", () => {
    const c = compararAlbaranes("9011223344", "0501234");
    expect(c.resultado).toBe("NO_MATCH");
    expect(c.parecido).toBe(false);
    expect(c.confianza).toBe(0);
  });

  it("sin número reconocible no se inventa una coincidencia", () => {
    expect(compararAlbaranes("0501234", "ALBARÁN DE ENTREGA").resultado).toBe("NO_MATCH");
    expect(compararAlbaranes("", "0501234").confianza).toBe(0);
  });

  it("números cortos no se marcan como parecidos", () => {
    // 802 y 803 difieren en un dígito, pero son demasiado cortos para decir nada.
    expect(compararAlbaranes("802", "803").parecido).toBe(false);
  });

  it("los umbrales son un parámetro", () => {
    const estricto = compararAlbaranes("0501234", "ENT-770199-0501234", {
      match: 0.99,
      incierto: 0.5,
    });
    expect(estricto.resultado).toBe("UNCERTAIN");
  });
});

describe("elegir entre los albaranes de un documento", () => {
  const seccion = (numero: string) => ({ numero });
  const numeroDe = (s: { numero: string }) => s.numero;

  it("coge el pedido y sólo el pedido", () => {
    const r = elegirAlbaran(
      "0501234",
      ["ENT-770199-0806294", "ENT-770199-0501234", "ENT-770199-0501235"].map(seccion),
      numeroDe
    );
    expect(r.candidato?.numero).toBe("ENT-770199-0501234");
    expect(r.comparacion.resultado).toBe("MATCH");
  });

  it("anota los parecidos que ha descartado", () => {
    const r = elegirAlbaran(
      "0501234",
      ["ENT-770199-0501235", "ENT-770199-0501234"].map(seccion),
      numeroDe
    );
    expect(r.candidato?.numero).toBe("ENT-770199-0501234");
    expect(r.parecidos.map(numeroDe)).toEqual(["ENT-770199-0501235"]);
  });

  it("si no está, no devuelve el que más se le parezca", () => {
    const r = elegirAlbaran("0501234", ["ENT-770199-0501235"].map(seccion), numeroDe);
    expect(r.candidato).toBeNull();
    expect(r.comparacion.resultado).toBe("NO_MATCH");
  });

  it("el mismo albarán dos veces en el documento pide una persona", () => {
    const r = elegirAlbaran(
      "0501234",
      ["ENT-770199-0501234", "ENT-770199-0501234"].map(seccion),
      numeroDe
    );
    expect(r.comparacion.resultado).toBe("UNCERTAIN");
    expect(r.comparacion.motivo).toContain("más de una vez");
  });

  it("un documento sin albaranes no da candidato", () => {
    const r = elegirAlbaran("0501234", [], numeroDe);
    expect(r.candidato).toBeNull();
    expect(r.comparacion.confianza).toBe(0);
  });
});
