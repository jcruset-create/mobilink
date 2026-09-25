import { useEffect, useState } from "react";

/**
 * Qué build está viendo el navegador y qué está desplegado en el servidor.
 *
 * ── Por qué dos datos y no uno ──────────────────────────────────────────────
 *
 * El número sirve para hablar; **el commit es el que decide** si un arreglo
 * está desplegado. Render pone `RENDER_GIT_COMMIT` al desplegar y el servidor
 * lo devuelve en `/api/health`, así que ese dato no depende de que nadie se
 * acuerde de subir nada a mano.
 *
 * ── De dónde sale el número ─────────────────────────────────────────────────
 *
 * De `__APP_VERSION__`, que es el `package.json` incrustado por Vite al
 * compilar. Antes salía de `src/version.ts`, que se sube A MANO y por eso se
 * quedaba atrás: la cabecera decía un número mientras entraban entregas con
 * otro, que es justo lo contrario de lo que esta etiqueta existe para hacer.
 *
 * ── Y por qué se comparan los dos números ───────────────────────────────────
 *
 * Porque el del bundle es el que el NAVEGADOR tiene cargado y el de
 * `/api/health` es el que el SERVIDOR está sirviendo. Si no coinciden, lo que
 * se está mirando es un bundle viejo de la caché, y eso explica la mitad de
 * los «pues a mí me sigue saliendo igual». Cuando pasa se enseñan los dos.
 *
 * ── Por qué es un componente y no un trozo de cabecera ──────────────────────
 *
 * Nació dentro de WorkPlanner. Cuando hizo falta lo mismo en TyreControl, la
 * alternativa era copiarlo: dos `fetch` al mismo sitio y dos maquetaciones que
 * mañana dirían cosas distintas. Vive aquí para que el día que cambie —otro
 * endpoint, otro formato— cambie en un sitio.
 *
 * Si `/api/health` no contesta se enseña solo la versión del bundle. Una
 * cabecera no se rompe porque no se sepa el commit.
 */
export default function VersionDesplegada({ className = "" }: { className?: string }) {
  const [servidor, setServidor] = useState<{ commit?: string; version?: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    const base = import.meta.env.PROD ? "" : "http://localhost:4000";
    fetch(`${base}/api/health`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d) setServidor({ commit: d.commit ?? undefined, version: d.version ?? undefined });
      })
      .catch(() => {
        /* sin respuesta se enseña solo la versión del bundle */
      });
    return () => {
      vivo = false;
    };
  }, []);

  const commit = servidor?.commit ?? null;
  // Sólo se enseña el del servidor cuando NO es el que tiene el navegador.
  const desfase = servidor?.version && servidor.version !== __APP_VERSION__ ? servidor.version : null;

  return (
    <span
      className={`rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold ${
        desfase ? "text-amber-300" : "text-slate-400"
      } ${className}`}
      title={
        [
          `Panel cargado: ${__APP_VERSION__}`,
          servidor?.version ? `Servidor: ${servidor.version}` : null,
          commit ? `Commit desplegado: ${commit}` : null,
          desfase ? "El navegador tiene un bundle viejo: recarga con Ctrl+F5." : null,
        ]
          .filter(Boolean)
          .join(" · ")
      }
    >
      v{__APP_VERSION__}
      {desfase && <span className="ml-1 font-normal">(servidor v{desfase})</span>}
      {commit && <span className="ml-1 font-mono text-[9px] text-slate-500">{commit}</span>}
    </span>
  );
}
