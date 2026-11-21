import { describe, it, expect } from "vitest";
import {
  interpretarConsulta, medidaDeTexto, marcaPedida, clasificar, clasificarTodos,
  faltanDatos, fuentesUtiles, creables, normModelo, ejeDelCandidato, consultaDe,
  type CandidatoCrudo, type ReferenciaExistente,
} from "./catalogoIA";

const CONSULTA = interpretarConsulta("Busca modelos de neumáticos CEAT en 295/80R22.5");

const fuente = [{ url: "https://www.ceat.com/truck/winmile-x3-r", titulo: "CEAT WINMILE X3-R" }];

const candidato = (o: Partial<CandidatoCrudo> = {}): CandidatoCrudo => ({
  fabricante: "CEAT",
  modelo: "WINMILE X3-R",
  medida: "295/80R22.5",
  indiceCargaSimple: "152",
  indiceCargaDoble: "148",
  codigoVelocidad: "M",
  fuentes: fuente,
  ...o,
});

describe("interpretarConsulta", () => {
  it("saca marca y medida de la frase del ejemplo", () => {
    expect(CONSULTA.fabricante).toBe("CEAT");
    expect(CONSULTA.medida).toBe("295/80R22.5");
  });

  it("aguanta cómo lo escribe la gente", () => {
    for (const frase of [
      "modelos CEAT 295/80 R22.5",
      "quiero neumáticos de la marca CEAT en medida 295/80R22,5",
      "CEAT 295/80R22.5",
      "busca gomas ceat para 295/80 R 22.5",
    ]) {
      const c = interpretarConsulta(frase);
      expect(c.medida).toBe("295/80R22.5");
      expect(c.fabricante?.toUpperCase()).toBe("CEAT");
    }
  });

  it("una marca que el catálogo no conoce también vale", () => {
    // Si solo aceptara marcas conocidas, esto no serviría para nada: buscar
    // es justo lo que se hace con una marca que todavía no está.
    expect(interpretarConsulta("busca modelos Aeolus en 315/80R22.5").fabricante).toBe("Aeolus");
  });

  it("sin medida y sin marca, lo dice", () => {
    expect(interpretarConsulta("busca modelos de neumáticos").fabricante).toBeNull();
    expect(interpretarConsulta("busca modelos de neumáticos").medida).toBeNull();
  });

  it("medidas de camión antiguas y con coma", () => {
    expect(medidaDeTexto("13R22.5")).toBe("13R22.5");
    expect(medidaDeTexto("385/65 R22,5")).toBe("385/65R22.5");
    expect(medidaDeTexto("sin medida aquí")).toBeNull();
  });
});

describe("la IA no puede cambiar de marca por el camino", () => {
  it("acepta la que se pidió", () => {
    expect(marcaPedida(CONSULTA, "CEAT")).toBe(true);
    expect(marcaPedida(CONSULTA, "ceat")).toBe(true);
  });

  it("rechaza cualquier otra", () => {
    expect(marcaPedida(CONSULTA, "Bridgestone")).toBe(false);
    expect(marcaPedida(CONSULTA, "")).toBe(false);
    expect(marcaPedida(CONSULTA, null)).toBe(false);
  });

  it("un candidato de otra marca NO se ofrece", () => {
    const c = clasificar(candidato({ fabricante: "Bridgestone", modelo: "R-Drive 002" }), CONSULTA, []);
    expect(c.estado).toBe("no_verificado");
    expect(c.motivo).toContain("no es la marca que has pedido");
  });
});

describe("la medida la manda la consulta, no el modelo", () => {
  it("otra medida no se ofrece, aunque la ficha sea real", () => {
    const c = clasificar(candidato({ medida: "315/80R22.5" }), CONSULTA, []);
    expect(c.estado).toBe("no_verificado");
    expect(c.motivo).toContain("no de 295/80R22.5");
  });

  it("la misma medida escrita de otra forma sí vale", () => {
    expect(clasificar(candidato({ medida: "295/80 R22.5" }), CONSULTA, []).estado).toBe("nuevo");
  });
});

describe("sin fuente no hay verificación", () => {
  it("sin fuentes se marca no verificado", () => {
    const c = clasificar(candidato({ fuentes: [] }), CONSULTA, []);
    expect(c.estado).toBe("no_verificado");
    expect(c.motivo).toContain("Sin ninguna fuente");
  });

  it("una URL inventada que no es URL no cuenta", () => {
    const c = clasificar(candidato({ fuentes: [{ url: "catálogo oficial de CEAT" }] }), CONSULTA, []);
    expect(c.estado).toBe("no_verificado");
  });

  it("las fuentes repetidas se quedan en una", () => {
    expect(fuentesUtiles([{ url: "https://a.com/x" }, { url: "https://a.com/x" }])).toHaveLength(1);
  });
});

