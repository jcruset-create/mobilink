/**
 * API de Mobilink Cash: `/api/cash/*`.
 *
 * Todas las rutas pasan por `authenticate` (sesión unificada de Supabase),
 * `requireModule("cash")` (licencia vigente) y `cargarPermisosCaja`. Es el
 * mismo encadenado que usan los demás módulos del SaaS; no hay puerta trasera.
 *
 * El router valida forma (que los números sean números, que las líneas de
 * denominación estén bien construidas) y delega TODO lo demás en el servicio,
 * que es quien decide con la jornada bloqueada. Aquí no hay ni una regla de
 * negocio: si la hubiera, existirían dos sitios donde mirar cuando algo cuadre
 * mal.
 */

import { Router, type Request, type Response } from "express";
import pool from "../db.ts";
import { authenticate, requireModule } from "../core/auth.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import { cargarPermisosCaja, exigirPermiso } from "./permissions.ts";
import { ErrorCaja, cargarDenominaciones, obtenerSesion, sesionAbierta, movimientosDeSesion } from "./repository.ts";
import type { LineaDenominacion } from "./domain/inventory.ts";
import { CAMBIO_MAXIMO_CENTIMOS } from "./domain/change.ts";
import * as servicio from "./service.ts";
import * as config from "./config.ts";
import { conectorPara, configuracionErp, conectoresDisponibles, estadoIntegracion } from "./erp/registry.ts";
import { procesarOutbox, reintentarErrores } from "./erp/worker.ts";

// ── Validación de entrada ──────────────────────────────────────────────────

function entero(v: unknown, campo: string): number {
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isSafeInteger(n)) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo} tiene que ser un número entero.`, 400);
  }
  return n;
}

function enteroPositivo(v: unknown, campo: string): number {
  const n = entero(v, campo);
  if (n <= 0) throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo} tiene que ser mayor que cero.`, 400);
  return n;
}

/**
 * Líneas de denominación. Se valida la forma con cuidado porque es la entrada
 * que acaba convertida en movimientos de dinero: un `cantidad: "3"` que se
 * cuele haría que `valor * cantidad` fuera una concatenación de texto.
 */
function lineas(v: unknown, campo: string): LineaDenominacion[] {
  if (v == null) return [];
  if (!Array.isArray(v)) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo} tiene que ser una lista de denominaciones.`, 400);
  }
  return v.map((l, i) => {
    if (!l || typeof l !== "object") {
      throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo}[${i}] no es una línea válida.`, 400);
    }
    const valor = enteroPositivo((l as Record<string, unknown>).valor, `${campo}[${i}].valor`);
    const cantidad = entero((l as Record<string, unknown>).cantidad, `${campo}[${i}].cantidad`);
    if (cantidad < 0) {
      throw new ErrorCaja("ENTRADA_NO_VALIDA", `${campo}[${i}].cantidad no puede ser negativa.`, 400);
    }
    return { valor, cantidad };
  }).filter((l) => l.cantidad > 0);
}

function formasPago(v: unknown): { forma: never; importe: number; referencia?: string | null }[] {
  if (!Array.isArray(v) || v.length === 0) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Hay que indicar al menos una forma de pago.", 400);
  }
  return v.map((f, i) => {
    const o = (f ?? {}) as Record<string, unknown>;
    if (typeof o.forma !== "string" || !o.forma) {
      throw new ErrorCaja("ENTRADA_NO_VALIDA", `formasPago[${i}].forma es obligatoria.`, 400);
    }
    return {
      forma: o.forma as never,
      importe: enteroPositivo(o.importe, `formasPago[${i}].importe`),
      referencia: typeof o.referencia === "string" ? o.referencia : null,
    };
  });
}

function contexto(req: Request): servicio.Contexto {
  return {
    empresaId: req.authCtx!.empresaId,
    userId: req.authCtx!.userId,
    ip: req.ip,
  };
}

/** Envuelve un handler async y traduce `ErrorCaja` a su código HTTP. */
function ruta(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof ErrorCaja) {
        return res.status(e.estado).json({ error: e.message, code: e.codigo, detalle: e.detalle });
      }
      console.error("[Mobilink Cash] error no controlado:", e);
      res.status(500).json({ error: "Error interno de Mobilink Cash" });
    }
  };
}

// ── Router ─────────────────────────────────────────────────────────────────

