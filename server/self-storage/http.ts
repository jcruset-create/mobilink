/**
 * Utilidades HTTP del módulo: envoltorio de rutas, validación con zod y
 * traducción de los errores de PostgreSQL.
 *
 * La base de datos es la última barrera (UNIQUE, FKs compuestas, CHECK). Cuando
 * salta, el usuario no debe ver «duplicate key value violates…», sino qué ha
 * pasado: por eso cada restricción con nombre tiene aquí su mensaje.
 */

import type { Request, Response } from "express";
import { z } from "zod";
import { ErrorSelfStorage } from "./errors.ts";
import type { Actor } from "./shared/audit.ts";

const MENSAJES_RESTRICCION: Record<string, { codigo: string; mensaje: string; estado?: number }> = {
  self_storage_centers_code_uq: { codigo: "CENTRO_DUPLICADO", mensaje: "Ya existe un centro con ese código." },
  self_storage_zones_code_uq: { codigo: "ZONA_DUPLICADA", mensaje: "Ya existe una zona con ese código en el centro." },
  self_storage_unit_types_code_uq: { codigo: "TIPO_DUPLICADO", mensaje: "Ya existe un tipo con ese código." },
  self_storage_units_code_uq: { codigo: "TRASTERO_DUPLICADO", mensaje: "Ya existe un trastero con ese número en el centro." },
  self_storage_units_shape_uq: { codigo: "FORMA_YA_VINCULADA", mensaje: "Esa forma del plano ya está vinculada a otro trastero." },
  self_storage_units_zone_fk: { codigo: "ZONA_DE_OTRO_CENTRO", mensaje: "La zona no pertenece al centro del trastero.", estado: 422 },
  self_storage_units_type_fk: { codigo: "TIPO_NO_VALIDO", mensaje: "El tipo de trastero no existe.", estado: 422 },
  self_storage_units_type_center: { codigo: "TIPO_DE_OTRO_CENTRO", mensaje: "El tipo de trastero es de otro centro.", estado: 422 },
  self_storage_units_gross_chk: { codigo: "PVP_NO_CUADRA", mensaje: "El PVP no corresponde a la base con su IVA.", estado: 422 },
  self_storage_units_vat_amount_chk: { codigo: "PVP_NO_CUADRA", mensaje: "Precio base + cuota de IVA no es el PVP.", estado: 422 },
  self_storage_billing_items_vat_policy_chk: { codigo: "IVA_OBLIGATORIO", mensaje: "Un concepto con IVA propio necesita su tipo de IVA.", estado: 422 },
  self_storage_customers_tax_id_uq: { codigo: "CLIENTE_DUPLICADO", mensaje: "Ya existe un cliente con ese NIF/NIE/CIF." },
  self_storage_customer_phones_uq: { codigo: "TELEFONO_DUPLICADO", mensaje: "El cliente ya tiene ese teléfono." },
  self_storage_customer_phones_access_uq: {
    codigo: "TELEFONO_DE_OTRO_CLIENTE",
    mensaje: "Ese teléfono ya está autorizado para abrir puertas a otro cliente.",
  },
  self_storage_reservations_active_unit_uq: { codigo: "TRASTERO_RESERVADO", mensaje: "El trastero ya tiene una reserva activa." },
  self_storage_contracts_live_unit_uq: { codigo: "TRASTERO_OCUPADO", mensaje: "El trastero ya tiene un contrato vivo." },
  self_storage_zones_center_fk: { codigo: "CENTRO_CON_ZONAS", mensaje: "El centro tiene zonas: no se puede borrar." },
  self_storage_floor_plans_version_uq: { codigo: "PLANO_CONCURRENTE", mensaje: "Otra persona acaba de subir un plano. Vuelve a intentarlo." },
};

type ErrorPg = { code?: string; constraint?: string; message?: string };

/** Traduce un error de pg a ErrorSelfStorage (o null si no es de restricciones). */
export function traducirErrorPg(e: unknown): ErrorSelfStorage | null {
  const err = e as ErrorPg;
  if (!err || typeof err.code !== "string") return null;
  const conocido = err.constraint ? MENSAJES_RESTRICCION[err.constraint] : undefined;
  if (conocido) return new ErrorSelfStorage(conocido.codigo, conocido.mensaje, conocido.estado ?? 409, { constraint: err.constraint });
  if (err.code === "23505") return new ErrorSelfStorage("DUPLICADO", "Ya existe un registro con esos datos.", 409, { constraint: err.constraint });
  if (err.code === "23503") return new ErrorSelfStorage("REFERENCIA_NO_VALIDA", "Hay una referencia a algo que no existe o que no se puede borrar.", 409, { constraint: err.constraint });
  if (err.code === "23514") return new ErrorSelfStorage("DATOS_NO_VALIDOS", "Los datos no cumplen las reglas del trastero.", 422, { constraint: err.constraint });
  if (err.code === "22P02") return new ErrorSelfStorage("DATOS_NO_VALIDOS", "Algún identificador o valor no tiene el formato correcto.", 422);
  return null;
}

/** Envuelve un manejador: errores de negocio → 4xx; lo demás → 500 sin detalles. */
export function ruta(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (e) {
      const negocio = e instanceof ErrorSelfStorage ? e : traducirErrorPg(e);
      if (negocio) {
        return res
          .status(negocio.estado)
          .json({ error: negocio.message, code: negocio.codigo, ...(negocio.detalle ? { detalle: negocio.detalle } : {}) });
      }
      console.error("[Self Storage] error no controlado:", e);
      res.status(500).json({ error: "Error interno del módulo Self Storage" });
    }
  };
}

/** Valida con zod; si no vale, 422 con la lista de problemas campo a campo. */
export function validar<T extends z.ZodType>(esquema: T, datos: unknown): z.infer<T> {
  const r = esquema.safeParse(datos);
  if (!r.success) {
    const problemas = r.error.issues.map((i) => ({ campo: i.path.join("."), mensaje: i.message }));
    const primero = problemas[0];
    throw new ErrorSelfStorage(
      "DATOS_NO_VALIDOS",
      primero ? `${primero.campo ? primero.campo + ": " : ""}${primero.mensaje}` : "Datos no válidos.",
      422,
      { problemas }
    );
  }
  return r.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Un id de la URL. Si no tiene forma de uuid, el recurso «no existe». */
export function idDe(req: Request, nombre = "id", que = "El registro"): string {
  const v = String(req.params[nombre] ?? "");
  if (!UUID.test(v)) throw new ErrorSelfStorage("NO_EXISTE", `${que} no existe.`, 404);
  return v;
}

export const esUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Quién hace la operación. La empresa sale SIEMPRE de la sesión, nunca del cuerpo. */
export function actorDe(req: Request): Actor {
  const ctx = req.authCtx!;
  return { empresaId: ctx.empresaId, userId: ctx.userId, nombre: ctx.nombre, ip: req.ip ?? null };
}
