/**
 * Convierte correos reales de Therefore en casos de calibración anonimizados.
 *
 *   npx tsx scripts/therefore-anonimizar.ts --revisar   # propone y NO escribe
 *   npx tsx scripts/therefore-anonimizar.ts             # aplica y genera
 *
 * ── Dos pasos, y el primero no escribe nada ─────────────────────────────────
 *
 * `--revisar` lee los correos, busca lo que parece identificar a alguien y
 * deja la propuesta en `sustituciones.json` para que una PERSONA la mire. Sólo
 * la segunda pasada genera los casos. Es deliberado: un detector automático
 * que sustituyera por su cuenta acabaría tocando un número de albarán que se
 * parece a un teléfono, y el lote quedaría roto sin que nadie se enterara.
 *
 * Los nombres de personas y de empresas no los detecta nadie —no hay patrón
 * que los distinga de un concepto de albarán—, así que se añaden a mano al
 * fichero. Quien los añade sabe cuáles son.
 *
 * ── El PDF no se copia: se vuelve a dibujar ─────────────────────────────────
 *
 * Se lee su capa de texto con mupdf (líneas con posición y tamaño), se aplican
 * las sustituciones y se dibuja un PDF nuevo poniendo cada línea donde estaba.
 * Así el resultado no contiene ni un byte del original —ni logotipos, ni
 * metadatos, ni el texto que no se vea— y a la vez conserva la geometría, que
 * es lo que el parser tiene que saber leer.
 *
 * Un PDF escaneado no tiene capa de texto: ésos se rechazan con un aviso, en
 * vez de generar una página en blanco que parecería un caso válido.
 *
 * ── Dónde va cada cosa ──────────────────────────────────────────────────────
 *
 *   server/therefore/fixtures/originales/   los .eml de verdad     NO se versiona
 *   server/therefore/fixtures/originales/sustituciones.json        NO se versiona
 *   server/therefore/fixtures/reales/       los casos anonimizados NO se versiona
 *
 * Ninguna de las tres se sube: este repositorio es PÚBLICO y un albarán lleva
 * el precio de compra y la escala de descuentos de un proveedor. Ver el
 * README.md de fixtures.
 */

import fs from "node:fs";
import path from "node:path";
import { simpleParser, type ParsedMail } from "mailparser";
import { leerPdf, redibujarPdf, tieneTexto } from "../server/therefore/fixtures/pdf.ts";
import {
  anonimizarMessageId,
  detectar,
  informacionAdicional,
  loQueQueda,
  proponerSustitutos,
  sustituir,
  type MapaSustituciones,
} from "../server/therefore/fixtures/anonimizar.ts";
import type { CasoCalibracion } from "../server/therefore/fixtures/tipos.ts";

const RAIZ = path.join(process.cwd(), "server", "therefore", "fixtures");
const DIR_ORIGINALES = path.join(RAIZ, "originales");
const DIR_SALIDA = path.join(RAIZ, "reales");
const FICHERO_MAPA = path.join(DIR_ORIGINALES, "sustituciones.json");

/* ── Correos ─────────────────────────────────────────────────────────────── */

function textoDe(correo: ParsedMail): string {
  if (correo.text?.trim()) return correo.text;
  // Sin texto plano, mailparser deja una conversión del HTML.
  return (correo.textAsHtml ?? "").replace(/<[^>]+>/g, "").trim();
}

function todoElTextoDe(correo: ParsedMail, textosPdf: readonly string[]): string {
  return [
    correo.subject ?? "",
    correo.from?.text ?? "",
    (correo.to as { text?: string } | undefined)?.text ?? "",
    textoDe(correo),
    ...textosPdf,
  ].join("\n");
}

function leerMapa(): MapaSustituciones {
  if (!fs.existsSync(FICHERO_MAPA)) return {};
  return JSON.parse(fs.readFileSync(FICHERO_MAPA, "utf8")) as MapaSustituciones;
}

function ficherosEml(): string[] {
  if (!fs.existsSync(DIR_ORIGINALES)) return [];
  return fs
    .readdirSync(DIR_ORIGINALES)
    .filter((f) => f.toLowerCase().endsWith(".eml"))
    .sort()
    .map((f) => path.join(DIR_ORIGINALES, f));
}

