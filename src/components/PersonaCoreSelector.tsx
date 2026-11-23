import { useEffect, useState } from "react";
import { API_BASE } from "../modules/workshopApi";
import { getAdminHeaders } from "../modules/adminHeaders";

/**
 * Elegir la persona de Core al dar de alta un técnico (fase C de la
 * unificación de operarios).
 *
 * Un técnico nuevo ya no es una persona nueva: es alguien de la plantilla de
 * Core al que se le da ficha de taller. Se busca por número de trabajador o
 * por nombre. Si Core no está disponible (base sin Core, o error), `onSinCore`
 * avisa y el alta sigue como antes, solo con nombre.
 */

export type PersonaCore = {
  id: string;
  nombre: string;
  numeroTrabajador: string | null;
  /** Nombre del técnico con el que ya está enlazada, si lo está. */
  tecnico: string | null;
};

type Props = {
  elegida: PersonaCore | null;
  onElegir: (p: PersonaCore | null) => void;
  onSinCore: () => void;
};

export default function PersonaCoreSelector({ elegida, onElegir, onSinCore }: Props) {
  const [personas, setPersonas] = useState<PersonaCore[] | null>(null);
  const [buscar, setBuscar] = useState("");

  useEffect(() => {
    let vivo = true;
    fetch(`${API_BASE}/api/techs/vinculo-core`, { headers: getAdminHeaders() })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error();
        const lista = ((body as { empleados?: PersonaCore[] } | null)?.empleados ?? []) as PersonaCore[];
        if (!vivo) return;
        if (lista.length === 0) onSinCore();
        else setPersonas(lista);
      })
      .catch(() => {
        if (vivo) onSinCore();
      });
    return () => {
      vivo = false;
    };
    // Solo al abrir el alta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (elegida) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
        <span className="text-sm font-bold text-slate-100">
          {elegida.nombre}
          {elegida.numeroTrabajador && (
            <span className="ml-2 text-xs font-normal text-slate-400">Nº {elegida.numeroTrabajador}</span>
          )}
        </span>
        <button
          type="button"
          onClick={() => onElegir(null)}
          className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-700"
        >
          Cambiar
        </button>
      </div>
    );
  }

  if (personas === null) {
    return <div className="text-xs text-slate-400">Cargando la plantilla de Core…</div>;
  }

  const texto = buscar.trim().toLowerCase();
  const sinEspacios = texto.replace(/\s+/g, "");
  const coincidencias = texto
    ? personas
        .filter((p) => (p.numeroTrabajador ?? "").toLowerCase() === sinEspacios || p.nombre.toLowerCase().includes(texto))
        .slice(0, 8)
    : [];

  return (
    <div>
      <input
        type="text"
        autoFocus
        placeholder="Nº de trabajador o nombre"
        value={buscar}
        onChange={(e) => setBuscar(e.target.value)}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
      />
      {coincidencias.length > 0 && (
        <ul className="mt-1 max-h-56 overflow-auto rounded-lg border border-slate-700 bg-slate-900">
          {coincidencias.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={p.tecnico !== null}
                onClick={() => onElegir(p)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-800 disabled:opacity-40"
              >
                <span>{p.nombre}</span>
                <span className="text-xs text-slate-400">
                  {p.tecnico ? `ya es «${p.tecnico}»` : p.numeroTrabajador ? `Nº ${p.numeroTrabajador}` : "sin número"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {texto && coincidencias.length === 0 && (
        <p className="mt-1 text-xs text-amber-300">Nadie en la plantilla con ese número o nombre.</p>
      )}
      <p className="mt-1 text-[11px] text-slate-500">
        Los técnicos salen de la plantilla de Core. Si no está, hay que darle de alta antes en Core → Empleados.
      </p>
    </div>
  );
}
