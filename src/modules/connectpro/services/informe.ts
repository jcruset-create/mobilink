/**
 * Apertura del informe PDF de una asistencia.
 *
 * Siempre se pide al backend que lo rehaga y lo archive en la ficha, y se abre
 * el que devuelve. Abrir directamente la URL archivada servía la copia del día
 * en que se cerró el servicio, con datos y formato antiguos; el informe se
 * construye en segundos a partir de la asistencia, así que la copia vigente es
 * siempre la que se ve. Funciona igual desde el listado, la ficha o activas.
 */

import { boFetch } from "./api";

const ESPERA = `<!doctype html><meta charset="utf-8"><title>Generando el informe…</title>
<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;
             font:15px system-ui,sans-serif;background:#0f172a;color:#cbd5e1">
Generando el informe de la asistencia…</body>`;

export async function abrirInforme(assistanceId: number): Promise<void> {
  // La pestaña se abre antes del await: si se abriera después, el navegador la
  // bloquearía por no venir de un gesto directo del usuario. Sin "noopener"
  // porque con esa opción window.open devuelve null y perderíamos el destino;
  // el enlace al hijo se corta a mano en cuanto se ha navegado.
  const ventana = window.open("", "_blank");
  ventana?.document.write(ESPERA);
  try {
    const r = await boFetch<{ url: string }>(`/assistances/${assistanceId}/report`, { method: "POST" });
    if (ventana) {
      ventana.opener = null;
      ventana.location.replace(r.url);
    } else {
      window.open(r.url, "_blank", "noopener");
    }
  } catch (e) {
    ventana?.close();
    throw e;
  }
}
