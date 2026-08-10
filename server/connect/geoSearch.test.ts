import { describe, expect, it } from "vitest";
import { interpretarBusqueda, kmEntre, talleresCercanos } from "./geoSearch.ts";

describe("interpretar la búsqueda", () => {
  it("reconoce coordenadas pegadas de WhatsApp", () => {
    const r = interpretarBusqueda("41.5569, 2.1528")!;
    expect(r.tipo).toBe("coordenadas");
    expect(r.punto).toEqual({ lat: 41.5569, lng: 2.1528 });
    expect(r.consultas).toEqual([]);
  });

  it("acepta coordenadas con coma decimal y separadas por espacio", () => {
    expect(interpretarBusqueda("41,5569 2,1528")!.punto).toEqual({ lat: 41.5569, lng: 2.1528 });
  });

  it("no toma por coordenadas algo fuera de rango", () => {
    expect(interpretarBusqueda("941.5, 2.1")!.tipo).toBe("texto");
  });

  it("saca el punto de un enlace de Google Maps", () => {
    const r = interpretarBusqueda("https://www.google.com/maps/@41.5569,2.1528,15z")!;
    expect(r.tipo).toBe("enlace");
    expect(r.punto).toEqual({ lat: 41.5569, lng: 2.1528 });
  });

  it("avisa si el enlace no lleva coordenadas dentro", () => {
    const r = interpretarBusqueda("https://share.google/abc123")!;
    expect(r.punto).toBeUndefined();
    expect(r.avisos[0]).toMatch(/no lleva coordenadas/i);
  });

  it("reconoce un código postal y lo filtra por país", () => {
    const r = interpretarBusqueda("08213")!;
    expect(r.tipo).toBe("codigo_postal");
    expect(r.componentes).toBe("postal_code:08213|country:ES");
  });

  it("reconoce un punto kilométrico de autopista", () => {
    const r = interpretarBusqueda("AP-7 km 234")!;
    expect(r.tipo).toBe("punto_kilometrico");
    expect(r.etiqueta).toBe("AP-7 km 234");
    expect(r.consultas[0]).toContain("AP-7 km 234");
  });

  it("admite las variantes pk, p.k. y kilómetro", () => {
    expect(interpretarBusqueda("A-2 pk 512")!.etiqueta).toBe("A-2 km 512");
    expect(interpretarBusqueda("N-340 p.k. 1170,5")!.etiqueta).toBe("N-340 km 1170.5");
    expect(interpretarBusqueda("C-31 kilometro 12")!.etiqueta).toBe("C-31 km 12");
  });

  it("reconoce carreteras nacionales en números romanos", () => {
    expect(interpretarBusqueda("N-II km 600")!.etiqueta).toBe("N-II km 600");
  });

  it("aprovecha la provincia para desempatar un PK repetido", () => {
    const r = interpretarBusqueda("AP-7 km 234 Tarragona")!;
    expect(r.consultas[0]).toContain("Tarragona");
    // y deja el intento sin provincia como repliegue
    expect(r.consultas.some((c) => !c.includes("Tarragona"))).toBe(true);
  });

  it("avisa de que un PK es aproximado", () => {
    expect(interpretarBusqueda("AP-7 km 234")!.avisos[0]).toMatch(/aproximada/i);
  });

  it("una carretera sin PK no es un punto: lo dice", () => {
    const r = interpretarBusqueda("AP-7")!;
    expect(r.tipo).toBe("texto");
    expect(r.avisos[0]).toMatch(/sin punto kilom/i);
  });

  it("una localidad se busca como texto acotado a España", () => {
    const r = interpretarBusqueda("Polinyà")!;
    expect(r.tipo).toBe("texto");
    expect(r.componentes).toBe("country:ES");
    expect(r.consultas).toContain("Polinyà, España");
  });

  it("una búsqueda vacía no es nada", () => {
    expect(interpretarBusqueda("   ")).toBeNull();
    expect(interpretarBusqueda("")).toBeNull();
  });
});

describe("talleres cercanos", () => {
  const talleres = [
    { id: 1, name: "Polinyà", latitude: 41.5569, longitude: 2.1528, radiusKm: 60 },
    { id: 2, name: "Reus", latitude: 41.1560, longitude: 1.1069, radiusKm: 60 },
    { id: 3, name: "Zaragoza", latitude: 41.6488, longitude: -0.8891, radiusKm: 30 },
  ];

  it("ordena por distancia al punto", () => {
    const r = talleresCercanos({ lat: 41.55, lng: 2.15 }, talleres);
    expect(r.map((w) => w.id)).toEqual([1, 2, 3]);
    expect(r[0].distanceKm).toBeLessThan(2);
  });

  it("marca si el punto entra en el radio declarado del taller", () => {
    const r = talleresCercanos({ lat: 41.55, lng: 2.15 }, talleres);
    expect(r[0].enCobertura).toBe(true);
    expect(r[2].enCobertura).toBe(false);
  });

  it("respeta el límite pedido", () => {
    expect(talleresCercanos({ lat: 41.55, lng: 2.15 }, talleres, 2)).toHaveLength(2);
  });

  it("descarta talleres sin coordenadas utilizables", () => {
    const malo = { id: 9, name: "Sin GPS", latitude: NaN, longitude: NaN, radiusKm: 60 };
    expect(talleresCercanos({ lat: 41.55, lng: 2.15 }, [...talleres, malo]).some((w) => w.id === 9)).toBe(false);
  });
});

describe("distancia", () => {
  it("mide en kilómetros", () => {
    // Polinyà → Reus en línea recta
    expect(Math.round(kmEntre(41.5569, 2.1528, 41.1560, 1.1069))).toBe(98);
  });
});