type Leido = { fichero: string; correo: ParsedMail; pdfs: { nombre: string; buffer: Buffer }[] };

async function leerTodos(): Promise<Leido[]> {
  const salida: Leido[] = [];
  for (const fichero of ficherosEml()) {
    const correo = await simpleParser(fs.readFileSync(fichero));
    const pdfs = (correo.attachments ?? [])
      .filter((a) => (a.contentType ?? "").includes("pdf"))
      .map((a) => ({ nombre: a.filename ?? "adjunto.pdf", buffer: a.content as Buffer }));
    salida.push({ fichero, correo, pdfs });
  }
  return salida;
}

/* ── Paso 1: proponer ────────────────────────────────────────────────────── */

async function revisar(): Promise<void> {
  const leidos = await leerTodos();
  if (leidos.length === 0) {
    console.log(`No hay ningún .eml en ${DIR_ORIGINALES}`);
    console.log("Exporta ahí los correos (con sus adjuntos) y vuelve a ejecutar.");
    return;
  }

  const mapa = leerMapa();
  let nuevos = 0;

  for (const { fichero, correo, pdfs } of leidos) {
    const textosPdf = pdfs.map((p) => leerPdf(p.buffer).lineas.map((l) => l.texto).join("\n"));
    const hallazgos = detectar(todoElTextoDe(correo, textosPdf));
    const propuesta = proponerSustitutos(hallazgos);

    console.log(`\n${path.basename(fichero)}  (${pdfs.length} PDF)`);
    for (const h of hallazgos) {
      const yaEsta = mapa[h.valor] !== undefined;
      if (!yaEsta) {
        mapa[h.valor] = propuesta[h.valor];
        nuevos++;
      }
      console.log(`  ${h.tipo.padEnd(10)} ${h.valor}  →  ${mapa[h.valor]}${yaEsta ? "" : "  (nuevo)"}`);
    }
    if (hallazgos.length === 0) console.log("  (nada detectado automáticamente)");
  }

  fs.mkdirSync(DIR_ORIGINALES, { recursive: true });
  fs.writeFileSync(FICHERO_MAPA, JSON.stringify(mapa, null, 2) + "\n");

  console.log(`\n${nuevos} valores nuevos. Mapa en ${FICHERO_MAPA}`);
  console.log(
    "\nREVÍSALO ANTES DE SEGUIR. Y añade a mano lo que ningún patrón puede detectar:\n" +
      "nombres de personas y razones sociales, por ejemplo\n" +
      '  "NEUMATICOS EJEMPLO, S.L.": "PROVEEDOR UNO, S.L.",\n' +
      '  "Daniel G": "Persona A"\n' +
      "\nNO pongas ahí números de albarán, referencias, importes ni descuentos:\n" +
      "son justo lo que el lote tiene que conservar intacto."
  );
}

/* ── Paso 2: generar ─────────────────────────────────────────────────────── */

function esqueletoCaso(
  id: string,
  correo: ParsedMail,
  texto: string,
  adjuntos: CasoCalibracion["adjuntos"]
): CasoCalibracion {
  return {
    id,
    descripcion: "RELLENAR: qué prueba este caso y por qué está en el lote.",
    origen: "real-anonimizado",
    correo: {
      asunto: correo.subject ?? "",
      de: correo.from?.text ?? "",
      para: (correo.to as { text?: string } | undefined)?.text ?? "",
      fecha: (correo.date ?? new Date()).toISOString(),
      texto,
      informacionAdicional: informacionAdicional(texto),
      // El dominio del Message-ID dice de quién es el buzón; la parte local,
      // que es lo que lo hace único, se conserva para poder probar la
      // idempotencia.
      messageId: anonimizarMessageId(correo.messageId),
      inReplyTo: correo.inReplyTo ? anonimizarMessageId(correo.inReplyTo) : null,
    },
    adjuntos,
    /*
     * El esperado sale VACÍO a propósito.
     *
     * Lo rellena una persona mirando el PDF. Si lo generase el parser, la
     * prueba diría «el parser hace lo que hace» y pasaría siempre, incluso el
     * día que empiece a leer 77,56 donde pone 77,50.
     */
    esperado: {
      correo: {
        categoria: "INCIDENCIA_ALBARAN",
        empresaCodigo: null,
        proveedorCodigo: null,
        proveedorNombre: null,
        cuentaContable: null,
        facturaNumero: null,
        facturaFecha: null,
        importeCentimos: null,
        urgente: false,
        persona: null,
        actuaciones: [],
      },
      albaranes: [],
    },
  };
}

