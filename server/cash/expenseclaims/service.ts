/**
 * El ciclo de vida de una liquidación de gastos de trabajadores.
 *
 *     BORRADOR ─► PRESENTADA ─► APROBADA ─► PAGADA
 *                     │
 *                     └─► RECHAZADA ─► (reabrir) BORRADOR
 *
 * y ANULADA desde cualquiera menos PAGADA. El grafo vive en `domain.ts`; aquí
 * se aplica dentro de una transacción, con la fila bloqueada, que es lo que
 * impide que dos personas aprueben y anulen la misma a la vez.
 *
 * ## Lo que este fichero NO hace
 *
 * No mueve dinero. Nada de lo de aquí toca `cash_operations` ni el libro mayor
 * de piezas: una liquidación se prepara, se revisa y se aprueba sin abrir el
 * cajón. El pago —la única unión con la caja— llega en otra fase y pasará por
 * `registrarOperacion`, como todo lo demás.
 */

import pool from "../../db.ts";
import { registrarAuditoria } from "../../core/auditoria.ts";
import { normalizarNombre } from "../../core/vinculoTecnicos.ts";
import { codigoDesde } from "../config.ts";
import { ErrorCaja } from "../errors.ts";
import { enTransaccion, siguienteNumeroDeEmpresa } from "../repository.ts";
import { exigirReautenticacion } from "../reauth.ts";
import type { Contexto } from "../service.ts";
import { exigirOtraPersona } from "../sod.ts";
import { revisarLiquidacion } from "./duplicates.ts";
import { urlFirmada } from "../storage.ts";
import {
  type AccionLiquidacion,
  type Bloqueo,
  type Totales,
  bloqueosParaPresentar,
  periodoDe,
  totalesPorConcepto,
  transicion,
} from "./domain.ts";
import {
  type LineaLiquidacion,
  type Liquidacion,
  cargarLiquidacion,
  conDuplicadoPendiente,
  lineasDe,
  listarLiquidaciones,
  paraReglas,
} from "./repository.ts";

export type { Liquidacion, LineaLiquidacion } from "./repository.ts";

export type DetalleLiquidacion = {
  liquidacion: Liquidacion;
  lineas: LineaLiquidacion[];
  totales: Totales;
  /** Lo que impide presentarla ahora mismo. Vacío = se puede. */
  bloqueos: Bloqueo[];
};

/**
 * El año en Madrid, no en el reloj del servidor.
 *
 * El servidor va en UTC: el 1 de enero a las 00:30 de Madrid todavía es 31 de
 * diciembre allí, y la primera liquidación del año saldría numerada con el
 * anterior. Es la misma trampa que `utils/periodo.ts` tiene probada aparte.
 */
function anioEnMadrid(ms = Date.now()): number {
  return Number(
    new Intl.DateTimeFormat("en", { timeZone: "Europe/Madrid", year: "numeric" }).format(new Date(ms))
  );
}

function textoObligatorio(v: unknown, que: string): string {
  const t = String(v ?? "").trim();
  if (!t) throw new ErrorCaja("ENTRADA_NO_VALIDA", `Hay que indicar ${que}.`, 400);
  return t.slice(0, 500);
}

/** Aplica el grafo o dice por qué no. */
function exigirTransicion(l: Liquidacion, accion: AccionLiquidacion) {
  const destino = transicion(l.estado, accion);
  if (destino) return destino;
  if (l.estado === "PAGADA" && accion === "ANULAR") {
    throw new ErrorCaja(
      "LIQUIDACION_PAGADA",
      `${l.numero} ya está pagada. Para anularla, anula antes el pago en la caja.`,
      409
    );
  }
  throw new ErrorCaja(
    "TRANSICION_NO_VALIDA",
    `${l.numero} está ${l.estado.toLowerCase()} y desde ahí no se puede ${accion.toLowerCase()}.`,
    409
  );
}

// ── Crear ──────────────────────────────────────────────────────────────────

type DestinoPersona = { id: number; nombre: string; activo: boolean; employee_id: string | null };

/**
 * El destino PERSONA que representa a un empleado dentro de Cash.
 *
 * Una persona, una proyección: si ya existe, se usa. Si no, se crea — salvo
 * que haya uno SIN vincular con el mismo nombre, que es casi seguro la misma
 * persona dada de alta antes a mano. Ese no se enlaza solo: «José» puede ser
 * José García o José Martín, y atribuir los gastos de uno al otro es peor que
 * pedir que alguien lo confirme. Es el criterio de `core/vinculoTecnicos.ts`.
 */
