/**
 * Analizar un albarán: del PDF guardado a las líneas en la base.
 *
 * Aquí se junta lo puro con lo que tiene efectos. El parser no sabe que existen
 * los expedientes y la base no sabe leer un PDF; este fichero es la costura, y
 * por eso lo único que decide son cosas de coordinación —qué adjunto mirar, qué
 * error se reintenta y cuál no— y ninguna de lectura.
 *
 * ── Qué adjunto se abre ─────────────────────────────────────────────────────
 *
 * Un expediente puede tener varios PDF: la factura original y las que llegaron
 * con cada reclamación. El albarán pedido está en uno de ellos y no se sabe en
 * cuál, así que se prueban todos y **gana el que mejor lo localiza**, no el
 * primero ni el más reciente. Si ninguno lo trae, se guarda el mejor intento
 * para poder enseñar qué se miró; lo que no se hace es quedarse con las líneas
 * de un albarán parecido.
 *
 * ── Qué se reintenta ────────────────────────────────────────────────────────
 *
 * Un fallo TÉCNICO —el almacenamiento no responde, la IA está caída— vuelve a
 * la cola: mañana puede salir bien. Un fallo de DOMINIO —el albarán no está en
 * el documento, el PDF está corrupto— es terminal y se enseña: reintentarlo es
 * repetir tres veces la misma lectura correcta y retrasar el momento en que una
 * persona se entera.
 *
 * ── Y qué NO puede pasar ────────────────────────────────────────────────────
 *
 * Que un fallo del análisis toque el expediente o la actuación (§45). El
 * trabajo que pide el correo sigue siendo el mismo aunque el PDF no se deje
 * leer, y alguien tiene que poder gestionarlo a mano. El error se guarda en su
 * fila y en una validación, y ahí se queda.
 */

import { leerConfig, type ConfigTherefore } from "../config.ts";
import {
  albaranesDelDocumento,
  analizarAlbaran,
  analizarCabecera,
  type AnalisisAlbaran,
} from "../domain/documento/index.ts";
import {
  peorEstado,
  validacionDocumentoIlegible,
  validarAnalisis,
  type Validacion,
} from "../domain/validaciones.ts";
import * as repo from "../repository.ts";
import { leerDocumento as leerDelAlmacen } from "../storage.ts";
import { DocumentoIlegible, esEscaneado, leerDocumento } from "./texto.ts";
import { extraerConIA, hayIA } from "./extractorIA.ts";
import type { DocumentoTexto } from "../domain/documento/tipos.ts";

/** Un fallo que merece volver a intentarse más tarde. */
class ErrorTecnico extends Error {}

/** Un fallo que no va a cambiar por repetirlo. */
class ErrorDeDominio extends Error {}

/**
 * Caché del texto de los PDF durante UNA pasada del worker.
 *
 * Un expediente con cuatro actuaciones y un adjunto abriría el mismo PDF cuatro
 * veces. La caché vive sólo lo que dura la pasada: guardarla más tiempo sería
 * quedarse en memoria con el contenido de facturas de clientes.
 */
type Cache = Map<string, DocumentoTexto | null>;

type Candidato = {
  adjunto: repo.Adjunto;
  texto: DocumentoTexto;
  analisis: AnalisisAlbaran;
  /** Si sus líneas las leyó la IA. Decide el `origen` que se guarda. */
  conIA: boolean;
};

const RANGO: Record<string, number> = { MATCH: 3, UNCERTAIN: 2, NO_MATCH: 1 };

async function textoDelAdjunto(
  adjunto: repo.Adjunto,
  cfg: ConfigTherefore,
  cache: Cache
): Promise<DocumentoTexto> {
  const clave = adjunto.storagePath ?? adjunto.id;
  const guardado = cache.get(clave);
  if (guardado) return guardado;

  if (!adjunto.storagePath) throw new ErrorDeDominio("El adjunto no está guardado en el almacenamiento.");

  let bytes: Buffer | null;
  try {
    bytes = await leerDelAlmacen(adjunto.storagePath);
  } catch (e) {
    throw new ErrorTecnico(`No se ha podido leer el documento del almacenamiento: ${(e as Error).message}`);
  }
  if (!bytes) throw new ErrorTecnico("El documento ya no está en el almacenamiento.");

  let texto: DocumentoTexto;
  try {
    texto = leerDocumento(bytes, { maxPaginas: cfg.albaran.maxPaginas });
  } catch (e) {
    if (e instanceof DocumentoIlegible) throw new ErrorDeDominio(e.message);
    throw new ErrorTecnico((e as Error).message);
  }

  cache.set(clave, texto);
  return texto;
}

/** Los PDF del expediente, en orden de llegada. */
function pdfDelExpediente(adjuntos: repo.Adjunto[]): repo.Adjunto[] {
  return adjuntos.filter(
    (a) => a.storagePath && (a.mimeType.includes("pdf") || a.nombreArchivo.toLowerCase().endsWith(".pdf"))
  );
}

/**
 * Analiza una fila de la cola. Nunca lanza: un documento roto no puede parar
 * la cola de los demás.
 */
