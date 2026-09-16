import { describe, expect, it } from "vitest";
import { almacenEnProsa, asuntoLimpio, detectarTipo, esConcepto, filaDeTabla, localidadDe, parsearCorreo, pedidosEnProsa, remitenteReenviado, usuarioEnProsa } from "./index.ts";

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


/* ───────────────────────────────────────────────────────────────────────────
 * El correo REAL de Soledad, copiado tal cual de un reenvío del 15/09/2026.
 * No lleva ni una etiqueta: el albarán está en el asunto, el pedido en una
 * frase y el contenido en una tabla. Si este test se rompe, es que Soledad ha
 * cambiado la plantilla: hay que traer el correo nuevo, no adaptar el test.
 * ─────────────────────────────────────────────────────────────────────────── */

const ASUNTO_REAL = "Fwd: Emisión de Albarán B /2028450459 con fecha 15/09/2026.";

const ALBARAN_REAL = `---------- Forwarded message ---------
From: noreply@gruposoledad.net
Date: Tue, 15 Sep 2026 15:08:05 +0000
Subject: Emisión de Albarán B /2028450459 con fecha 15/09/2026.
To: jordi.cruset@gruposoledad.net

Información Entrega de Pedido

Estimado COMERCIAL SEA, S.A.,
tu pedido 5687439 ha sido emitido por nuestro centro logístico y la
entrega se realizará a través de TRANSAHER.

Para ver el estado del envío accede al siguiente link:
PULSA ESTE ENLACE PARA ACCEDER INFORMACION SEGUIMIENTO
<http://www.transaher.es/index.php/seguimiento-de-envios>

Escribe el número de pedido entero T0100007878018 en el apartado
¿Dónde está tu envío? y te mostraremos el número de expedición del pedido.

Si tienes alguna duda puedes llamarnos al
965112533 o escribirnos a
http://www.transaher.es/index.php/seguimiento-de-envios  y pregunta por el
número de expedición facilitado.

El pedido será entregado a:
COMERCIAL SEA, S.A.
PI RIU CLAR C/COURE 27,
43006 TARRAGONA
TARRAGONA ESPAÑA

El contenido del pedido es:

Cantidad
Descripción
Importe
2.00 245/70X17.5 HANKOOK AH35 136M 248.45
-2.00 10 EUR DTO UD HANKOOK 10.00
2.00 S.I.Gestión de NFU Cat.D1T 6.05
Pulsar enlace para ver albarán adjunto.
<https://ws.gruposoledad.com/b2b?serviceName=descargarAlbaran&message=execute&r=L1VOSURBREVT&p=VVNVQVJJTz1hZG1pbmlzdHJhZG9y&e=MQ==>

Si tienes alguna duda, por favor NO respondas a esta dirección de e-mail.
Puedes contactar con nosotros utilizando nuestro servicio de chat entre las
9:00 -20:00 horas, nuestro
e-mail b2b@gruposoledad.com o nuestro teléfono 911 910 910.

Un saludo,

Grupo Soledad
`;

describe("parsearCorreo · el albarán real de Soledad", () => {
  const r = parsearCorreo(ASUNTO_REAL, ALBARAN_REAL);

  it("lo reconoce como albarán aunque venga reenviado", () => {
    expect(r.tipo).toBe("ALBARAN");
  });

  it("saca el albarán del asunto y el pedido de la frase", () => {
    expect(r.albaran!.numeroAlbaran).toBe("B/2028450459");
    expect(r.albaran!.numeroPedido).toBe("5687439");
  });

  it("no confunde el número de expedición del transportista con el del pedido", () => {
    expect(r.albaran!.numeroPedido).not.toContain("0100007878018");
  });

  it("lee la fecha del asunto y el transportista de la frase", () => {
    expect(r.albaran!.fecha).toBe("2026-09-15");
    expect(r.albaran!.transportista).toBe("TRANSAHER");
  });

  it("lee la tabla: sólo el neumático es mercancía", () => {
    expect(r.albaran!.lineas).toEqual([
      { cantidad: 2, descripcion: "245/70X17.5 HANKOOK AH35 136M", precioCentimos: 24845, referencia: null },
    ]);
  });

  it("guarda el descuento y la gestión de NFU aparte, sin tirarlos", () => {
    expect(r.albaran!.conceptos.map((l) => l.descripcion)).toEqual(["10 EUR DTO UD HANKOOK", "S.I.Gestión de NFU Cat.D1T"]);
  });

  it("se queda con el enlace de descarga del albarán, no con el del transportista", () => {
    expect(r.albaran!.enlacesPdf[0]).toContain("descargarAlbaran");
  });

  it("no tiene nada que avisar", () => {
    expect(r.avisos).toEqual([]);
  });
});