async function destinoDeEmpleado(
  client: import("pg").PoolClient,
  ctx: Contexto,
  employeeId: string
): Promise<{ destino: DestinoPersona; nombre: string }> {
  let empleado: { nombre: string; apellidos: string | null; activo: boolean } | undefined;
  try {
    const { rows } = await client.query(
      `SELECT nombre, apellidos, activo FROM sea_employees WHERE id = $1`,
      [employeeId]
    );
    empleado = rows[0];
  } catch (e) {
    /*
     * `sea_employees` la crean las migraciones de Supabase; en una base sin
     * ellas no existe. Se dice claro en vez de soltar un 500 con el error de
     * PostgreSQL. 42P01 = la tabla no existe.
     */
    if ((e as { code?: string })?.code === "42P01") {
      throw new ErrorCaja(
        "EMPLEADOS_NO_DISPONIBLES",
        "Esta instalación no tiene la ficha de empleados. Elige al trabajador de la lista de personas de Cash.",
        409
      );
    }
    throw e;
  }
  if (!empleado) throw new ErrorCaja("EMPLEADO_NO_ENCONTRADO", "Ese empleado no existe.", 404);
  if (!empleado.activo) {
    throw new ErrorCaja("EMPLEADO_INACTIVO", "Ese empleado está dado de baja.", 409);
  }
  const nombre = empleado.apellidos?.trim()
    ? `${empleado.apellidos.trim()}, ${empleado.nombre.trim()}`
    : empleado.nombre.trim();

  const { rows: vinculados } = await client.query<DestinoPersona>(
    `SELECT id, nombre, activo, employee_id FROM cash_expense_targets
      WHERE empresa_id = $1 AND employee_id = $2`,
    [ctx.empresaId, employeeId]
  );
  if (vinculados[0]) {
    if (!vinculados[0].activo) {
      throw new ErrorCaja(
        "DESTINO_INACTIVO",
        `«${vinculados[0].nombre}» está desactivado en Cash. Actívalo en Configuración.`,
        409
      );
    }
    return { destino: vinculados[0], nombre: vinculados[0].nombre };
  }

  /*
   * Candidatos sin vincular. Se compara con los dos órdenes del nombre —
   * «García, José» y «José García»— porque a mano se ha escrito de las dos.
   */
  const { rows: sueltos } = await client.query<DestinoPersona>(
    `SELECT id, nombre, activo, employee_id FROM cash_expense_targets
      WHERE empresa_id = $1 AND tipo = 'PERSONA' AND employee_id IS NULL`,
    [ctx.empresaId]
  );
  const formas = new Set(
    [nombre, `${empleado.nombre} ${empleado.apellidos ?? ""}`].map((n) => normalizarNombre(n))
  );
  const candidato = sueltos.find((d) => formas.has(normalizarNombre(d.nombre)));
  if (candidato) {
    throw new ErrorCaja(
      "DESTINO_SIN_VINCULAR",
      `Ya hay una persona «${candidato.nombre}» en Cash sin vincular a su ficha de empleado. Vincúlala en Configuración antes de crear la liquidación.`,
      409,
      { candidato: { id: candidato.id, nombre: candidato.nombre } }
    );
  }

  /*
   * Se crea. El código sale del nombre como en `crearDestino`; si ya lo usa
   * otra persona —dos empleados que se llaman igual—, se le pone un sufijo en
   * vez de fallar: son dos personas y las dos tienen derecho a cobrar.
   */
  const base = codigoDesde(nombre) || "EMPLEADO";
  const ahora = Date.now();
  for (let n = 1; n <= 20; n++) {
    const codigo = n === 1 ? base : `${base.slice(0, 26)}_${n}`;
    const { rows } = await client.query<DestinoPersona>(
      `INSERT INTO cash_expense_targets
         (empresa_id, tipo, codigo, nombre, activo, orden, employee_id, created_at_ms, updated_at_ms)
       VALUES ($1,'PERSONA',$2,$3,true,0,$4,$5,$5)
       ON CONFLICT (empresa_id, tipo, codigo) DO NOTHING
       RETURNING id, nombre, activo, employee_id`,
      [ctx.empresaId, codigo, nombre.slice(0, 80), employeeId, ahora]
    );
    if (rows[0]) return { destino: rows[0], nombre: rows[0].nombre };
  }
  throw new ErrorCaja("DESTINO_DUPLICADO", "No se ha podido dar de alta a la persona en Cash.", 409);
}

