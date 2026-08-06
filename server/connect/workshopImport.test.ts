import { describe, expect, it } from "vitest";
import {
  buscarDuplicados, metrosEntre, normalizarDireccion, normalizarNombre,
  normalizarPropuesta, normalizarTelefono,
} from "./workshopImport.ts";

const POLINYA = {
  id: 1,
  name: "Confortauto Neumáticos Polinyà",
  phone: "937133317",
  address: "Ctra. Santa Perpetua a Sentmenat, Km 1,4 Nave 5",
  latitude: 41.5569,
  longitude: 2.1528,
};

describe("normalización", () => {
  it("iguala el mismo taller escrito de dos maneras", () => {
    expect(normalizarNombre("Talleres Pérez, S.L.")).toBe(normalizarNombre("PEREZ"));
  });

  it("no confunde talleres distintos", () => {
    expect(normalizarNombre("Talleres Pérez")).not.toBe(normalizarNombre("Talleres Gómez"));
  });

  it("quita emojis y reclamos de puntuación del nombre", () => {
    expect(normalizarNombre('🔧 "Auto Polinyà" ★')).toBe("auto polinya");
  });

  it("iguala el teléfono con y sin prefijo", () => {
    expect(normalizarTelefono("+34 937 133 317")).toBe(normalizarTelefono("937133317"));
  });

  it("teléfono vacío no casa con nada", () => {
    expect(normalizarTelefono("")).toBe("");
    expect(normalizarTelefono(null)).toBe("");
  });

  it("iguala la dirección con abreviatura y sin ella", () => {
    expect(normalizarDireccion("Ctra. Santa Perpetua, Km 1,4"))
      .toBe(normalizarDireccion("Carretera Santa Perpetua 1 4"));
  });
});

describe("distancia", () => {
  it("mide en metros", () => {
    // ~1 km al norte
    expect(Math.round(metrosEntre(41.5569, 2.1528, 41.5659, 2.1528) / 100) * 100).toBe(1000);
  });
});

describe("duplicados", () => {
  it("detecta el mismo taller por teléfono aunque cambie el nombre", () => {
    const d = buscarDuplicados({ name: "Otro nombre", phone: "+34 937 133 317" }, [POLINYA]);
    expect(d).toHaveLength(1);
    expect(d[0].motivos).toContain("mismo teléfono");
  });

  it("detecta por cercanía de coordenadas", () => {
    const d = buscarDuplicados({ name: "Sin relación", latitude: 41.5570, longitude: 2.1529 }, [POLINYA]);
    expect(d[0].motivos.some((m) => m.startsWith("a "))).toBe(true);
  });

  it("no marca duplicado un taller distinto y lejano", () => {
    const d = buscarDuplicados(
      { name: "Talleres Gómez", phone: "934000000", latitude: 41.9, longitude: 2.9 },
      [POLINYA],
    );
    expect(d).toEqual([]);
  });

  it("un candidato sin datos no arrastra a todos los talleres", () => {
    expect(buscarDuplicados({}, [POLINYA])).toEqual([]);
  });

  it("ordena primero el que coincide en más señales", () => {
    const otro = { ...POLINYA, id: 2, name: "Otro", phone: "930000000", latitude: 41.9, longitude: 2.9,
      address: "Ctra. Santa Perpetua a Sentmenat, Km 1,4 Nave 5" };
    const d = buscarDuplicados(
      { name: POLINYA.name, phone: POLINYA.phone, address: POLINYA.address,
        latitude: POLINYA.latitude, longitude: POLINYA.longitude },
      [otro, POLINYA],
    );
    expect(d[0].id).toBe(1);
  });
});

describe("propuesta de la IA", () => {
  it("deja el teléfono español en formato internacional", () => {
    expect(normalizarPropuesta({ phone: "937133317" }).phone).toBe("+34937133317");
  });

  it("respeta un prefijo que ya venga puesto", () => {
    expect(normalizarPropuesta({ phone: "+33 1 23 45 67 89" }).phone).toBe("+33 1 23 45 67 89");
  });

  it("descarta códigos de servicio inventados", () => {
    expect(normalizarPropuesta({ services: ["tyres", "chapa_y_pintura", "mechanical"] }).services)
      .toEqual(["tyres", "mechanical"]);
  });

  it("convierte a null lo que no consta, sin colar ceros", () => {
    const p = normalizarPropuesta({ name: "Taller", latitude: "", longitude: null, city: "  " });
    expect(p.latitude).toBeNull();
    expect(p.longitude).toBeNull();
    expect(p.city).toBeNull();
  });

  it("acepta coordenadas con coma decimal", () => {
    expect(normalizarPropuesta({ latitude: "41,5569" }).latitude).toBeCloseTo(41.5569, 4);
  });

  it("sin services devuelve lista vacía, no null", () => {
    expect(normalizarPropuesta({}).services).toEqual([]);
  });
});
