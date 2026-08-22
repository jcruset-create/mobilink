/**
 * Composición de los tres documentos en PDF.
 *
 * Son los mismos que produce el libro del centro, hoja por hoja: justificante
 * de transferencia, acuse de recibo del certificado de intransferibilidad y
 * comunicación a la administración. El informe/certificado del anexo II del
 * RD 125/2017 NO está aquí: lo emite la extranet de VDO.
 *
 * Los textos legales no viven en este fichero, se leen de `tac_plantillas` con
 * la versión que corresponda. Aquí sólo está la maquetación.
 *
 * Fuente Times de las estándar del PDF, que codifica en WinAnsi: le caben los
 * acentos del castellano y del catalán, la ce trencada y el punt volat. No le
 * caben símbolos como los de aviso, así que no se usan — la advertencia de
 * campos incompletos es de la pantalla, no del papel.
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { seAchatarra, type Modalidad } from "./domain.ts";
import type { Centro, Expediente } from "./repository.ts";
import type { Plantillas } from "./templates.ts";

export const TIPOS_DOCUMENTO = ["justificante", "acuse_cliente", "comunicacion_admin"] as const;
export type TipoDocumento = (typeof TIPOS_DOCUMENTO)[number];

export const ETIQUETA_DOCUMENTO: Record<TipoDocumento, string> = {
  justificante: "Justificante de transferencia",
  acuse_cliente: "Acuse de recibo - intransferibilidad",
  comunicacion_admin: "Comunicación a la administración",
};

/**
 * Código de formato de cada documento (UNE 66102:2025, 7.5.2: identificación).
 * Va impreso en el pie junto con la versión de plantilla y la fecha de emisión.
 */
export const CODIGO_FORMATO: Record<TipoDocumento, string> = {
  justificante: "CTT-F-01",
  acuse_cliente: "CTT-F-03",
  comunicacion_admin: "CTT-F-04",
};

/** Qué documento corresponde a cada tipo de operación. */
export const DOCUMENTOS_POR_TIPO: Record<Expediente["tipo"], TipoDocumento[]> = {
  transferencia: ["justificante"],
  intransferibilidad: ["acuse_cliente", "comunicacion_admin"],
};

// A4 en puntos y 2 cm de margen: los mismos que lleva el libro.
const ANCHO = 595.28;
const ALTO = 841.89;
const MARGEN = 56.7;
const ANCHO_UTIL = ANCHO - MARGEN * 2;
const NEGRO = rgb(0, 0, 0);
const GRIS = rgb(0.35, 0.35, 0.35);

type Color = ReturnType<typeof rgb>;

/** `aaaa-mm-dd` a `dd/mm/aaaa`. Vacío si no hay fecha. */
export function fechaEs(iso: string | null): string {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return a && m && d ? `${d}/${m}/${a}` : "";
}

/**
 * Parte un texto en líneas que caben en `ancho`.
 *
 * Se hace a mano porque pdf-lib no sabe de párrafos: `drawText` con un texto
 * largo lo pinta en una sola línea que se sale de la página.
 */