describe("piezas sueltas del correo real", () => {
  it("asuntoLimpio quita los prefijos de reenvío", () => {
    expect(asuntoLimpio("Fwd: RV: Emisión de Albarán B /1234")).toBe("Emisión de Albarán B /1234");
    expect(asuntoLimpio("Emisión de Albarán")).toBe("Emisión de Albarán");
  });

  it("remitenteReenviado encuentra el remitente original", () => {
    expect(remitenteReenviado(ALBARAN_REAL)).toBe("noreply@gruposoledad.net");
    expect(remitenteReenviado("Sin cabeceras de reenvío")).toBeNull();
  });

  it("filaDeTabla sólo acepta filas de verdad", () => {
    expect(filaDeTabla("2.00 245/70X17.5 HANKOOK AH35 136M 248.45")).toEqual({
      cantidad: 2,
      descripcion: "245/70X17.5 HANKOOK AH35 136M",
      precioCentimos: 24845,
      referencia: null,
    });
    expect(filaDeTabla("43006 TARRAGONA")).toBeNull();
    expect(filaDeTabla("9:00 -20:00 horas, nuestro")).toBeNull();
    expect(filaDeTabla("2016/679 y a la Ley Orgánica 3/2018 de")).toBeNull();
    expect(filaDeTabla("Cantidad")).toBeNull();
  });

  it("esConcepto deja pasar la mercancía y para lo que sólo se cobra", () => {
    expect(esConcepto({ cantidad: 2, descripcion: "245/70X17.5 HANKOOK AH35 136M" })).toBe(false);
    expect(esConcepto({ cantidad: -2, descripcion: "10 EUR DTO UD HANKOOK" })).toBe(true);
    expect(esConcepto({ cantidad: 2, descripcion: "S.I.Gestión de NFU Cat.D1T" })).toBe(true);
  });

  it("localidadDe quita el país de la última línea", () => {
    expect(localidadDe("PI RIU CLAR C/COURE 27,\n43006 TARRAGONA\nTARRAGONA ESPAÑA")).toBe("TARRAGONA");
  });
});


/* ───────────────────────────────────────────────────────────────────────────
 * Otros dos albaranes reales del mismo día. Del cuerpo se ha quitado sólo el
 * pie legal, que ocupa media pantalla y no dice nada; lo demás va tal cual.
 * ─────────────────────────────────────────────────────────────────────────── */

const cuerpoReal = (pedidos: string, tabla: string) => `---------- Forwarded message ---------
From: noreply@gruposoledad.net
Date: Tue, 15 Sep 2026 17:13:54 +0000
To: jordi.cruset@gruposoledad.net

Información Entrega de Pedido

Estimado COMERCIAL SEA, S.A.,
${pedidos}
entrega se realizará a través de TRANSAHER.

Escribe el número de pedido entero T0100007879100 en el apartado
¿Dónde está tu envío? y te mostraremos el número de expedición del pedido.

El pedido será entregado a:
COMERCIAL SEA, S.A.
PI RIU CLAR C/COURE 27,
43006 TARRAGONA
TARRAGONA ESPAÑA

El contenido del pedido es:

Cantidad
Descripción
Importe
${tabla}
Pulsar enlace para ver albarán adjunto.
<https://ws.gruposoledad.com/b2b?serviceName=descargarAlbaran&message=execute&r=L1VOSURBREVT&p=VVNVQVJJTz1h&e=MQ==>

Un saludo,

Grupo Soledad
`;

