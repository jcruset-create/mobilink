import { Component, type ReactNode } from "react";

/**
 * La pantalla se quedaba en blanco después de cada despliegue.
 *
 * EL PORQUÉ, comprobado en Chromium sirviendo el dist real:
 *
 * Las sub-aplicaciones se cargan con `lazy()`, así que el navegador pide su
 * trozo cuando hace falta: /assets/TyreControlApp-<hash>.js. El hash cambia en
 * cada compilación. Quien tuviera la pestaña abierta durante un despliegue
 * sigue con el index.html viejo en memoria y pide un trozo que en el servidor
 * ya no existe.
 *
 * Y el servidor no decía que no existía: el catch-all devolvía index.html para
 * TODO, así que el trozo caducado llegaba con 200 y text/html. El navegador lo
 * rechaza como módulo, el import se rompe en pleno render y, sin nadie que lo
 * recoja, React desmonta el árbol entero. De ahí la pantalla blanca. Refrescar
 * lo arreglaba porque traía el index.html nuevo, con los hashes nuevos.
 *
 * El servidor ya devuelve un 404 honesto para los trozos que no existen (ver
 * el final de server/index.ts). Esto es la otra mitad: que el usuario no tenga
 * que refrescar a mano. Al detectar que ha fallado la descarga de un trozo se
 * recarga sola, que es exactamente lo que hacía él.
 *
 * SOLO UNA VEZ. Si tras recargar vuelve a fallar, ya no es un despliegue a
 * medias: es un fallo de verdad, y recargar en bucle lo escondería. Entonces
 * se enseña y se deja el botón, que es lo honesto.
 */

const YA_RECARGADO = "mobilink:recarga-por-despliegue";

/**
 * Cada navegador lo cuenta con sus palabras, y de ahí que se miren varias:
 * Chrome "Failed to fetch dynamically imported module", Firefox "error loading
 * dynamically imported module", Safari "Importing a module script failed".
 */
export function esTrozoCaducado(error: unknown): boolean {
  const m = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|Failed to load module script|error loading dynamically imported|Unable to preload CSS/i.test(m);
}

type Props = { children: ReactNode };
type Estado = { roto: boolean };

export default class RecuperarDespliegue extends Component<Props, Estado> {
  state: Estado = { roto: false };

  static getDerivedStateFromError(error: unknown): Estado | null {
    // Lo que no sea un trozo caducado no es asunto de este componente: se deja
    // subir para no disfrazar de "versión nueva" un error cualquiera.
    if (!esTrozoCaducado(error)) throw error;
    return { roto: true };
  }

  componentDidCatch(error: unknown) {
    if (!esTrozoCaducado(error)) return;
    let recargadoYa = true;
    try {
      recargadoYa = sessionStorage.getItem(YA_RECARGADO) === "1";
      if (!recargadoYa) sessionStorage.setItem(YA_RECARGADO, "1");
    } catch {
      // Navegación privada o cookies bloqueadas: sin memoria no se puede
      // garantizar que no entre en bucle, así que no se recarga sola.
      return;
    }
    if (!recargadoYa) window.location.reload();
  }

  render() {
    if (!this.state.roto) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 p-6 text-center">
        <div className="max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6">
          <p className="text-sm text-slate-200">Hay una versión nueva del panel.</p>
          <p className="mt-1 text-xs text-slate-400">
            No se ha podido cargar esta pantalla con la versión que tenías abierta.
          </p>
          <button
            type="button"
            onClick={() => {
              try { sessionStorage.removeItem(YA_RECARGADO); } catch { /* da igual */ }
              window.location.reload();
            }}
            className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            Recargar
          </button>
        </div>
      </div>
    );
  }
}