export async function analizarFila(fila: repo.AlbaranAnalizado): Promise<void> {
  const cache: Cache = new Map();
  try {
    await procesar(fila, cache);
  } catch (e) {
    const tecnico = e instanceof ErrorTecnico;
    const motivo = e instanceof Error ? e.message : "Error analizando el documento";
    // Sin contenido del documento en el log (§45): sólo qué pasó y dónde.
    console.error(`[Therefore] análisis ${fila.id} fallido: ${motivo}`);
    const cfg = await leerConfig(fila.empresaId);
    await repo.marcarErrorAnalisis(fila.id, motivo, tecnico, cfg.albaran.maxIntentos);
    await guardarValidacionDeError(fila, motivo);
  }
}

async function guardarValidacionDeError(fila: repo.AlbaranAnalizado, motivo: string): Promise<void> {
  try {
    await repo.guardarValidaciones(
      fila.empresaId,
      fila.expedienteId,
      fila.actuacionId,
      fila.id,
      [aFilaValidacion(validacionDocumentoIlegible(motivo))]
    );
  } catch (e) {
    console.error("[Therefore] no se ha podido guardar la validación del error:", (e as Error).message);
  }
}

function aFilaValidacion(v: Validacion): repo.ValidacionGuardada {
  return {
    tipo: v.tipo,
    estado: v.estado,
    mensaje: v.mensaje,
    valorEsperado: v.valorEsperado,
    valorObtenido: v.valorObtenido,
    metadata: v.metadata,
  };
}

