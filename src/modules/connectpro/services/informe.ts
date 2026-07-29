/**
 * Apertura del informe PDF de una asistencia.
 *
 * El PDF vive en el almacenamiento (URL pública) en cuanto se genera al
 * cerrar el servicio. Si todavía no existe, se pide al backend que lo genere
 * y lo archive en la ficha, y se abre el que devuelve. Así el enlace funciona
 * igual desde el listado, la ficha o la ventana de activas.
 */

import { boFetch } from "./api";

export async function abrirInforme(assistanceId: number, reportUrl?: string | null): Promise<void> {
  if (reportUrl) {
    window.open(reportUrl, "_blank", "noopener");
    return;
  }
  // Se abre la pestaña antes del await: si se abre después, el navegador la
  // bloquea por no venir de un gesto directo del usuario.
  const ventana = window.open("", "_blank", "noopener");
  try {
    const r = await boFetch<{ url: string }>(`/assistances/${assistanceId}/report`, { method: "POST" });
    if (ventana) ventana.location.href = r.url;
    else window.open(r.url, "_blank", "noopener");
  } catch (e) {
    ventana?.close();
    throw e;
  }
}
