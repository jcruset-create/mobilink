/**
 * Envío del resguardo de un ingreso a la central.
 *
 * El taller ingresa y la central concilia: entre las dos cosas había un correo
 * a mano con el PDF y la foto del resguardo adjuntos, que es justo el paso que
 * se olvida cuando el día viene torcido. Aquí va todo junto —resguardo,
 * comprobante escaneado y a qué cuenta fue— con un botón.
 *
 * Módulo aparte y no dentro de `bankdeposits.ts` porque el correo es un
 * accesorio: `bankdeposits` tiene que poder cargarse en un entorno sin SMTP
 * —las pruebas, un despliegue sin correo— sin arrastrar nada de esto.
 */

import pool from "../db.ts";
import { getMailTransport } from "../mail.ts";
import { registrarAuditoria } from "../core/auditoria.ts";
import { ErrorCaja } from "./repository.ts";
import { formatearEuros } from "./domain/money.ts";
import { formatearIban } from "./domain/bankaccount.ts";
import { leerDocumento } from "./storage.ts";
import { informeIngreso } from "./report.ts";
import { ajustes } from "./config.ts";
import type { Contexto } from "./service.ts";

const eur = (c: number) => `${formatearEuros(c)} €`;

export type ResultadoEnvio = {
  destinatarios: string[];
  adjuntos: string[];
};

/**
 * Manda el resguardo a la central.
 *
 * Se exige que el ingreso esté CONFIRMADO EN EL BANCO —con su fecha real— y no
 * solo registrado: el correo dice «ya está ingresado», y mandarlo antes de
 * volver del banco sería afirmar algo que todavía no ha pasado.
 */
export async function enviarResguardoALaCentral(
  ctx: Contexto,
  depositId: number
): Promise<ResultadoEnvio> {
  const transporte = getMailTransport();
  if (!transporte) {
    throw new ErrorCaja(
      "SMTP_NO_CONFIGURADO",
      "No hay servidor de correo configurado en este servidor. Descarga el resguardo y mándalo a mano.",
      503
    );
  }

  const { correoCentral } = await ajustes(ctx.empresaId);
  const destinatarios = (correoCentral ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  if (destinatarios.length === 0) {
    throw new ErrorCaja(
      "SIN_CORREO_CENTRAL",
      "Falta el correo de la central. Ponlo en Configuración → Ingresos bancarios.",
      409
    );
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { rows } = await pool.query<any>(
    `SELECT d.*, c.banco, c.iban,
            COALESCE(r.centro || ' · ', '') || r.nombre AS caja, r.codigo
       FROM cash_bank_deposits d
       JOIN cash_registers r ON r.id = d.register_id
       LEFT JOIN cash_bank_accounts c ON c.id = d.bank_account_id
      WHERE d.id = $1 AND d.empresa_id = $2`,
    [depositId, ctx.empresaId]
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
  if (rows.length === 0) {
    throw new ErrorCaja("INGRESO_NO_ENCONTRADO", "El ingreso no existe.", 404);
  }
  const ing = rows[0];

  if (ing.estado !== "CONFIRMADO") {
    throw new ErrorCaja("INGRESO_ANULADO", "Un ingreso anulado no se manda a la central.", 409);
  }
  if (!ing.fecha_ingreso) {
    throw new ErrorCaja(
      "INGRESO_SIN_CONFIRMAR",
      "Este ingreso todavía no está confirmado en el banco. Pon la fecha real antes de mandarlo.",
      409
    );
  }

  const fecha = String(
    ing.fecha_ingreso instanceof Date
      ? ing.fecha_ingreso.toISOString().slice(0, 10)
      : ing.fecha_ingreso
  );

  // El resguardo se genera al vuelo: así el correo lleva SIEMPRE la versión
  // buena, aunque después de crearlo se le haya cambiado la cuenta o la fecha.
  const adjuntos: { filename: string; content: Buffer }[] = [
    { filename: `${ing.numero}.pdf`, content: await informeIngreso(ctx.empresaId, depositId) },
  ];

  /*
   * Y los comprobantes escaneados. Uno ilegible o que ya no está en el
   * almacenamiento NO tumba el envío: se manda lo que hay y el cuerpo dice
   * cuántos van, que es preferible a que la central no reciba nada.
   */
  const { rows: docs } = await pool.query<{ nombre: string; ruta: string }>(
    `SELECT nombre, ruta FROM cash_operation_documents
      WHERE empresa_id = $1 AND deposit_id = $2 AND NOT anulado
      ORDER BY id`,
    [ctx.empresaId, depositId]
  );
  for (const d of docs) {
    const contenido = await leerDocumento(d.ruta);
    if (contenido) adjuntos.push({ filename: d.nombre, content: contenido });
  }

  const cuenta = ing.banco
    ? `${ing.banco} · ${formatearIban(ing.iban ?? "")}`
    : "sin especificar";

  const lineas = [
    `Ingreso ${ing.numero}`,
    `Caja: ${ing.caja}`,
    `Fecha del ingreso: ${fecha}`,
    `Importe: ${eur(Number(ing.importe_centimos))}`,
    `Cuenta: ${cuenta}`,
    ing.referencia ? `Referencia bancaria: ${ing.referencia}` : null,
    "",
    adjuntos.length > 1
      ? `Se adjuntan el resguardo y ${adjuntos.length - 1} comprobante(s) del banco.`
      : "Se adjunta el resguardo. Todavía no hay comprobante del banco escaneado.",
    ing.observaciones ? `\nObservaciones: ${ing.observaciones}` : null,
  ].filter((l) => l !== null);

  await transporte.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: destinatarios.join(", "),
    subject: `Ingreso bancario ${ing.numero} · ${ing.caja} · ${eur(Number(ing.importe_centimos))}`,
    text: lineas.join("\n"),
    attachments: adjuntos,
  });

  await registrarAuditoria({
    empresaId: ctx.empresaId,
    userId: ctx.userId,
    accion: "cash.deposit.email",
    entidad: "cash_bank_deposits",
    entidadId: String(depositId),
    detalle: { numero: ing.numero, destinatarios, adjuntos: adjuntos.length },
    ip: ctx.ip,
  });

  return { destinatarios, adjuntos: adjuntos.map((a) => a.filename) };
}
