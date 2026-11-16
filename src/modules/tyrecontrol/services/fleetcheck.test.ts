import { describe, expect, it } from "vitest";
import {
  filasDeFleetcheck, firmaDeEjes, leerFleetcheck, medidaDeNeumatico, partesDeNeumatico, type LineaFleetcheck,
} from "./fleetcheck";

/**
 * Un informe en miniatura, con las mismas coordenadas que el de verdad
 * (Fleetcheck Report de TIRETASK, 16/11/2026): un autobús de dos ejes y un
 * autocar de tres, cuya tabla salta de página.
 */
const L = (pagina: number, x: number, y: number, texto: string): LineaFleetcheck => ({ pagina, x, y, texto });

function cabecera(p: number, y: number): LineaFleetcheck[] {
  return [
    L(p, 45, y, "Pos."), L(p, 68, y, "Número de"), L(p, 68, y + 10, "serie / DOT"), L(p, 130, y, "Neumáticos"),
    L(p, 229, y, "Perfil"), L(p, 229, y + 10, "1"), L(p, 257, y, "Perfil"), L(p, 257, y + 10, "2"),
    L(p, 286, y, "Perfil"), L(p, 286, y + 10, "3"), L(p, 314, y, "Rayar"), L(p, 342, y, "Condición"),
    L(p, 425, y, "Barra"), L(p, 425, y + 10, "antes"), L(p, 456, y, "Bar de"), L(p, 456, y + 10, "spués."),
    L(p, 487, y, "Comentario"),
  ];
}

function rueda(p: number, y: number, pos: string, p1: string, p2: string, antes: string, despues = "-"): LineaFleetcheck[] {
  return [
    L(p, 45, y, pos), L(p, 130, y, "Hankook 295/80 R22.5 Smart"), L(p, 130, y + 8, "Flex AH51 3PMSF 154M"),
    L(p, 231, y + 2, p1), L(p, 260, y + 2, p2), L(p, 288, y + 2, "-"), L(p, 316, y + 2, "No"), L(p, 345, y + 2, "/"),
    L(p, 427, y + 2, antes), L(p, 458, y + 2, despues),
  ];
}

const INFORME: LineaFleetcheck[] = [
  // Portada: la fecha va ANTES que su rótulo en el orden del PDF.
  L(1, 257, 215, "16/11/2026"), L(1, 280, 200, "Fecha"), L(1, 42, 670, "PLANA"),
  // Un «cambio recomendado» con posiciones, antes del detalle: no cuenta.
  L(5, 42, 100, "5267JRT"), L(5, 110, 100, "2-DI"),
  L(8, 42, 47, "VISTA DETALLADA"), L(8, 430, 807, "Creado con TIRETASK"),
  L(8, 42, 106, "5267JRT"), L(8, 42, 120, "Kilometraje: 486164"),
  ...cabecera(8, 143),
  ...rueda(8, 168, "1-IE", "7,0", "7,6", "4,5"),
  ...rueda(8, 189, "1-DE", "5,0", "6,4", "4,5", "5,0"),
  ...rueda(8, 211, "2-IE", "5,1", "4,6", "-"),
  ...rueda(8, 232, "2-II", "4,5", "4,6", "4,5"),
  ...rueda(8, 253, "2-DI", "3,7", "3,8", "4,5"),
  ...rueda(8, 274, "2-DE", "4,0", "3,7", "4,5"),
  // Tres ejes, el tercero sencillo, y la tabla sigue en la página siguiente.
  L(8, 42, 600, "7453KCC"), L(8, 42, 614, "Kilometraje: /"),
  ...cabecera(8, 637),
  ...rueda(8, 662, "1-IE", "5,0", "9,1", "9,0"),
  ...rueda(8, 683, "1-DE", "9,0", "9,1", "9,0"),
  L(9, 42, 47, "VISTA DETALLADA"),
  ...cabecera(9, 60),
  ...rueda(9, 85, "2-IE", "8,0", "8,1", "8,5"),
  ...rueda(9, 106, "2-II", "8,0", "8,1", "8,5"),
  ...rueda(9, 127, "2-DI", "8,0", "8,1", "8,5"),
  ...rueda(9, 148, "2-DE", "8,0", "8,1", "8,5"),
  ...rueda(9, 169, "3-IE", "6,2", "6,9", "9,0"),
  ...rueda(9, 190, "3-DE", "6,3", "7,0", "9,0"),
];

describe("leerFleetcheck", () => {
  const r = leerFleetcheck(INFORME);

  it("lee la fecha del informe aunque vaya antes que su rótulo", () => {
    expect(r.fecha).toBe("2026-11-16");
    expect(r.avisos).toEqual([]);
  });

  it("saca cada vehículo con su kilometraje; «/» es que no se apuntó", () => {
    expect(r.vehiculos.map((v) => [v.matricula, v.km, v.ruedas.length]))
      .toEqual([["5267JRT", 486164, 6], ["7453KCC", null, 8]]);
  });

  it("no cuenta las posiciones de las páginas de resumen", () => {
    expect(r.vehiculos[0].ruedas.filter((x) => x.posicion === "2-DI")).toHaveLength(1);
  });

  it("cada número va a su columna por la X, no por el orden", () => {
    const [ie, de, ie2] = r.vehiculos[0].ruedas;
    expect(ie).toMatchObject({ posicion: "1-IE", eje: 1, lado: "izq", perfiles: [7, 7.6], presionAntes: 4.5, presionDespues: null });
    expect(de).toMatchObject({ presionAntes: 4.5, presionDespues: 5 });
    // Sin presión: el hueco no corre las demás columnas.
    expect(ie2).toMatchObject({ perfiles: [5.1, 4.6], presionAntes: null, presionDespues: null });
  });

  it("junta las dos líneas del neumático", () => {
    expect(r.vehiculos[0].ruedas[0].neumatico).toBe("Hankook 295/80 R22.5 Smart Flex AH51 3PMSF 154M");
  });

  it("sigue la tabla en la página siguiente sin perder ruedas ni mezclar la cabecera", () => {
    expect(r.vehiculos[1].ruedas.map((x) => x.posicion))
      .toEqual(["1-IE", "1-DE", "2-IE", "2-II", "2-DI", "2-DE", "3-IE", "3-DE"]);
    expect(r.vehiculos[1].ruedas[2].perfiles).toEqual([8, 8.1]);
  });

  it("un PDF que no es el informe lo dice, en vez de devolver cero vehículos sin más", () => {
    const otro = leerFleetcheck([L(1, 10, 10, "Factura")]);
    expect(otro.vehiculos).toEqual([]);
    expect(otro.avisos.join(" ")).toContain("VISTA DETALLADA");
  });
});

