import { useEffect, useState } from "react";
import { API_BASE } from "../modules/workshopApi";
import { getAdminHeaders } from "../modules/adminHeaders";

/**
 * Elegir la persona de Core al dar de alta un técnico (fase C de la
 * unificación de operarios).
 *
 * Un técnico nuevo ya no es una persona nueva: es alguien de la plantilla de
 * Core al que se le da ficha de taller: un desplegable con la plantilla de
 * alta, por nombre y con su número de trabajador. Si Core no está disponible (base sin Core, o error), `onSinCore`
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

  // Desplegable con toda la plantilla de alta, por nombre. Quien ya tiene
  // ficha de taller aparece pero no se puede elegir: se ve que existe y de
  // quién es, en vez de preguntarse por qué no sale.
  const ordenadas = [...personas].sort((x, y) => x.nombre.localeCompare(y.nombre, "es"));
  const libres = ordenadas.filter((p) => p.tecnico === null).length;

  return (
    <div>
      <select
        autoFocus
        value=""
        onChange={(e) => {
          const p = personas.find((x) => x.id === e.target.value);
          if (p) onElegir(p);
        }}
        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-sky-500"
      >
        <option value="">— Elige a la persona ({libres} sin ficha de taller) —</option>
        {ordenadas.map((p) => (
          <option key={p.id} value={p.id} disabled={p.tecnico !== null}>
            {p.nombre}
            {p.numeroTrabajador ? ` · Nº ${p.numeroTrabajador}` : ""}
            {p.tecnico ? ` · ya es «${p.tecnico}»` : ""}
          </option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-slate-500">
        Los técnicos salen de la plantilla de Core. Si no está, hay que darle de alta antes en Core → Empleados.
      </p>
    </div>
  );
}
