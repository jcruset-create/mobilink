/**
 * Un ZIP mínimo, escrito a mano.
 *
 * Sin compresión (método «store»): lo que va dentro son PDF, que ya vienen
 * comprimidos, y un índice de unas líneas. Con eso el formato se reduce a
 * tres estructuras —cabecera local, directorio central y fin de directorio—
 * y un CRC-32, y no hace falta traer una dependencia para empaquetar diez
 * ficheros. Los nombres van en UTF-8 (bandera 0x0800).
 */

export type EntradaZip = {
  /** Ruta dentro del zip, con `/` como separador. */
  nombre: string;
  contenido: Buffer;
  fecha?: Date;
};

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(datos: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Fecha y hora en el formato de MS-DOS que usa el zip (resolución de 2 s). */
function fechaDos(fecha: Date): { hora: number; dia: number } {
  const anio = Math.max(1980, fecha.getFullYear());
  return {
    hora: (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | (fecha.getSeconds() >> 1),
    dia: ((anio - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate(),
  };
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff);
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
}

export function componerZip(entradas: EntradaZip[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let desplazamiento = 0;

  for (const e of entradas) {
    const nombre = Buffer.from(e.nombre.replace(/\\/g, "/"), "utf8");
    const crc = crc32(e.contenido);
    const { hora, dia } = fechaDos(e.fecha ?? new Date());
    const comun = Buffer.concat([
      u16(0x0800), // bandera: nombres en UTF-8
      u16(0), // método: store
      u16(hora),
      u16(dia),
      u32(crc),
      u32(e.contenido.length),
      u32(e.contenido.length),
      u16(nombre.length),
    ]);

    const local = Buffer.concat([u32(0x04034b50), u16(20), comun, u16(0), nombre, e.contenido]);
    partes.push(local);

    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20), // hecho por
        u16(20), // necesita
        comun,
        u16(0), // extra
        u16(0), // comentario
        u16(0), // disco
        u16(0), // atributos internos
        u32(0), // atributos externos
        u32(desplazamiento),
        nombre,
      ])
    );
    desplazamiento += local.length;
  }

  const directorio = Buffer.concat(central);
  const fin = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entradas.length),
    u16(entradas.length),
    u32(directorio.length),
    u32(desplazamiento),
    u16(0),
  ]);
  return Buffer.concat([...partes, directorio, fin]);
}

/** Los nombres y tamaños que declara el directorio central. Para las pruebas. */
export function indiceZip(zip: Buffer): { nombre: string; tamano: number; crc: number }[] {
  const fin = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fin < 0) throw new Error("No es un zip: falta el fin de directorio.");
  const cuantas = zip.readUInt16LE(fin + 10);
  let pos = zip.readUInt32LE(fin + 16);
  const salida: { nombre: string; tamano: number; crc: number }[] = [];
  for (let i = 0; i < cuantas; i++) {
    if (zip.readUInt32LE(pos) !== 0x02014b50) throw new Error("Directorio central corrupto.");
    const crc = zip.readUInt32LE(pos + 16);
    const tamano = zip.readUInt32LE(pos + 24);
    const largoNombre = zip.readUInt16LE(pos + 28);
    const largoExtra = zip.readUInt16LE(pos + 30);
    const largoComentario = zip.readUInt16LE(pos + 32);
    const nombre = zip.subarray(pos + 46, pos + 46 + largoNombre).toString("utf8");
    salida.push({ nombre, tamano, crc });
    pos += 46 + largoNombre + largoExtra + largoComentario;
  }
  return salida;
}