describe("filasDeFleetcheck", () => {
  const filas = filasDeFleetcheck(leerFleetcheck(INFORME), "2026-11-16");

  it("una fila por rueda", () => {
    expect(filas).toHaveLength(14);
  });

  it("guarda la MENOR de las lecturas y apunta las dos", () => {
    const f = filas.find((x) => x.matricula === "7453KCC" && x.codigo_posicion === "E1_IZQ")!;
    expect(f.profundidad_mm).toBe(5);
    expect(f.observaciones).toBe("Lecturas: 5,0 / 9,1 mm");
  });

  it("la presión es la de después si la hay; si no, la de antes", () => {
    const de = filas.find((x) => x.matricula === "5267JRT" && x.codigo_posicion === "E1_DER")!;
    expect(de.presion_bar).toBe(5);
    expect(filas[0].presion_bar).toBe(4.5);
    expect(filas.find((x) => x.matricula === "5267JRT" && x.codigo_posicion === "E2_IZQ_EXT")!.presion_bar).toBeNull();
  });

  it("eje con interiores es doble; sin ellas es sencillo aunque el informe escriba «E»", () => {
    expect(filas.filter((x) => x.matricula === "7453KCC").map((x) => x.codigo_posicion)).toEqual([
      "E1_IZQ", "E1_DER", "E2_IZQ_EXT", "E2_IZQ_INT", "E2_DER_INT", "E2_DER_EXT", "E3_IZQ", "E3_DER",
    ]);
    expect(filas.find((x) => x.codigo_posicion === "E3_IZQ")).toMatchObject({ _eje: 3, _lado: "izq", _io: null });
    expect(filas.find((x) => x.codigo_posicion === "E2_DER_INT")).toMatchObject({ _io: "int" });
  });

  it("todas llevan la fecha del informe, y ninguna hora inventada", () => {
    expect(new Set(filas.map((x) => x.fecha_revision))).toEqual(new Set(["2026-11-16"]));
    expect(filas.every((x) => !("_medidoAt" in x))).toBe(true);
  });
});

describe("medidaDeNeumatico", () => {
  it("saca la medida del texto del neumático", () => {
    expect(medidaDeNeumatico("Hankook 295/80 R22.5 Smart Flex AH51 3PMSF 154M")).toBe("295/80 R22.5");
    expect(medidaDeNeumatico("Hankook 225/75 R16 Vantra LT RA18 121R")).toBe("225/75 R16");
    expect(medidaDeNeumatico("Recacor Bus")).toBeNull();
  });
});

describe("partesDeNeumatico", () => {
  it("trocea marca, medida, modelo e índices, y quita el 3PMSF del modelo", () => {
    expect(partesDeNeumatico("Hankook 295/80 R22.5 Smart Flex AH51 3PMSF 154M")).toEqual({
      marca: "Hankook", modelo: "Smart Flex AH51", medida: "295/80 R22.5", carga: "154", cargaDoble: null, velocidad: "M",
    });
    expect(partesDeNeumatico("Michelin 205/75 R16 Agilis Cross Climate 3PMSF 113R"))
      .toMatchObject({ marca: "Michelin", modelo: "Agilis Cross Climate", medida: "205/75 R16", carga: "113", velocidad: "R" });
  });

  it("un modelo que parece un índice no se confunde con el índice", () => {
    expect(partesDeNeumatico("Yokohama 295/80 R22.5 124R 3PMSF 154M"))
      .toMatchObject({ modelo: "124R", carga: "154", velocidad: "M" });
  });

  it("índice doble", () => {
    expect(partesDeNeumatico("Marca 315/80 R22.5 Modelo 156/150L"))
      .toMatchObject({ modelo: "Modelo", carga: "156", cargaDoble: "150", velocidad: "L" });
  });

  it("sin índice de carga lo deja a null, no lo inventa", () => {
    expect(partesDeNeumatico("InsaTruck 295/80 R22.5 K25")).toMatchObject({ modelo: "K25", carga: null, velocidad: null });
    expect(partesDeNeumatico("Hankook 265/70 R17.5 Smart Flex AH35 3PMSF")).toMatchObject({ modelo: "Smart Flex AH35", carga: null });
  });

  it("sin medida o sin marca no hay neumático", () => {
    expect(partesDeNeumatico("Recacor Bus")).toBeNull();
    expect(partesDeNeumatico("295/80 R22.5 Bus 154M")).toBeNull();
  });
});

describe("firmaDeEjes", () => {
  it("cuenta las ruedas de cada eje, en orden", () => {
    const v = leerFleetcheck(INFORME).vehiculos;
    expect(firmaDeEjes(v[0].ruedas)).toBe("2x4");
    expect(firmaDeEjes(v[1].ruedas)).toBe("2x4x2");
  });
});