/** Cuatro medidas en el mismo albarán, y los pedidos agrupados entre paréntesis. */
const ALBARAN_VARIAS_LINEAS = cuerpoReal(
  "tus pedidos (5690526,5690526,5690526,5690526) han sido emitidos por nuestro\ncentro logístico y la",
  ["10.00 385/65X22.5 SAILUN STR1+ 164K 261.35",
   "2.00 385/65X22.5 SAILUN SFR1 160K 270.12",
   "8.00 315/80X22.5 SAILUN TRNSP.D156L 251.32",
   "2.00 315/80X22.5 SAILUN SFR1 158L 229.55",
   "22.00 S.I.Gestión de NFU Cat.D2T 12.18"].join("\n")
);

const ALBARAN_UNA_LINEA = cuerpoReal(
  "tu pedido 5562580 ha sido emitido por nuestro centro logístico y la",
  "12.00 275/70X22.5 HANK.AU04+ 152J149 336.69\n12.00 S.I.Gestión de NFU Cat.D2T 12.18"
);

describe("parsearCorreo · más albaranes reales", () => {
  it("lee las cuatro medidas de un albarán agrupado, y sólo ellas", () => {
    const a = parsearCorreo("Fwd: Emisión de Albarán B /2028452141 con fecha 15/09/2026.", ALBARAN_VARIAS_LINEAS).albaran!;
    expect(a.numeroAlbaran).toBe("B/2028452141");
    expect(a.lineas.map((l) => [l.cantidad, l.descripcion, l.precioCentimos])).toEqual([
      [10, "385/65X22.5 SAILUN STR1+ 164K", 26135],
      [2, "385/65X22.5 SAILUN SFR1 160K", 27012],
      [8, "315/80X22.5 SAILUN TRNSP.D156L", 25132],
      [2, "315/80X22.5 SAILUN SFR1 158L", 22955],
    ]);
    expect(a.conceptos.map((l) => l.descripcion)).toEqual(["S.I.Gestión de NFU Cat.D2T"]);
  });

  it("«tus pedidos (5690526,5690526,…)» es UN pedido repetido, no cuatro", () => {
    const a = parsearCorreo("Fwd: Emisión de Albarán B /2028452141 con fecha 15/09/2026.", ALBARAN_VARIAS_LINEAS).albaran!;
    expect(a.numerosPedido).toEqual(["5690526"]);
    expect(a.numeroPedido).toBe("5690526");
  });

  it("una descripción que acaba en números no se come el importe", () => {
    const a = parsearCorreo("Fwd: Emisión de Albarán B /2028452173 con fecha 15/09/2026.", ALBARAN_UNA_LINEA).albaran!;
    expect(a.numeroPedido).toBe("5562580");
    expect(a.lineas).toEqual([{ cantidad: 12, descripcion: "275/70X22.5 HANK.AU04+ 152J149", precioCentimos: 33669, referencia: null }]);
  });
});

describe("pedidosEnProsa", () => {
  it("salta las apariciones de «pedido» que no llevan número", () => {
    // «Información Entrega de Pedido» va ANTES que el número de verdad.
    expect(pedidosEnProsa("Información Entrega de Pedido\n\ntu pedido 5687439 ha sido emitido")).toEqual(["5687439"]);
  });

  it("no confunde el número de seguimiento del transportista con el del pedido", () => {
    expect(pedidosEnProsa("Escribe el número de pedido entero T0100007879100 en el apartado")).toEqual([]);
  });

  it("devuelve varios cuando de verdad son varios", () => {
    expect(pedidosEnProsa("tus pedidos (5690526,5690527) han sido emitidos")).toEqual(["5690526", "5690527"]);
  });
});


/* ───────────────────────────────────────────────────────────────────────────
 * El correo de PEDIDO real, del 16/09/2026. Tampoco lleva etiquetas: el
 * número va en una frase («Tu número de pedido es B -2026-5693921», con la
 * serie separada por un espacio), el usuario en otra y el almacén de origen
 * dentro de la frase que anuncia la expedición — con la errata «logísitico»
 * que trae el proveedor, que se copia tal cual a propósito.
 * ─────────────────────────────────────────────────────────────────────────── */

const ASUNTO_PEDIDO_REAL = "Fwd: Aviso de nuevo Pedido número: B -2026-5693921 con fecha 16/09/2026.";