export function partirEnLineas(
  texto: string,
  fuente: PDFFont,
  tamano: number,
  ancho: number
): string[] {
  const lineas: string[] = [];
  let actual = "";
  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const prueba = actual ? `${actual} ${palabra}` : palabra;
    if (fuente.widthOfTextAtSize(prueba, tamano) <= ancho) {
      actual = prueba;
    } else {
      if (actual) lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/**
 * Deja el texto en lo que la codificación WinAnsi de las fuentes estándar sabe
 * pintar.
 *
 * Sin esto, un carácter suelto colado desde un campo tecleado —una comilla
 * tipográfica pegada desde un correo— hace que `drawText` lance y el técnico se
 * queda sin documento sin saber por qué.
 */
export function aWinAnsi(texto: string): string {
  return texto
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/[^ -ÿ]/g, "");
}

type OpcionesTexto = {
  tamano?: number;
  negrita?: boolean;
  color?: Color;
  centrado?: boolean;
  x?: number;
};

/** Cursor de escritura sobre una página A4. */
class Lienzo {
  private pagina: PDFPage;
  private y = ALTO - MARGEN;

  constructor(
    private doc: PDFDocument,
    private normal: PDFFont,
    private negrita: PDFFont
  ) {
    this.pagina = doc.addPage([ANCHO, ALTO]);
  }

  private sitio(alto: number) {
    if (this.y - alto < MARGEN) {
      this.pagina = this.doc.addPage([ANCHO, ALTO]);
      this.y = ALTO - MARGEN;
    }
  }

  salto(px: number) {
    this.y -= px;
  }

  /** Altura actual del cursor, para volver a ella. */
  altura(): number {
    return this.y;
  }

  /** Vuelve a una altura anotada antes: dos firmas en la misma línea. */
  enAltura(y: number) {
    this.y = y;
  }

  linea(texto: string, opts: OpcionesTexto = {}) {
    const tamano = opts.tamano ?? 11;
    const fuente = opts.negrita ? this.negrita : this.normal;
    const limpio = aWinAnsi(texto);
    this.sitio(tamano + 4);
    const x = opts.centrado
      ? MARGEN + (ANCHO_UTIL - fuente.widthOfTextAtSize(limpio, tamano)) / 2
      : (opts.x ?? MARGEN);
    this.pagina.drawText(limpio, {
      x,
      y: this.y - tamano,
      size: tamano,
      font: fuente,
      color: opts.color ?? NEGRO,
    });
    this.y -= tamano + 4;
  }

  parrafo(texto: string, opts: OpcionesTexto & { sangria?: number } = {}) {
    const tamano = opts.tamano ?? 11;
    const fuente = opts.negrita ? this.negrita : this.normal;
    const sangria = opts.sangria ?? 0;
    for (const l of partirEnLineas(aWinAnsi(texto), fuente, tamano, ANCHO_UTIL - sangria)) {
      this.linea(l, { ...opts, x: MARGEN + sangria });
    }
  }

  /** Etiqueta a la izquierda y valor en negrita al lado. */
  campo(etiqueta: string, valor: string, opts: { anchoEtiqueta?: number } = {}) {
    const tamano = 11;
    const ancho = opts.anchoEtiqueta ?? 150;
    this.sitio(tamano + 4);
    this.pagina.drawText(aWinAnsi(etiqueta), {
      x: MARGEN, y: this.y - tamano, size: tamano, font: this.normal, color: NEGRO,
    });
    this.pagina.drawText(aWinAnsi(valor), {
      x: MARGEN + ancho, y: this.y - tamano, size: tamano, font: this.negrita, color: NEGRO,
    });
    this.y -= tamano + 4;
  }

  /** Opción de entrega con su casilla, marcada o no. */
  opcion(texto: string, marcada: boolean) {
    const tamano = 10;
    const lineas = partirEnLineas(aWinAnsi(texto), this.normal, tamano, ANCHO_UTIL - 34);
    const alto = lineas.length * (tamano + 3) + 6;
    this.sitio(alto);
    const arriba = this.y;
    this.pagina.drawRectangle({
      x: ANCHO - MARGEN - 24, y: arriba - alto + 4, width: 20, height: 20,
      borderColor: NEGRO, borderWidth: 0.8,
    });
    if (marcada) {
      this.pagina.drawText("X", {
        x: ANCHO - MARGEN - 18, y: arriba - alto + 9, size: 13, font: this.negrita, color: NEGRO,
      });
    }
    let y = arriba;
    for (const l of lineas) {
      this.pagina.drawText(l, { x: MARGEN, y: y - tamano, size: tamano, font: this.normal, color: NEGRO });
      y -= tamano + 3;
    }
    this.y = arriba - alto;
  }

  /**
   * Línea de firma con su rótulo debajo. Si viene la rúbrica escaneada, se
   * dibuja encima de la línea, escalada para caber sin deformarse.
   */
  firma(rotulo: string, x = MARGEN, ancho = 200, rubrica?: PDFImage) {
    const ALTO_RUBRICA = 38;
    this.sitio(34 + (rubrica ? ALTO_RUBRICA : 0));
    if (rubrica) {
      const escala = Math.min(ancho / rubrica.width, ALTO_RUBRICA / rubrica.height);
      this.pagina.drawImage(rubrica, {
        x,
        y: this.y - ALTO_RUBRICA,
        width: rubrica.width * escala,
        height: rubrica.height * escala,
      });
      this.y -= ALTO_RUBRICA;
    }
    this.pagina.drawLine({
      start: { x, y: this.y - 14 }, end: { x: x + ancho, y: this.y - 14 },
      thickness: 0.8, color: NEGRO,
    });
    this.pagina.drawText(aWinAnsi(rotulo), {
      x, y: this.y - 26, size: 8, font: this.normal, color: GRIS,
    });
    this.y -= 34;
  }

  /** Pie de identificación del documento (UNE 66102:2025, 7.5.2). */
  pie(texto: string) {
    if (!texto) return;
    for (const p of this.doc.getPages()) {
      p.drawText(aWinAnsi(texto), {
        x: MARGEN, y: MARGEN - 22, size: 7, font: this.normal, color: GRIS,
      });
    }
  }
}

function cabeceraCentro(l: Lienzo, centro: Centro) {
  l.linea(centro.nombre, { negrita: true });
  for (const t of [centro.centroTecnico, centro.numCentro, centro.direccion1, centro.direccion2, centro.ciudad]) {
    if (t) l.linea(t, { tamano: 10 });
  }
}

function fichaTacografo(l: Lienzo, e: Expediente) {
  l.campo("Modelo:", e.tacModelo);
  l.campo("Nº de Serie:", e.tacSerie);
  l.salto(6);
  l.campo("Montado en el vehículo:", e.matricula, { anchoEtiqueta: 170 });
  l.campo("Nº de informe/Certificado:", e.numInforme, { anchoEtiqueta: 170 });
  l.campo("Fecha Informe:", fechaEs(e.fechaInforme), { anchoEtiqueta: 170 });
}

/**
 * Rúbricas ya embebidas en el documento, por papel.
 *
 * Llegan embebidas y no como bytes porque `embedPng` es asíncrono y los
 * compositores no lo son: hacerlos async obligaría a esperar dentro de cada
 * `drawText`, que es donde menos falta hace.
 */
export type Rubricas = Partial<Record<"autoriza" | "receptor" | "tecnico" | "responsable", PDFImage>>;

export type ContextoDocumento = {
  expediente: Expediente;
  centro: Centro;
  plantillas: Plantillas;
  /** Texto del pie: código de formato, versión y fecha de edición. */
  pie: string;
  rubricas?: Rubricas;
};

/*
 * El justificante tiene que caber en una hoja: es lo que el cliente firma en el
 * mostrador, y una segunda página con la firma sola invita a que se traspapele.
 * Por eso el cuerpo va a 10 pt y las cláusulas a 8 pt — el mismo apretón que
 * hace el libro original para meterlo todo en un A4.
 */
const CUERPO_JUST = 10;
const CLAUSULA_JUST = 8;

function justificante(
  l: Lienzo,
  { expediente: e, centro, plantillas: t, pie, rubricas = {} }: ContextoDocumento
) {
  const cuerpo = { tamano: CUERPO_JUST };
  l.linea(centro.nombre, { negrita: true, tamano: CUERPO_JUST });
  l.salto(4);
  l.parrafo(t.just_titulo, { negrita: true, tamano: 11, centrado: true });
  l.salto(8);

  l.parrafo(`Yo, ${e.autorizaNombre}`, cuerpo);
  l.parrafo(`con N.I.F. nº: ${e.autorizaNif}`, cuerpo);
  l.parrafo(`en representación de la empresa de transportes: ${e.empresaCliente}`, cuerpo);
  l.parrafo(`propietaria del vehículo matrícula: ${e.matricula}`, cuerpo);
  l.salto(4);
  l.parrafo(`${t.just_informado} ${centro.nombre},`, cuerpo);
  l.parrafo(`${t.just_contrasena} ${centro.numCentro}${t.just_marca} ${e.tacMarca}`, cuerpo);
  l.parrafo(`modelo: ${e.tacModelo}   y número de serie: ${e.tacSerie}`, cuerpo);
  l.salto(4);
  for (const clave of ["just_p1", "just_p2", "just_p3", "just_p4"]) {
    l.parrafo(t[clave] ?? "", cuerpo);
    l.salto(4);
  }

  const opciones: Array<[Modalidad, string]> = [
    ["en_mano", t.just_op_en_mano ?? ""],
    ["email", t.just_op_email ?? ""],
    ["mensajeria", t.just_op_mensajeria ?? ""],
    ["correo_certificado", t.just_op_correo_certificado ?? ""],
  ];
  for (const [clave, texto] of opciones) l.opcion(texto, e.modalidadEntrega === clave);

  l.salto(6);
  for (const clave of ["clausula_confid", "clausula_custodia"]) {
    l.parrafo(t[clave] ?? "", { tamano: CLAUSULA_JUST, color: GRIS });
    l.salto(2);
  }
  if (e.docTitularidad) l.parrafo(t.clausula_titularidad ?? "", { tamano: CLAUSULA_JUST, color: GRIS });

  l.salto(6);
  l.parrafo(t.just_firma, { negrita: true, tamano: CUERPO_JUST });
  l.salto(4);
  l.linea(`En ${centro.ciudadFirma}, a ${fechaEs(e.fechaInforme)}`, cuerpo);
  l.salto(20);
  // Las dos firmas van a la misma altura: la del cliente a la izquierda y la
  // del técnico a la derecha, como en la hoja del libro.
  const alturaFirmas = l.altura();
  l.firma("Persona que autoriza", MARGEN, 200, rubricas.autoriza);
  l.enAltura(alturaFirmas);
  l.firma(`Técnico: ${e.tecnico}`, ANCHO - MARGEN - 200, 200, rubricas.tecnico);
  l.pie(pie);
}

function acuseCliente(
  l: Lienzo,
  { expediente: e, centro, plantillas: t, pie, rubricas = {} }: ContextoDocumento
) {
  cabeceraCentro(l, centro);
  l.salto(20);
  l.parrafo(t.acuse_titulo, { negrita: true, tamano: 13 });
  l.salto(10);
  l.linea(e.empresaCliente, { negrita: true });
  l.salto(14);
  l.linea(t.acuse_saludo ?? "");
  l.salto(8);
  l.parrafo(t.acuse_p1 ?? "");
  l.salto(8);
  fichaTacografo(l, e);
  l.salto(10);
  l.campo("Nombre:", e.receptorNombre);
  l.campo("DNI:", e.receptorDni);
  l.salto(10);
  l.parrafo(
    `En calidad de personal/propietario de la organización de transportes propietaria del ` +
      `vehículo con matrícula ${e.matricula} declaro haber recibido el certificado de ` +
      `intransferibilidad de fecha ${fechaEs(e.fechaInforme)} correspondiente a la intervención ` +
      `técnica realizada sobre el vehículo de matrícula antedicha.`
  );
  l.salto(8);
  l.parrafo(t.acuse_compromiso ?? "");
  l.salto(10);
  if (e.entregaAparato) l.parrafo(t.acuse_entrega_si ?? "", { negrita: true });
  if (seAchatarra(e.entregaAparato)) l.parrafo(t.acuse_achatarrar_si ?? "", { negrita: true });
  l.salto(10);
  l.parrafo(t.clausula_confid ?? "", { tamano: 9, color: GRIS });
  l.salto(14);
  l.linea("Entregado");
  l.linea(`${centro.ciudadFirma} a ${fechaEs(e.fechaEntrega)}`);
  l.salto(20);
  l.firma(`Firma: ${e.receptorNombre}`, MARGEN, 200, rubricas.receptor);
  l.pie(pie);
}

function comunicacionAdmin(
  l: Lienzo,
  { expediente: e, centro, plantillas: t, pie, rubricas = {} }: ContextoDocumento
) {
  cabeceraCentro(l, centro);
  l.salto(20);
  l.parrafo(t.acuse_titulo, { negrita: true, tamano: 13 });
  l.salto(10);
  l.linea(centro.destinatarioAdmin, { negrita: true });
  l.salto(14);
  l.linea(t.acuse_saludo ?? "");
  l.salto(8);
  l.parrafo(t.acuse_p1 ?? "");
  l.salto(8);
  fichaTacografo(l, e);
  l.salto(20);
  l.linea("Entregado");
  l.linea(`${centro.ciudadFirma} a ${fechaEs(e.fechaEntrega)}`);
  l.salto(20);
  l.firma(
    `Responsable técnico: ${centro.responsableTecnico}`,
    MARGEN,
    200,
    rubricas.responsable
  );
  l.pie(pie);
}

const COMPOSITORES: Record<TipoDocumento, (l: Lienzo, c: ContextoDocumento) => void> = {
  justificante,
  acuse_cliente: acuseCliente,
  comunicacion_admin: comunicacionAdmin,
};

/** Qué firma lleva cada documento. */
export const FIRMAS_POR_DOCUMENTO: Record<TipoDocumento, Array<keyof Rubricas>> = {
  justificante: ["autoriza", "tecnico"],
  acuse_cliente: ["receptor"],
  comunicacion_admin: ["responsable"],
};

/**
 * Genera el PDF. Devuelve los bytes; guardarlos es de quien llama.
 *
 * `rubricasPng` son las imágenes de las firmas, por papel. Se embeben aquí
 * —una sola vez, y sólo las que el documento va a usar— porque `embedPng` es
 * asíncrono y los compositores no lo son.
 */
export async function componer(
  tipo: TipoDocumento,
  ctx: ContextoDocumento & { rubricasPng?: Partial<Record<keyof Rubricas, Buffer>> }
): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.TimesRoman);
  const negrita = await doc.embedFont(StandardFonts.TimesRomanBold);

  const rubricas: Rubricas = { ...ctx.rubricas };
  for (const papel of FIRMAS_POR_DOCUMENTO[tipo]) {
    const png = ctx.rubricasPng?.[papel];
    if (!png) continue;
    try {
      rubricas[papel] = await doc.embedPng(png);
    } catch (e) {
      // Una firma ilegible no puede impedir emitir el documento: sale sin
      // rúbrica, con su línea en blanco para firmar a mano.
      console.warn(`Tacógrafos: firma '${papel}' ilegible, se emite sin ella:`, e);
    }
  }

  COMPOSITORES[tipo](new Lienzo(doc, normal, negrita), { ...ctx, rubricas });

  doc.setTitle(`${ETIQUETA_DOCUMENTO[tipo]} - ${ctx.expediente.numInforme}`);
  doc.setProducer("Mobilink - modulo Tacografos");
  return Buffer.from(await doc.save());
}
