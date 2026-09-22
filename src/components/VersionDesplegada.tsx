import { useEffect, useState } from "react";
import { APP_VERSION } from "../version";

/**
 * La versión del panel y el commit que corre en el servidor.
 *
 * ── Por qué dos números y no uno ────────────────────────────────────────────
 *
 * `APP_VERSION` se sube A MANO en el PR que cambia algo, así que se queda
 * atrás en cuanto alguien se olvida: hubo tres días con arreglos entrando y la
 * pantalla poniendo la misma versión. El commit lo pone Render al desplegar y
 * no depende de que nadie se acuerde.
 *
 * El número sirve para hablar; **el commit es el que decide** si un arreglo
 * está desplegado. Esa distinción es el motivo de que se enseñen los dos.
 *
 * ── Por qué es un componente y no un trozo de cabecera ──────────────────────
 *
 * Nació dentro de WorkPlanner. Cuando hizo falta lo mismo en TyreControl, la
 * alternativa era copiarlo: dos `fetch` al mismo sitio y dos maquetaciones que
 * mañana dirían cosas distintas. Vive aquí para que el día que cambie —otro
 * endpoint, otro formato— cambie en un sitio.
 *
 * Si `/api/health` no contesta se enseña solo la versión. Una cabecera no se
 * rompe porque no se sepa el commit.
 */
export default function VersionDesplegada({ className = "" }: { className?: string }) {
  const [commit, setCommit] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const base = import.meta.env.PROD ? "" : "http://localhost:4000";
    fetch(`${base}/api/health`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d?.commit) setCommit(String(d.commit));
      })
      .catch(() => {
        /* sin commit se enseña solo la versión */
      });
    return () => { vivo = false; };
  }, []);

  return (
    <span
      className={`rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-400 ${className}`}
      title={commit ? `Servidor desplegado: ${commit}` : "Versión del panel"}
    >
      {APP_VERSION}
      {commit && <span className="ml-1 font-mono text-[9px] text-slate-500">{commit}</span>}
    </span>
  );
}