async function generar(): Promise<void> {
  const mapa = leerMapa();
  if (Object.keys(mapa).length === 0) {
    console.error("No hay sustituciones.json. Ejecuta primero con --revisar.");
    process.exitCode = 1;
    return;
  }

  const leidos = await leerTodos();
  if (leidos.length === 0) {
    console.log(`No hay ningún .eml en ${DIR_ORIGINALES}`);
    return;
  }

  fs.mkdirSync(DIR_SALIDA, { recursive: true });
  let hechos = 0;

  for (const [i, { fichero, correo, pdfs }] of leidos.entries()) {
    const id = `caso-${String(i + 1).padStart(2, "0")}-${path
      .basename(fichero, ".eml")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;
    const dir = path.join(DIR_SALIDA, id);

    const textoAnonimo = sustituir(textoDe(correo), mapa);
    const adjuntos: CasoCalibracion["adjuntos"] = [];
    const pdfsAnonimos: { fichero: string; buffer: Buffer }[] = [];
    let problema: string | null = null;

    for (const [j, pdf] of pdfs.entries()) {
      const leido = leerPdf(pdf.buffer);
      if (!tieneTexto(leido)) {
        // Escaneado: sin capa de texto no se puede redibujar, y generar una
        // página en blanco daría un caso que parece válido y no lo es.
        problema = `${pdf.nombre} no tiene capa de texto (¿escaneado?): no se puede anonimizar redibujando.`;
        break;
      }
      const nombre = `factura-${j + 1}.pdf`;
      pdfsAnonimos.push({
        fichero: nombre,
        buffer: await redibujarPdf(leido, (t) => sustituir(t, mapa)),
      });
      adjuntos.push({
        fichero: nombre,
        mimeType: "application/pdf",
        nombreOriginal: sustituir(pdf.nombre, mapa),
      });
    }

    if (problema) {
      console.log(`✗ ${id}: ${problema}`);
      continue;
    }

    /*
     * La última puerta: si después de aplicar el mapa el detector todavía
     * encuentra algo, el caso NO se escribe. Es lo único que separa un lote
     * limpio de publicar el correo de alguien.
     */
    const textosPdfAnonimos = pdfsAnonimos.map((p) =>
      leerPdf(p.buffer).lineas.map((l) => l.texto).join("\n")
    );
    const quedan = loQueQueda([textoAnonimo, ...textosPdfAnonimos].join("\n"), mapa);
    if (quedan.length > 0) {
      console.log(`✗ ${id}: queda sin anonimizar → ${quedan.map((h) => `${h.tipo} ${h.valor}`).join(", ")}`);
      console.log("   Añádelo a sustituciones.json y vuelve a ejecutar.");
      continue;
    }

    fs.mkdirSync(dir, { recursive: true });
    for (const p of pdfsAnonimos) fs.writeFileSync(path.join(dir, p.fichero), p.buffer);
    fs.writeFileSync(
      path.join(dir, "caso.json"),
      JSON.stringify(esqueletoCaso(id, correo, textoAnonimo, adjuntos), null, 2) + "\n"
    );
    console.log(`✓ ${id}  (${adjuntos.length} PDF)`);
    hechos++;
  }

  console.log(`\n${hechos} casos en ${DIR_SALIDA}`);
  console.log("Falta rellenar a mano el bloque «esperado» de cada caso.json:");
  console.log("es el ground truth, y lo escribe quien mira el PDF, nunca el parser.");
}

const esRevision = process.argv.includes("--revisar");
await (esRevision ? revisar() : generar());
