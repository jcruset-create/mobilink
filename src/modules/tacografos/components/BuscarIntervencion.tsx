/**
 * Trae los datos de una intervención de taller al expediente nuevo.
 *
 * Sólo aparece si el centro tiene TyreControl: sin él no hay intervenciones que
 * traer, y un buscador que nunca devuelve nada es peor que no tenerlo.
 *
 * Rellena lo que sabe el taller —cliente, matrícula, bastidor, fecha y
 * técnico— y **nada más**. El nº de informe no se toca: lo asigna la extranet
 * de VDO al emitir el anexo II, y copiarlo de otro sitio sería inventarlo.
 */

import { useEffect, useState } from "react";
import { Link2, Search } from "lucide-react";
import * as api from "../services/api";
import type { Sugerencia } from "../types";

type Props = { onElegir: (s: Sugerencia) => void };

export default function BuscarIntervencion({ onElegir }: Props) {
  const [texto, setTexto] = useState("");
  const [sugerencias, setSugerencias] = useState<Sugerencia[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    // El vaciado va en el `onChange` y no aquí: un `setState` síncrono dentro
    // de un efecto provoca renders en cascada, y el linter lo rechaza.
    if (texto.trim().length < 2) return;
    let vivo = true;
    // Se espera a que deje de teclear: una consulta por letra contra el
    // histórico del taller no aporta nada.
    const t = setTimeout(() => {
      void (async () => {
        setBuscando(true);
        try {
          const r = await api.buscarIntervenciones(texto);
          if (vivo) setSugerencias(r.sugerencias);
        } catch {
          if (vivo) setSugerencias([]);
        } finally {
          if (vivo) setBuscando(false);
        }
      })();
    }, 300);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [texto]);

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-slate-800">
      <h2 className="bg-slate-800/70 px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-slate-200">
        Traer de una intervención de taller
      </h2>
      <div className="p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={texto}
            onChange={(e) => {
              const v = e.target.value;
              setTexto(v);
              if (v.trim().length < 2) setSugerencias([]);
            }}
            placeholder="Matrícula, nº de parte o empresa"
            className="w-full rounded-lg border border-slate-600 bg-slate-900 py-2 pl-9 pr-3 text-[13px] outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
        {buscando && <p className="mt-2 text-[12px] text-slate-400">Buscando…</p>}
        {!buscando && texto.trim().length >= 2 && sugerencias.length === 0 && (
          <p className="mt-2 text-[12px] text-slate-400">Ninguna intervención coincide.</p>
        )}
        {sugerencias.length > 0 && (
          <ul className="mt-2 space-y-1">
            {sugerencias.map((s) => (
              <li key={s.intervencionId}>
                <button
                  onClick={() => onElegir(s)}
                  className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-slate-700 p-2 text-left text-[13px] hover:bg-slate-800"
                >
                  <Link2 className="h-4 w-4 shrink-0 text-sky-400" />
                  <span className="font-semibold">{s.matricula}</span>
                  <span className="text-slate-300">{s.empresaCliente}</span>
                  {s.numero && <span className="text-slate-400">{s.numero}</span>}
                  {s.fecha && (
                    <span className="ml-auto text-slate-400">
                      {s.fecha.split("-").reverse().join("/")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          Se copian cliente, matrícula, bastidor, fecha y técnico. El nº de informe lo asigna la
          extranet de VDO: hay que teclearlo.
        </p>
      </div>
    </section>
  );
}
