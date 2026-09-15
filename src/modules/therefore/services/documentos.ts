/**
 * Abrir en otra pestaña un documento cuyo enlace hay que pedir al servidor.
 *
 * La ventana se abre ANTES de la petición: los navegadores sólo dejan abrir
 * ventanas como respuesta directa a un clic, y un `window.open` después de un
 * `await` cae en el bloqueador de ventanas emergentes sin avisar a nadie. Se
 * abre vacía, se le pone la URL cuando llega y, si algo falla, se cierra.
 */
export async function abrirEnPestana(pedirUrl: () => Promise<string>): Promise<void> {
  const ventana = window.open("about:blank", "_blank");
  try {
    const url = await pedirUrl();
    if (!ventana) {
      throw new Error(
        "El navegador ha bloqueado la ventana. Permite las ventanas emergentes para este sitio o abre el documento desde la pestaña Documentos."
      );
    }
    ventana.opener = null;
    ventana.location.href = url;
  } catch (e) {
    ventana?.close();
    throw e;
  }
}

/** Sólo lo que el navegador puede enseñar dentro de la página. */
export function esVisible(a: { storagePath: string | null; mimeType: string }): boolean {
  return !!a.storagePath && a.mimeType.toLowerCase() === "application/pdf";
}

export function nombreAdjunto(a: { nombreArchivo: string; hashArchivo: string }): string {
  return a.nombreArchivo || a.hashArchivo.slice(0, 8);
}

export function tamanoLegible(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
