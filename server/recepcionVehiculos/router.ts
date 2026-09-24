/**
 * Recepción rápida de vehículos: la API.
 *
 * Dos puertas con guardas distintos, a propósito:
 *
 *  · `/api/taller-operator/recepcion-vehiculos/*` la usa la APK del patio, con
 *    las credenciales de operario que ya existen (`x-operator-name` /
 *    `x-operator-pin`). No se inventa un quinto modelo de autenticación.
 *  · `/api/recepcion-vehiculos/*` la usa WorkPlanner en el navegador, con el
 *    guarda de supervisor del panel.
 *
 * El nombre largo no es capricho: `server/recepciones/` ya existe y es otra
 * cosa —la recepción física de mercancía de proveedores, montada en
 * `/api/recepciones`—. Dos módulos con el mismo nombre acaban con uno
 * pisando al otro.
 *
 * Quien crea una recepción NO necesita ser supervisor: el que recibe el coche
 * en el patio normalmente no lo es. Quien la convierte en trabajo, sí.
 */

import { Router, json, type RequestHandler, type Response } from "express";
import type multer from "multer";

import db from "../db.ts";
import { hasAi } from "../core/ai.ts";
import { pedirIA } from "../core/openaiService.ts";
import { normalizarMatricula, patronBusquedaMatricula } from "../tyrecontrol/matricula.ts";
import { normalizeRecepcionRow } from "./normaliza.ts";
import {
  esClaveDuplicada,
  INTENTOS_DE_ID,
  siguienteIdDeTrabajo,
} from "../core/idDeTrabajo.ts";
import {
  citasParaRecibir,
  idsDeCitasYaRecibidas,
  kilometrosDeTextoIA,
  matriculaDeTextoIA,
  plantillasParaElPatio,
} from "../../src/modules/recepcionVehiculo.ts";

const ESTADOS = new Set(["pendiente", "convertida", "descartada"]);

/** Columnas de la recepción, en el orden en que se leen siempre. */
const COLUMNAS = `
  id, "workshopId", matricula, "matriculaNormal", "matriculaOcr", "confianzaOcr",
  "clienteNombre", "clienteTelefono", kilometros, "kilometrosOcr", "confianzaKilometrosOcr",
  "scheduledJobId", "vehiculoId", "vehiculoOrigen", area, "plantillaKey",
  "operacionLabel", notas, urgente, fotos, estado, "operarioNombre",
  "creadaAtMs", "resueltaAtMs", "resueltaPor", "motivoDescarte", "jobId"
`;

/**
 * Un 500 con el paso que ha fallado dentro del mensaje.
 *
 * Antes todos los endpoints de este módulo devolvían exactamente «Error en la
 * recepción de vehículos», y con eso en pantalla no hay forma de saber si ha
 * fallado la lista, una edición o la conversión. Costó una tarde averiguar
 * que lo que reventaba era el enlace con la cita.
 *
 * Va el paso, no el error de la base: el mensaje lo lee quien está en el
 * taller, y el detalle sigue yendo al registro del servidor.
 */
function fallo(res: Response, contexto: string, e: unknown) {
  console.error(`[Recepciones] ${contexto}:`, (e as any)?.message ?? e);
  return res
    .status(500)
    .json({ error: `Error en la recepción de vehículos (${contexto})` });
}

function texto(valor: unknown): string {
  return String(valor ?? "").trim();
}

function textoONull(valor: unknown): string | null {
  const t = texto(valor);
  return t === "" ? null : t;
}

/**
 * Entero o null. Nunca 0 por un campo vacío: un cuentakilómetros a cero es una
 * lectura fallida, y guardarlo como dato bueno ensucia el histórico.
 */