describe("duplicados contra el catálogo", () => {
  const existentes: ReferenciaExistente[] = [
    { id: "r1", marca: "CEAT", modelo: "WINMILE X3-R", medida: "295/80R22.5" },
    { id: "r2", marca: "CEAT", modelo: "WINLOAD X3-D", medida: "315/80R22.5" },
  ];

  it("lo que ya está, no se vuelve a crear", () => {
    const c = clasificar(candidato(), CONSULTA, existentes);
    expect(c.estado).toBe("existente");
    expect(c.parecidos[0].id).toBe("r1");
  });

  it("da igual cómo esté escrito: Winmile X3 R es WINMILE X3-R", () => {
    expect(normModelo("Winmile X3 R")).toBe(normModelo("WINMILE X3-R"));
    const c = clasificar(candidato({ modelo: "Winmile X3 R" }), CONSULTA, existentes);
    expect(c.estado).toBe("existente");
  });

  it("el mismo modelo en otra medida es «revisar», no «nuevo»", () => {
    const c = clasificar(candidato({ modelo: "WINLOAD X3-D" }), CONSULTA, existentes);
    expect(c.estado).toBe("revisar");
    expect(c.motivo).toContain("otra medida");
  });

  it("un nombre que contiene a otro se manda a revisar", () => {
    const c = clasificar(candidato({ modelo: "WINMILE X3-R PLUS" }), CONSULTA, existentes);
    expect(c.estado).toBe("revisar");
    expect(c.motivo).toContain("Se parece a");
  });

  it("uno de verdad nuevo sí se puede crear", () => {
    const c = clasificar(candidato({ modelo: "WINSUPER X3-D" }), CONSULTA, existentes);
    expect(c.estado).toBe("nuevo");
  });
});

describe("datos que faltan", () => {
  it("sin índice de carga no se puede crear: el catálogo lo exige", () => {
    expect(faltanDatos(candidato({ indiceCargaSimple: null }))).toContain("índice de carga");
    const c = clasificar(candidato({ indiceCargaSimple: null }), CONSULTA, []);
    expect(c.estado).toBe("revisar");
    expect(c.motivo).toContain("índice de carga");
  });

  it("sin código de velocidad SÍ se puede: la columna lo admite vacío", () => {
    expect(faltanDatos(candidato({ codigoVelocidad: null }))).toEqual([]);
    expect(clasificar(candidato({ codigoVelocidad: null }), CONSULTA, []).estado).toBe("nuevo");
  });

  it("un dato con forma rara se avisa pero no bloquea", () => {
    const c = clasificar(candidato({ codigoVelocidad: "MM", ruidoDb: 120 }), CONSULTA, []);
    expect(c.estado).toBe("nuevo");
    expect(c.motivo).toContain("velocidad raro");
    expect(c.motivo).toContain("ruido fuera de rango");
  });
});

describe("la lista entera", () => {
  it("el mismo modelo desde dos páginas es una fila con dos fuentes", () => {
    const r = clasificarTodos([
      candidato({ fuentes: [{ url: "https://a.com/1" }] }),
      candidato({ fuentes: [{ url: "https://b.com/2" }] }),
    ], CONSULTA, []);
    expect(r).toHaveLength(1);
    expect(r[0].fuentes.map((f) => f.url)).toEqual(["https://a.com/1", "https://b.com/2"]);
  });

  it("solo se marcan solos los nuevos verificados", () => {
    const r = clasificarTodos([
      candidato({ modelo: "WINSUPER X3-D" }),
      candidato({ fabricante: "Michelin", modelo: "X Multi Z" }),
      candidato({ modelo: "WINLOAD X5-D", indiceCargaSimple: null }),
    ], CONSULTA, []);
    expect(creables(r).map((c) => c.modelo)).toEqual(["WINSUPER X3-D"]);
  });

  it("una búsqueda vacía no produce nada", () => {
    expect(clasificarTodos([], CONSULTA, [])).toEqual([]);
  });
});

describe("el eje que el catálogo acepta", () => {
  it("traduce cómo lo escriben las fichas reales", () => {
    expect(ejeDelCandidato("dirección")).toBe("direccion");
    expect(ejeDelCandidato("Steer")).toBe("direccion");
    expect(ejeDelCandidato("tracción")).toBe("traccion");
    expect(ejeDelCandidato("Drive axle")).toBe("traccion");
    expect(ejeDelCandidato("trailer")).toBe("remolque");
    expect(ejeDelCandidato("multiposición")).toBe("mixto");
    expect(ejeDelCandidato("all-position")).toBe("mixto");
  });

  it("lo que no encaja va vacío, no por parecido", () => {
    // La columna tiene lista cerrada: un valor de más hace fallar el alta con
    // un error de restricción que no se parece a su causa.
    expect(ejeDelCandidato("urbano")).toBeNull();
    expect(ejeDelCandidato("")).toBeNull();
    expect(ejeDelCandidato(null)).toBeNull();
  });
});

describe("consultaDe: marca y medida elegidas en desplegables", () => {
  it("lo elegido entra tal cual, sin interpretar nada", () => {
    const c = consultaDe("CEAT", "295/80R22.5");
    expect(c.fabricante).toBe("CEAT");
    expect(c.medida).toBe("295/80R22.5");
  });

  it("una marca de dos palabras no se parte", () => {
    // Por el camino de la frase, «Double Coin» sobrevive; pero elegirla de la
    // lista no debe depender de eso. Aquí entra entera por construcción.
    expect(consultaDe("Double Coin", "315/80R22.5").fabricante).toBe("Double Coin");
  });

  it("la medida tecleada a mano se normaliza", () => {
    expect(consultaDe("CEAT", "295/80 R 22,5").medida).toBe("295/80R22.5");
  });

  it("si lo tecleado no es una medida, no hay medida", () => {
    // Y sin medida no se busca: es lo que impide gastar una llamada y traer
    // cualquier cosa.
    expect(consultaDe("CEAT", "la grande").medida).toBeNull();
    expect(consultaDe("CEAT", "").medida).toBeNull();
  });

  it("la marca elegida sigue valiendo para el filtro de la respuesta", () => {
    const c = consultaDe("CEAT", "295/80R22.5");
    expect(marcaPedida(c, "CEAT")).toBe(true);
    expect(marcaPedida(c, "Bridgestone")).toBe(false);
  });
});