async function procesar(fila: repo.AlbaranAnalizado, cache: Cache): Promise<void> {
  const empresaId = fila.empresaId;
  const cfg = await leerConfig(empresaId);

  const adjuntos = pdfDelExpediente(await repo.adjuntosDeExpediente(empresaId, fila.expedienteId));
  if (adjuntos.length === 0) {
    throw new ErrorDeDominio(
      "Documento no disponible: el expediente todavía no tiene ningún PDF adjunto. Se analizará cuando llegue."
    );
  }

  const opciones = {
    umbrales: cfg.albaran.umbrales,
    lineas: { toleranciaCentimos: cfg.albaran.toleranciaCentimos },
  };

  let mejor: Candidato | null = null;
  let ultimoFallo: Error | null = null;
  for (const adjunto of adjuntos) {
    let texto: DocumentoTexto;
    try {
      texto = await textoDelAdjunto(adjunto, cfg, cache);
    } catch (e) {
      ultimoFallo = e as Error;
      continue;
    }

    let analisis = analizarAlbaran(texto, fila.numeroSolicitado, opciones);

    /*
     * La IA sólo entra cuando el camino determinista se queda corto: un
     * escaneado sin capa de texto, o una sección con texto de la que no ha
     * salido ninguna línea. Localizar el albarán NO se delega nunca: eso es
     * determinista o es revisión.
     */
    let leidoPorIA = false;
    const sinLineas = analisis.seccion !== null && analisis.lineas.length === 0;
    if ((esEscaneado(texto) || sinLineas) && hayIA()) {
      const conIA = await extraerConIA(texto, analisis, opciones.lineas.toleranciaCentimos);
      if (conIA) {
        analisis = conIA;
        leidoPorIA = true;
      }
    }

    if (!mejor || puntua(analisis) > puntua(mejor.analisis)) {
      mejor = { adjunto, texto, analisis, conIA: leidoPorIA };
    }
    if (analisis.resultadoMatch === "MATCH") break;
  }

  if (!mejor) throw ultimoFallo ?? new ErrorDeDominio("Ninguno de los adjuntos se ha podido leer.");

  const { adjunto, texto, analisis } = mejor;
  // El origen lo decide quién leyó las líneas, no una estimación sobre su
  // confianza: `PDF_IA` es lo que impide que esa lectura llegue a OK sola.
  const origen = mejor.conIA ? "PDF_IA" : "PDF_TEXTO";

  // La cabecera del documento, una vez por fichero. El dato del correo NO se
  // sobrescribe: si difieren, salen los dos y una validación lo dice.
  const { cabecera, parserUsado } = analizarCabecera(texto);
  const expediente = await repo.obtenerExpediente(empresaId, fila.expedienteId);
  const documento = await repo.guardarDocumento(empresaId, fila.expedienteId, {
    adjuntoId: adjunto.id,
    hashArchivo: adjunto.hashArchivo,
    tipoDocumento: cabecera.tipoDocumento,
    numeroDocumento: cabecera.numeroDocumento,
    fechaDocumento: cabecera.fechaDocumento,
    proveedorNombre: cabecera.proveedorNombre,
    proveedorNif: cabecera.proveedorNif,
    baseCentimos: cabecera.baseCentimos,
    ivaCentimos: cabecera.ivaCentimos,
    totalCentimos: cabecera.totalCentimos,
    albaranesDetectados: albaranesDelDocumento(texto),
    origen,
    parserUsado,
    validacion:
      expediente?.facturaNumero && cabecera.numeroDocumento
        ? mismoNumero(expediente.facturaNumero, cabecera.numeroDocumento)
          ? "VALIDADO"
          : "DISCREPANCIA"
        : "SIN_COMPARAR",
  });

  const validaciones = validarAnalisis({
    analisis,
    importeIncidenciaCentimos: fila.importeIncidenciaCentimos,
    toleranciaCentimos: cfg.albaran.toleranciaCentimos,
    umbralConfianzaCampo: cfg.albaran.umbralConfianzaCampo,
    origen,
    correo: expediente
      ? { facturaNumero: expediente.facturaNumero, importeCentimos: expediente.importeCentimos }
      : undefined,
    documento: expediente
      ? { facturaNumero: cabecera.numeroDocumento, totalCentimos: cabecera.totalCentimos }
      : undefined,
  });
  const estadoAnalisis = peorEstado(validaciones);

  const diferencia =
    analisis.sumaLineasCentimos !== null && fila.importeIncidenciaCentimos !== null
      ? analisis.sumaLineasCentimos - fila.importeIncidenciaCentimos
      : null;

  await repo.enTransaccion(async (c) => {
    await repo.guardarResultadoAnalisis(
      fila.id,
      "COMPLETADO",
      {
        documentoId: documento.id,
        adjuntoId: adjunto.id,
        numeroDocumento: analisis.numeroDocumento,
        numeroNormalizado: analisis.numeroNormalizado,
        confianzaMatch: analisis.confianzaMatch,
        resultadoMatch: analisis.resultadoMatch,
        fecha: analisis.complementarios.fecha,
        matricula: analisis.complementarios.matricula,
        bastidor: analisis.complementarios.bastidor,
        observaciones: analisis.complementarios.observaciones,
        importeLineasCentimos: analisis.sumaLineasCentimos,
        diferenciaCentimos: diferencia,
        estadoAnalisis,
        paginaInicio: analisis.paginaInicio,
        paginaFin: analisis.paginaFin,
        parserUsado: analisis.parserUsado,
        origen,
        metadata: {
          modoTabla: analisis.modoTabla,
          filasDescartadas: analisis.filasDescartadas,
          lineasRepetidasRetiradas: analisis.lineasRepetidasRetiradas,
          parecidos: analisis.parecidos,
          conceptosAdicionales: analisis.conceptos,
          otros: analisis.complementarios.otros,
          seccionesVecinas: analisis.seccion
            ? { anterior: analisis.seccion.vecinaAnterior, siguiente: analisis.seccion.vecinaSiguiente }
            : null,
        },
      },
      c
    );

    await repo.guardarLineas(
      empresaId,
      fila.id,
      analisis.lineas.map((l) => ({
        numeroLinea: l.numeroLinea,
        referencia: l.referencia,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitarioCentimos: l.precioUnitarioCentimos,
        importeCentimos: l.importeCentimos,
        confianza: l.confianza,
        cuadraAritmetica: l.cuadraAritmetica,
        descuentosRaw: l.descuentosRaw,
        descuentos: l.descuentos,
        rawText: l.rawText,
        pagina: l.pagina,
        bbox: l.caja,
      })),
      c
    );

    await repo.guardarValidaciones(
      empresaId,
      fila.expedienteId,
      fila.actuacionId,
      fila.id,
      validaciones.map(aFilaValidacion),
      c
    );

    await repo.anotarEvento(
      empresaId,
      {
        expedienteId: fila.expedienteId,
        actuacionId: fila.actuacionId,
        albaranAnalizadoId: fila.id,
        tipo: estadoAnalisis === "ERROR" ? "ANALISIS_ERROR" : "ALBARAN_ANALIZADO",
        actorTipo: "sistema",
        datosNuevos: {
          albaran: analisis.numeroDocumento,
          resultadoMatch: analisis.resultadoMatch,
          lineas: analisis.lineas.length,
          sumaCentimos: analisis.sumaLineasCentimos,
          estadoAnalisis,
        },
        descripcion:
          estadoAnalisis === "ERROR"
            ? `No se ha podido analizar el albarán ${fila.numeroSolicitado}: ${validaciones.find((v) => v.estado === "ERROR")?.mensaje ?? ""}`
            : `Albarán ${fila.numeroSolicitado} analizado: ${analisis.lineas.length} líneas.`,
      },
      c
    );

    // Una validación viva deja el expediente pidiendo revisión. No se quita
    // aquí nunca: quitarla es cosa de quien la resuelva.
    if (estadoAnalisis !== "OK") {
      await repo.actualizarExpediente(empresaId, fila.expedienteId, { requiere_revision: true }, c);
    }
  });
}

/** Ordena los candidatos: primero el que mejor localiza, luego por confianza. */
function puntua(a: AnalisisAlbaran): number {
  return (RANGO[a.resultadoMatch] ?? 0) * 10 + a.confianzaMatch;
}

function mismoNumero(a: string, b: string): boolean {
  return a.replace(/\W/g, "").toUpperCase() === b.replace(/\W/g, "").toUpperCase();
}