const PEDIDO_REAL = `---------- Forwarded message ---------
From: noreply@gruposoledad.net
Date: Wed, 16 Sep 2026 14:28:43 +0000
To: jordi.cruset@gruposoledad.net

 Notificación Pedido Recibido

Estimado COMERCIAL SEA, S.A.,
acabamos de registrar con éxito un pedido en nuestro sistema.

Tu número de pedido es B -2026-5693921
Realizado por comercialseatarragona

El pedido será entregado a:
COMERCIAL SEA, S.A.
PIRIU CLAR C/COURE 27
43006 TARRAGONA
TARRAGONA ESPAÑA

El contenido del pedido es:

Cantidad
Descripción
Importe
2.00 385/65X22.5 SAILUN STR1+ 164K 261.35
La mercancía será expedida por nuestro centro logísitico  54 - GETAFE
ALMACEN
La entrega se realizará a través de TRANSAHER

Cuando la mercancía sea emitida por nuestro centro logístico, recibirás
otro correo con la copia del albarán de salida y más información.

Un saludo,

Grupo Soledad
`;

describe("parsearCorreo · el pedido real de Soledad", () => {
  const r = parsearCorreo(ASUNTO_PEDIDO_REAL, PEDIDO_REAL);

  it("lo reconoce como pedido y no tiene nada que avisar", () => {
    expect(r.tipo).toBe("PEDIDO");
    expect(r.avisos).toEqual([]);
  });

  it("pega la serie que el correo separa: «B -2026-5693921» es un número, no dos", () => {
    expect(r.pedido!.numeroPedido).toBe("B-2026-5693921");
  });

  it("lee de la prosa el usuario, el cliente y el almacén de origen", () => {
    expect(r.pedido!.usuario).toBe("comercialseatarragona");
    expect(r.pedido!.cliente).toBe("COMERCIAL SEA, S.A.");
    expect(r.pedido!.almacenOrigen).toBe("54 - GETAFE");
    expect(r.pedido!.transportista).toBe("TRANSAHER");
  });

  it("lee la fecha del asunto, el destino y la línea", () => {
    expect(r.pedido!.fecha).toBe("2026-09-16");
    expect(r.pedido!.destinoLocalidad).toBe("TARRAGONA");
    expect(r.pedido!.lineas).toEqual([
      { cantidad: 2, descripcion: "385/65X22.5 SAILUN STR1+ 164K", precioCentimos: 26135, referencia: null },
    ]);
  });

  it("su número casa con el que dirá el albarán: los dos normalizan igual", async () => {
    const { normalizarNumero } = await import("../numero.ts");
    expect(normalizarNumero(r.pedido!.numeroPedido)).toBe("5693921");
    expect(normalizarNumero("5693921")).toBe("5693921");
  });
});

describe("las frases del pedido, sueltas", () => {
  it("pedidosEnProsa salta el relleno pero no se traga otras palabras", () => {
    expect(pedidosEnProsa("Tu número de pedido es B -2026-5693921")).toEqual(["B-2026-5693921"]);
    expect(pedidosEnProsa("Pedido número: B -2026-5693921")).toEqual(["B-2026-5693921"]);
    expect(pedidosEnProsa("tu pedido 5687439 ha sido emitido")).toEqual(["5687439"]);
    // «entero» no es relleno: sigue sin colarse el número del transportista.
    expect(pedidosEnProsa("Escribe el número de pedido entero T0100007879100")).toEqual([]);
  });

  it("usuarioEnProsa y almacenEnProsa leen sus frases, con errata incluida", () => {
    expect(usuarioEnProsa("Realizado por comercialseatarragona")).toBe("comercialseatarragona");
    expect(usuarioEnProsa("Sin esa frase")).toBeNull();
    expect(almacenEnProsa("expedida por nuestro centro logísitico  54 - GETAFE")).toBe("54 - GETAFE");
    expect(almacenEnProsa("expedida por nuestro centro logístico 227 - MANRESA")).toBe("227 - MANRESA");
    // Con la etiqueta y el valor debajo no hay nada en la misma línea: manda la etiqueta.
    expect(almacenEnProsa("Centro logístico:\n227 - ALMACEN MANRESA")).toBeNull();
  });
});
