/**
 * Las rutas del informe de tacógrafo: simular, importar, listar y deshacer.
 *
 * ── Simular antes que importar, y no por cortesía ───────────────────────────
 *
 * `/simular` sube el Excel y devuelve qué pasaría sin escribir una sola fila.
 * Es el paso que permite discutir los números antes de que existan: cuántas
 * nuevas, cuántas ya estaban, cuántas matrículas no se encuentran, qué
 * propone sobre las medidas y qué lecturas de kilometraje no cuadran.
 *
 * `/importar` hace lo mismo y además graba. Se vuelve a leer el fichero en
 * vez de fiarse de lo que la pantalla simuló hace un rato: entre una cosa y
 * otra alguien puede haber dado de alta un vehículo, o importado el mismo
 * fichero desde otro sitio.
 *
 * ── El fichero se lee AQUÍ, no en el navegador ──────────────────────────────
 *
 * Podría leerse en el panel y mandar las filas en JSON, como hacen los
 * importadores antiguos. No se hace por dos razones: el parser ya está en el
 * servidor y tener dos sería tener dos criterios, y mandar 1.744 filas en
 * JSON es varias veces el tamaño del propio Excel.
 *
 * ── La empresa se comprueba aquí ────────────────────────────────────────────
 *
 * El servidor habla con Supabase usando `service_role`, que NO pasa por RLS.
 * Sin esta comprobación, cualquiera con sesión podría simular contra la
 * empresa de otro cliente tecleando su id. Es el mismo agujero que se cerró
 * en los informes, y aquí se cierra antes de abrirlo.
 *
 * ── Ojo con el nombre ───────────────────────────────────────────────────────
 *
 * Existe `mountTacografos` —en plural— y es OTRA cosa: el módulo de
 * expedientes del anexo II (transferencias e intransferibilidad), con sus
 * tablas `tac_*` y su propio pool. Esto es el registro de intervenciones de
 * TyreControl. Se llama `mountTcTacografo` para que no se confundan en una
 * lista de imports.
 */

import type { Express, RequestHandler } from "express";
import multer from "multer";
import * as XLSX from "xlsx";

import { createHash } from "node:crypto";

import { empresaDelInforme } from "../informes/alcance.ts";
import { normalizarMatricula } from "../matricula.ts";
import {
  SISTEMA_ORIGEN, contarInformesDeLote, leerBases, leerBloqueadasDeLote, leerCatalogoMedidas,
  leerClavesDePropuestas, leerCreadasDePdf, leerFilasDeLote, leerFlotaConBase, leerIdsPorOrigen,
  leerInforme, leerInformePorHash, leerInformesDeVehiculo, leerIntervenciones,
  leerIntervencionCompleta,
  leerIntervencionPorOrigen, leerLote, leerLotes, leerMedidasDeVehiculos, leerPropuesta,
  leerPropuestas, leerPropuestasDeLote, leerRegla, leerVehiculo, leerVehiculos, leerYaImportados,
} from "./datos.ts";
import {
  construirControl, fichaDe, type IntervencionTac, type VehiculoTac,
} from "./control.ts";
import type { EstadoTacografo } from "./vencimiento.ts";
import { evaluar } from "./deshacer.ts";
import {
  aplicarPropuesta, borrarLote, cerrarLote, completarDePdf, crearLote, guardarBloqueadas,
  guardarInformePdf, insertarFilas, insertarIntervencionDePdf, insertarPropuestas,
  rechazarPropuesta, urlFirmadaDeInforme, vincularIntervencion,
} from "./escribir.ts";
import {
  decidir, filasPropuesta, porCaso, separarParaBloque,
  type Candidata, type MedidaCatalogo, type PropuestaGuardada,
} from "./propuestas.ts";
import { aFilaInsert, parcheParaCompletar, preparar } from "./importar.ts";
import { ErrorFichero, leerHoja, type Lectura } from "./parser.ts";
import { simular } from "./simular.ts";
import { decidirInforme } from "./informes.ts";
import { leerInformePdf, lineasDeInforme } from "./informePdf.ts";

/**
 * El informe del centro son 3,3 MB con cinco años dentro. Veinte deja sitio
 * para que crezca unos cuantos años más sin que nadie tenga que tocar esto.
 */
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

const hoyISO = () => new Date().toISOString().slice(0, 10);

/** El usuario de la sesión, si la tabla de TyreControl lo conoce. */
const usuarioDe = (req: any): string | null => req?.authCtx?.userId ?? null;

