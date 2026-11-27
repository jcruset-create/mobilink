import { describe, expect, it } from "vitest";
import { deflateSync } from "node:zlib";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bloquesDeFichero, recorrerBloque, type ViaPbf } from "./pbf.ts";

// ── Un escritor de protobuf mínimo, solo para fabricar el fichero de prueba ──
const varint = (n: number): number[] => {
  const out: number[] = [];
  do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 0x80; out.push(b); } while (n > 0);
  return out;
};
const zz = (n: number) => (n >= 0 ? n * 2 : -n * 2 - 1);
const clave = (n: number, t: number) => varint(n * 8 + t);
const bytes = (n: number, b: number[] | Uint8Array) => [...clave(n, 2), ...varint(b.length), ...b];
const num = (n: number, v: number) => [...clave(n, 0), ...varint(v)];
const empaquetado = (n: number, vs: number[], zig: boolean) => bytes(n, vs.flatMap((v) => varint(zig ? zz(v) : v)));
const deltas = (vs: number[]) => vs.map((v, i) => v - (i ? vs[i - 1] : 0));
const str = (s: string) => [...new TextEncoder().encode(s)];

function bloque(): number[] {
  const cadenas = ["", "highway", "primary", "ref", "C-14", "footway", "name", "Carrer Major"];
  const tabla = cadenas.flatMap((s) => bytes(1, str(s)));
  // Nodos (granularidad 100 → lat en unidades de 1e-7 grados).
  const ids = [1, 2, 3, 10_000_000_001];
  const lats = [411_500_000, 411_510_000, 411_520_000, 411_530_000];
  const lons = [12_400_000, 12_410_000, 12_420_000, 12_430_000];
  const dense = [...empaquetado(1, deltas(ids), true), ...empaquetado(8, deltas(lats), true), ...empaquetado(9, deltas(lons), true)];
  const via = (id: number, keys: number[], vals: number[], refs: number[]) =>
    bytes(3, [...num(1, id), ...empaquetado(2, keys, false), ...empaquetado(3, vals, false), ...empaquetado(8, deltas(refs), true)]);
  const grupoNodos = bytes(2, bytes(2, dense));
  const grupoVias = bytes(2, [
    ...via(100, [1, 3, 6], [2, 4, 7], [1, 2, 10_000_000_001]),
    ...via(101, [1], [5], [2, 3]),
  ]);
  return [...bytes(1, tabla), ...grupoNodos, ...grupoVias];
}

function ficheroPbf(): string {
  const datos = deflateSync(Buffer.from(bloque()));
  const blob = Buffer.from([...num(2, bloque().length), ...bytes(3, datos)]);
  const cab = Buffer.from([...bytes(1, str("OSMData")), ...num(3, blob.length)]);
  const cabHeader = Buffer.from(bytes(1, str("OSMHeader")).concat(num(3, 0)));
  const largo = (b: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(b.length); return l; };
  const dir = mkdtempSync(join(tmpdir(), "pbf-"));
  const ruta = join(dir, "prueba.osm.pbf");
  writeFileSync(ruta, Buffer.concat([largo(cabHeader), cabHeader, largo(cab), cab, blob]));
  return ruta;
}

describe("lector de .osm.pbf", () => {
  it("lee nodos (ids de más de 32 bits) y vías, con sus etiquetas y nodos", async () => {
    const nodos = new Map<number, [number, number]>();
    const vias: ViaPbf[] = [];
    for await (const b of bloquesDeFichero(ficheroPbf())) {
      recorrerBloque(b, { alNodo: (id, lat, lon) => nodos.set(id, [lat, lon]), alaVia: (v) => vias.push(v) });
    }
    expect(nodos.size).toBe(4);
    expect(nodos.get(10_000_000_001)![0]).toBeCloseTo(41.153, 6);
    expect(nodos.get(1)![1]).toBeCloseTo(1.24, 6);
    expect(vias.map((v) => v.id)).toEqual([100, 101]);
    expect(vias[0].tags).toEqual({ highway: "primary", ref: "C-14", name: "Carrer Major" });
    expect(vias[0].refs).toEqual([1, 2, 10_000_000_001]);
  });

  it("quiereVia descarta antes de decodificar los nodos de la vía", async () => {
    const vias: ViaPbf[] = [];
    for await (const b of bloquesDeFichero(ficheroPbf())) {
      recorrerBloque(b, { alaVia: (v) => vias.push(v), quiereVia: (t) => t.highway === "primary" });
    }
    expect(vias.map((v) => v.id)).toEqual([100]);
  });
});
