/**
 * Lector mínimo de ficheros .osm.pbf (el formato de los extractos de
 * OpenStreetMap de Geofabrik), solo lo que hace falta para el mapa de
 * carreteras: nodos (posición) y vías (etiquetas y nodos que la forman).
 *
 * ── Por qué uno propio ──────────────────────────────────────────────────────
 *
 * Las librerías de npm para PBF o cargan el fichero entero en memoria (un
 * extracto de Cataluña son ~250 MB comprimidos y millones de objetos) o están
 * abandonadas. El formato es pequeño y estable: bloques de protobuf
 * comprimidos con zlib. Leerlo a mano son estas líneas y deja controlar la
 * memoria, que en el servidor es lo que manda.
 *
 * ── El formato, en dos líneas ───────────────────────────────────────────────
 *
 * Fichero = [4 bytes longitud][BlobHeader][Blob] repetido. Cada Blob de tipo
 * «OSMData» es un PrimitiveBlock comprimido: tabla de cadenas + grupos de
 * nodos (casi siempre «dense», en deltas) y vías (con sus nodos en deltas).
 * https://wiki.openstreetmap.org/wiki/PBF_Format
 */

import { inflateSync } from "node:zlib";

// ── Protobuf: lo justo ──────────────────────────────────────────────────────

/** Un lector de protobuf sobre un trozo de buffer. Números de hasta 2^53 (los ids de OSM caben). */
export class Proto {
  pos: number;
  constructor(readonly buf: Uint8Array, inicio = 0, readonly fin = buf.length) { this.pos = inicio; }

  get quedan(): boolean { return this.pos < this.fin; }

  varint(): number {
    let n = 0, mult = 1, b: number;
    do {
      b = this.buf[this.pos++];
      n += (b & 0x7f) * mult;
      mult *= 128;
    } while (b & 0x80);
    return n;
  }

  /** sint (zigzag). */
  svarint(): number {
    const n = this.varint();
    return n % 2 === 0 ? n / 2 : -(n + 1) / 2;
  }

  /** Lee la cabecera de un campo: [número, tipo]. */
  campo(): [number, number] {
    const k = this.varint();
    return [Math.floor(k / 8), k % 8];
  }

  /** Un campo de longitud delimitada: devuelve [inicio, fin] en el buffer. */
  trozo(): [number, number] {
    const len = this.varint();
    const a = this.pos;
    this.pos += len;
    return [a, a + len];
  }

  saltar(tipo: number): void {
    if (tipo === 0) this.varint();
    else if (tipo === 1) this.pos += 8;
    else if (tipo === 2) this.pos += this.varint();
    else if (tipo === 5) this.pos += 4;
    else throw new Error(`Tipo de campo protobuf desconocido: ${tipo}`);
  }

  /** Lista empaquetada de varints entre [a, b). */
  static varints(buf: Uint8Array, a: number, b: number, zigzag: boolean): number[] {
    const p = new Proto(buf, a, b);
    const out: number[] = [];
    while (p.quedan) out.push(zigzag ? p.svarint() : p.varint());
    return out;
  }
}

const texto = new TextDecoder();

// ── Bloques del fichero ─────────────────────────────────────────────────────

/** Los 4 primeros bytes de cada bloque: cuánto ocupa la BlobHeader (big-endian). */
export function longitudCabecera(cab: Uint8Array): number {
  return ((cab[0] << 24) | (cab[1] << 16) | (cab[2] << 8) | cab[3]) >>> 0;
}

/** De una BlobHeader: el tipo y cuánto ocupa el Blob que la sigue. */
export function leerCabecera(buf: Uint8Array): { tipo: string; tamano: number } {
  const p = new Proto(buf);
  let tipo = "", tamano = 0;
  while (p.quedan) {
    const [n, t] = p.campo();
    if (n === 1 && t === 2) { const [a, b] = p.trozo(); tipo = texto.decode(buf.subarray(a, b)); }
    else if (n === 3 && t === 0) tamano = p.varint();
    else p.saltar(t);
  }
  return { tipo, tamano };
}

/** Un Blob → los bytes del bloque, descomprimidos. */
export function abrirBlob(buf: Uint8Array): Uint8Array {
  const p = new Proto(buf);
  while (p.quedan) {
    const [n, t] = p.campo();
    if (n === 1 && t === 2) { const [a, b] = p.trozo(); return buf.subarray(a, b); }          // raw
    if (n === 3 && t === 2) { const [a, b] = p.trozo(); return inflateSync(buf.subarray(a, b)); } // zlib
    p.saltar(t);
  }
  throw new Error("Bloque PBF sin datos legibles (solo se leen sin comprimir y zlib)");
}

// ── PrimitiveBlock ──────────────────────────────────────────────────────────

export interface ViaPbf { id: number; tags: Record<string, string>; refs: number[] }

/**
 * Recorre un PrimitiveBlock llamando a `alNodo(id, lat, lon)` por cada nodo y
 * `alaVia(via)` por cada vía. Las vías solo se decodifican enteras si
 * `quiereVia` dice que sí a sus etiquetas: así la pasada de nodos no gasta en
 * vías y la de vías descarta pronto las que no son carreteras.
 */
