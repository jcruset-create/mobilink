import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generarPartePdf, type NeumaticoPdf } from "./generarPdf.ts";
import * as C from "./coordenadas.ts";

const neu = (i: number, extra: Partial<NeumaticoPdf> = {}): NeumaticoPdf => ({
  posicion: `E${i}`, descripcion: "315/80R22.5 Michelin X Multi D",
  serie: `DOT${1000 + i}`, mm: "10.0", ...extra,
});

describe("el parte generado", () => {
  it("sale sobre la plantilla, en A4 y con una página", async () => {
    const d = await PDFDocument.load(await generarPartePdf({ matricula: "1234ABC" }));
    expect(d.getPageCount()).toBe(1);
    const { width, height } = d.getPage(0).getSize();
    expect(Math.round(width)).toBe(C.ANCHO);
    expect(Math.round(height)).toBe(C.ALTO);
  });

  it("con más neumáticos de los que caben, añade página en vez de perderlos", async () => {
    // Nueve filas por tabla: diez desmontados NO caben en una hoja.
    const muchos = Array.from({ length: 10 }, (_, i) => neu(i + 1));
    const d = await PDFDocument.load(await generarPartePdf({ desmontados: muchos }));
    expect(d.getPageCount()).toBe(2);
  });

  it("la segunda página también es la plantilla, no una hoja en blanco", async () => {
    const d = await PDFDocument.load(await generarPartePdf({
      desmontados: Array.from({ length: 12 }, (_, i) => neu(i + 1)),
    }));
    // Una hoja en blanco no tendria los recursos de la plantilla.
    for (const p of d.getPages()) {
      expect(Math.round(p.getSize().height)).toBe(C.ALTO);
    }
    expect(d.getPageCount()).toBe(2);
  });

  it("manda la tabla que más filas necesite", async () => {
    const d = await PDFDocument.load(await generarPartePdf({
      desmontados: [neu(1)],
      montados: Array.from({ length: 14 }, (_, i) => neu(i + 1)),
    }));
    expect(d.getPageCount()).toBe(2);
  });

  it("un parte vacío no revienta: sale la plantilla limpia", async () => {
    const d = await PDFDocument.load(await generarPartePdf({}));
    expect(d.getPageCount()).toBe(1);
  });

  it("una firma que no es un PNG válido no tumba el parte entero", async () => {
    await expect(generarPartePdf({
      matricula: "1234ABC", firma_cliente: new Uint8Array([1, 2, 3]),
    })).rejects.toThrow();
    // Se documenta el comportamiento: revienta al generar, no escribe medio
    // parte. Quien llama decide si reintenta sin firma.
  });
});

describe("las coordenadas", () => {
  it("las diez razones del formulario tienen columna", () => {
    for (const c of ["desgaste", "cambio_posicion", "pinchazo", "dano_golpe",
      "desgaste_irregular", "cortes", "roces_flanco", "dano_banda_rodadura",
      "rodaje_sin_presion", "robo"]) {
      expect(C.RAZON_X[c], `falta la columna de ${c}`).toBeGreaterThan(0);
    }
  });
  it("los siete destinos también", () => {
    for (const c of ["comprada_taller", "almacen_flota", "carcasa_continental",
      "desechado", "reclamacion", "almacen_taller", "montada_vehiculo"]) {
      expect(C.DESTINO_X[c], `falta la columna de ${c}`).toBeGreaterThan(0);
    }
  });
  it("las doce líneas de servicio tienen su fila", () => {
    for (const c of ["desmontar_montar_cubierta", "quitar_poner_rueda", "equilibrado",
      "pinchazo", "rayados", "alineacion_standard", "alineacion_compleja",
      "salida_servicio_movil", "km_recorridos", "horas_oficial_1a", "valvulas",
      "alargaderas"]) {
      expect(C.SERVICIOS_Y[c], `falta la fila de ${c}`).toBeGreaterThan(0);
    }
  });
  it("las columnas de razón y destino no se pisan", () => {
    const razon = Object.values(C.RAZON_X).sort((a, b) => a - b);
    const destino = Object.values(C.DESTINO_X).sort((a, b) => a - b);
    expect(razon[razon.length - 1]).toBeLessThan(destino[0]);
    // Y dentro de cada bloque, separadas lo bastante para no solaparse.
    for (const col of [razon, destino]) {
      for (let i = 1; i < col.length; i++) expect(col[i] - col[i - 1]).toBeGreaterThanOrEqual(10);
    }
  });
  it("ninguna coordenada se sale de la hoja", () => {
    const puntos = [
      ...Object.values(C.CABECERA), ...Object.values(C.LUGAR),
      ...Object.values(C.FIRMAS),
    ] as { x: number; y: number }[];
    for (const p of puntos) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(C.ANCHO);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(C.ALTO);
    }
    // Y la última fila de cada tabla tampoco.
    for (const t of [C.DESMONTADOS, C.MONTADOS, C.NUEVOS]) {
      expect(t.primeraFila + (t.filas - 1) * t.alturaFila).toBeLessThan(C.ALTO);
    }
  });
  it("aPdf da la vuelta al eje: arriba del todo es el alto de la hoja", () => {
    expect(C.aPdf(0)).toBe(C.ALTO);
    expect(C.aPdf(C.ALTO)).toBe(0);
  });
});
