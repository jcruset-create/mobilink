import { describe, expect, it } from "vitest";
import { detectarTipo, localidadDe, parsearCorreo } from "./index.ts";

/** El correo de pedido tal y como lo describe el encargo (valor en la línea siguiente). */
const PEDIDO_SOLEDAD = `
Pedido:
B-2026-5688837

Fecha:
15/09/2026

Cliente:
COMERCIAL SEA, S.A.

Usuario que realiza el pedido:
comercialseatarragona

Destino:
COMERCIAL SEA, S.A.
PIRIU CLAR C/COURE 27
43006 TARRAGONA

Contenido:

Cantidad:
2

Producto:
245/70X17.5 HANKOOK AH35 136M

Precio unitario:
248,45 €

Centro logístico:
227 - ALMACEN MANRESA (CATALUÑA)

Transportista:
TRANSAHER
`;

const ALBARAN_SOLEDAD = `
Estimado cliente,

Le informamos de que su pedido ha sido expedido.

Pedido: 5688837
Albarán: 2028450461
Transportista: TRANSAHER

Puede descargar el albarán en:
https://portal.soledad.example/albaranes/2028450461.pdf

Un saludo.
`;

describe("detectarTipo", () => {
  it("por el asunto", () => {
    expect(detectarTipo("Aviso de nuevo Pedido número B-2026-5688837", "")).toBe("PEDIDO");
    expect(detectarTipo("Emisión de Albarán 2028450461", "")).toBe("ALBARAN");
    expect(detectarTipo("Emision de Albaran", "")).toBe("ALBARAN");
  });

  it("por el cuerpo cuando el asunto no dice nada", () => {
    expect(detectarTipo("Sin asunto", ALBARAN_SOLEDAD)).toBe("ALBARAN");
    expect(detectarTipo("Sin asunto", PEDIDO_SOLEDAD)).toBe("PEDIDO");
    expect(detectarTipo("Hola", "¿Qué tal?")).toBe("DESCONOCIDO");
  });
});

describe("parsearCorreo · pedido", () => {
  it("lee el correo real de Soledad con los valores en la línea siguiente", () => {
    const r = parsearCorreo("Aviso de nuevo Pedido número B-2026-5688837", PEDIDO_SOLEDAD);
    expect(r.tipo).toBe("PEDIDO");
    expect(r.avisos).toEqual([]);
    const p = r.pedido!;
    expect(p.numeroPedido).toBe("B-2026-5688837");
    expect(p.fecha).toBe("2026-09-15");
    expect(p.cliente).toBe("COMERCIAL SEA, S.A.");
    expect(p.usuario).toBe("comercialseatarragona");
    expect(p.destino).toBe("COMERCIAL SEA, S.A.\nPIRIU CLAR C/COURE 27\n43006 TARRAGONA");
    expect(p.destinoLocalidad).toBe("TARRAGONA");
    expect(p.almacenOrigen).toBe("227 - ALMACEN MANRESA (CATALUÑA)");
    expect(p.transportista).toBe("TRANSAHER");
    expect(p.lineas).toEqual([
      { cantidad: 2, descripcion: "245/70X17.5 HANKOOK AH35 136M", precioCentimos: 24845, referencia: null },
    ]);
  });

  it("acepta el valor en la misma línea y varias líneas de producto", () => {
    const texto = `Pedido: 5688838
Fecha: 16/09/2026
Destino: 43006 TARRAGONA
Cantidad: 4
Producto: 315/80R22.5 HANKOOK AL10 156/150L
Precio unitario: 310,00 €
Cantidad: 1
Producto: 385/65R22.5 HANKOOK TH22 160K
Precio unitario: 402,10 €
Transportista: TRANSAHER`;
    const r = parsearCorreo("Aviso de nuevo Pedido", texto);
    expect(r.pedido!.lineas).toHaveLength(2);
    expect(r.pedido!.lineas[1]).toMatchObject({ cantidad: 1, descripcion: "385/65R22.5 HANKOOK TH22 160K", precioCentimos: 40210 });
    expect(r.pedido!.destinoLocalidad).toBe("TARRAGONA");
  });

  it("avisa de lo que falta en vez de inventarlo", () => {
    const r = parsearCorreo("Aviso de nuevo Pedido", "Fecha: 15/09/2026\nTransportista: TRANSAHER");
    expect(r.pedido!.numeroPedido).toBeNull();
    expect(r.pedido!.lineas).toEqual([]);
    expect(r.avisos.join(" ")).toMatch(/número de pedido/);
    expect(r.avisos.join(" ")).toMatch(/línea de producto/);
  });
});

describe("parsearCorreo · albarán", () => {
  it("lee el correo de albarán con el enlace al PDF", () => {
    const r = parsearCorreo("Emisión de Albarán", ALBARAN_SOLEDAD);
    expect(r.tipo).toBe("ALBARAN");
    expect(r.avisos).toEqual([]);
    const a = r.albaran!;
    expect(a.numeroPedido).toBe("5688837");
    expect(a.numeroAlbaran).toBe("2028450461");
    expect(a.transportista).toBe("TRANSAHER");
    expect(a.enlacesPdf).toEqual(["https://portal.soledad.example/albaranes/2028450461.pdf"]);
    expect(a.lineas).toEqual([]);
    expect(a.cantidadExpedida).toBeNull();
  });

  it("saca el número de albarán del asunto si el cuerpo no lo trae, y lee la cantidad expedida", () => {
    const r = parsearCorreo("Emisión de Albarán 2028450461", "Pedido: 5688837\nCantidad expedida: 2\nTransportista: TRANSAHER");
    expect(r.albaran!.numeroAlbaran).toBe("2028450461");
    expect(r.albaran!.cantidadExpedida).toBe(2);
    expect(r.avisos).toEqual(["El correo no trae enlace al PDF del albarán."]);
  });

  it("prefiere el enlace que parece un PDF", () => {
    const r = parsearCorreo("Emisión de Albarán 1", "Pedido: 1\nVea http://www.soledad.example/ y descargue https://x.example/doc?id=9 (albarán)");
    expect(r.albaran!.enlacesPdf[0]).toBe("https://x.example/doc?id=9");
  });
});

describe("localidadDe", () => {
  it("quita el código postal y se queda con la localidad", () => {
    expect(localidadDe("COMERCIAL SEA, S.A.\nC/ COURE 27\n43006 TARRAGONA")).toBe("TARRAGONA");
    expect(localidadDe("TARRAGONA")).toBe("TARRAGONA");
    expect(localidadDe("08243 - MANRESA (BARCELONA)")).toBe("MANRESA");
    expect(localidadDe(null)).toBeNull();
  });
});
