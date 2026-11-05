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
import {
  SISTEMA_ORIGEN, leerBases, leerBloqueadasDeLote, leerFilasDeLote, leerFlotaConBase,
  leerIntervenciones, leerLote, leerLotes, leerPropuestasDeLote, leerRegla,
  leerVehiculo, leerVehiculos, leerYaImportados,
} from "./datos.ts";
import {
  construirControl, fichaDe, type IntervencionTac, type VehiculoTac,
} from "./control.ts";
import type { EstadoTacografo } from "./vencimiento.ts";
import { evaluar } from "./deshacer.ts";
import { borrarLote, cerrarLote, crearLote, guardarBloqueadas, insertarFilas } from "./escribir.ts";
import { preparar } from "./importar.ts";
import { ErrorFichero, leerHoja, type Lectura } from "./parser.ts";
import { simular } from "./simular.ts";

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
        const [vehiculos, yaImportados, regla] = await Promise.all([
          leerVehiculos(empresa),
          leerYaImportados(empresa, SISTEMA_ORIGEN),
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

        const [vehiculos, yaImportados, regla] = await Promise.all([
          leerVehiculos(empresa),
          leerYaImportados(empresa, SISTEMA_ORIGEN),
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
        });

        const { insertadas, duplicadas } = await insertarFilas(prep.insertar);

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
      const [filas, propuestas] = lote
        ? await Promise.all([leerFilasDeLote(loteId), leerPropuestasDeLote(loteId)])
        : [[], []];

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
}
