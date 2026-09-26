/**
 * Mandar un PDF de la API a la impresora sin que nadie tenga que abrirlo.
 *
 * Se carga en un iframe invisible y se llama a `print()` sobre él: sale el
 * diálogo de impresión del navegador con el PDF dentro, como si se hubiera
 * abierto y pulsado Ctrl+P. No se abre una pestaña nueva porque, lanzada
 * después de esperar al servidor, el navegador la tomaría por una ventana
 * emergente y la bloquearía.
 *
 * Imprimir sin diálogo ninguno no lo deja hacer un navegador a una página web,
 * y está bien que no: lo tiene que activar quien administra el PC (Chrome con
 * `--kiosk-printing`).
 */

import { descargarPdf } from "../services/api";

/** Cuánto se deja vivo el iframe: el diálogo de impresión lo necesita abierto. */
const VIDA_MS = 5 * 60_000;

export async function imprimirPdf(ruta: string): Promise<void> {
  const blob = await descargarPdf(ruta);
  const url = URL.createObjectURL(blob);
  const marco = document.createElement("iframe");
  marco.setAttribute("aria-hidden", "true");
  marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";

  await new Promise<void>((resolve, reject) => {
    marco.onload = () => {
      try {
        marco.contentWindow?.focus();
        marco.contentWindow?.print();
        resolve();
      } catch {
        reject(new Error("El navegador no ha dejado imprimir. Pulsa «Imprimir el cierre»."));
      }
    };
    marco.src = url;
    document.body.appendChild(marco);
  });

  setTimeout(() => {
    marco.remove();
    URL.revokeObjectURL(url);
  }, VIDA_MS);
}