/** Lee el Excel que viene en la petición y lo deja en filas. */
function leerDelCuerpo(req: any): { lectura: Lectura; archivo: string; sha: string } {
  const archivo = req.file as { buffer: Buffer; originalname: string } | undefined;
  if (!archivo?.buffer?.length) throw new ErrorFichero("Falta el fichero");
  const wb = XLSX.read(archivo.buffer, { cellDates: true });
  const nombreHoja = wb.SheetNames[0];
  if (!nombreHoja) throw new ErrorFichero("El fichero no tiene ninguna hoja");
  const hoja = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja],
    { header: 1, defval: null, raw: true }) as unknown[][];
  return {
    lectura: leerHoja(hoja, nombreHoja),
    archivo: archivo.originalname,
    sha: createHash("sha256").update(archivo.buffer).digest("hex"),
  };
}


const ESTADOS: EstadoTacografo[] = ["vigente", "proxima", "vencida", "sin_datos"];

/** Una fila de la base, con los nombres que usa el cálculo. */
const aIntervencion = (r: any): IntervencionTac => ({
  id: String(r.id),
  vehiculoId: r.vehiculo_id ?? null,
  idOrigen: String(r.id_origen ?? ""),
  fecha: String(r.fecha ?? "").slice(0, 10),
  tipoOperacion: r.tipo_operacion ?? null,
  resultado: r.resultado ?? null,
  medidaNorm: r.medida_neumatico_norm ?? null,
  medidaOrigen: r.medida_neumatico ?? null,
  kmNuevo: r.km_nuevo == null ? null : Number(r.km_nuevo),
  kmSospechoso: r.km_sospechoso === true,
  paramL: r.param_l ?? null,
  paramW: r.param_w ?? null,
  paramK: r.param_k ?? null,
  referencia: r.referencia ?? null,
  version: r.version ?? null,
  numSerie: r.num_serie ?? null,
  numSensor: r.num_sensor ?? null,
  tipoTacografo: r.tipo_tacografo ?? null,
  fabricante: r.fabricante ?? null,
  tecnico: r.tecnico ?? null,
  observaciones: r.observaciones ?? null,
});

const aVehiculo = (r: any): VehiculoTac => ({
  id: String(r.id),
  matricula: r.matricula ?? null,
  numeroUnidad: r.numero_unidad ?? null,
  baseId: r.delegacion_id ?? null,
  base: (r.delegacion as any)?.nombre ?? null,
  activo: r.activo !== false,
});

/** Una propuesta de la base, con los nombres que usa el módulo que decide. */
const aPropuesta = (r: any): PropuestaGuardada => ({
  id: String(r.id),
  vehiculoId: r.vehiculo_id ?? null,
  matriculaNorm: String(r.matricula_norm ?? ""),
  caso: r.caso,
  medidaNorm: String(r.medida_norm ?? ""),
  medidaOrigen: r.medida_origen ?? null,
  fecha: r.fecha_intervencion ?? null,
  idOrigen: r.id_origen ?? null,
  medidaActual: r.medida_actual ?? null,
  medidaActualId: r.medida_actual_id ?? null,
  estado: String(r.estado ?? ""),
  seguraParaBloque: r.segura_para_bloque === true,
});

/**
 * Decide sobre un montón de propuestas de una vez.
 *
 * El catálogo y las medidas actuales se leen UNA vez para todas: resolver 43
 * propuestas preguntando por cada una serían 86 consultas para leer una tabla
 * de dos docenas de filas y 43 vehículos.
 */
async function decidirTodas(
  empresa: string, propuestas: PropuestaGuardada[],
): Promise<{ candidatas: Candidata[]; catalogo: MedidaCatalogo[] }> {
  const [catalogo, medidas] = await Promise.all([
    leerCatalogoMedidas(),
    leerMedidasDeVehiculos(empresa, propuestas.map((p) => p.vehiculoId).filter(Boolean) as string[]),
  ]);
  const candidatas = propuestas.map((p) => ({
    propuesta: p,
    decision: decidir(p, catalogo, p.vehiculoId ? (medidas.get(p.vehiculoId)?.medida ?? null) : null),
  }));
  return { candidatas, catalogo };
}

/** Los estados que pide la URL: `?estado=vencida,proxima`. */
function estadosPedidos(v: unknown): EstadoTacografo[] | null {
  const partes = String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const buenos = partes.filter((x): x is EstadoTacografo => (ESTADOS as string[]).includes(x));
  return buenos.length > 0 ? buenos : null;
}

