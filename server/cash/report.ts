/**
 * Informe de cierre de jornada en PDF.
 *
 * Un solo fichero con todo el papeleo del día: el cierre, el arqueo, el
 * listado de operaciones y **los justificantes escaneados detrás**. Es lo que
 * se archiva y lo que se le enseña a quien pregunte, sin tener que juntar a
 * mano un PDF del sistema con una carpeta de escaneos.
 *
 * Dos herramientas, cada una en lo suyo:
 *
 * · **pdfkit** para la portada y los listados. Es lo que ya usa el proyecto en
 *   los partes de taller, con la misma cabecera de marca.
 * · **pdf-lib** para el montaje final, porque pdfkit sabe dibujar pero no sabe
 *   incrustar las páginas de otro PDF, y los justificantes vienen del escáner
 *   en PDF. Es la única forma de que la factura entre entera en el informe en
 *   vez de quedarse en un enlace que mañana no abre nadie.
 *
 * Un documento ilegible o que ya no está en el almacenamiento **no rompe el
 * informe**: sale una página diciendo que ese justificante no se ha podido
 * incrustar, con su número de operación. Un cierre sin informe por una factura
 * corrupta sería peor que un informe con un hueco señalado.
 */

import PDFDocument from "pdfkit";
import { PDFDocument as PDFLib } from "pdf-lib";
import pool from "../db.ts";
import { formatearEuros } from "./domain/money.ts";
import type { LineaDenominacion } from "./domain/inventory.ts";
import { ErrorCaja, cargarDenominaciones } from "./repository.ts";
import { detalleJornada } from "./service.ts";
import { conteoPorOperacion, documentosDeJornada } from "./documents.ts";
import { pendientes } from "./treasury.ts";
import { leerDocumento } from "./storage.ts";

const M = 40;
const GRIS = "#64748b";
const TINTA = "#0f172a";

const ETIQUETA_TIPO: Record<string, string> = {
  COLLECTION: "Cobro",
  PAYMENT: "Pago",
  MANUAL_IN: "Entrada",
  MANUAL_OUT: "Salida",
  CASH_DELIVERY: "Entrega",
  BANK_DEPOSIT: "Ingreso banco",
  ADJUSTMENT: "Ajuste",
  OPENING_FLOAT: "Fondo inicial",
  CLOSING_FLOAT: "Cambio final",
};

const eur = (c: number) => `${formatearEuros(c)} €`;

/**
 * Composición de un motivo del libro mayor, para poder imprimir el cambio
 * final y el ingreso bancario pieza a pieza y no solo su importe.
 */