function entero(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  const n = Number(String(valor).replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function decimal(valor: unknown): number | null {
  if (valor == null || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * El taller del operario que hace la petición.
 *
 * `requireTallerOperator` deja en la petición el nombre; el taller se consulta
 * aquí. Null significa «el de por defecto», que es como se ha comportado todo
 * hasta que la columna existió.
 */
async function tallerDelOperario(req: any): Promise<string | null> {
  const nombre = String(req?.roadsideOperator?.techName ?? "").trim();
  if (!nombre) return null;
  const r = await db.query(
    `SELECT "workshopId" FROM techs WHERE name = $1 LIMIT 1`,
    [nombre]
  );
  const w = r.rows[0]?.workshopId;
  return w == null || w === "" ? null : String(w);
}

export type DependenciasRecepcionVehiculos = {
  requireTallerOperator: RequestHandler;
  requireSupervisorRole: RequestHandler;
  /** Reintento de la cola offline: devuelve lo ya guardado, si lo hay. */
  respuestaIdempotente: (req: any) => Promise<any>;
  guardarIdempotencia: (req: any, respuesta: unknown) => Promise<void>;
  upload: multer.Multer;
  /** Sube el buffer al almacenamiento y devuelve la URL pública. */
  subirFoto: (ruta: string, buffer: Buffer, contentType: string) => Promise<string>;
  /** Nombre del usuario del panel, para dejar constancia de quién resolvió. */
  nombreDelPanel: (req: any) => string;
};

export function createRecepcionVehiculosRouter(dep: DependenciasRecepcionVehiculos): Router {
  const r = Router();
  r.use(json({ limit: "15mb" }));

  const {
    requireTallerOperator,
    requireSupervisorRole,
    respuestaIdempotente,
    guardarIdempotencia,
    upload,
    subirFoto,
    nombreDelPanel,
  } = dep;

  /* ── APK ──────────────────────────────────────────────────────────────── */

  /**
   * El catálogo de operaciones que ve el operario.
   *
   * Sale de `quick_templates`, que es lo que el taller ya mantiene: no hay un
   * catálogo paralelo escrito a mano en la APK. Y sale **sin `unitPrice`**: en
   * la pantalla del técnico no se enseñan precios, tarifas ni importes.
   */
  r.get("/taller-operator/recepcion-vehiculos/catalogo", requireTallerOperator, async (req, res) => {
    try {
      /*
       * El taller sale del OPERARIO, no de lo que mande la APK.
       *
       * Antes venía por query y la app lo preguntaba con un desplegable, que
       * es preguntar dos veces lo mismo: el técnico ya pertenece a un taller.
       * Y un taller que se puede mandar es un taller que se puede equivocar.
       */
      const workshopId = await tallerDelOperario(req);
      /*
       * `SELECT *`, sin nombrar ni una columna, y la forma se decide en
       * JavaScript. No es pereza: es lo único que aguanta el esquema real de
       * esta tabla.
       *
       * `db.ts` crea `quick_templates` con ocho columnas. El resto del código
       * escribe y lee otras tres —usesQuantity, unitMinutes, unitPrice— que
       * ninguna migración añade, y el navegador filtra por un `workshopId`
       * que tampoco está en el CREATE. En Postgres, nombrar una columna que
       * no existe no devuelve null: tumba la consulta ENTERA.
       *
       * Este endpoint dejó el desplegable del patio vacío DOS veces por eso:
       * primero por `usesQuantity`, y después por `workshopId`, que seguía en
       * el WHERE cuando se quitó la primera. El endpoint de plantillas que
       * lleva años funcionando hace exactamente esto, y por eso nunca se ha
       * roto.
       *
       * `plantillasParaElPatio` hace el filtro por taller y deja fuera los
       * precios; vive en src/modules porque así se puede probar sin base de
       * datos.
       */
      const filas = await db.query(
        `SELECT * FROM quick_templates ORDER BY id ASC`
      );
      res.json(plantillasParaElPatio(filas.rows, workshopId));
    } catch (e) {
      fallo(res, "catalogo", e);
    }
  });

  /**
   * ¿Conocemos este vehículo?
   *
   * `roadside_vehicles` no guarda la matrícula normalizada, así que no se puede
   * comparar por igualdad. Se usa el patrón con comodines que ya existe para
   * TyreControl (filtra en el servidor en vez de traerse la flota entera) y la
   * coincidencia exacta se confirma después.
   */
  r.get("/taller-operator/recepcion-vehiculos/vehiculo", requireTallerOperator, async (req, res) => {
    try {
      const buscada = texto((req.query as any)?.matricula);
      const patron = patronBusquedaMatricula(buscada);
      // Menos de 4 caracteres traería media tabla y no diría nada útil.
      if (!patron) return res.json({ vehiculo: null });

      const filas = await db.query(
        `SELECT id, plate, name FROM roadside_vehicles
          WHERE active AND plate ILIKE $1 LIMIT 20`,
        [patron]
      );
      const objetivo = normalizarMatricula(buscada);
      const fila = filas.rows.find((v: any) => normalizarMatricula(v.plate) === objetivo);

      res.json({
        vehiculo: fila
          ? {
              id: String(fila.id),
              matricula: String(fila.plate ?? ""),
              clienteNombre: textoONull(fila.name),
              origen: "roadside",
            }
          : null,
      });
    } catch (e) {
      fallo(res, "vehiculo", e);
    }
  });

  /**
   * Las citas de hoy que el operario puede recibir en el patio.
   *
   * Se sirven las del día que pida la APK —su fecha local, no la del
   * servidor: el taller y el servidor no tienen por qué estar en la misma
   * zona horaria, y a las once de la noche eso son dos días distintos—.
   *
   * El filtro de qué es recibible vive en `citasParaRecibir`, en src/modules,
   * porque es la regla que impide el trabajo duplicado y conviene poder
   * probarla sin base de datos.
   */
  r.get("/taller-operator/recepcion-vehiculos/citas", requireTallerOperator, async (req, res) => {
    try {
      const dia = texto((req.query as any)?.dia);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
        return res.status(400).json({ error: "Falta el día (AAAA-MM-DD)" });
      }
      // Del operario, igual que el catálogo: el técnico ya pertenece a un
      // taller y preguntárselo sería preguntar dos veces lo mismo.
      const workshopId = await tallerDelOperario(req);

      // Igual que el endpoint del panel: el JSONB se devuelve tal cual y la
      // forma se decide en JavaScript. Esta tabla no tiene columnas que
      // nombrar, todo vive dentro de `data`.
      const filas = await db.query(
        `SELECT data FROM scheduled_jobs
          WHERE COALESCE(data::jsonb->>'status', '') <> 'eliminado'
            AND data::jsonb->>'deletedAtMs' IS NULL`
      );

      /*
       * Las que ya están recibidas y esperando validación salen de la lista.
       * La cita no se cierra hasta que la oficina convierte la recepción, y
       * entre el patio y la oficina pueden pasar horas: sin esto, otro
       * operario podría recibir el mismo vehículo por segunda vez.
       */
      const recibidas = await db.query(
        `SELECT estado, "scheduledJobId" FROM recepciones_vehiculo
          WHERE estado = 'pendiente'
            AND "scheduledJobId" IS NOT NULL
            AND "deletedAtMs" IS NULL`
      );

      const citas = citasParaRecibir(
        filas.rows.map((f: any) => f.data),
        dia,
        workshopId,
        idsDeCitasYaRecibidas(
          recibidas.rows.map((r: any) => ({
            estado: String(r.estado),
            scheduledJobId: Number(r.scheduledJobId),
          }))
        )
      );

      // Solo lo que el operario necesita para reconocer el vehículo. Nada de
      // precios ni de datos del trabajo.
      res.json(
        citas.map((c) => ({
          id: Number(c.id),
          plate: c.plate ?? "",
          startTime: c.startTime ?? "",
          customerName: c.customerName ?? "",
          customerPhone: (c as any).customerPhone ?? "",
          templateLabel: c.templateLabel ?? "",
          templateKey: c.templateKey ?? "",
          area: c.area ?? "",
        }))
      );
    } catch (e) {
      fallo(res, "citas", e);
    }
  });

  /** Crear la recepción. Idempotente: un reintento de la cola no crea otra. */
  r.post("/taller-operator/recepcion-vehiculos", requireTallerOperator, async (req, res) => {
    try {
      const yaCreada = await respuestaIdempotente(req);
      if (yaCreada) return res.json(yaCreada);

      const { techName } = (req as any).roadsideOperator as { techName: string };
      const body = (req.body ?? {}) as Record<string, unknown>;

      const matricula = texto(body.matricula).toUpperCase();
      if (!matricula) {
        return res.status(400).json({ error: "La matrícula es obligatoria" });
      }

      const ahora = Date.now();
      const confianza = Number(body.confianzaOcr);
      // El taller del operario manda sobre lo que venga en el cuerpo: es dato
      // de quién lo envía, no del formulario.
      const tallerOperario = await tallerDelOperario(req);

      const fila = await db.query(
        `INSERT INTO recepciones_vehiculo (
           id, "workshopId", matricula, "matriculaNormal", "matriculaOcr",
           "confianzaOcr", "clienteNombre", "clienteTelefono", kilometros, "kilometrosOcr",
           "confianzaKilometrosOcr", "scheduledJobId", "vehiculoId",
           "vehiculoOrigen", area, "plantillaKey", "operacionLabel", notas,
           urgente, fotos, estado, "operarioNombre", "creadaAtMs"
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'[]'::jsonb,
           'pendiente',$20,$21
         ) RETURNING ${COLUMNAS}`,
        [
          ahora,
          tallerOperario ?? textoONull(body.workshopId),
          matricula,
          normalizarMatricula(matricula),
          textoONull(body.matriculaOcr),
          Number.isFinite(confianza) ? confianza : null,
          textoONull(body.clienteNombre),
          textoONull(body.clienteTelefono),
          entero(body.kilometros),
          entero(body.kilometrosOcr),
          decimal(body.confianzaKilometrosOcr),
          entero(body.scheduledJobId),
          textoONull(body.vehiculoId),
          textoONull(body.vehiculoOrigen),
          textoONull(body.area),
          textoONull(body.plantillaKey),
          textoONull(body.operacionLabel),
          textoONull(body.notas),
          body.urgente === true || body.urgente === "true",
          texto(techName),
          ahora,
        ]
      );

      const creada = normalizeRecepcionRow(fila.rows[0]);
      await guardarIdempotencia(req, creada);
      res.json(creada);
    } catch (e) {
      fallo(res, "crear", e);
    }
  });

  /** Las recepciones de este operario, para que vea que llegaron. */
  r.get("/taller-operator/recepcion-vehiculos/mias", requireTallerOperator, async (req, res) => {
    try {
      const { techName } = (req as any).roadsideOperator as { techName: string };
      const filas = await db.query(
        `SELECT ${COLUMNAS} FROM recepciones_vehiculo
          WHERE "operarioNombre" = $1 AND "deletedAtMs" IS NULL
          ORDER BY "creadaAtMs" DESC LIMIT 50`,
        [texto(techName)]
      );
      res.json(filas.rows.map(normalizeRecepcionRow));
    } catch (e) {
      fallo(res, "mias", e);
    }
  });

  /** Fotos del estado del vehículo. Mismo camino que las de un trabajo. */
  r.post(
    "/taller-operator/recepcion-vehiculos/:id/fotos",
    requireTallerOperator,
    upload.single("file"),
    async (req, res) => {
      try {
        const yaHecho = await respuestaIdempotente(req);
        if (yaHecho) return res.json(yaHecho);

        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: "ID no válido" });
        if (!req.file) return res.status(400).json({ error: "No se recibió archivo" });

        const extPorTipo: Record<string, string> = {
          "image/jpeg": "jpg",
          "image/png": "png",
          "image/webp": "webp",
        };
        const ext = extPorTipo[req.file.mimetype] ?? "jpg";
        const url = await subirFoto(
          `recepciones/${id}/foto_${Date.now()}.${ext}`,
          req.file.buffer,
          req.file.mimetype
        );

        const foto = {
          url,
          nombre: req.file.originalname ?? null,
          creadaAtMs: Date.now(),
        };

        // Se añade a la lista; no se sustituye la colección entera, que es
        // como se pierden las fotos que subió otro a la vez.
        const fila = await db.query(
          `UPDATE recepciones_vehiculo
              SET fotos = COALESCE(fotos, '[]'::jsonb) || $2::jsonb
            WHERE id = $1 AND "deletedAtMs" IS NULL
            RETURNING ${COLUMNAS}`,
          [id, JSON.stringify([foto])]
        );
        if (fila.rowCount === 0) {
          return res.status(404).json({ error: "Recepción no encontrada" });
        }

        await guardarIdempotencia(req, foto);
        res.json(foto);
      } catch (e) {
        fallo(res, "fotos", e);
      }
    }
  );

  /**
   * Leer la matrícula de una foto.
   *
   * **No guarda nada.** Devuelve lo que ha leído para que la APK se lo enseñe
   * al operario en un campo editable. Nunca se envía una matrícula de OCR sin
   * que una persona la haya visto.
   */
  r.post("/taller-operator/recepcion-vehiculos/ocr-matricula", requireTallerOperator, async (req, res) => {
    try {
      const imagen = texto((req.body as any)?.imagen);
      if (!imagen) return res.status(400).json({ error: "Falta la imagen" });
      // Sin clave de IA el flujo sigue: la matrícula se teclea. El OCR es una
      // comodidad, no una dependencia.
      if (!hasAi()) return res.json({ matricula: null, confianza: 0 });

      /*
       * Se lee EXACTAMENTE como lo hace Mobilink Assist en el arcén
       * (`detectPlateFromImage`, server/index.ts): respuesta en texto plano,
       * NONE cuando no hay nada, y tokens de sobra.
       *
       * Antes se pedía un JSON con una «confianza» y un tope de 200 tokens, y
       * las dos cosas quitaban lecturas buenas. La confianza es un número que
       * el modelo se inventa —leyó 4810CCV donde ponía 4610CCV y lo dio con
       * 0.99—, así que no filtraba ni un error. Y 200 tokens es un cepo con un
       * modelo razonador: lo que piensa antes de contestar también cuenta, se
       * queda sin presupuesto a mitad del JSON, la respuesta no parsea y al
       * operario le sale que en la foto no se ve ninguna matrícula. Se veía.
       *
       * La regla del camión y el remolque tampoco es adorno: aquí entran
       * tractoras con placa roja detrás, y sin decirle cuál queremos devuelve
       * la que le apetece.
       */
      const r = await pedirIA({
        operacion: "recepcion.ocrMatricula",
        proposito: "documento",
        prompt:
          "Esta es la foto de la matrícula de un vehículo que entra en un " +
          "taller. En España la matrícula BLANCA es la del CAMIÓN o del coche " +
          "y la ROJA es la del REMOLQUE: si se ven las dos, devuelve SOLO la " +
          "BLANCA. Puede ser una matrícula moderna (1234BCD), una antigua con " +
          "letras de provincia (T-1234-AB) o una placa extranjera. " +
          "Responde EXCLUSIVAMENTE con el texto de la matrícula, sin espacios " +
          "ni guiones, o con la palabra NONE si en la imagen no hay ninguna " +
          "matrícula legible. Da tu mejor lectura aunque la foto no sea " +
          "perfecta: quien la ha hecho tiene el vehículo delante y la va a " +
          "comprobar. No te inventes una matrícula que no esté.",
        imagenes: [{ url: imagen }],
        maxTokens: 2000,
      });

      /*
       * `confianza` se sigue devolviendo porque la APK y la columna de la
       * tabla la esperan, pero ya no significa nada: en texto plano el modelo
       * no la da, y cuando la daba no valía para decidir. Quien decide si la
       * matrícula es la buena es la persona del patio, y por eso el campo es
       * editable y pone «compruébala».
       */
      // Un fallo del proveedor y una foto sin matrícula acaban los dos en
      // `matricula: null`, y al operario se le enseña lo mismo. En el log no:
      // ahí sí queda el motivo, que es lo que faltaba para poder mirarlo.
      if (!r.ok) console.error("[Recepciones] ocr-matricula:", r.error);

      res.json({ matricula: matriculaDeTextoIA(r.texto), confianza: null });
    } catch (e) {
      // Que falle la IA no puede bloquear una recepción: se teclea y ya está.
      console.error("[Recepciones] ocr:", (e as any)?.message ?? e);
      res.json({ matricula: null, confianza: 0 });
    }
  });

  /**
   * Leer el cuentakilómetros de una foto del cuadro.
   *
   * Mismo trato que la matrícula: **no guarda nada**. Devuelve lo leído para
   * que la APK se lo enseñe al operario en un campo editable, porque un OCR de
   * un cuadro con reflejos se come un dígito sin despeinarse y un kilometraje
   * mal metido contamina el histórico del vehículo.
   */
  r.post(
    "/taller-operator/recepcion-vehiculos/ocr-kilometros",
    requireTallerOperator,
    async (req, res) => {
      try {
        const imagen = texto((req.body as any)?.imagen);
        if (!imagen) return res.status(400).json({ error: "Falta la imagen" });
        if (!hasAi()) return res.json({ kilometros: null, confianza: 0 });

        // Texto plano y tokens de sobra, por lo mismo que la matrícula.
        const r = await pedirIA({
          operacion: "recepcion.ocrKilometros",
          proposito: "documento",
          prompt:
            "Esta es la foto del cuadro de un vehículo que entra en un taller. " +
            "Lee el ODÓMETRO TOTAL: no el parcial (trip), no la temperatura, " +
            "no la velocidad y no la hora. Si marca kilómetros y décimas, " +
            "quédate solo con los kilómetros enteros. Responde " +
            "EXCLUSIVAMENTE con el número, sin puntos ni comas ni la palabra " +
            "km, o con NONE si no se lee el cuentakilómetros.",
          imagenes: [{ url: imagen }],
          maxTokens: 2000,
        });

        // El filtro de sensatez (cero, topes) es el mismo que aplica la APK a
        // lo que se teclea, y vive en el módulo de lógica pura.
        if (!r.ok) console.error("[Recepciones] ocr-kilometros:", r.error);

        res.json({ kilometros: kilometrosDeTextoIA(r.texto), confianza: null });
      } catch (e) {
        // Que falle la IA no puede bloquear una recepción: se teclea y ya está.
        console.error("[Recepciones] ocr-kilometros:", (e as any)?.message ?? e);
        res.json({ kilometros: null, confianza: 0 });
      }
    }
  );

  /* ── Panel ────────────────────────────────────────────────────────────── */

  /** La bandeja. */
  r.get("/recepcion-vehiculos", requireSupervisorRole, async (req, res) => {
    try {
      const estado = texto((req.query as any)?.estado) || "pendiente";
      if (!ESTADOS.has(estado) && estado !== "todas") {
        return res.status(400).json({ error: "Estado no válido" });
      }
      const workshopId = textoONull((req.query as any)?.workshopId);

      const filas = await db.query(
        `SELECT ${COLUMNAS} FROM recepciones_vehiculo
          WHERE "deletedAtMs" IS NULL
            AND ($1::text = 'todas' OR estado = $1)
            -- Una recepción SIN taller se ve desde cualquiera.
            --
            -- Si no, desaparece: el operario que la manda puede no tener
            -- taller asignado —la columna es nueva y está en NULL para todos
            -- hasta que alguien la rellene—, y entonces la recepción se
            -- guarda sin taller. Filtrando por igualdad, los nulos quedan
            -- fuera y Operativo 2 enseñaba «Pendientes de recepción (0)»
            -- mientras la bandeja, que no filtra, la enseñaba perfectamente.
            --
            -- Es el mismo criterio que con las plantillas: sin taller = de
            -- todos. Más vale verla de más que no verla.
            AND ($2::text IS NULL OR "workshopId" = $2 OR "workshopId" IS NULL)
          ORDER BY "creadaAtMs" DESC LIMIT 300`,
        [estado, workshopId]
      );
      res.json(filas.rows.map(normalizeRecepcionRow));
    } catch (e) {
      fallo(res, "bandeja", e);
    }
  });

  r.get("/recepcion-vehiculos/:id", requireSupervisorRole, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "ID no válido" });
      const filas = await db.query(
        `SELECT ${COLUMNAS} FROM recepciones_vehiculo
          WHERE id = $1 AND "deletedAtMs" IS NULL`,
        [id]
      );
      if (filas.rowCount === 0) return res.status(404).json({ error: "No encontrada" });
      res.json(normalizeRecepcionRow(filas.rows[0]));
    } catch (e) {
      fallo(res, "detalle", e);
    }
  });

  /**
   * Corregir lo que el operario no pudo saber desde el patio.
   *
   * `COALESCE` en todos los campos: lo que no venga en el cuerpo se queda como
   * estaba. Sin eso, guardar sólo el área borraría el cliente.
   */
  r.put("/recepcion-vehiculos/:id", requireSupervisorRole, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "ID no válido" });
      const body = (req.body ?? {}) as Record<string, unknown>;

      const matricula = body.matricula === undefined ? null : texto(body.matricula).toUpperCase();
      if (matricula !== null && matricula === "") {
        return res.status(400).json({ error: "La matrícula no puede quedar vacía" });
      }

      const filas = await db.query(
        `UPDATE recepciones_vehiculo SET
           matricula = COALESCE($2, matricula),
           "matriculaNormal" = COALESCE($3, "matriculaNormal"),
           "clienteNombre" = COALESCE($4, "clienteNombre"),
           "clienteTelefono" = COALESCE($11, "clienteTelefono"),
           area = COALESCE($5, area),
           "plantillaKey" = COALESCE($6, "plantillaKey"),
           "operacionLabel" = COALESCE($7, "operacionLabel"),
           notas = COALESCE($8, notas),
           urgente = COALESCE($9, urgente),
           kilometros = COALESCE($10, kilometros)
         WHERE id = $1 AND "deletedAtMs" IS NULL AND estado = 'pendiente'
         RETURNING ${COLUMNAS}`,
        [
          id,
          matricula,
          matricula === null ? null : normalizarMatricula(matricula),
          body.clienteNombre === undefined ? null : textoONull(body.clienteNombre),
          body.area === undefined ? null : textoONull(body.area),
          body.plantillaKey === undefined ? null : textoONull(body.plantillaKey),
          body.operacionLabel === undefined ? null : textoONull(body.operacionLabel),
          body.notas === undefined ? null : textoONull(body.notas),
          body.urgente === undefined ? null : body.urgente === true || body.urgente === "true",
          body.kilometros === undefined ? null : entero(body.kilometros),
          body.clienteTelefono === undefined ? null : textoONull(body.clienteTelefono),
        ]
      );
      if (filas.rowCount === 0) {
        return res.status(409).json({ error: "La recepción ya está resuelta" });
      }
      res.json(normalizeRecepcionRow(filas.rows[0]));
    } catch (e) {
      fallo(res, "editar", e);
    }
  });

  /**
   * Convertir la recepción en trabajo.
   *
   * El trabajo llega ya montado desde el navegador, que es donde vive el motor
   * de asignación y donde se le ha puesto la propuesta de técnico explicada,
   * igual que hace la pantalla de partes de trabajo. Aquí sólo se escribe, y
   * se escribe **en una sola transacción**: si se insertara el trabajo y luego
   * fallara el marcado de la recepción, quedaría convertible otra vez y
   * saldrían dos técnicos para el mismo camión.
   *
   * El `UPDATE` es condicional (`estado = 'pendiente'`). Si dos personas
   * pulsan "convertir" a la vez, una gana y la otra recibe 409.
   */
  r.post("/recepcion-vehiculos/:id/convertir", requireSupervisorRole, async (req, res) => {
    const cliente = await db.connect();
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "ID no válido" });
      const job = (req.body ?? {}) as Record<string, any>;
      /*
       * El id lo pone el SERVIDOR, no el navegador, pero NO con `Date.now()`.
       *
       * Las dos cosas que se han probado aquí eran malas por motivos
       * distintos:
       *
       *  · El navegador lo calculaba como «el mayor de los trabajos que veo,
       *    más uno». Con la lista vacía —o filtrada por taller, o con todo
       *    cerrado— eso da 1, y el 1 ya existe: clave duplicada.
       *  · Lo cambié a `Date.now()` y fue peor: `jobs.id` es SERIAL, o sea
       *    INTEGER de cuatro bytes, y el máximo que admite es 2.147.483.647.
       *    Un `Date.now()` anda por 1.758.000.000.000, mil veces más. Postgres
       *    lo rechaza con «integer out of range», la transacción entera se cae
       *    y en pantalla sale «Error en la recepción de vehículos (convertir)».
       *    La conversión no ha funcionado NUNCA desde ese cambio.
       *
       * Se numera como numera el resto del panel —el máximo de la tabla más
       * uno— pero preguntándoselo a la BASE, no a lo que el navegador alcance
       * a ver, que es lo que fallaba al principio. Y vale igual si algún día
       * la columna pasa a BIGINT.
       */
      // La regla vive en `server/core/idDeTrabajo.ts`, con el porqué. Aquí
      // solo se usa, que es lo que evita que vuelva a divergir entre los dos
      // sitios que dan de alta trabajos.
      // El trabajo nace en validacion: es una propuesta, y una propuesta la
      // autoriza una persona en la pantalla de siempre.
      if (String(job.status) !== "validacion") {
        return res.status(400).json({ error: "El trabajo debe nacer en validación" });
      }

      await cliente.query("BEGIN");

      const actual = await cliente.query(
        `SELECT ${COLUMNAS} FROM recepciones_vehiculo
          WHERE id = $1 AND "deletedAtMs" IS NULL AND estado = 'pendiente'
          FOR UPDATE`,
        [id]
      );
      if (actual.rowCount === 0) {
        await cliente.query("ROLLBACK");
        return res.status(409).json({ error: "La recepción ya está convertida o descartada" });
      }
      const recepcion = normalizeRecepcionRow(actual.rows[0]);
      const ahora = Date.now();

      /*
       * Se reintenta si otro se lleva el número entre el SELECT y el INSERT.
       *
       * Dos personas convirtiendo a la vez leen el mismo máximo y la segunda
       * choca contra la clave primaria. Es raro —convertir lo hace una
       * persona mirando la pantalla— pero el coste de cubrirlo es un bucle y
       * el de no cubrirlo es un error que no se entiende.
       *
       * Solo se repite ante clave duplicada (SQLSTATE 23505). Cualquier otro
       * fallo sube tal cual: repetir un error de columna o de tipo no lo
       * arregla, solo lo esconde tres veces.
       */
      let jobId = 0;
      for (let intento = 1; ; intento++) {
        jobId = await siguienteIdDeTrabajo(cliente);
        try {
          await cliente.query(`SAVEPOINT alta_trabajo`);
          await cliente.query(
            `INSERT INTO jobs (
               id, area, plate, urgent, status, "assignedNames", reason,
               "customerName", "customerPhone", "createdAtMs",
               "workedAccumulatedMinutes", "pausedAccumulatedMinutes",
               "workshopId", "quickEntryLabel", "quickEntryMode",
               quantity, "unitMinutes", "ptEntradaMs", "recepcionId"
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,0,$11,$12,$13,$14,$15,$16,$17)`,
            [
              jobId,
              texto(job.area) || "mecanica",
              texto(job.plate).toUpperCase(),
              job.urgent === true,
              "validacion",
              JSON.stringify(Array.isArray(job.assignedNames) ? job.assignedNames : []),
              texto(job.reason),
              texto(job.customerName),
              texto(job.customerPhone) || texto(recepcion.clienteTelefono),
              Number(job.createdAtMs) || ahora,
              textoONull(job.workshopId ?? recepcion.workshopId),
              textoONull(job.quickEntryLabel),
              texto(job.quickEntryMode) || "team",
              Number.isFinite(Number(job.quantity)) ? Number(job.quantity) : 1,
              // `standardMinutes` NO es columna de `jobs`: es de
              // `quick_templates`. Nombrarla aquí tumbaba la consulta entera.
              // El tiempo total sale de quantity x unitMinutes, que es como lo
              // calcula el resto del panel.
              Number.isFinite(Number(job.unitMinutes)) ? Number(job.unitMinutes) : null,
              recepcion.creadaAtMs,
              id,
            ]
          );
          await cliente.query(`RELEASE SAVEPOINT alta_trabajo`);
          break;
        } catch (e) {
          // Sin el savepoint la transacción se queda abortada y ya no admite
          // ni el reintento: en Postgres, un error dentro de una transacción
          // la invalida entera hasta el ROLLBACK.
          await cliente.query(`ROLLBACK TO SAVEPOINT alta_trabajo`);
          if (!esClaveDuplicada(e) || intento >= INTENTOS_DE_ID) throw e;
        }
      }

      // Las fotos del patio se enganchan al trabajo por referencia: ya están
      // subidas, volver a subirlas sólo duplicaría ficheros.
      for (const foto of recepcion.fotos) {
        const url = texto((foto as any)?.url);
        if (!url) continue;
        await cliente.query(
          `INSERT INTO job_files ("jobId", url, "fileName", "techName", "createdAtMs", tipo)
           VALUES ($1,$2,$3,$4,$5,'foto')`,
          [jobId, url, textoONull((foto as any)?.nombre), recepcion.operarioNombre, ahora]
        );
      }

      /*
       * ── Cerrar la cita, si la recepción salió de una ─────────────────────
       *
       * Sin esto, la cita sigue en «Llegadas» con su botón «Llegó», y ese
       * botón crea un trabajo por su cuenta: dos trabajos para el mismo
       * vehículo, uno por cada puerta. `confirmScheduledArrival` se retira en
       * cuanto la cita tiene `jobId`, así que escribirlo aquí es lo que cierra
       * esa puerta.
       *
       * Va DENTRO de la transacción a propósito: si se hiciera después y
       * fallara, quedaría el trabajo creado y la cita abierta, que es
       * justamente el estado que esto evita.
       *
       * `scheduled_jobs` no tiene columnas: es un JSONB, así que se escribe
       * con `jsonb_set`. Y se exige que la cita siga sin trabajo —el
       * `->>'jobId' IS NULL`—: si alguien pulsó «Llegó» mientras el vehículo
       * estaba en el patio, gana lo que ya se hizo y aquí no se pisa nada.
       */
      if (recepcion.scheduledJobId != null) {
        /*
         * La cita se modifica en JavaScript, no con `jsonb_set`.
         *
         * `scheduled_jobs.data` guarda el JSON como TEXTO, no como JSONB: por
         * eso todo el resto del código lo lee con `data::jsonb->>'…'` —el
         * cast sobra en una columna jsonb— y lo escribe con `JSON.stringify`.
         * Asignarle el resultado de `jsonb_set` reventaba con «column data is
         * of type text but expression is of type jsonb», y como el fallo
         * ocurría DENTRO de la transacción, la conversión entera se caía: la
         * recepción se quedaba pendiente y en pantalla solo salía un error
         * genérico.
         *
         * Se lee la fila bloqueada, se toca el JSON aquí y se vuelve a
         * escribir como texto, que es lo que hace el endpoint de la agenda
         * desde siempre. Así da igual el tipo de la columna.
         */
        const filaCita = await cliente.query(
          `SELECT data FROM scheduled_jobs WHERE id = $1 FOR UPDATE`,
          [recepcion.scheduledJobId]
        );

        let yaTenia = true;
        if (filaCita.rowCount && filaCita.rowCount > 0) {
          const cruda = filaCita.rows[0].data;
          const datos =
            typeof cruda === "string" ? JSON.parse(cruda) : { ...(cruda ?? {}) };

          // Si la cita ya tiene trabajo, alguien pulsó «Llegó» mientras el
          // vehículo estaba en el patio. Gana lo que ya se hizo.
          if (datos.jobId == null) {
            datos.jobId = jobId;
            await cliente.query(
              `UPDATE scheduled_jobs
                  SET data = $2, "updatedAtMs" = $3
                WHERE id = $1`,
              [recepcion.scheduledJobId, JSON.stringify(datos), ahora]
            );
            yaTenia = false;
          }
        }

        const cita = { rowCount: yaTenia ? 0 : 1 };
        if (cita.rowCount === 0) {
          // No es un error: la cita pudo confirmarse por el otro camino
          // mientras el vehículo esperaba. Se deja constancia y se sigue.
          console.warn(
            `[Recepciones] la cita ${recepcion.scheduledJobId} ya tenía trabajo; ` +
              `la recepción ${id} se convierte igual en el trabajo ${jobId}.`
          );
        }
      }

      const marcada = await cliente.query(
        `UPDATE recepciones_vehiculo
            SET estado = 'convertida', "jobId" = $2,
                "resueltaAtMs" = $3, "resueltaPor" = $4
          WHERE id = $1 AND estado = 'pendiente'
          RETURNING ${COLUMNAS}`,
        [id, jobId, ahora, nombreDelPanel(req)]
      );
      if (marcada.rowCount === 0) {
        // Alguien la resolvió entre el SELECT y esto. No se deja a medias.
        await cliente.query("ROLLBACK");
        return res.status(409).json({ error: "La recepción ya está convertida o descartada" });
      }

      await cliente.query("COMMIT");
      res.json({ recepcion: normalizeRecepcionRow(marcada.rows[0]), jobId });
    } catch (e) {
      try {
        await cliente.query("ROLLBACK");
      } catch {
        /* la conexión ya estaba perdida */
      }
      fallo(res, "convertir", e);
    } finally {
      cliente.release();
    }
  });

  /** Descartar, con motivo: un vehículo que se fue, un aviso repetido. */
  r.post("/recepcion-vehiculos/:id/descartar", requireSupervisorRole, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "ID no válido" });
      const motivo = texto((req.body as any)?.motivo);
      if (!motivo) return res.status(400).json({ error: "Hace falta un motivo" });

      const filas = await db.query(
        `UPDATE recepciones_vehiculo
            SET estado = 'descartada', "motivoDescarte" = $2,
                "resueltaAtMs" = $3, "resueltaPor" = $4
          WHERE id = $1 AND "deletedAtMs" IS NULL AND estado = 'pendiente'
          RETURNING ${COLUMNAS}`,
        [id, motivo, Date.now(), nombreDelPanel(req)]
      );
      if (filas.rowCount === 0) {
        return res.status(409).json({ error: "La recepción ya está resuelta" });
      }
      res.json(normalizeRecepcionRow(filas.rows[0]));
    } catch (e) {
      fallo(res, "descartar", e);
    }
  });

  return r;
}
