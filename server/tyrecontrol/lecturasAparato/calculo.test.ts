import { describe, it, expect } from "vitest";
import { deltaEntre, enTandas, mitades, resumen, tramos, type Foto } from "./calculo.ts";

const DIA = 24 * 3_600_000;
const t0 = Date.parse("2026-11-25T03:00:00Z");

const foto = (dias: number, v: Partial<Foto> = {}): Foto => ({
  fecha: new Date(t0 + dias * DIA).toISOString().slice(0, 10),
  leidoEnMs: t0 + dias * DIA,
  horasMotor: null,
  consumidoL: null,
  odometroKm: null,
  ...v,
});

describe("deltaEntre — un día normal", () => {
  const d = deltaEntre(
    foto(0, { horasMotor: 2230, consumidoL: 19100, odometroKm: 78500 }),
    foto(1, { horasMotor: 2238, consumidoL: 19267, odometroKm: 79180 }),
  );

  it("resta cada contador", () => {
    expect(d.horasMotor).toBe(8);
    expect(d.litros).toBe(167);
    expect(d.km).toBe(680);
  });

  it("calcula el consumo del tramo", () => {
    expect(d.l100).toBe(24.6);
  });

  it("sin avisos", () => {
    expect(d.aviso).toBeNull();
    expect(d.horasTranscurridas).toBe(24);
  });
});

describe("lo que no se puede asegurar NO se guarda como cero", () => {
  it("un contador que baja es un equipo cambiado, no un consumo negativo", () => {
    const d = deltaEntre(
      foto(0, { consumidoL: 19100, odometroKm: 78500 }),
      foto(1, { consumidoL: 12, odometroKm: 3 }),
    );
    expect(d.litros).toBeNull();
    expect(d.km).toBeNull();
    expect(d.aviso).toMatch(/ha bajado/);
  });

  it("un motor no anda 30 horas en un día", () => {
    const d = deltaEntre(foto(0, { horasMotor: 2230 }), foto(1, { horasMotor: 2260 }));
    expect(d.horasMotor).toBeNull();
    expect(d.aviso).toMatch(/imposible/);
  });

  it("pero si el hueco es de tres días, 30 horas de motor son normales", () => {
    // El tope va con el tiempo transcurrido, no con «un día»: si el servidor
    // estuvo caído, el tramo cubre más y el tope sube con él.
    const d = deltaEntre(foto(0, { horasMotor: 2230 }), foto(3, { horasMotor: 2260 }));
    expect(d.horasMotor).toBe(30);
    expect(d.aviso).toBeNull();
  });

  it("1.400 km en un día no son creíbles", () => {
    const d = deltaEntre(foto(0, { odometroKm: 78500 }), foto(1, { odometroKm: 83000 }));
    expect(d.km).toBeNull();
    expect(d.aviso).toMatch(/imposible/);
  });

  it("600 litros con ocho horas de motor tampoco", () => {
    const d = deltaEntre(
      foto(0, { horasMotor: 2230, consumidoL: 19100 }),
      foto(1, { horasMotor: 2238, consumidoL: 20500 }),
    );
    expect(d.litros).toBeNull();
    expect(d.aviso).toMatch(/litros/);
  });

  it("un tramo con pocos kilómetros no da l/100 km", () => {
    const d = deltaEntre(
      foto(0, { consumidoL: 19100, odometroKm: 78500 }),
      foto(1, { consumidoL: 19110, odometroKm: 78510 }),
    );
    expect(d.litros).toBe(10);
    expect(d.l100).toBeNull();
  });

  it("un contador que no viene no es un fallo: simplemente no hay dato", () => {
    const d = deltaEntre(foto(0, { odometroKm: 78500 }), foto(1, { odometroKm: 78900 }));
    expect(d.km).toBe(400);
    expect(d.litros).toBeNull();
    expect(d.aviso).toBeNull();
  });
});

describe("tramos y resumen", () => {
  const fotos = [
    foto(0, { horasMotor: 2230, consumidoL: 19100, odometroKm: 78500 }),
    foto(1, { horasMotor: 2238, consumidoL: 19267, odometroKm: 79180 }),
    foto(2, { horasMotor: 2245, consumidoL: 19400, odometroKm: 79700 }),
  ];

  it("ordena por fecha aunque lleguen al revés", () => {
    const t = tramos([fotos[2], fotos[0], fotos[1]]);
    expect(t.map((x) => x.km)).toEqual([680, 520]);
  });

  it("suma el periodo", () => {
    const r = resumen(tramos(fotos));
    expect(r.tramos).toBe(2);
    expect(r.km).toBe(1200);
    expect(r.litros).toBe(300);
    expect(r.horasMotor).toBe(15);
    expect(r.l100).toBe(25);
    expect(r.conAviso).toBe(0);
  });

  it("una suma incompleta lo dice, en vez de pasar por completa", () => {
    const rotas = [...fotos, foto(3, { horasMotor: 2245, consumidoL: 10, odometroKm: 80100 })];
    const r = resumen(tramos(rotas));
    expect(r.conAviso).toBe(1);
    expect(r.km).toBe(1600); // los km de ese tramo sí valen
    expect(r.litros).toBe(300); // los litros de ese tramo, no
  });

  it("sin tramos no se inventa un cero", () => {
    const r = resumen([]);
    expect(r.litros).toBeNull();
    expect(r.km).toBeNull();
    expect(r.tramos).toBe(0);
  });
});

describe("tandas", () => {
  it("parte la flota en trozos del tamaño pedido", () => {
    expect(enTandas([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("un tamaño absurdo no cuelga el bucle", () => {
    expect(enTandas([1, 2, 3], 0)).toEqual([[1], [2], [3]]);
  });

  it("una tanda que falla se parte por la mitad", () => {
    expect(mitades([1, 2, 3, 4, 5])).toEqual([[1, 2, 3], [4, 5]]);
  });

  it("una tanda de uno ya no se parte más: ese es el que falla", () => {
    expect(mitades([7])).toBeNull();
  });
});