export function mountTcTacografo(app: Express, ...guards: RequestHandler[]): void {
  app.post("/api/tyrecontrol/tacografo/simular", ...guards, subida.single("archivo"),
    async (req, res) => {
      try {
        const alcance = await empresaDelInforme(req, req.query.empresa ?? req.body?.empresa);
        if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
        const empresa = alcance.empresa;

        const { lectura, archivo } = leerDelCuerpo(req);

        // Las tres lecturas son independientes: en paralelo.
        const [vehiculos, yaImportados, creadasDePdf, regla] = await Promise.all([
          leerVehiculos(empresa),
          leerYaImportados(empresa, SISTEMA_ORIGEN),
          leerCreadasDePdf(empresa),
          leerRegla(empresa),
        ]);

        const simulacion = simular({
          filas: lectura.filas, problemas: lectura.problemas,
          vehiculos, yaImportados, regla, hoy: hoyISO(), archivo,
        });

        res.json({
          ok: true,
          lectura: {
            filaCabecera: lectura.filaCabecera,
            columnas: lectura.columnas,
            columnasUsadas: lectura.columnasUsadas,
            columnasDesconocidas: lectura.columnasDesconocidas,
            hoja: lectura.nombreHoja,
          },
          regla,
          simulacion,
        });
      } catch (e: any) {
        if (e instanceof ErrorFichero) return res.status(400).json({ error: e.message });
        console.error("[tacografo-simular] error:", e?.message ?? e);
        res.status(500).json({ error: e?.message || "No se ha podido leer el fichero" });
      }
    });

  /**
   * Importar de verdad.
   *
   * Vuelve a leer el fichero y a cruzar contra la base en vez de fiarse de lo
   * que la pantalla simuló hace un rato: entre una cosa y otra alguien puede
   * haber dado de alta un vehículo o importado el mismo fichero desde otro
   * sitio. La simulación sirve para decidir, no como entrada.
   */
  app.post("/api/tyrecontrol/tacografo/importar", ...guards, subida.single("archivo"),
    async (req, res) => {
      try {
        const alcance = await empresaDelInforme(req, req.query.empresa ?? (req as any).body?.empresa);
        if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
        const empresa = alcance.empresa;

        const { lectura, archivo, sha } = leerDelCuerpo(req);
        const usuarioId = usuarioDe(req);

        const [vehiculos, yaImportados, creadasDePdf, regla] = await Promise.all([
          leerVehiculos(empresa),
          leerYaImportados(empresa, SISTEMA_ORIGEN),
          leerCreadasDePdf(empresa),
          leerRegla(empresa),
        ]);

        // El lote se abre antes de insertar nada: las filas llevan su id, y
        // así un corte a mitad deja rastro de qué se estaba haciendo.
        const loteId = await crearLote({
          empresa, archivo, sistemaOrigen: SISTEMA_ORIGEN,
          archivoFilas: lectura.filas.length + lectura.problemas.length,
          filasEmpresa: lectura.filas.length,
          usuarioId, sha256: sha,
        });

        const prep = preparar(lectura.filas, {
          empresa, loteId, sistemaOrigen: SISTEMA_ORIGEN,
          archivo, hoja: lectura.nombreHoja, usuarioId, vehiculos, yaImportados,
          creadasDePdf,
        });

        const { insertadas, duplicadas } = await insertarFilas(prep.insertar);

        /*
         * Las intervenciones que creó un informe en PDF se COMPLETAN, no se
         * saltan. Están a medias a propósito —el impreso no trae la versión
         * de software de las unidades VDO, por ejemplo— y esta es la fila del
         * centro que les faltaba. Solo se rellena lo que está a null: si el
         * Excel dice una cosa y la fila otra, se queda lo que ya había.
         */
        const yaDePdf = await Promise.all(prep.completar.map(async (c) => {
          const actual = await leerIntervencionCompleta(empresa, c.idOrigen);
          return actual ? { idOrigen: c.idOrigen, parche: parcheParaCompletar(actual, c.nueva) } : null;
        }));
        const completadas = await completarDePdf(
          empresa, yaDePdf.filter((x): x is { idOrigen: string; parche: Record<string, unknown> } => x != null));

        // Las que el parser no supo leer también se dejan dichas, con su fila.
        const bloqueadas = [
          ...prep.bloqueadas,
          ...lectura.problemas.map((p) => ({
            fila_origen: p.fila, id_origen: null, matricula: null, fecha: null,
            motivo: p.motivo, valor: p.valor ?? null,
          })),
        ];
        await guardarBloqueadas(empresa, loteId, bloqueadas);

        await cerrarLote(loteId, {
          importadas: insertadas,
          duplicadas: prep.saltadas.length + duplicadas,
          sinVehiculo: prep.sinVehiculo,
          bloqueadas: bloqueadas.length,
        });

        // La foto de después, con lo que ahora hay en la base.
        const yaDespues = await leerYaImportados(empresa, SISTEMA_ORIGEN);
        const simulacion = simular({
          filas: lectura.filas, problemas: lectura.problemas,
          vehiculos, yaImportados: yaDespues, regla, hoy: hoyISO(), archivo,
        });

        /*
         * Las propuestas de medida se guardan AQUÍ y no al aceptarlas, porque
         * `segura_para_bloque` solo se puede calcular con el fichero delante:
         * depende de si alguna fila de ese vehículo traía un aviso, y eso no
         * está en la base. Tres semanas después, cuando alguien abra la
         * pantalla, el fichero ya no existe.
         *
         * Las que ya tienen propuesta se saltan, incluidas las RECHAZADAS: si
         * alguien dijo que no a esta medida para esta matrícula, la
         * exportación del mes que viene no puede volver a preguntarlo.
         */
        const [claves, idsPorOrigen] = await Promise.all([
          leerClavesDePropuestas(empresa),
          leerIdsPorOrigen(loteId),
        ]);
        const propuestas = await insertarPropuestas(filasPropuesta(simulacion.propuestas, {
          empresa, loteId, intervencionPorIdOrigen: idsPorOrigen, yaExisten: claves,
        }));

        res.json({
          ok: true,
          loteId,
          resultado: {
            leidas: lectura.filas.length,
            insertadas,
            yaEstaban: prep.saltadas.length,
            duplicadasEnBase: duplicadas,
            sinVehiculo: prep.sinVehiculo,
            bloqueadas: bloqueadas.length,
            propuestas: propuestas.insertadas,
            propuestasYaEstaban: simulacion.propuestas.length - propuestas.insertadas,
            /** De las que ya estaban, las que había creado un PDF y ahora están enteras. */
            completadasDePdf: completadas,
          },
          simulacion,
        });
      } catch (e: any) {
        if (e instanceof ErrorFichero) return res.status(400).json({ error: e.message });
        console.error("[tacografo-importar] error:", e?.message ?? e);
        res.status(500).json({ error: e?.message || "No se ha podido importar" });
      }
    });

  /**
   * El control de tacógrafos de toda la flota.
   *
   * Sale del MISMO cálculo que la sección de la ficha (`control.ts`). Si cada
   * pantalla lo hiciera por su cuenta, un día la ficha diría una fecha y el
   * control otra, y a partir de ahí nadie se fiaría de ninguna.
   */
  app.get("/api/tyrecontrol/tacografo/control", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      const empresa = alcance.empresa;

      const [flota, intervenciones, regla, bases] = await Promise.all([
        leerFlotaConBase(empresa),
        leerIntervenciones(empresa),
        leerRegla(empresa),
        leerBases(empresa),
      ]);

      const control = construirControl(
        flota.map(aVehiculo),
        intervenciones.map(aIntervencion),
        regla,
        hoyISO(),
        {
          baseId: String(req.query.base ?? "").trim() || null,
          texto: String(req.query.texto ?? "").trim() || null,
          estados: estadosPedidos(req.query.estado),
          venceAntesDe: String(req.query.venceAntesDe ?? "").trim() || null,
          incluirBaja: String(req.query.incluirBaja ?? "") === "1",
        },
      );

      res.json({ ok: true, empresaId: empresa, regla, bases, ...control });
    } catch (e: any) {
      console.error("[tacografo-control] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se ha podido leer el control" });
    }
  });

  /** La sección Tacógrafo de la ficha de un vehículo. */
  app.get("/api/tyrecontrol/tacografo/vehiculo/:id", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      const empresa = alcance.empresa;
      const vehiculoId = String(req.params.id);

      const vehiculo = await leerVehiculo(empresa, vehiculoId);
      if (!vehiculo) return res.status(404).json({ error: "Ese vehículo no es de esta empresa" });

      const [intervenciones, regla] = await Promise.all([
        leerIntervenciones(empresa, vehiculoId),
        leerRegla(empresa),
      ]);

      res.json({
        ok: true,
        regla,
        ...fichaDe(aVehiculo(vehiculo), intervenciones.map(aIntervencion), regla, hoyISO()),
      });
    } catch (e: any) {
      console.error("[tacografo-ficha] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se ha podido leer el tacógrafo" });
    }
  });

  // ── Los informes técnicos en PDF ─────────────────────────────────────────

  /**
   * Adjuntar un informe técnico a la ficha de un vehículo.
   *
   * Dos caminos, y los pidió así el cliente: si la intervención del impreso
   * no está dada de alta, se crea con los datos del informe; si ya está, solo
   * se adjunta el PDF. Lo decide el «A1. Nº de orden», que es el mismo
   * `id_origen` del Excel del centro.
   *
   * El orden de escritura es intervención → documento, y no al revés: si falla
   * lo segundo queda una intervención sin adjunto, que es correcta y se puede
   * volver a intentar. Al revés quedaría un clip en la ficha que no abre nada.
   *
   * Con `?confirmar=1` se acepta un informe cuya matrícula no es la del
   * vehículo abierto. Sin él, el servidor NO decide: responde con las dos
   * matrículas, porque subir el informe en la ficha de al lado es el error
   * fácil y el caro.
   */
  app.post("/api/tyrecontrol/tacografo/informe-pdf", ...guards, subida.single("archivo"),
    async (req, res) => {
      try {
        const alcance = await empresaDelInforme(req, req.query.empresa ?? (req as any).body?.empresa);
        if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
        const empresa = alcance.empresa;
        const vehiculoId = String(req.query.vehiculo ?? (req as any).body?.vehiculo ?? "");
        if (!vehiculoId) return res.status(400).json({ error: "Falta el vehículo" });

        const archivo = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
        if (!archivo?.buffer?.length) return res.status(400).json({ error: "Falta el fichero" });
        if (archivo.buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
          return res.status(400).json({ error: "Eso no es un PDF" });
        }

        const vehiculo = await leerVehiculo(empresa, vehiculoId);
        if (!vehiculo) return res.status(404).json({ error: "Ese vehículo no es de esta empresa" });

        const lineas = await lineasDeInforme(archivo.buffer);
        const lectura = leerInformePdf(lineas);
        const sha = createHash("sha256").update(archivo.buffer).digest("hex");

        const [existente, mismoFichero] = await Promise.all([
          lectura.fila ? leerIntervencionPorOrigen(empresa, lectura.fila.idOrigen) : null,
          leerInformePorHash(vehiculoId, sha),
        ]);

        const decision = decidirInforme({
          fila: lectura.fila,
          problemas: lectura.problemas,
          vehiculoId,
          matriculaVehiculo: normalizarMatricula(String(vehiculo.matricula ?? "")),
          existente,
          mismoFichero,
          confirmado: String(req.query.confirmar ?? (req as any).body?.confirmar ?? "") === "1",
        });

        if (decision.accion === "no_se_puede") {
          return res.status(409).json({ error: decision.motivo, decision });
        }
        if (decision.accion === "duplicado") {
          return res.status(409).json({ error: decision.motivo, decision });
        }

        const usuarioId = usuarioDe(req);
        const fila = lectura.fila!;
        let intervencionId = decision.intervencionId ?? null;
        let creada = false;

        if (decision.accion === "crear_y_adjuntar") {
          const r = await insertarIntervencionDePdf(aFilaInsert(fila, {
            empresa, sistemaOrigen: SISTEMA_ORIGEN, vehiculoId,
            loteId: null, archivo: archivo.originalname, hoja: null,
            usuarioId, kmSospechoso: false, creadaDePdf: true,
          }));
          intervencionId = r.id;
          creada = !r.yaEstaba;
          if (r.yaEstaba) {
            decision.avisos.push("Alguien había importado esa intervención mientras se subía "
              + "el informe: el PDF se adjunta a la que ya estaba.");
          }
        } else if (decision.vincular && intervencionId) {
          await vincularIntervencion(intervencionId, vehiculoId, usuarioId);
        }

        const doc = await guardarInformePdf({
          empresa, vehiculoId, intervencionId: intervencionId!,
          pdf: archivo.buffer, nombreOriginal: archivo.originalname, sha256: sha,
          paginas: lineas.reduce((m, l) => Math.max(m, l.pagina), 0) || null,
          idOrigen: fila.idOrigen, usuarioId,
        });

        res.json({
          ok: true,
          accion: creada ? "creada_y_adjuntada" : "adjuntada",
          intervencionId,
          documentoId: doc.id,
          idOrigen: fila.idOrigen,
          fecha: fila.fecha,
          url: await urlFirmadaDeInforme(doc.ruta),
          avisos: decision.avisos,
        });
      } catch (e: any) {
        console.error("[tacografo-informe-pdf] error:", e?.message ?? e);
        res.status(500).json({ error: e?.message || "No se ha podido adjuntar el informe" });
      }
    });

  /**
   * Los informes adjuntos de un vehículo, por intervención.
   *
   * Va aparte de la ficha y no dentro: la ficha se pide siempre y el clip es
   * un extra, y así una URL firmada que caduca no obliga a recargar el
   * histórico entero.
   */
  app.get("/api/tyrecontrol/tacografo/informes", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      const empresa = alcance.empresa;
      const vehiculoId = String(req.query.vehiculo ?? "");
      if (!vehiculoId) return res.status(400).json({ error: "Falta el vehículo" });

      const vehiculo = await leerVehiculo(empresa, vehiculoId);
      if (!vehiculo) return res.status(404).json({ error: "Ese vehículo no es de esta empresa" });

      const docs = await leerInformesDeVehiculo(empresa, vehiculoId);
      res.json({
        ok: true,
        informes: await Promise.all(docs.map(async (d: any) => ({
          id: String(d.id),
          intervencionId: d.intervencion_id ?? null,
          nombre: d.nombre_original ?? "informe.pdf",
          paginas: d.paginas ?? null,
          bytes: d.tamano_bytes ?? null,
          subidoEn: d.created_at ?? null,
          url: await urlFirmadaDeInforme(String(d.storage_path)),
        }))),
      });
    } catch (e: any) {
      console.error("[tacografo-informes] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se han podido leer los informes" });
    }
  });

  /** Una URL nueva para un informe, porque la firmada caduca en una hora. */
  app.get("/api/tyrecontrol/tacografo/informes/:id", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      const doc = await leerInforme(alcance.empresa, String(req.params.id));
      if (!doc) return res.status(404).json({ error: "Ese informe no existe" });
      res.json({
        ok: true,
        id: String(doc.id),
        nombre: doc.nombre_original ?? "informe.pdf",
        url: await urlFirmadaDeInforme(String(doc.storage_path)),
      });
    } catch (e: any) {
      console.error("[tacografo-informe] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se ha podido leer el informe" });
    }
  });

  /** Los lotes de la empresa, del más reciente al más viejo. */
  app.get("/api/tyrecontrol/tacografo/lotes", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      res.json({ ok: true, lotes: await leerLotes(alcance.empresa) });
    } catch (e: any) {
      console.error("[tacografo-lotes] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se han podido leer los lotes" });
    }
  });

  /** Las filas que no entraron en un lote, con su motivo. */
  app.get("/api/tyrecontrol/tacografo/lotes/:id/bloqueadas", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      const lote = await leerLote(String(req.params.id));
      if (!lote || lote.empresa_id !== alcance.empresa) {
        return res.status(404).json({ error: "Ese lote no existe" });
      }
      res.json({ ok: true, bloqueadas: await leerBloqueadasDeLote(lote.id) });
    } catch (e: any) {
      console.error("[tacografo-bloqueadas] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se han podido leer" });
    }
  });

  /**
   * Deshacer un lote.
   *
   * Con `?comprobar=1` solo dice si se puede y qué estorba, sin tocar nada.
   * Es lo que la pantalla pregunta antes de enseñar el botón, para no ofrecer
   * algo que va a fallar.
   */
  app.post("/api/tyrecontrol/tacografo/lotes/:id/deshacer", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa ?? (req as any).body?.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      const empresa = alcance.empresa;
      const loteId = String(req.params.id);

      const lote = await leerLote(loteId);
      const [filas, propuestas, informes] = lote
        ? await Promise.all([
          leerFilasDeLote(loteId), leerPropuestasDeLote(loteId), contarInformesDeLote(loteId),
        ])
        : [[], [], 0];

      const veredicto = evaluar(
        lote ? { id: String(lote.id), empresaId: String(lote.empresa_id),
                 estado: String(lote.estado), importadas: Number(lote.importadas ?? 0) } : null,
        empresa,
        filas.map((f: any) => ({
          id: String(f.id), idOrigen: String(f.id_origen),
          importadoEn: String(f.importado_en), actualizadoEn: String(f.actualizado_en),
          vinculadoEn: f.vinculado_en ?? null,
        })),
        propuestas.map((p: any) => ({
          id: String(p.id), estado: String(p.estado), matriculaNorm: String(p.matricula_norm),
        })),
        informes,
      );

      if (String(req.query.comprobar ?? "") === "1") {
        return res.json({ ok: true, veredicto });
      }
      if (!veredicto.puede) {
        return res.status(409).json({ error: veredicto.explicacion, veredicto });
      }

      const borradas = await borrarLote(loteId, empresa, usuarioDe(req));
      res.json({ ok: true, borradas, loteId });
    } catch (e: any) {
      console.error("[tacografo-deshacer] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se ha podido deshacer" });
    }
  });
  // ── Fase 5: las propuestas de medida ─────────────────────────────────────

  /**
   * Las propuestas pendientes, cada una con si se puede aceptar y por qué no.
   *
   * La decisión viene YA TOMADA del servidor: si la pantalla decidiera por su
   * cuenta qué es aceptable, tendría que reimplementar la búsqueda en el
   * catálogo y la comparación con la medida actual, y el día que una de las
   * dos cambiara enseñaría un botón que el servidor rechaza.
   */
  app.get("/api/tyrecontrol/tacografo/propuestas", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      const empresa = alcance.empresa;

      const estado = req.query.estado ? String(req.query.estado) : "pendiente";
      const propuestas = (await leerPropuestas(empresa, estado === "todas" ? null : estado))
        .map(aPropuesta);

      const { candidatas } = await decidirTodas(empresa, propuestas);
      const { aceptables } = separarParaBloque(candidatas);

      res.json({
        total: candidatas.length,
        porCaso: porCaso(propuestas),
        // Cuántas entrarían en un «aceptar todo». Es el número que la
        // pantalla pone en el botón, para que nadie lo pulse a ciegas.
        aceptablesEnBloque: aceptables.length,
        propuestas: candidatas.map((c) => ({
          ...c.propuesta,
          puedeAceptar: c.decision.puede,
          motivo: c.decision.motivo ?? null,
          explicacion: c.decision.explicacion ?? null,
          seEscribira: c.decision.resuelta
            ? { medidaId: c.decision.resuelta.medida.id, valor: c.decision.resuelta.medida.valor,
                exacta: c.decision.resuelta.exacta,
                marcadoIgnorado: c.decision.resuelta.marcadoIgnorado }
            : null,
          entraEnBloque: aceptables.some((a) => a.propuesta.id === c.propuesta.id),
        })),
      });
    } catch (e: any) {
      console.error("[tacografo-propuestas] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se han podido leer las propuestas" });
    }
  });

  /**
   * Aceptar o rechazar UNA propuesta.
   *
   * Se vuelve a decidir con la base delante, no se cree lo que diga el
   * cuerpo de la petición: entre que la pantalla pintó el botón y alguien lo
   * pulsó, la medida del vehículo puede haber cambiado. Y aceptar escribe
   * `tc_vehiculos.medida_id` y NADA más.
   */
  app.post("/api/tyrecontrol/tacografo/propuestas/:id", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa ?? (req as any).body?.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      const empresa = alcance.empresa;

      const accion = String((req.body as any)?.accion ?? "");
      if (accion !== "aceptar" && accion !== "rechazar") {
        return res.status(400).json({ error: "La acción tiene que ser «aceptar» o «rechazar»" });
      }

      const fila = await leerPropuesta(empresa, String(req.params.id));
      if (!fila) return res.status(404).json({ error: "Esa propuesta no existe en esta empresa" });
      const p = aPropuesta(fila);

      if (accion === "rechazar") {
        const nota = (req.body as any)?.nota ? String((req.body as any).nota).slice(0, 500) : null;
        const hecho = await rechazarPropuesta(p.id, empresa, usuarioDe(req), nota);
        if (!hecho) return res.status(409).json({ error: "La propuesta ya estaba resuelta" });
        return res.json({ ok: true, accion: "rechazar" });
      }

      const { candidatas } = await decidirTodas(empresa, [p]);
      const d = candidatas[0].decision;
      if (!d.puede || !d.resuelta) {
        return res.status(409).json({ error: d.explicacion ?? "No se puede aceptar", motivo: d.motivo });
      }

      const r = await aplicarPropuesta({
        propuestaId: p.id, empresa, vehiculoId: p.vehiculoId!,
        medidaId: d.resuelta.medida.id, medidaValor: d.resuelta.medida.valor,
        exacta: d.resuelta.exacta, medidaPreviaId: p.medidaActualId,
        usuarioId: usuarioDe(req),
      });
      if (!r.ok) return res.status(409).json({ error: r.motivo });

      res.json({
        ok: true, accion: "aceptar",
        escrito: { medida: d.resuelta.medida.valor, exacta: d.resuelta.exacta },
      });
    } catch (e: any) {
      console.error("[tacografo-propuesta] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se ha podido resolver la propuesta" });
    }
  });

  /**
   * Aceptar en bloque, y solo lo que es seguro aceptar en bloque.
   *
   * El filtro no es cosmético: `separarParaBloque` deja fuera las 19
   * discrepancias reales por mucho que individualmente se puedan aceptar.
   * Resolver 19 desacuerdos entre el tacógrafo y TyreControl con un botón es
   * decidir sin mirar, y era una condición explícita del encargo.
   *
   * Si el cuerpo trae `ids`, se aceptan solo esas, y SIEMPRE pasando por el
   * mismo filtro: mandar un id de una discrepancia no la mete en el bloque.
   *
   * Cada una se aplica por su cuenta y con su propio compara-y-cambia. No hay
   * transacción: una que falle no tumba las demás, y se dice cuáles fueron.
   */
  app.post("/api/tyrecontrol/tacografo/propuestas-bloque", ...guards, async (req, res) => {
    try {
      const alcance = await empresaDelInforme(req, req.query.empresa ?? (req as any).body?.empresa);
      if (!alcance.empresa) return res.status(alcance.estado!).json({ error: alcance.error });
      const empresa = alcance.empresa;

      const pedidos = Array.isArray((req.body as any)?.ids)
        ? new Set((req.body as any).ids.map(String)) : null;

      const todas = (await leerPropuestas(empresa, "pendiente")).map(aPropuesta);
      const propuestas = pedidos ? todas.filter((p) => pedidos.has(p.id)) : todas;

      const { candidatas } = await decidirTodas(empresa, propuestas);
      const { aceptables, excluidas } = separarParaBloque(candidatas);

      const aceptadas: Array<{ id: string; matricula: string; medida: string; exacta: boolean }> = [];
      const falladas: Array<{ id: string; matricula: string; motivo: string }> = [];

      for (const c of aceptables) {
        const d = c.decision.resuelta!;
        try {
          const r = await aplicarPropuesta({
            propuestaId: c.propuesta.id, empresa, vehiculoId: c.propuesta.vehiculoId!,
            medidaId: d.medida.id, medidaValor: d.medida.valor, exacta: d.exacta,
            medidaPreviaId: c.propuesta.medidaActualId, usuarioId: usuarioDe(req),
          });
          if (r.ok) {
            aceptadas.push({
              id: c.propuesta.id, matricula: c.propuesta.matriculaNorm,
              medida: d.medida.valor, exacta: d.exacta,
            });
          } else {
            falladas.push({ id: c.propuesta.id, matricula: c.propuesta.matriculaNorm, motivo: r.motivo! });
          }
        } catch (e: any) {
          falladas.push({
            id: c.propuesta.id, matricula: c.propuesta.matriculaNorm,
            motivo: e?.message ?? "Error desconocido",
          });
        }
      }

      res.json({
        ok: true,
        aceptadas,
        falladas,
        // Las que no entraban, con el motivo, para que no parezca que se han
        // olvidado: una discrepancia excluida sigue ahí esperando a que
        // alguien la mire una a una.
        excluidas: excluidas.map((c) => ({
          id: c.propuesta.id, matricula: c.propuesta.matriculaNorm, caso: c.propuesta.caso,
          motivo: c.decision.puede
            ? (c.propuesta.caso === "sin_medida"
                ? "El informe traía avisos en las filas de este vehículo: hay que mirarla."
                : "No es una medida que falte, es un desacuerdo: solo una a una.")
            : (c.decision.explicacion ?? "No se puede aceptar"),
        })),
      });
    } catch (e: any) {
      console.error("[tacografo-bloque] error:", e?.message ?? e);
      res.status(500).json({ error: e?.message || "No se han podido aceptar las propuestas" });
    }
  });
}