export async function crearLiquidacion(
  ctx: Contexto,
  e: { employeeId?: string | null; expenseTargetId?: number | null; notas?: string | null }
): Promise<Liquidacion> {
  if (!e.employeeId && !e.expenseTargetId) {
    throw new ErrorCaja("ENTRADA_NO_VALIDA", "Hay que decir de qué trabajador es la liquidación.", 400);
  }

  const creada = await enTransaccion(async (client) => {
    let destino: DestinoPersona;
    let nombre: string;
    if (e.employeeId) {
      ({ destino, nombre } = await destinoDeEmpleado(client, ctx, e.employeeId));
    } else {
      const { rows } = await client.query(
        `SELECT id, nombre, activo, employee_id, tipo FROM cash_expense_targets
          WHERE id = $1 AND empresa_id = $2`,
        [e.expenseTargetId, ctx.empresaId]
      );
      if (!rows[0]) throw new ErrorCaja("DESTINO_NO_ENCONTRADO", "Esa persona no existe.", 404);
      /*
       * Un centro de coste no cobra: la liquidación es de una PERSONA. Que el
       * desplegable solo enseñe personas no impide llamar a la API con otro id.
       */
      if (rows[0].tipo !== "PERSONA") {
        throw new ErrorCaja(
          "DESTINO_NO_ES_PERSONA",
          `«${rows[0].nombre}» no es una persona: a un centro de coste no se le reembolsa nada.`,
          400
        );
      }
      if (!rows[0].activo) {
        throw new ErrorCaja("DESTINO_INACTIVO", `«${rows[0].nombre}» está desactivado.`, 409);
      }
      destino = rows[0];
      nombre = rows[0].nombre;
    }

    const ahora = Date.now();
    const numero = await siguienteNumeroDeEmpresa(client, ctx.empresaId, "LG", anioEnMadrid(ahora));
    const { rows } = await client.query(
      `INSERT INTO cash_expense_claims
         (empresa_id, centro_id, numero, estado, employee_id, expense_target_id, empleado_nombre,
          solicitante_user_id, notas, creado_por, created_at_ms, updated_at_ms)
       VALUES ($1,$2,$3,'BORRADOR',$4,$5,$6,$7,$8,$7,$9,$9)
       RETURNING id`,
      [
        ctx.empresaId,
        ctx.centroId ?? null,
        numero,
        destino.employee_id,
        destino.id,
        nombre,
        ctx.userId,
        e.notas?.trim()?.slice(0, 1000) || null,
        ahora,
      ]
    );
    return cargarLiquidacion(client, ctx, rows[0].id);
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.expense_claim.create",
    entidad: "cash_expense_claims",
    entidadId: String(creada.id),
    detalle: {
      numero: creada.numero,
      empleado: creada.empleadoNombre,
      employeeId: creada.employeeId,
      expenseTargetId: creada.expenseTargetId,
    },
    ip: ctx.ip,
  });
  return creada;
}

// ── Leer ───────────────────────────────────────────────────────────────────

export { listarLiquidaciones };

export async function detalleLiquidacion(ctx: Contexto, id: number): Promise<DetalleLiquidacion> {
  const liquidacion = await cargarLiquidacion(pool, ctx, id);
  const lineas = await lineasDe(pool, id, urlFirmada);
  return {
    liquidacion,
    lineas,
    totales: totalesPorConcepto(lineas.map(paraReglas)),
    bloqueos:
      liquidacion.estado === "BORRADOR"
        ? bloqueosParaPresentar(lineas.map(paraReglas), conDuplicadoPendiente(lineas))
        : [],
  };
}

// ── Transiciones ───────────────────────────────────────────────────────────

/**
 * Presentar: congela las líneas y fija el total.
 *
 * El total lo calcula SIEMPRE el servidor con lo que hay en la base en ese
 * momento. Lo que la pantalla enseñara hace un minuto no cuenta: otra pestaña
 * ha podido excluir un ticket entre medias.
 */
export async function presentarLiquidacion(ctx: Contexto, id: number): Promise<Liquidacion> {
  /*
   * Antes, y en su PROPIA transacción, se vuelve a mirar si algún ticket está
   * repetido: si aparece algo nuevo, tiene que quedar guardado aunque
   * presentar se niegue justo por eso. Dentro de la misma transacción, el
   * rechazo se llevaría la evidencia que lo explica.
   */
  const previa = await cargarLiquidacion(pool, ctx, id);
  if (previa.estado === "BORRADOR") {
    await enTransaccion((client) => revisarLiquidacion(client, ctx.empresaId, id, "PRESENTAR"));
  }

  const hecha = await enTransaccion(async (client) => {
    const l = await cargarLiquidacion(client, ctx, id, true);
    exigirTransicion(l, "PRESENTAR");

    const lineas = await lineasDe(client, id);
    const reglas = lineas.map(paraReglas);
    const bloqueos = bloqueosParaPresentar(reglas, conDuplicadoPendiente(lineas));
    if (bloqueos.length > 0) {
      throw new ErrorCaja(bloqueos[0].codigo, bloqueos[0].mensaje, 400, { bloqueos });
    }

    const { totalCentimos } = totalesPorConcepto(reglas);
    const periodo = periodoDe(reglas);
    await client.query(
      `UPDATE cash_expense_claims
          SET estado = 'PRESENTADA', total_centimos = $2, periodo_desde = $3, periodo_hasta = $4,
              presentada_por = $5, presentada_at_ms = $6, version = version + 1, updated_at_ms = $6
        WHERE id = $1`,
      [id, totalCentimos, periodo.desde, periodo.hasta, ctx.userId, Date.now()]
    );
    return cargarLiquidacion(client, ctx, id);
  });

  await auditar(ctx, hecha, "present", { totalCentimos: hecha.totalCentimos });
  return hecha;
}