export function recorrerBloque(
  datos: Uint8Array,
  op: {
    alNodo?: (id: number, lat: number, lon: number) => void;
    alaVia?: (v: ViaPbf) => void;
    quiereVia?: (tags: Record<string, string>) => boolean;
  },
): void {
  let cadenas: string[] = [];
  let granularidad = 100, latOff = 0, lonOff = 0;
  const grupos: [number, number][] = [];
  const p = new Proto(datos);
  while (p.quedan) {
    const [n, t] = p.campo();
    if (n === 1 && t === 2) {
      const [a, b] = p.trozo();
      const st = new Proto(datos, a, b);
      cadenas = [];
      while (st.quedan) {
        const [m, u] = st.campo();
        if (m === 1 && u === 2) { const [x, y] = st.trozo(); cadenas.push(texto.decode(datos.subarray(x, y))); }
        else st.saltar(u);
      }
    } else if (n === 2 && t === 2) grupos.push(p.trozo());
    else if (n === 17 && t === 0) granularidad = p.varint();
    // lat_offset / lon_offset: int64 sin zigzag (Geofabrik usa 0).
    else if (n === 19 && t === 0) latOff = p.varint();
    else if (n === 20 && t === 0) lonOff = p.varint();
    else p.saltar(t);
  }
  const grado = (offset: number, v: number) => 1e-9 * (offset + granularidad * v);

  for (const [ga, gb] of grupos) {
    const g = new Proto(datos, ga, gb);
    while (g.quedan) {
      const [n, t] = g.campo();
      if (n === 2 && t === 2 && op.alNodo) {
        // DenseNodes: ids, lats y lons en deltas.
        const [a, b] = g.trozo();
        const d = new Proto(datos, a, b);
        let ids: number[] = [], lats: number[] = [], lons: number[] = [];
        while (d.quedan) {
          const [m, u] = d.campo();
          if (m === 1 && u === 2) { const [x, y] = d.trozo(); ids = Proto.varints(datos, x, y, true); }
          else if (m === 8 && u === 2) { const [x, y] = d.trozo(); lats = Proto.varints(datos, x, y, true); }
          else if (m === 9 && u === 2) { const [x, y] = d.trozo(); lons = Proto.varints(datos, x, y, true); }
          else d.saltar(u);
        }
        let id = 0, lat = 0, lon = 0;
        for (let i = 0; i < ids.length; i++) {
          id += ids[i]; lat += lats[i]; lon += lons[i];
          op.alNodo(id, grado(latOff, lat), grado(lonOff, lon));
        }
      } else if (n === 1 && t === 2 && op.alNodo) {
        // Nodo suelto (raro en los extractos, pero existe en el formato).
        const [a, b] = g.trozo();
        const d = new Proto(datos, a, b);
        let id = 0, lat = 0, lon = 0;
        while (d.quedan) {
          const [m, u] = d.campo();
          if (m === 1 && u === 0) id = d.svarint();
          else if (m === 8 && u === 0) lat = d.svarint();
          else if (m === 9 && u === 0) lon = d.svarint();
          else d.saltar(u);
        }
        op.alNodo(id, grado(latOff, lat), grado(lonOff, lon));
      } else if (n === 3 && t === 2 && op.alaVia) {
        const [a, b] = g.trozo();
        const d = new Proto(datos, a, b);
        let id = 0, keys: number[] = [], vals: number[] = [], refsAB: [number, number] | null = null;
        while (d.quedan) {
          const [m, u] = d.campo();
          if (m === 1 && u === 0) id = d.varint();
          else if (m === 2 && u === 2) { const [x, y] = d.trozo(); keys = Proto.varints(datos, x, y, false); }
          else if (m === 3 && u === 2) { const [x, y] = d.trozo(); vals = Proto.varints(datos, x, y, false); }
          else if (m === 8 && u === 2) refsAB = d.trozo();
          else d.saltar(u);
        }
        const tags: Record<string, string> = {};
        for (let i = 0; i < keys.length; i++) tags[cadenas[keys[i]]] = cadenas[vals[i]];
        if (op.quiereVia && !op.quiereVia(tags)) continue;
        const deltas = refsAB ? Proto.varints(datos, refsAB[0], refsAB[1], true) : [];
        const refs: number[] = new Array(deltas.length);
        let r = 0;
        for (let i = 0; i < deltas.length; i++) { r += deltas[i]; refs[i] = r; }
        op.alaVia({ id, tags, refs });
      } else g.saltar(t);
    }
  }
}

// ── El fichero, bloque a bloque ─────────────────────────────────────────────

/**
 * Los bloques de datos de un .osm.pbf en disco, de uno en uno: nunca hay más
 * de un bloque en memoria (cada uno, como mucho 32 MB descomprimido). Entre
 * bloques se cede el turno al resto del servidor: leer Cataluña lleva minutos
 * y la web no puede quedarse parada mientras.
 */
export async function* bloquesDeFichero(ruta: string): AsyncGenerator<Uint8Array> {
  const { open } = await import("node:fs/promises");
  const f = await open(ruta, "r");
  try {
    let pos = 0;
    const cab4 = Buffer.alloc(4);
    for (;;) {
      const { bytesRead } = await f.read(cab4, 0, 4, pos);
      if (bytesRead < 4) break;
      const lenCab = longitudCabecera(cab4);
      const cab = Buffer.alloc(lenCab);
      await f.read(cab, 0, lenCab, pos + 4);
      const { tipo, tamano } = leerCabecera(cab);
      const blob = Buffer.alloc(tamano);
      await f.read(blob, 0, tamano, pos + 4 + lenCab);
      pos += 4 + lenCab + tamano;
      if (tipo === "OSMData") yield abrirBlob(blob);
      await new Promise((r) => setImmediate(r));
    }
  } finally {
    await f.close();
  }
}
