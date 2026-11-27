/**
 * ¿Llegó el SMS del enlace? — preguntárselo a Twilio y apuntarlo.
 *
 * Se PREGUNTA (Core llama a Twilio con el identificador del mensaje) en vez de
 * esperar a que Twilio avise con un webhook, por tres razones:
 *
 *  · sirve para los SMS que ya están mandados, que es justo el caso que lo
 *    destapó: uno aceptado por Twilio que no llegó al móvil;
 *  · no abre una ruta pública sin sesión a la que cualquiera pueda decirle
 *    «este mensaje se entregó»;
 *  · si Twilio no llega a avisar, no se queda mintiendo.
 *
 * Solo se pregunta por lo que tiene sentido: el ÚLTIMO enlace de cada persona,
 * si sigue vivo (sin caducar) y sin abrir. Un enlace abierto llegó, no hay
 * nada que preguntar; uno caducado o anulado ya no le importa a nadie.
 *
 * Es solo informativo: que un SMS no llegue no anula el enlace ni mueve la
 * ficha. Quien lo ve decide si reenviar o corregir el móvil.
 *
 * Necesita `core_alta_entrega_sms.sql`. Sin ella, `disponible: false` y la
 * lista sale como siempre.
 */

import { Router, type Request, type RequestHandler, type Response } from "express";

import db from "../db.ts";
import { authenticate, requireAdmin } from "./auth.ts";
import { clienteTwilio, hayCredencialesTwilio } from "./twilio.ts";
import {
  entregaDeTwilio,
  entregaEnLista,
  motivoDeEntrega,
  tocaPreguntar,
  type EntregaEnLista,
} from "./entregaSmsEstado.ts";

type Consultor = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };

/** Lo que interesa de la respuesta de Twilio sobre un mensaje. */
export type RespuestaTwilio = { status: string; errorCode: number | null; errorMessage: string | null };

/** Pregunta a Twilio por un mensaje. Inyectable: en las pruebas no hay Twilio. */
export type ConsultaTwilio = (sid: string) => Promise<RespuestaTwilio>;

export type EntregaDeEnlace = {
  estado: EntregaEnLista;
  /** Por qué no llegó, ya en cristiano. Solo en `no_entregado`. */
  motivo: string | null;
  telefono: string;
  enviadoAt: string;
};

type Dependencias = {
  consultor?: Consultor;
  consultar?: ConsultaTwilio;
  ahora?: () => number;
};

/** No más de estas preguntas a Twilio por cada vez que se abre la lista. */
const MAX_PREGUNTAS = 25;
const A_LA_VEZ = 5;
/** Si Twilio tarda más, la lista no espera: se enseña lo que hubiera. */
const ESPERA_MS = 6_000;

const consultaTwilio: ConsultaTwilio = async (sid) => {
  const m = await clienteTwilio().messages(sid).fetch();
  return {
    status: String(m.status ?? ""),
    errorCode: m.errorCode ?? null,
    errorMessage: m.errorMessage ?? null,
  };
};

function conLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
  let reloj: ReturnType<typeof setTimeout>;
  const tope = new Promise<never>((_, rechazar) => {
    reloj = setTimeout(() => rechazar(new Error("Twilio no ha contestado a tiempo")), ms);
  });
  return Promise.race([promesa, tope]).finally(() => clearTimeout(reloj));
}