export function createCashRouter(): Router {
  const r = Router();

  r.use(authenticate, requireModule("cash"), cargarPermisosCaja);

  // ── Contexto de arranque de la interfaz ─────────────────────────────────
  r.get(
    "/bootstrap",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const [denominaciones, cajas, erp] = await Promise.all([
        cargarDenominaciones(pool, true),
        pool.query(
          `SELECT id, centro, nombre FROM cash_registers
            WHERE empresa_id = $1 AND activa = true ORDER BY centro, nombre`,
          [empresaId]
        ),
        estadoIntegracion(empresaId),
      ]);

      res.json({
        denominaciones,
        cajas: cajas.rows,
        permisos: req.cashPermisos,
        rol: req.cashRol,
        erp: { estado: erp.estado, connectorKey: erp.connectorKey, displayName: erp.displayName },
        cambioMaximoCentimos: CAMBIO_MAXIMO_CENTIMOS,
      });
    })
  );

  // ── Cajas ────────────────────────────────────────────────────────────────

  r.get(
    "/registers",
    exigirPermiso("cash.configure"),
    ruta(async (req, res) => {
      res.json({ cajas: await config.listarCajas(req.authCtx!.empresaId) });
    })
  );

  r.post(
    "/registers",
    exigirPermiso("cash.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const caja = await config.crearCaja(contexto(req), {
        nombre: typeof b.nombre === "string" ? b.nombre : "",
        centro: typeof b.centro === "string" ? b.centro : "",
      });
      res.status(201).json({ caja });
    })
  );

  r.patch(
    "/registers/:id",
    exigirPermiso("cash.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const caja = await config.actualizarCaja(contexto(req), enteroPositivo(req.params.id, "id"), {
        nombre: typeof b.nombre === "string" ? b.nombre : undefined,
        centro: typeof b.centro === "string" ? b.centro : undefined,
        activa: typeof b.activa === "boolean" ? b.activa : undefined,
      });
      res.json({ caja });
    })
  );

  // ── Catálogo de denominaciones ───────────────────────────────────────────

  /** Todas, activas o no: la pantalla de configuración necesita las desactivadas. */
  r.get(
    "/denominations",
    exigirPermiso("cash.view"),
    ruta(async (_req, res) => {
      res.json({ denominaciones: await cargarDenominaciones(pool, false) });
    })
  );

  r.patch(
    "/denominations/:id",
    exigirPermiso("cash.denominations.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      // `null` es un valor con significado (sin cartucho), así que se distingue
      // de "no se ha mandado el campo".
      const piezas =
        b.piezasPorCartucho === undefined
          ? undefined
          : b.piezasPorCartucho === null || b.piezasPorCartucho === ""
            ? null
            : entero(b.piezasPorCartucho, "piezasPorCartucho");

      const denominacion = await config.actualizarDenominacion(
        contexto(req),
        enteroPositivo(req.params.id, "id"),
        {
          activa: typeof b.activa === "boolean" ? b.activa : undefined,
          piezasPorCartucho: piezas,
        }
      );
      res.json({ denominacion });
    })
  );

  // ── Jornadas ─────────────────────────────────────────────────────────────
  r.get(
    "/registers/:id/session",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const sesion = await sesionAbierta(enteroPositivo(req.params.id, "id"));
      if (!sesion) return res.json({ sesion: null });
      res.json(await servicio.resumenJornada(sesion.id));
    })
  );

  r.post(
    "/sessions",
    exigirPermiso("cash.open_session"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const salida = await servicio.abrirJornada(contexto(req), {
        registerId: enteroPositivo(b.registerId, "registerId"),
        fondoManual: lineas(b.fondoManual, "fondoManual"),
        motivoFondoManual: typeof b.motivoFondoManual === "string" ? b.motivoFondoManual : undefined,
        fecha: typeof b.fecha === "string" ? b.fecha : undefined,
        notas: typeof b.notas === "string" ? b.notas : undefined,
      });
      res.status(201).json(salida);
    })
  );

  r.get(
    "/sessions/:id",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      res.json(await servicio.detalleJornada(enteroPositivo(req.params.id, "id")));
    })
  );

  r.get(
    "/sessions/:id/stock",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      res.json(await servicio.stockDeJornada(enteroPositivo(req.params.id, "id")));
    })
  );

  r.get(
    "/sessions/:id/movements",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      res.json({ movimientos: await movimientosDeSesion(enteroPositivo(req.params.id, "id")) });
    })
  );

  /** Propuesta de cambio. Es una consulta: no reserva nada. */
  r.get(
    "/sessions/:id/change",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const importe = entero(req.query.importe, "importe");
      res.json(await servicio.proponerCambio(enteroPositivo(req.params.id, "id"), importe));
    })
  );

  r.post(
    "/sessions/:id/reopen",
    exigirPermiso("cash.session.reopen"),
    ruta(async (req, res) => {
      const motivo = String((req.body ?? {}).motivo ?? "");
      res.json({
        sesion: await servicio.reabrirJornada(contexto(req), enteroPositivo(req.params.id, "id"), motivo),
      });
    })
  );

  // ── Cobros ───────────────────────────────────────────────────────────────
  r.post(
    "/collections",
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const esManual = !b.externalDocumentId;

      // El encargo pedía justamente esto: se puede tener permiso para cobrar
      // facturas de la ERP y no tenerlo para inventarse un cobro manual.
      const permiso = esManual ? "cash.collection.create_manual" : "cash.collection.create";
      if (!req.cashPermisos?.includes(permiso)) {
        return res.status(403).json({ error: "No tienes permiso para este tipo de cobro.", code: "PERMISO_DENEGADO", permiso });
      }

      const salida = await servicio.registrarCobro(contexto(req), {
        sessionId: enteroPositivo(b.sessionId, "sessionId"),
        origen: esManual ? "MANUAL" : "ERP",
        importeCentimos: enteroPositivo(b.importeCentimos, "importeCentimos"),
        formasPago: formasPago(b.formasPago),
        efectivoRecibido: lineas(b.efectivoRecibido, "efectivoRecibido"),
        cambioManual: b.cambioManual ? lineas(b.cambioManual, "cambioManual") : undefined,
        partyNombre: typeof b.partyNombre === "string" ? b.partyNombre : "",
        concepto: typeof b.concepto === "string" ? b.concepto : "",
        referencia: typeof b.referencia === "string" ? b.referencia : null,
        documentoId: b.documentoId ? enteroPositivo(b.documentoId, "documentoId") : null,
        externalSystem: typeof b.externalSystem === "string" ? b.externalSystem : null,
        externalDocumentId: typeof b.externalDocumentId === "string" ? b.externalDocumentId : null,
        externalDocumentReference:
          typeof b.externalDocumentReference === "string" ? b.externalDocumentReference : null,
      });
      res.status(201).json(salida);
    })
  );

  // ── Pagos ────────────────────────────────────────────────────────────────
  r.post(
    "/payments",
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const esManual = !b.externalDocumentId;
      const permiso = esManual ? "cash.payment.create_manual" : "cash.payment.create";
      if (!req.cashPermisos?.includes(permiso)) {
        return res.status(403).json({ error: "No tienes permiso para este tipo de pago.", code: "PERMISO_DENEGADO", permiso });
      }

      const salida = await servicio.registrarOperacion(contexto(req), {
        sessionId: enteroPositivo(b.sessionId, "sessionId"),
        tipo: "PAYMENT",
        origen: esManual ? "MANUAL" : "ERP",
        importeCentimos: enteroPositivo(b.importeCentimos, "importeCentimos"),
        formasPago: formasPago(b.formasPago),
        efectivoEntregado: lineas(b.efectivoEntregado, "efectivoEntregado"),
        partyNombre: typeof b.partyNombre === "string" ? b.partyNombre : "",
        concepto: typeof b.concepto === "string" ? b.concepto : "",
        referencia: typeof b.referencia === "string" ? b.referencia : null,
        documentoId: b.documentoId ? enteroPositivo(b.documentoId, "documentoId") : null,
        externalSystem: typeof b.externalSystem === "string" ? b.externalSystem : null,
        externalDocumentId: typeof b.externalDocumentId === "string" ? b.externalDocumentId : null,
        externalDocumentReference:
          typeof b.externalDocumentReference === "string" ? b.externalDocumentReference : null,
      });
      res.status(201).json(salida);
    })
  );

  // ── Otros movimientos de efectivo ────────────────────────────────────────
  const TIPOS_MOVIMIENTO = new Set(["MANUAL_IN", "MANUAL_OUT", "CASH_DELIVERY", "BANK_DEPOSIT", "ADJUSTMENT"]);

  r.post(
    "/movements",
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const tipo = String(b.tipo ?? "");
      if (!TIPOS_MOVIMIENTO.has(tipo)) {
        throw new ErrorCaja("ENTRADA_NO_VALIDA", `Tipo de movimiento no válido: ${tipo}.`, 400);
      }

      const permiso = tipo === "ADJUSTMENT" ? "cash.adjustment.create" : "cash.movement.create";
      if (!req.cashPermisos?.includes(permiso)) {
        return res.status(403).json({ error: "No tienes permiso para este movimiento.", code: "PERMISO_DENEGADO", permiso });
      }

      // Un ajuste sin motivo es un descuadre sin explicar: no se acepta.
      const concepto = typeof b.concepto === "string" ? b.concepto.trim() : "";
      if (tipo === "ADJUSTMENT" && !concepto) {
        throw new ErrorCaja("FALTA_MOTIVO", "Un ajuste exige indicar el motivo.", 400);
      }

      const importe = enteroPositivo(b.importeCentimos, "importeCentimos");
      const entra = tipo === "MANUAL_IN";

      const salida = await servicio.registrarOperacion(contexto(req), {
        sessionId: enteroPositivo(b.sessionId, "sessionId"),
        tipo: tipo as never,
        origen: "MANUAL",
        importeCentimos: importe,
        formasPago: [{ forma: "CASH" as never, importe }],
        efectivoRecibido: entra ? lineas(b.efectivo, "efectivo") : undefined,
        efectivoEntregado: entra ? undefined : lineas(b.efectivo, "efectivo"),
        partyNombre: typeof b.partyNombre === "string" ? b.partyNombre : "",
        concepto,
        referencia: typeof b.referencia === "string" ? b.referencia : null,
      });
      res.status(201).json(salida);
    })
  );

  // ── Anulación por reversión ──────────────────────────────────────────────
  r.post(
    "/operations/:id/reverse",
    exigirPermiso("cash.operation.reverse"),
    ruta(async (req, res) => {
      const motivo = String((req.body ?? {}).motivo ?? "");
      res.json(
        await servicio.anularOperacion(contexto(req), enteroPositivo(req.params.id, "id"), motivo)
      );
    })
  );

  // ── Arqueo ───────────────────────────────────────────────────────────────
  r.post(
    "/sessions/:id/count",
    exigirPermiso("cash.count.create"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      res.status(201).json(
        await servicio.guardarArqueo(contexto(req), {
          sessionId: enteroPositivo(req.params.id, "id"),
          contado: lineas(b.contado, "contado"),
          cartuchos: lineas(b.cartuchos, "cartuchos"),
          tipo: b.tipo === "INTERMEDIATE" ? "INTERMEDIATE" : "CLOSING",
          notas: typeof b.notas === "string" ? b.notas : undefined,
        })
      );
    })
  );

  // ── Cierre ───────────────────────────────────────────────────────────────
  r.get(
    "/sessions/:id/closing-proposal",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const objetivo = entero(req.query.objetivo ?? 0, "objetivo");
      res.json(await servicio.proponerCierre(enteroPositivo(req.params.id, "id"), objetivo));
    })
  );

  r.post(
    "/sessions/:id/close",
    exigirPermiso("cash.close_session"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      res.json(
        await servicio.cerrarJornada(contexto(req), {
          sessionId: enteroPositivo(req.params.id, "id"),
          cambioFinal: lineas(b.cambioFinal, "cambioFinal"),
          arqueoId: b.arqueoId ? enteroPositivo(b.arqueoId, "arqueoId") : undefined,
          notas: typeof b.notas === "string" ? b.notas : undefined,
        })
      );
    })
  );

  // ── Histórico ────────────────────────────────────────────────────────────
  r.get(
    "/sessions",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const { desde, hasta, registerId, estado } = req.query;
      const filtros: string[] = ["s.empresa_id = $1"];
      const params: unknown[] = [req.authCtx!.empresaId];

      if (typeof desde === "string" && desde) {
        params.push(desde);
        filtros.push(`s.fecha >= $${params.length}`);
      }
      if (typeof hasta === "string" && hasta) {
        params.push(hasta);
        filtros.push(`s.fecha <= $${params.length}`);
      }
      if (registerId) {
        params.push(enteroPositivo(registerId, "registerId"));
        filtros.push(`s.register_id = $${params.length}`);
      }
      if (typeof estado === "string" && estado) {
        params.push(estado);
        filtros.push(`s.estado = $${params.length}`);
      }

      const { rows } = await pool.query(
        `SELECT s.*, c.nombre AS caja_nombre, c.centro AS caja_centro
           FROM cash_sessions s
           JOIN cash_registers c ON c.id = s.register_id
          WHERE ${filtros.join(" AND ")}
          ORDER BY s.fecha DESC, s.id DESC
          LIMIT 200`,
        params
      );
      res.json({ sesiones: rows });
    })
  );

  // ── Documentos de la ERP ─────────────────────────────────────────────────
  r.get(
    "/documents",
    exigirPermiso("cash.view"),
    ruta(async (req, res) => {
      const tipo = req.query.tipo === "PAYABLE" ? "SUPPLIER_INVOICE" : "CUSTOMER_INVOICE";
      const busca = typeof req.query.q === "string" ? req.query.q.trim() : "";

      const params: unknown[] = [req.authCtx!.empresaId, tipo];
      let filtroBusqueda = "";
      if (busca) {
        params.push(`%${busca}%`);
        filtroBusqueda = ` AND (numero ILIKE $3 OR party_nombre ILIKE $3 OR external_reference ILIKE $3)`;
      }

      const { rows } = await pool.query(
        `SELECT * FROM cash_external_documents
          WHERE empresa_id = $1 AND tipo = $2 AND estado IN ('OPEN','PARTIALLY_PAID')
          ${filtroBusqueda}
          ORDER BY fecha DESC NULLS LAST, id DESC
          LIMIT 100`,
        params
      );
      res.json({ documentos: rows });
    })
  );

  // ── Panel de integración ERP ─────────────────────────────────────────────
  r.get(
    "/erp/status",
    exigirPermiso("cash.erp.view"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const estado = await estadoIntegracion(empresaId);

      const { rows: contadores } = await pool.query(
        `SELECT estado, COUNT(*) AS n FROM cash_erp_outbox WHERE empresa_id = $1 GROUP BY estado`,
        [empresaId]
      );
      const { rows: documentos } = await pool.query(
        `SELECT COUNT(*) AS n FROM cash_external_documents WHERE empresa_id = $1`,
        [empresaId]
      );
      const { rows: errores } = await pool.query(
        `SELECT evento, mobilink_id, last_error, intentos, created_at_ms
           FROM cash_erp_logs
          WHERE empresa_id = $1 AND estado = 'ERROR'
          ORDER BY id DESC LIMIT 20`,
        [empresaId]
      );

      res.json({
        ...estado,
        conectoresDisponibles: conectoresDisponibles(),
        documentosRecibidos: Number(documentos[0].n),
        outbox: Object.fromEntries(
          contadores.map((c: { estado: string; n: string }) => [c.estado, Number(c.n)])
        ),
        errores,
      });
    })
  );

  r.post(
    "/erp/test",
    exigirPermiso("cash.erp.view"),
    ruta(async (req, res) => {
      const { conector } = await conectorPara(req.authCtx!.empresaId);
      if (!conector) {
        return res.json({ ok: false, mensaje: "No hay ninguna ERP configurada. Mobilink Cash funciona en modo autónomo." });
      }
      res.json(await conector.probarConexion());
    })
  );

  /**
   * Importa los documentos pendientes de la ERP a la caché local.
   *
   * El upsert por (empresa, sistema, id) es lo que evita duplicar una factura
   * que ya se había importado: se actualiza en vez de insertarse otra vez.
   */
  r.post(
    "/erp/sync",
    exigirPermiso("cash.erp.sync"),
    ruta(async (req, res) => {
      const empresaId = req.authCtx!.empresaId;
      const { conector, config } = await conectorPara(empresaId);
      if (!conector) throw new ErrorCaja("ERP_NO_CONFIGURADA", "No hay ninguna ERP configurada.", 409);

      const ahora = Date.now();
      const aCobrar = conector.documentosACobrar ? await conector.documentosACobrar() : [];
      const aPagar = conector.documentosAPagar ? await conector.documentosAPagar() : [];
      let importados = 0;

      for (const d of [...aCobrar, ...aPagar]) {
        await pool.query(
          `INSERT INTO cash_external_documents
             (empresa_id, external_system, external_id, external_reference, tipo, party_tipo,
              party_external_id, party_nombre, numero, fecha, vencimiento, total_centimos,
              pendiente_centimos, moneda, estado_erp, metadata, last_sync_at_ms,
              created_at_ms, updated_at_ms)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$17)
           ON CONFLICT (empresa_id, external_system, external_id) DO UPDATE SET
             external_reference = EXCLUDED.external_reference,
             party_nombre = EXCLUDED.party_nombre,
             numero = EXCLUDED.numero,
             fecha = EXCLUDED.fecha,
             vencimiento = EXCLUDED.vencimiento,
             total_centimos = EXCLUDED.total_centimos,
             -- El pendiente NO se pisa si aquí ya se ha cobrado algo que la ERP
             -- todavía no conoce: se queda el menor de los dos, que es el que
             -- no permite cobrar de más.
             pendiente_centimos = LEAST(cash_external_documents.pendiente_centimos, EXCLUDED.pendiente_centimos),
             estado_erp = EXCLUDED.estado_erp,
             metadata = EXCLUDED.metadata,
             last_sync_at_ms = EXCLUDED.last_sync_at_ms,
             updated_at_ms = EXCLUDED.updated_at_ms`,
          [
            empresaId,
            d.externalSystem,
            d.externalId,
            d.externalReference ?? null,
            d.tipo,
            d.parteTipo,
            d.parteExternalId ?? null,
            d.parteNombre,
            d.numero,
            d.fecha ?? null,
            d.vencimiento ?? null,
            d.totalCentimos,
            d.pendienteCentimos,
            d.moneda,
            d.estadoErp ?? null,
            d.metadata ? JSON.stringify(d.metadata) : null,
            ahora,
          ]
        );
        importados++;
      }

      if (config) {
        await pool.query(
          `UPDATE cash_erp_configs SET last_sync_at_ms = $2, last_status = 'ok', last_error = NULL, updated_at_ms = $2
            WHERE id = $1`,
          [config.id, ahora]
        );
      }

      await registrarAuditoria({
        empresaId,
        userId: req.authCtx!.userId,
        accion: "cash.erp.sync",
        entidad: "cash_external_documents",
        detalle: { importados },
        ip: req.ip,
      });

      res.json({ importados });
    })
  );

  r.post(
    "/erp/retry",
    exigirPermiso("cash.erp.sync"),
    ruta(async (req, res) => {
      const reencolados = await reintentarErrores(req.authCtx!.empresaId);
      const tratados = await procesarOutbox(50);
      res.json({ reencolados, tratados });
    })
  );

  r.get(
    "/erp/config",
    exigirPermiso("cash.erp.configure"),
    ruta(async (req, res) => {
      // Nunca se devuelven credenciales: `ajustes` guarda solo lo no secreto.
      res.json({ config: await configuracionErp(req.authCtx!.empresaId) });
    })
  );

  r.put(
    "/erp/config",
    exigirPermiso("cash.erp.configure"),
    ruta(async (req, res) => {
      const b = req.body ?? {};
      const connectorKey = String(b.connectorKey ?? "");
      if (!conectoresDisponibles().includes(connectorKey)) {
        throw new ErrorCaja("CONECTOR_DESCONOCIDO", `No existe el conector "${connectorKey}".`, 400);
      }
      const ahora = Date.now();
      const { rows } = await pool.query(
        `INSERT INTO cash_erp_configs
           (empresa_id, centro, connector_key, activo, ajustes, permite_cobro_parcial, created_at_ms, updated_at_ms)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
         ON CONFLICT (empresa_id, centro) DO UPDATE SET
           connector_key = EXCLUDED.connector_key,
           activo = EXCLUDED.activo,
           ajustes = EXCLUDED.ajustes,
           permite_cobro_parcial = EXCLUDED.permite_cobro_parcial,
           updated_at_ms = EXCLUDED.updated_at_ms
         RETURNING *`,
        [
          req.authCtx!.empresaId,
          typeof b.centro === "string" ? b.centro : "",
          connectorKey,
          Boolean(b.activo),
          JSON.stringify(b.ajustes ?? {}),
          b.permiteCobroParcial !== false,
          ahora,
        ]
      );

      await registrarAuditoria({
        empresaId: req.authCtx!.empresaId,
        userId: req.authCtx!.userId,
        accion: "cash.erp.configure",
        entidad: "cash_erp_configs",
        entidadId: String(rows[0].id),
        detalle: { connectorKey, activo: Boolean(b.activo) },
        ip: req.ip,
      });

      res.json({ config: rows[0] });
    })
  );

  return r;
}

export { obtenerSesion };
