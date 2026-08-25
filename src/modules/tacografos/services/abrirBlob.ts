/**
 * Abre un blob en una pestaña nueva, o lo descarga si el navegador bloquea la
 * ventana emergente.
 *
 * El `window.open` va después de un `await` (la descarga autenticada), así que
 * depende de que la activación del clic siga viva; cuando el bloqueador gana,
 * el plan B es un enlace de descarga programático, que no está sujeto a esa
 * regla. El objeto se revoca tarde a propósito: revocarlo al momento rompe la
 * pestaña recién abierta en algunos navegadores.
 */
export function abrirBlob(blob: Blob, nombreDescarga: string): void {
  const url = URL.createObjectURL(blob);
  const ventana = window.open(url, "_blank");
  if (!ventana) {
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreDescarga;
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Descarga directa, para lo que no se mira sino que se guarda (el .xlsx). */
export function descargarBlob(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
