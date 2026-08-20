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
import { composicionDeIngreso } from "./bankdeposits.ts";
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

/**
 * Fotos del catálogo, descargadas para incrustar.
 *
 * Las fotos de billetes y monedas viven en Storage como PNG públicos; aquí se
 * bajan una vez por informe y se pintan en la hoja del arqueo, que así queda
 * con la misma pinta que el formulario de Genes donde se van a teclear los
 * números. Cualquier fallo —foto borrada, red caída, URL vieja— deja esa
 * denominación con su etiqueta de texto y el informe sale igual: un PDF sin
 * fotos es útil; un PDF que no se genera, no.
 */
async function imagenesDelCatalogo(
  denominaciones: readonly { valor: number; imagenUrl: string | null }[]
): Promise<Map<number, Buffer>> {
  const imagenes = new Map<number, Buffer>();
  await Promise.all(
    denominaciones
      .filter((d) => d.imagenUrl && /^https?:/.test(d.imagenUrl))
      .map(async (d) => {
        try {
          const r = await fetch(d.imagenUrl!, { signal: AbortSignal.timeout(4000) });
          if (!r.ok) return;
          imagenes.set(d.valor, Buffer.from(await r.arrayBuffer()));
        } catch {
          /* sin foto: la etiqueta manda */
        }
      })
  );
  return imagenes;
}

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

  const imagenes = await imagenesDelCatalogo(denominaciones);

  const portada = await construirPortada({
    detalle,
    caja: caja.rows[0] ?? null,
    fuera,
    cambioFinal,
    ingreso,
    conteos,
    documentos: documentos.length,
    denominaciones,
    imagenes,
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
  denominaciones: import("./domain/denominations.ts").Denominacion[];
  imagenes: Map<number, Buffer>;
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

  /*
   * Título de sección: una banda gris con una pestaña azul marino delante, el
   * mismo azul de la cabecera. La rayita fina de antes se perdía entre las
   * filas de las tablas y el informe parecía un único listado sin cortes.
   */
  const titulo = (texto: string) => {
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(M, y, ancho, 18).fill("#eef2f7");
    doc.rect(M, y, 3, 18).fill("#101a33");
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(TINTA)
      .text(texto.toUpperCase(), M + 10, y + 5, { width: ancho - 20, lineBreak: false });
    doc.y = y + 24;
    doc.font("Helvetica").fontSize(10).fillColor(TINTA);
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
   * El desglose va en tabla, con UNA fila por denominación y una columna por
   * formato: unidades, cartuchos y bolsas de la misma moneda juntos, y el
   * importe de la fila es el total de esa denominación.
   *
   * Antes cada formato era una fila («0,05 € · cartucho de 50 · 1») y la misma
   * moneda aparecía dos o tres veces, en trozos separados de la tabla: para
   * saber cuánto hay de 2 € había que buscarla y sumar de cabeza. Así es como
   * se cuenta un cajón de verdad: moneda a moneda, no formato a formato.
   */
  const columnasPiezas = [
    { t: "Denominación", x: M, w: ancho * 0.24, derecha: false },
    { t: "Unidades", x: M + ancho * 0.24, w: ancho * 0.15, derecha: true },
    { t: "Cartuchos", x: M + ancho * 0.41, w: ancho * 0.15, derecha: true },
    { t: "Bolsas", x: M + ancho * 0.58, w: ancho * 0.15, derecha: true },
    { t: "Importe", x: M + ancho * 0.75, w: ancho * 0.25, derecha: true },
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

    // Los tres formatos, agrupados por denominación.
    const porValor = new Map<number, { sueltas: number; tubos: number; sacos: number }>();
    const de = (valor: number) => {
      if (!porValor.has(valor)) porValor.set(valor, { sueltas: 0, tubos: 0, sacos: 0 });
      return porValor.get(valor)!;
    };
    for (const l of piezas.sueltas) de(l.valor).sueltas += l.cantidad;
    for (const t of piezas.tubos) de(t.valor).tubos += t.cantidad;
    for (const b of piezas.sacos) de(b.valor).sacos += b.cantidad;

    let par = false;
    for (const [valor, f] of [...porValor.entries()].sort((a, b) => b[0] - a[0])) {
      const importe =
        valor * f.sueltas +
        valor * f.tubos * d.piezasDe(valor) +
        valor * f.sacos * d.piezasBolsaDe(valor);
      // Cebra: sin ella, en una tabla de quince filas el ojo se cambia de
      // renglón entre la denominación y su importe.
      if (par) {
        doc.rect(M, doc.y - 1.5, ancho, 12).fill("#f5f7fa");
        doc.fillColor(TINTA);
      }
      par = !par;
      // La celda a cero va en blanco, como en una hoja hecha a mano: el ojo
      // salta directo a lo que hay, sin vadear ceros.
      filaPiezas([
        d.etiquetaDe(valor),
        f.sueltas > 0 ? String(f.sueltas) : "",
        f.tubos > 0 ? String(f.tubos) : "",
        f.sacos > 0 ? String(f.sacos) : "",
        eur(importe),
      ]);
    }

    doc.moveDown(0.2);
    filaPiezas(["Total", "", "", "", total == null ? "—" : eur(total)], true);
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
   * Con la MISMA distribución que el formulario «Nuevo Arqueo» de Genes,
   * porque esta hoja existe para teclear sus números allí: monedas a la
   * izquierda y billetes a la derecha, de menor a mayor, cada una con su foto,
   * su número de piezas y su importe, y el total en grande abajo. Si el papel
   * va en otro orden que la pantalla, el que transcribe salta de fila en fila
   * y ahí es donde se cuela un dedo.
   *
   * El número de piezas es el TOTAL de la denominación —sueltas más lo que hay
   * dentro de cartuchos y bolsas— que es lo que pide Genes («debe contar todo
   * el dinero»). Cuando hay envases, el desglose va debajo en pequeño.
   */
  const arqueo = detalle.ultimoArqueo;
  if (arqueo) {
    doc.addPage();
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor(TINTA)
      .text("Arqueo para Genes", M, doc.y);
    doc.moveDown(0.2);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(GRIS)
      .text(
        "Lo que había en el cajón al arquear, antes de apartar el cambio de mañana y el ingreso bancario. En el mismo orden que el formulario de arqueo de Genes.",
        { width: ancho }
      );
    doc.moveDown(0.8);

    // Piezas totales por denominación: sueltas + envases convertidos.
    const piezasTotales = new Map<number, number>();
    const envasesDe = new Map<number, string[]>();
    const sumar = (valor: number, n: number) =>
      piezasTotales.set(valor, (piezasTotales.get(valor) ?? 0) + n);
    for (const l of arqueo.sueltas) sumar(l.valor, l.cantidad);
    for (const t of arqueo.cartuchos) {
      sumar(t.valor, t.cantidad * d.piezasDe(t.valor));
      const nota = envasesDe.get(t.valor) ?? [];
      nota.push(`${t.cantidad} ${t.cantidad === 1 ? "cartucho" : "cartuchos"} de ${d.piezasDe(t.valor)}`);
      envasesDe.set(t.valor, nota);
    }
    for (const b of arqueo.bolsas) {
      sumar(b.valor, b.cantidad * d.piezasBolsaDe(b.valor));
      const nota = envasesDe.get(b.valor) ?? [];
      nota.push(`${b.cantidad} ${b.cantidad === 1 ? "bolsa" : "bolsas"} de ${d.piezasBolsaDe(b.valor)}`);
      envasesDe.set(b.valor, nota);
    }

    // Todas las denominaciones activas, de MENOR a mayor, como en Genes.
    // También las que están a cero: la hoja calca el formulario fila a fila.
    const activas = d.denominaciones.filter((den) => den.activa);
    const monedas = activas.filter((den) => den.tipo === "MONEDA").sort((a, b) => a.valor - b.valor);
    const billetes = activas.filter((den) => den.tipo === "BILLETE").sort((a, b) => a.valor - b.valor);

    const colAncho = (ancho - 24) / 2;
    const filaGenes = (den: (typeof activas)[number], x: number, y: number): number => {
      const piezas = piezasTotales.get(den.valor) ?? 0;
      const importe = piezas * den.valor;
      const notas = envasesDe.get(den.valor);
      // La fila crece cuando lleva la nota del envase debajo: con altura fija
      // el «incluye 1 bolsa de 100» se montaba encima de la casilla siguiente.
      const alto = notas && piezas > 0 ? 38 : 30;

      // La foto —o la etiqueta, si no la hay— identifica la fila, como en Genes.
      const foto = d.imagenes.get(den.valor);
      if (foto) {
        try {
          doc.image(foto, x, y + 2, { fit: [34, 22] });
        } catch {
          /* PNG corrupto: cae a la etiqueta */
        }
      }
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(TINTA)
        .text(den.etiqueta, x + 40, y + 8, { width: 44, lineBreak: false });

      // La casilla con el número de piezas, como la celda donde se teclea.
      const cx = x + 88;
      doc.roundedRect(cx, y + 2, 44, 20, 3).lineWidth(0.8).strokeColor("#94a3b8").stroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor(piezas > 0 ? TINTA : "#b6c0cc")
        .text(String(piezas), cx, y + 8, { width: 44, align: "center", lineBreak: false });

      doc.font("Helvetica").fontSize(10).fillColor(GRIS).text("=", cx + 50, y + 8, { lineBreak: false });

      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(piezas > 0 ? TINTA : "#b6c0cc")
        .text(eur(importe), cx + 60, y + 8, {
          width: colAncho - (cx - x) - 60,
          align: "right",
          lineBreak: false,
        });

      if (notas && piezas > 0) {
        doc
          .font("Helvetica")
          .fontSize(7)
          .fillColor(GRIS)
          .text(`incluye ${notas.join(" y ")}`, x + 40, y + 25, {
            width: colAncho - 40,
            lineBreak: false,
          });
      }
      return y + alto;
    };

    const cabeceraCol = (texto: string, x: number, y: number) => {
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor(GRIS)
        .text(texto.toUpperCase(), x, y, { lineBreak: false });
      doc
        .moveTo(x, y + 13)
        .lineTo(x + colAncho, y + 13)
        .lineWidth(0.8)
        .strokeColor("#cbd5e1")
        .stroke();
    };

    const yInicio = doc.y;
    cabeceraCol("Monedas", M, yInicio);
    cabeceraCol("Billetes", M + colAncho + 24, yInicio);

    let yMon = yInicio + 20;
    for (const den of monedas) yMon = filaGenes(den, M, yMon);
    let yBil = yInicio + 20;
    for (const den of billetes) yBil = filaGenes(den, M + colAncho + 24, yBil);

    doc.y = Math.max(yMon, yBil) + 10;

    // El total en grande, como el «Total:» del formulario.
    const yTotal = doc.y;
    doc.roundedRect(M + ancho - 240, yTotal, 240, 34, 4).fill("#eef2f7");
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor(GRIS)
      .text("Total:", M + ancho - 228, yTotal + 10, { lineBreak: false });
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor(TINTA)
      .text(eur(arqueo.totalCentimos), M + ancho - 240, yTotal + 9, {
        width: 228,
        align: "right",
        lineBreak: false,
      });
    doc.y = yTotal + 42;
    doc.font("Helvetica").fontSize(10).fillColor(TINTA);

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

// ── Resguardo del ingreso bancario ─────────────────────────────────────────

/**
 * La hoja que va DENTRO de la bolsa, con el dinero.
 *
 * No es un informe de archivo: es el papel que se le da a quien coge el coche
 * y se planta en el banco. Por eso está pensado para leerse de pie y en dos
 * segundos —el importe en grande arriba, el desglose de billetes debajo— y por
 * eso lleva las dos casillas de firma del final: quién se lleva el dinero y
 * qué dijo el banco al recibirlo. Ese hueco entre «salió de la caja» y «está
 * en la cuenta» es donde se pierde el dinero, y hasta ahora no lo cubría nada.
 *
 * El desglose son los billetes del montón. Si el importe que se lleva no
 * coincide con ellos —se puede ingresar solo una parte— se dice en su línea en
 * vez de dejar que los números no cuadren y que quien lo lea se lo imagine.
 */
export async function informeIngreso(empresaId: string, depositId: number): Promise<Buffer> {
  const datos = await composicionDeIngreso(empresaId, depositId);
  if (!datos) {
    throw new ErrorCaja("INGRESO_NO_ENCONTRADO", "El ingreso no existe.", 404);
  }
  const { ingreso, billetes, monedas } = datos;

  const { rows: cajas } = await pool.query(
    `SELECT centro, nombre, codigo FROM cash_registers WHERE id = $1`,
    [ingreso.registerId]
  );
  const caja = cajas[0] ?? { centro: "", nombre: "", codigo: "" };

  const denominaciones = await cargarDenominaciones(pool, false);
  const etiqueta = new Map(denominaciones.map((d) => [d.valor, d.etiqueta]));
  const etiquetaDe = (v: number) => etiqueta.get(v) ?? `${formatearEuros(v)} €`;

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
    .text("Ingreso bancario", M, 16, { lineBreak: false });
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#94a3b8")
    .text(
      `${caja.centro ? `${caja.centro} · ` : ""}${caja.nombre}${
        ingreso.fechaIngreso ? ` · ${ingreso.fechaIngreso}` : ""
      }`,
      M,
      36,
      { lineBreak: false }
    );
  doc.fillColor(TINTA).font("Helvetica").fontSize(10);
  doc.y = 78;

  // Mismo título de banda que el informe de cierre: los dos papeles salen de
  // la misma impresora y se archivan juntos, así que visten igual.
  const titulo = (texto: string) => {
    doc.moveDown(0.6);
    const y = doc.y;
    doc.rect(M, y, ancho, 18).fill("#eef2f7");
    doc.rect(M, y, 3, 18).fill("#101a33");
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor(TINTA)
      .text(texto.toUpperCase(), M + 10, y + 5, { width: ancho - 20, lineBreak: false });
    doc.y = y + 24;
    doc.font("Helvetica").fontSize(10).fillColor(TINTA);
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

  /*
   * El número y el importe, en un recuadro y en grande. Es lo que se dicta por
   * teléfono y lo que se compara contra el extracto: si hay que buscarlo entre
   * el texto, se busca mal.
   */
  const alto = 62;
  doc.roundedRect(M, doc.y, ancho, alto, 6).fillAndStroke("#f1f5f9", "#cbd5e1");
  const yCaja = doc.y;
  doc
    .fillColor(GRIS)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("NÚMERO DE INGRESO", M + 14, yCaja + 12, { lineBreak: false });
  doc
    .fillColor(TINTA)
    .font("Helvetica-Bold")
    .fontSize(18)
    .text(ingreso.numero, M + 14, yCaja + 26, { lineBreak: false });
  doc
    .fillColor(GRIS)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("IMPORTE A INGRESAR", M + ancho / 2, yCaja + 12, {
      width: ancho / 2 - 14,
      align: "right",
      lineBreak: false,
    });
  doc
    .fillColor(TINTA)
    .font("Helvetica-Bold")
    .fontSize(18)
    .text(eur(ingreso.importeCentimos), M + ancho / 2, yCaja + 26, {
      width: ancho / 2 - 14,
      align: "right",
      lineBreak: false,
    });
  doc.y = yCaja + alto + 6;
  doc.font("Helvetica").fontSize(10);

  if (ingreso.estado === "ANULADO") {
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#b91c1c")
      .text("INGRESO ANULADO — este resguardo no vale", M, doc.y, { width: ancho });
    doc.moveDown(0.4);
    if (ingreso.anuladoMotivo) {
      doc.font("Helvetica").fontSize(9).fillColor(GRIS).text(ingreso.anuladoMotivo, { width: ancho });
    }
    doc.fillColor(TINTA).font("Helvetica").fontSize(10);
  }

  // ── Los billetes que van dentro ──
  const totalBilletes = billetes.reduce((a, l) => a + l.valor * l.cantidad, 0);
  const totalMonedas = monedas.reduce((a, l) => a + l.valor * l.cantidad, 0);

  titulo("Billetes que van al banco");
  if (billetes.length === 0) {
    doc.fillColor(GRIS).text("Sin desglose registrado.", M, doc.y, { width: ancho });
    doc.moveDown(0.4);
  } else {
    const cols = [
      { t: "Denominación", x: M, w: ancho * 0.4, derecha: false },
      { t: "Cantidad", x: M + ancho * 0.4, w: ancho * 0.25, derecha: true },
      { t: "Importe", x: M + ancho * 0.65, w: ancho * 0.35, derecha: true },
    ];
    const linea = (celdas: string[], negrita = false) => {
      const y = doc.y;
      doc.font(negrita ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(TINTA);
      celdas.forEach((c, i) =>
        doc.text(c, cols[i].x, y, {
          width: cols[i].w,
          align: cols[i].derecha ? "right" : "left",
          lineBreak: false,
        })
      );
      doc.y = y + 14;
    };

    const yc = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(GRIS);
    for (const c of cols) {
      doc.text(c.t.toUpperCase(), c.x, yc, {
        width: c.w,
        align: c.derecha ? "right" : "left",
        lineBreak: false,
      });
    }
    doc.y = yc + 12;

    for (const l of billetes) {
      linea([etiquetaDe(l.valor), `${l.cantidad}`, eur(l.valor * l.cantidad)]);
    }
    doc.moveDown(0.2);
    linea(["Total en billetes", "", eur(totalBilletes)], true);

    /*
     * Si lo que se lleva no son todos los billetes del montón, la diferencia
     * va escrita. Sin esta línea, el que cuenta la bolsa en el banco encuentra
     * un importe que no coincide con el desglose y no sabe si falta dinero o
     * si es que se ingresa a propósito solo una parte.
     */
    if (ingreso.importeCentimos !== totalBilletes) {
      const resto = totalBilletes - ingreso.importeCentimos;
      fila(
        resto > 0 ? "Se queda en la caja, no va al banco" : "Se ingresa además, en efectivo de caja",
        eur(Math.abs(resto)),
        true
      );
    }
  }

  if (monedas.length > 0) {
    titulo("Monedas que NO van al banco");
    doc
      .fillColor(GRIS)
      .fontSize(9)
      .text(
        "El banco solo admite billetes. Estas monedas se quedan en tienda como remanente y entran en el ingreso siguiente.",
        M,
        doc.y,
        { width: ancho }
      );
    doc.moveDown(0.4);
    doc.fontSize(10);
    for (const l of monedas) {
      fila(`${etiquetaDe(l.valor)} × ${l.cantidad}`, eur(l.valor * l.cantidad));
    }
    fila("Total en monedas", eur(totalMonedas), true);
  }

  // ── De dónde sale ──
  titulo("Cierres que componen el ingreso");
  for (const c of ingreso.cierres) {
    fila(`Cierre del ${c.fecha}`, eur(c.importeCentimos));
  }
  fila("Remanente anterior", eur(ingreso.remanenteAnteriorCentimos));
  fila("Total bajo control", eur(ingreso.remanenteAnteriorCentimos + ingreso.totalCierresCentimos), true);
  fila("Se ingresa", eur(ingreso.importeCentimos), true);
  fila("Remanente que queda en tienda", eur(ingreso.remanenteNuevoCentimos), true);

  if (ingreso.referencia || ingreso.observaciones) {
    titulo("Datos del ingreso");
    if (ingreso.referencia) fila("Referencia bancaria", ingreso.referencia);
    if (ingreso.observaciones) {
      doc.fillColor(GRIS).fontSize(9).text(ingreso.observaciones, M, doc.y, { width: ancho });
      doc.fontSize(10);
    }
  }

  /*
   * Las dos firmas. Van al pie de la página, no a continuación del texto: así
   * están siempre en el mismo sitio y no bailan según cuántos billetes lleve
   * el desglose.
   */
  const yFirmas = doc.page.height - M - 96;
  doc.y = Math.max(doc.y + 20, yFirmas);
  titulo("Firmas");
  const yF = doc.y + 4;
  const anchoF = (ancho - 20) / 2;
  for (const [i, texto] of [
    "Recibe el dinero y lo lleva al banco",
    "Conforme del banco / nº de resguardo",
  ].entries()) {
    const x = M + i * (anchoF + 20);
    doc.roundedRect(x, yF, anchoF, 60, 4).strokeColor("#cbd5e1").stroke();
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(GRIS)
      .text(texto, x + 8, yF + 6, { width: anchoF - 16, lineBreak: false });
    doc
      .moveTo(x + 8, yF + 46)
      .lineTo(x + anchoF - 8, yF + 46)
      .strokeColor("#cbd5e1")
      .stroke();
    doc
      .fontSize(7)
      .fillColor(GRIS)
      .text("Nombre y firma", x + 8, yF + 49, { width: anchoF - 16, lineBreak: false });
  }

  doc.end();
  return listo;
}
