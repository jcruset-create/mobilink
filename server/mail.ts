/**
 * El transporte de correo saliente, en un sitio.
 *
 * Estaba dentro de index.ts y solo lo usaba él. Al necesitarlo también el
 * vigilante del buzón del CheckPoint, sacarlo aquí evita que un módulo
 * importe del index —que a su vez lo importa a él— y que acaben existiendo
 * dos transportes con la misma configuración.
 *
 * Devuelve null si no hay SMTP configurado, y quien llama decide qué hacer:
 * un aviso que no se puede mandar no debe tumbar la operación que lo generó.
 */
import nodemailer from "nodemailer";

let transporte: import("nodemailer").Transporter | null = null;

export function getMailTransport(): import("nodemailer").Transporter | null {
  if (transporte) return transporte;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporte;
}