/** ¿Está ejecutada `core_alta_entrega_sms.sql`? Se mira cada vez: se ejecuta a mano. */
export async function hayEntrega(cx: Consultor): Promise<boolean> {
  const { rows } = await cx.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sea_employee_invites' AND column_name = 'entrega'
          AND table_schema = ANY (current_schemas(false))
     ) AS hay`
  );
  return rows[0]?.hay === true;
}

type Fila = {
  id: string;
  employee_id: string;
  telefono: string;
  mensaje_sid: string;
  enviado_at: Date;
  entrega: string | null;
  entrega_codigo: number | null;
  entrega_detalle: string | null;
  entrega_at: Date | null;
};

/**
 * La entrega del enlace vivo de cada empleado, por `employee_id`.
 *
 * De paso pone al día en la base lo que haya cambiado: lo siguiente que abra
 * la lista ya no tiene que preguntar por lo que quedó resuelto.
 */
export async function entregasDeEnlaces(deps: Dependencias = {}): Promise<Record<string, EntregaDeEnlace>> {
  const cx = deps.consultor ?? db;
  const ahoraMs = (deps.ahora ?? Date.now)();

  const { rows } = await cx.query(
    `SELECT u.id, u.employee_id, u.telefono, u.mensaje_sid, u.enviado_at,
            u.entrega, u.entrega_codigo, u.entrega_detalle, u.entrega_at
       FROM (
         SELECT DISTINCT ON (i.employee_id) i.*
           FROM sea_employee_invites i
          ORDER BY i.employee_id, i.enviado_at DESC
       ) u
      WHERE u.estado = 'enviado'
        AND u.mensaje_sid IS NOT NULL
        AND u.caduca_at > $1
      ORDER BY u.enviado_at DESC`,
    [new Date(ahoraMs).toISOString()]
  );
  const filas = rows as Fila[];

  // Con Twilio sin configurar no se pregunta: se enseña lo que ya se supiera.
  const consultar = deps.consultar ?? (hayCredencialesTwilio() ? consultaTwilio : null);
  if (consultar) {
    const pendientes = filas
      .filter((f) =>
        tocaPreguntar({
          entrega: f.entrega,
          enviadoAtMs: new Date(f.enviado_at).getTime(),
          preguntadoAtMs: f.entrega_at ? new Date(f.entrega_at).getTime() : null,
          ahoraMs,
        })
      )
      .slice(0, MAX_PREGUNTAS);

    for (let i = 0; i < pendientes.length; i += A_LA_VEZ) {
      await Promise.all(
        pendientes.slice(i, i + A_LA_VEZ).map(async (f) => {
          try {
            const r = await conLimite(consultar(f.mensaje_sid), ESPERA_MS);
            // Un estado que no conocemos no pisa lo que hubiera.
            const entrega = entregaDeTwilio(r.status) ?? f.entrega;
            const codigo = entrega === "no_entregado" ? r.errorCode : null;
            const detalle = entrega === "no_entregado" ? r.errorMessage : null;
            await cx.query(
              `UPDATE sea_employee_invites
                  SET entrega = $2, entrega_codigo = $3, entrega_detalle = $4, entrega_at = $5
                WHERE id = $1`,
              [f.id, entrega, codigo, detalle, new Date(ahoraMs).toISOString()]
            );
            f.entrega = entrega;
            f.entrega_codigo = codigo;
            f.entrega_detalle = detalle;
          } catch (e) {
            // Twilio caído o lento: se queda como estaba y se vuelve a intentar
            // la próxima vez. La lista no se rompe por esto.
            console.error(
              `[alta] no se ha podido preguntar a Twilio por ${f.mensaje_sid}:`,
              e instanceof Error ? e.message : e
            );
          }
        })
      );
    }
  }

  const salida: Record<string, EntregaDeEnlace> = {};
  for (const f of filas) {
    const enviadoAtMs = new Date(f.enviado_at).getTime();
    const estado = entregaEnLista(f.entrega, enviadoAtMs, ahoraMs);
    salida[f.employee_id] = {
      estado,
      motivo: estado === "no_entregado" ? motivoDeEntrega(f.entrega_codigo, f.entrega_detalle) : null,
      telefono: f.telefono,
      enviadoAt: new Date(f.enviado_at).toISOString(),
    };
  }
  return salida;
}

/**
 * `GET /api/core/alta/entregas` — solo administradores, como el resto del alta.
 *
 * Se monta ANTES que el router del encargado: allí `/:employeeId` se quedaría
 * con «entregas» y contestaría que ese empleado no existe.
 */
export function createEntregaSmsRouter(opciones: { autenticar?: RequestHandler } & Dependencias = {}): Router {
  const r = Router();
  const deps: Dependencias = { consultor: opciones.consultor, consultar: opciones.consultar, ahora: opciones.ahora };

  r.get("/", opciones.autenticar ?? authenticate, requireAdmin, async (_req: Request, res: Response) => {
    try {
      if (!(await hayEntrega(deps.consultor ?? db))) {
        return res.json({ disponible: false, entregas: {} });
      }
      res.json({ disponible: true, entregas: await entregasDeEnlaces(deps) });
    } catch (err) {
      console.error("GET /api/core/alta/entregas:", err instanceof Error ? err.message : err);
      // Sin esto la lista sale igual, con «Enlace enviado» a secas.
      res.json({ disponible: false, entregas: {} });
    }
  });

  return r;
}
