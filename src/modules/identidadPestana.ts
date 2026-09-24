/**
 * Identidad de la pestaña del navegador (título y favicon) por módulo.
 *
 * El panel entero es UNA sola página: `index.html` trae el título "Mobilink" y
 * el favicon genérico, y todos los módulos comparten esa pestaña. Un módulo que
 * quiera la suya la pide con `useIdentidadPestana` y aquí se deshace el cambio
 * al salir; si no se deshiciera, el usuario que va de Cash a TyreControl se
 * quedaría con "Mobilink Cash" en la pestaña, que es peor que no personalizar
 * nada.
 *
 * Solo se toca lo que el módulo declara: quien no llame a este hook sigue
 * exactamente como estaba.
 */

import { useEffect } from "react";

export type IconoPestana = {
  rel: string;            // "icon" | "apple-touch-icon"
  href: string;
  type?: string;
  sizes?: string;
};

export type IdentidadPestana = {
  titulo: string;
  iconos: IconoPestana[];
};

const SELECTOR_ICONOS = 'link[rel~="icon"], link[rel="apple-touch-icon"]';

/**
 * Aplica el título y los iconos de un módulo mientras el componente esté
 * montado, y devuelve la pestaña a como estaba al desmontarlo.
 *
 * Las rutas hijas del módulo no lo desmontan, así que el título aguanta la
 * navegación interna sin tener que reescribirlo en cada pantalla.
 */
export function useIdentidadPestana(identidad: IdentidadPestana | null): void {
  const titulo = identidad?.titulo ?? null;
  // Las dependencias de un efecto se comparan por identidad, y el array de
  // iconos se vuelve a crear en cada render. Se compara por su contenido para
  // no reinstalar los <link> sesenta veces por minuto.
  const huellaIconos = JSON.stringify(identidad?.iconos ?? []);

  useEffect(() => {
    if (!titulo) return;

    const tituloPrevio = document.title;
    const iconosPrevios = Array.from(document.querySelectorAll(SELECTOR_ICONOS));
    // Se guarda el HTML y no el nodo: al reinsertar un <link> ya usado, algunos
    // navegadores no vuelven a pedir el icono y la pestaña se queda en blanco.
    const htmlPrevio = iconosPrevios.map((l) => l.outerHTML);

    document.title = titulo;
    iconosPrevios.forEach((l) => l.remove());
    for (const icono of JSON.parse(huellaIconos) as IconoPestana[]) {
      const link = document.createElement("link");
      link.rel = icono.rel;
      link.href = icono.href;
      if (icono.type) link.type = icono.type;
      if (icono.sizes) link.setAttribute("sizes", icono.sizes);
      document.head.appendChild(link);
    }

    return () => {
      document.title = tituloPrevio;
      document.querySelectorAll(SELECTOR_ICONOS).forEach((l) => l.remove());
      document.head.insertAdjacentHTML("beforeend", htmlPrevio.join(""));
    };
  }, [titulo, huellaIconos]);
}