async function composicionPorMotivo(
  sessionId: number,
  motivo: string
): Promise<Composicion> {
  // Consulta propia y no `movimientosDeSesion` porque aquí hacen falta las
  // columnas `cartuchos` y `bolsas`: es lo que distingue un envase precintado
  // de las monedas sueltas del mismo valor, y sin eso el ingreso saldría
  // descuadrado en el papel aunque el dinero estuviera bien.
  const { rows } = await pool.query(
    `SELECT valor_unitario_centimos AS valor, cantidad, cartuchos, bolsas
       FROM cash_denomination_movements
      WHERE session_id = $1 AND motivo = $2 AND direccion = 'OUT'
      ORDER BY valor_unitario_centimos DESC`,
    [sessionId, motivo]
  );

  const sueltas = new Map<number, number>();
  const tubos = new Map<number, number>();
  const sacos = new Map<number, number>();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  for (const m of rows as any[]) {
    if (m.bolsas > 0) sacos.set(m.valor, (sacos.get(m.valor) ?? 0) + m.bolsas);
    else if (m.cartuchos > 0) tubos.set(m.valor, (tubos.get(m.valor) ?? 0) + m.cartuchos);
    else sueltas.set(m.valor, (sueltas.get(m.valor) ?? 0) + m.cantidad);
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const aLineas = (m: Map<number, number>) =>
    [...m.entries()]
      .map(([valor, cantidad]) => ({ valor, cantidad }))
      .sort((a, b) => b.valor - a.valor);

  return { sueltas: aLineas(sueltas), tubos: aLineas(tubos), sacos: aLineas(sacos) };
}

/** Composición de un montón de dinero, separada por formato. */
type Composicion = {
  sueltas: LineaDenominacion[];
  tubos: LineaDenominacion[];
  sacos: LineaDenominacion[];
};

/** Genera el informe entero. Devuelve el PDF listo para descargar. */
export async function informeCierre(empresaId: string, sessionId: number): Promise<Buffer> {
  const detalle = await detalleJornada(sessionId);
  if (detalle.sesion.empresaId !== empresaId) {
    throw new ErrorCaja("JORNADA_DE_OTRA_EMPRESA", "La jornada no pertenece a tu empresa.", 403);
  }

  const [denominaciones, documentos, conteos, fuera, cambioFinal, ingreso, caja] =
    await Promise.all([
      cargarDenominaciones(pool),
      documentosDeJornada(sessionId),
      conteoPorOperacion(sessionId),
      pendientes(empresaId, detalle.sesion.registerId),
      composicionPorMotivo(sessionId, "CLOSING_FLOAT"),
      composicionPorMotivo(sessionId, "BANK_DEPOSIT"),
      pool.query(`SELECT centro, nombre FROM cash_registers WHERE id = $1`, [
        detalle.sesion.registerId,
      ]),
    ]);

  const etiquetaDe = (valor: number) =>
    denominaciones.find((d) => d.valor === valor)?.etiqueta ?? `${valor} c`;
  const piezasDe = (valor: number) =>
    denominaciones.find((d) => d.valor === valor)?.piezasPorCartucho ?? 0;
  const piezasBolsaDe = (valor: number) =>
    denominaciones.find((d) => d.valor === valor)?.piezasPorBolsa ?? 0;

  const portada = await construirPortada({
    detalle,
    caja: caja.rows[0] ?? null,
    fuera,
    cambioFinal,
    ingreso,
    conteos,
    documentos: documentos.length,
    etiquetaDe,
    piezasDe,
    piezasBolsaDe,
  });

  return montar(portada, documentos);
}

// ── Portada y listados ─────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
async function construirPortada(d: {
  detalle: Awaited<ReturnType<typeof detalleJornada>>;
  caja: { centro: string; nombre: string } | null;
  fuera: Awaited<ReturnType<typeof pendientes>>;
  cambioFinal: Composicion;
  ingreso: Composicion;
  conteos: Map<number, number>;
  documentos: number;
  etiquetaDe: (valor: number) => string;
  piezasDe: (valor: number) => number;
  piezasBolsaDe: (valor: number) => number;
}): Promise<Buffer> {
  const { detalle, caja, fuera, conteos } = d;
  const s = detalle.sesion;

  const doc = new PDFDocument({ margin: M, size: "A4" });
  const trozos: Buffer[] = [];
  doc.on("data", (c: Buffer) => trozos.push(c));
  const listo = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(trozos)))
  );

  const ancho = doc.page.width - M * 2;

  // ── Cabecera ──
  doc.rect(0, 0, doc.page.width, 58).fill("#101a33");
  doc
    .fillColor("#ffffff")
    .font("Helvetica-Bold")
    .fontSize(15)
    .text("Cierre de caja", M, 16, { lineBreak: false });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#94a3b8")
    .text(
      `${caja ? `${caja.centro ? `${caja.centro} · ` : ""}${caja.nombre} · ` : ""}${s.fecha}`,
      M,
      36,
      { lineBreak: false }
    );
  doc.fillColor(TINTA).font("Helvetica").fontSize(10);
  doc.y = 78;

  const titulo = (texto: string) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(TINTA).text(texto);
    doc
      .moveTo(M, doc.y + 2)
      .lineTo(M + ancho, doc.y + 2)
      .strokeColor("#cbd5e1")
      .stroke();
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(10);
  };

  const fila = (izq: string, der: string, destacado = false) => {
    const y = doc.y;
    doc
      .font(destacado ? "Helvetica-Bold" : "Helvetica")
      .fillColor(destacado ? TINTA : GRIS)
      .text(izq, M, y, { width: ancho * 0.62, lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fillColor(TINTA)
      .text(der, M + ancho * 0.62, y, { width: ancho * 0.38, align: "right", lineBreak: false });
    doc.y = y + 14;
  };

  // ── Resumen del día ──
  titulo("Resumen de la jornada");
  fila("Fondo inicial", eur(s.fondoInicialCentimos));
  fila("Cobros", eur(detalle.cobros.totalCentimos));
  fila("Pagos", eur(detalle.pagos.totalCentimos));
  fila("Salidas y entregas", eur(detalle.salidasCentimos + detalle.entregasCentimos));
  /*
   * `.length`, no el objeto. `detalleJornada` devuelve la LISTA de operaciones
   * y pisa el contador que traía el resumen, así que esto imprimía
   * «[object Object],[object Object]…» en el papel del cierre.
   */
  fila("Operaciones registradas", String(detalle.operaciones.length));
  // Sin justificantes no se dice nada: un «0» en el informe solo hace pensar
  // que falta algo que buscar.
  if (d.documentos > 0) fila("Justificantes adjuntos", String(d.documentos));

  if (detalle.porFormaPago.length > 0) {
    titulo("Por forma de pago");
    for (const f of detalle.porFormaPago) fila(f.forma, eur(f.importeCentimos));
  }

  /*
   * Reparto por sección de negocio: taller y gasolinera comparten cajón, y
   * este es el desglose que dice cuánto ha puesto cada uno. Es informativo —el
   * arqueo es del cajón entero— pero es lo que se mira para liquidar.
   */
  if (detalle.porSeccion.length > 0) {
    titulo("Por sección");
    for (const sec of detalle.porSeccion) {
      fila(
        `${sec.nombre} · ${sec.operaciones} ${sec.operaciones === 1 ? "operación" : "operaciones"}`,
        eur(sec.efectivoNetoCentimos)
      );
    }
  }

  // ── Arqueo y cierre ──
  titulo("Arqueo");
  if (s.contadoCentimos == null) {
    doc.fillColor(GRIS).text("La jornada todavía no se ha cerrado.", { width: ancho });
    doc.moveDown(0.5);
  } else {
    fila("Contado", eur(s.contadoCentimos));
    fila(
      "Diferencia",
      s.diferenciaCentimos === 0 ? "cuadra" : eur(s.diferenciaCentimos ?? 0),
      s.diferenciaCentimos !== 0
    );
    fila(
      "Denominaciones",
      s.denominacionesCuadran === false ? "no coinciden con el teórico" : "coinciden"
    );
  }

  /*
   * El desglose va en tabla —denominación, formato, cantidad, importe— y no
   * como una lista de frases. Es lo que se compara pieza a pieza contra el
   * cajón cuando algo no cuadra, y en columnas se lee de un vistazo; en
   * renglones sueltos hay que ir leyendo cada línea entera.
   */
  const columnasPiezas = [
    { t: "Denominación", x: M, w: ancho * 0.3, derecha: false },
    { t: "Formato", x: M + ancho * 0.3, w: ancho * 0.34, derecha: false },
    { t: "Cantidad", x: M + ancho * 0.64, w: ancho * 0.16, derecha: true },
    { t: "Importe", x: M + ancho * 0.8, w: ancho * 0.2, derecha: true },
  ];

  const filaPiezas = (celdas: string[], negrita = false) => {
    const y = doc.y;
    doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(TINTA);
    celdas.forEach((c, i) => {
      doc.text(c, columnasPiezas[i].x, y, {
        width: columnasPiezas[i].w,
        align: columnasPiezas[i].derecha ? "right" : "left",
        lineBreak: false,
      });
    });
    doc.y = y + 12;
    doc.font("Helvetica").fontSize(10);
  };

  const composicion = (
    etiqueta: string,
    total: number | null,
    piezas: Composicion
  ) => {
    titulo(etiqueta);

    const vacio =
      piezas.sueltas.length === 0 && piezas.tubos.length === 0 && piezas.sacos.length === 0;
    if (vacio) {
      fila("Total", total == null ? "—" : eur(total), true);
      doc.fillColor(GRIS).fontSize(9).text("   sin desglose registrado", M);
      doc.fontSize(10);
      doc.moveDown(0.3);
      return;
    }

    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(GRIS);
    for (const c of columnasPiezas) {
      doc.text(c.t.toUpperCase(), c.x, y, {
        width: c.w,
        align: c.derecha ? "right" : "left",
        lineBreak: false,
      });
    }
    doc.y = y + 12;
    doc.font("Helvetica").fontSize(10).fillColor(TINTA);

    for (const l of piezas.sueltas) {
      filaPiezas([
        d.etiquetaDe(l.valor),
        "suelto",
        String(l.cantidad),
        eur(l.valor * l.cantidad),
      ]);
    }
    for (const t of piezas.tubos) {
      const n = d.piezasDe(t.valor);
      filaPiezas([
        d.etiquetaDe(t.valor),
        `${t.cantidad === 1 ? "cartucho" : "cartuchos"} de ${n}`,
        String(t.cantidad),
        eur(t.valor * t.cantidad * n),
      ]);
    }
    for (const b of piezas.sacos) {
      const n = d.piezasBolsaDe(b.valor);
      filaPiezas([
        d.etiquetaDe(b.valor),
        `${b.cantidad === 1 ? "bolsa" : "bolsas"} de ${n}`,
        String(b.cantidad),
        eur(b.valor * b.cantidad * n),
      ]);
    }

    doc.moveDown(0.2);
    filaPiezas(["Total", "", "", total == null ? "—" : eur(total)], true);
  };

  composicion("Cambio final que se queda en caja", s.cambioFinalCentimos, d.cambioFinal);
  composicion("Ingreso bancario", s.ingresoBancarioCentimos, d.ingreso);

  // ── Lo que está fuera de la caja ──
  if (fuera.pedidos.length > 0 || fuera.entregas.length > 0) {
    titulo("Fuera de la caja al cerrar");
    for (const p of fuera.pedidos) {
      fila(`Cambio en el banco · ${p.numero}`, eur(p.importeCentimos));
    }
    for (const e of fuera.entregas) {
      fila(`${e.persona} · ${e.motivo} · ${e.numero}`, eur(e.importeCentimos));
    }
    fila("Total fuera", eur(fuera.totalFueraCentimos), true);
  }

  /*
   * Hoja aparte: lo que había en el cajón ANTES de repartirlo.
   *
   * Es el contado del arqueo con su desglose, y va en su propia página porque
   * es la que se lleva uno para pasar la cifra a Genes. Metida entre el cambio
   * final y el ingreso —que son justo las dos mitades en las que se parte
   * después— habría que ir buscándola.
   */
  const arqueo = detalle.ultimoArqueo;
  if (arqueo) {
    doc.addPage();
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor(TINTA)
      .text("Efectivo en caja antes del cierre", M, doc.y);
    doc.moveDown(0.2);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(GRIS)
      .text(
        "Lo que había en el cajón al arquear, antes de apartar el cambio de mañana y el ingreso bancario.",
        { width: ancho }
      );
    doc.moveDown(0.6);

    composicion("Recuento del arqueo", arqueo.totalCentimos, {
      sueltas: arqueo.sueltas,
      tubos: arqueo.cartuchos,
      sacos: arqueo.bolsas,
    });

    /*
     * En qué se repartió, para que la hoja se explique sola. Solo si la
     * jornada está cerrada: con el reparto sin hacer saldrían tres ceros y
     * parecería que el cajón se quedó vacío.
     */
    const cambio = s.cambioFinalCentimos;
    const ingreso = s.ingresoBancarioCentimos;
    if (cambio != null || ingreso != null) {
      titulo("De ahí salieron");
      fila("Cambio que se queda en caja", eur(cambio ?? 0));
      fila("Ingreso bancario", eur(ingreso ?? 0));
      fila("Total repartido", eur((cambio ?? 0) + (ingreso ?? 0)), true);
      // Si no cuadra con lo contado se dice, en vez de dejar que el lector
      // haga la resta y se pregunte si el informe está mal.
      const resto = arqueo.totalCentimos - ((cambio ?? 0) + (ingreso ?? 0));
      if (resto !== 0) fila("Sin repartir", eur(resto), true);
    }

    // El listado de operaciones empieza en hoja limpia, no debajo de esto.
    doc.addPage();
  }

  // ── Listado de operaciones ──
  titulo("Operaciones");
  // La sección va en su columna: con taller y gasolinera compartiendo cajón,
  // saber de cuál es cada operación es la mitad de la lectura del listado.
  /*
   * Las anchuras dejan un hueco entre columnas a propósito. Sin él, «IMPORTE»
   * —que va alineado a la derecha— acababa pegado a «JUST.» y se leía
   * «IMPORTEJUST.» en la cabecera.
   */
  const cols = [
    { x: M, w: ancho * 0.21, t: "Número" },
    { x: M + ancho * 0.22, w: ancho * 0.12, t: "Tipo" },
    { x: M + ancho * 0.35, w: ancho * 0.13, t: "Sección" },
    { x: M + ancho * 0.49, w: ancho * 0.23, t: "Concepto" },
    { x: M + ancho * 0.73, w: ancho * 0.15, t: "Importe" },
    { x: M + ancho * 0.91, w: ancho * 0.09, t: "Just." },
  ];

  const cabeceraTabla = () => {
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(GRIS);
    for (const c of cols) {
      doc.text(c.t.toUpperCase(), c.x, y, {
        width: c.w,
        align: c.t === "Importe" ? "right" : "left",
        lineBreak: false,
      });
    }
    doc.y = y + 12;
    doc.font("Helvetica").fontSize(9).fillColor(TINTA);
  };
  cabeceraTabla();

  for (const o of detalle.operaciones as any[]) {
    if (doc.y > doc.page.height - 60) {
      doc.addPage();
      cabeceraTabla();
    }
    const y = doc.y;
    const n = conteos.get(o.id) ?? 0;
    const valores = [
      o.numero,
      ETIQUETA_TIPO[o.tipo] ?? o.tipo,
      String(o.seccionNombre ?? "—").slice(0, 14),
      String(o.concepto || o.partyNombre || "").slice(0, 30),
      eur(o.importeCentimos),
      n > 0 ? String(n) : "—",
    ];
    valores.forEach((v, i) => {
      /*
       * `height` con `ellipsis` recorta de verdad: solo con `lineBreak: false`
       * un concepto largo seguía desbordando su columna y se pisaba con el
       * importe de al lado.
       */
      doc.fillColor(o.estado === "REVERSED" ? GRIS : TINTA).text(v, cols[i].x, y, {
        width: cols[i].w,
        height: 11,
        align: i === 4 ? "right" : "left",
        lineBreak: false,
        ellipsis: true,
      });
    });
    doc.y = y + 12;
  }

  doc.end();
  return listo;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Montaje con los justificantes ──────────────────────────────────────────

async function montar(
  portada: Buffer,
  documentos: Awaited<ReturnType<typeof documentosDeJornada>>
): Promise<Buffer> {
  const final = await PDFLib.load(portada);

  for (const d of documentos) {
    const contenido = await leerDocumento(d.ruta);
    if (!contenido) {
      await paginaDeAviso(final, d, "No se ha podido recuperar este justificante.");
      continue;
    }

    try {
      if (d.mime === "application/pdf") {
        const adjunto = await PDFLib.load(contenido, { ignoreEncryption: true });
        const paginas = await final.copyPages(adjunto, adjunto.getPageIndices());
        for (const p of paginas) final.addPage(p);
      } else {
        const imagen =
          d.mime === "image/png"
            ? await final.embedPng(contenido)
            : await final.embedJpg(contenido);
        // A4 con margen, respetando la proporción de la imagen.
        const pagina = final.addPage([595.28, 841.89]);
        const max = { w: 595.28 - 60, h: 841.89 - 90 };
        const escala = Math.min(max.w / imagen.width, max.h / imagen.height, 1);
        pagina.drawImage(imagen, {
          x: (595.28 - imagen.width * escala) / 2,
          y: (841.89 - imagen.height * escala) / 2 - 10,
          width: imagen.width * escala,
          height: imagen.height * escala,
        });
      }
    } catch (e) {
      console.warn("Mobilink Cash: justificante no incrustable:", d.nombre, e);
      await paginaDeAviso(final, d, "Este justificante no se ha podido incrustar.");
    }
  }

  return Buffer.from(await final.save());
}

async function paginaDeAviso(
  pdf: PDFLib,
  d: { operacionNumero: string; nombre: string },
  mensaje: string
): Promise<void> {
  const pagina = pdf.addPage([595.28, 841.89]);
  pagina.drawText(`Justificante de ${d.operacionNumero}`, { x: 50, y: 780, size: 14 });
  pagina.drawText(d.nombre.slice(0, 70), { x: 50, y: 758, size: 10 });
  pagina.drawText(mensaje, { x: 50, y: 730, size: 10 });
}