/**
 * Aprobar: la da otra persona, si la separación de funciones está encendida.
 *
 * Es la primera bandeja de aprobación del módulo. `sod.ts` explica por qué no
 * había ninguna —el mostrador no puede esperar con el cliente delante— y por
 * qué aquí sí: una liquidación de gastos puede esperar de verdad.
 */
export async function aprobarLiquidacion(ctx: Contexto, id: number): Promise<Liquidacion> {
  const hecha = await enTransaccion(async (client) => {
    const l = await cargarLiquidacion(client, ctx, id, true);
    exigirTransicion(l, "APROBAR");
    await exigirOtraPersona(ctx.empresaId, ctx, l.presentadaPor, "aprobar esta liquidación");
    await exigirReautenticacion(ctx.empresaId, ctx.userId);

    const ahora = Date.now();
    await client.query(
      `UPDATE cash_expense_claims
          SET estado = 'APROBADA', aprobada_por = $2, aprobada_at_ms = $3,
              version = version + 1, updated_at_ms = $3
        WHERE id = $1`,
      [id, ctx.userId, ahora]
    );
    return cargarLiquidacion(client, ctx, id);
  });

  await auditar(ctx, hecha, "approve", { totalCentimos: hecha.totalCentimos });
  return hecha;
}

export async function rechazarLiquidacion(ctx: Contexto, id: number, motivo: string): Promise<Liquidacion> {
  const texto = textoObligatorio(motivo, "por qué se rechaza");
  const hecha = await enTransaccion(async (client) => {
    const l = await cargarLiquidacion(client, ctx, id, true);
    exigirTransicion(l, "RECHAZAR");
    const ahora = Date.now();
    await client.query(
      `UPDATE cash_expense_claims
          SET estado = 'RECHAZADA', rechazo_motivo = $2, rechazada_por = $3, rechazada_at_ms = $4,
              version = version + 1, updated_at_ms = $4
        WHERE id = $1`,
      [id, texto, ctx.userId, ahora]
    );
    return cargarLiquidacion(client, ctx, id);
  });

  await auditar(ctx, hecha, "reject", { motivo: texto });
  return hecha;
}

/**
 * Reabrir una rechazada para corregirla.
 *
 * El motivo del rechazo se CONSERVA: es justo lo que quien la corrige necesita
 * tener delante. Se pisa si vuelve a rechazarse; el rastro completo queda en
 * la auditoría.
 */
export async function reabrirLiquidacion(ctx: Contexto, id: number): Promise<Liquidacion> {
  const hecha = await enTransaccion(async (client) => {
    const l = await cargarLiquidacion(client, ctx, id, true);
    exigirTransicion(l, "REABRIR");
    const ahora = Date.now();
    await client.query(
      `UPDATE cash_expense_claims
          SET estado = 'BORRADOR', version = version + 1, updated_at_ms = $2
        WHERE id = $1`,
      [id, ahora]
    );
    return cargarLiquidacion(client, ctx, id);
  });

  await auditar(ctx, hecha, "reopen", {});
  return hecha;
}

/**
 * Anular. Nada se borra: la liquidación y sus tickets siguen ahí, con el
 * motivo, y dejan de contar para los duplicados de las demás.
 */
export async function anularLiquidacion(ctx: Contexto, id: number, motivo: string): Promise<Liquidacion> {
  const texto = textoObligatorio(motivo, "por qué se anula");
  const hecha = await enTransaccion(async (client) => {
    const l = await cargarLiquidacion(client, ctx, id, true);
    exigirTransicion(l, "ANULAR");
    const ahora = Date.now();
    await client.query(
      `UPDATE cash_expense_claims
          SET estado = 'ANULADA', anulada_motivo = $2, anulada_por = $3, anulada_at_ms = $4,
              version = version + 1, updated_at_ms = $4
        WHERE id = $1`,
      [id, texto, ctx.userId, ahora]
    );
    return cargarLiquidacion(client, ctx, id);
  });

  await auditar(ctx, hecha, "void", { motivo: texto });
  return hecha;
}

async function auditar(
  ctx: Contexto,
  l: Liquidacion,
  accion: string,
  detalle: Record<string, unknown>
): Promise<void> {
  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: `cash.expense_claim.${accion}`,
    entidad: "cash_expense_claims",
    entidadId: String(l.id),
    detalle: { numero: l.numero, estado: l.estado, ...detalle },
    ip: ctx.ip,
  });
}
