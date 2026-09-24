/**
 * El campo «Empresa que solicita», con el maestro de clientes detrás.
 *
 * Antes era texto libre, y por eso la misma empresa acababa escrita de cinco
 * maneras: no era la misma empresa para el ERP, ni para un listado por
 * cliente, ni para saber a quién se le factura.
 *
 * Lo que guarda NO es el nombre elegido: es el id de la ficha. El texto se
 * conserva al lado a propósito —es lo que se escribió ese día— pero lo que ata
 * la asistencia al cliente es el enlace.
 *
 * Va en su propio fichero porque `RoadsideAssistanceView` ya pasa de cuatro
 * mil líneas y esto trae estado propio: lo tecleado, lo que responde el
 * buscador, si la lista está abierta y el temporizador que evita una petición
 * por tecla.
 */
import { useEffect, useRef, useState } from "react";

import { apiFetch } from "../modules/apiFetch";
import { API_BASE } from "../modules/workshopApi";
import {
  contactoPropuesto,
  detalleDe,
  ofrecerAlta,
  tocaBuscar,
  type ClienteFrecuente,
  type ContactoCliente,
} from "../modules/clientesFrecuentes";

type Props = {
  valor: string;
  clienteId: number | null;
  /** El operador escribe a mano: cambia el texto y se suelta el enlace. */
  onTexto: (texto: string) => void;
  /** Ha elegido una ficha: llegan el cliente y el contacto que se propone. */
  onElegir: (cliente: ClienteFrecuente, contacto: ContactoCliente | null) => void;
  /** Ha dado de alta uno nuevo con lo que ya había escrito. */
  onAlta: (nombre: string) => void;
  /** Suelta el enlace y deja el texto tal cual. */
  onSoltar: () => void;
  /** Código en el ERP del cliente enlazado, para enseñarlo en la marca. */
  erpCode?: string | null;
};

export default function BuscadorCliente({
  valor,
  clienteId,
  onTexto,
  onElegir,
  onAlta,
  onSoltar,
  erpCode,
}: Props) {
  const [resultados, setResultados] = useState<ClienteFrecuente[]>([]);
  const [abierta, setAbierta] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const caja = useRef<HTMLDivElement | null>(null);

  /*
   * Una petición por tecla dejaría el buscador contestando a «E», «En», «Enc»…
   * y pintando la respuesta que llegue la última, que no tiene por qué ser la
   * de lo último escrito. Con 250 ms se busca cuando se para de teclear.
   */
  useEffect(() => {
    if (clienteId != null || !tocaBuscar(valor)) {
      setResultados([]);
      return;
    }
    let vigente = true;
    setBuscando(true);
    const t = setTimeout(() => {
      apiFetch(`${API_BASE}/api/clientes-frecuentes?q=${encodeURIComponent(valor.trim())}`)
        .then((r) => r.json())
        .then((d) => {
          if (!vigente) return;
          setResultados(Array.isArray(d?.data) ? d.data : []);
        })
        .catch(() => {
          // Que el buscador no conteste no puede impedir dar de alta la
          // asistencia: se queda como el texto libre de siempre.
          if (vigente) setResultados([]);
        })
        .finally(() => {
          if (vigente) setBuscando(false);
        });
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [valor, clienteId]);

  // Pulsar fuera cierra la lista. Sin esto se queda abierta tapando los campos
  // de debajo, que es justo donde hay que escribir después.
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierta(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierta]);

  const puedeAlta = clienteId == null && ofrecerAlta(valor, resultados);
  const hayLista = abierta && clienteId == null && (resultados.length > 0 || puedeAlta);

  return (
    <div className="relative" ref={caja}>
      <span className="mb-1 block text-xs font-semibold text-slate-400">
        Empresa que solicita
      </span>
      <input
        value={valor}
        onChange={(e) => {
          onTexto(e.target.value);
          setAbierta(true);
        }}
        onFocus={() => setAbierta(true)}
        placeholder="P. ej. aseguradora, gestor de flota…"
        autoComplete="off"
        className={`w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/40 ${
          clienteId != null
            ? "border-emerald-700/60 bg-emerald-950/30"
            : "border-slate-700 bg-slate-950"
        }`}
      />

      {/* Enlazado: se dice a QUÉ ficha, porque «Encatrans» a secas no distingue
          una de otra, y se puede soltar. */}
      {clienteId != null && (
        <div className="mt-1 inline-flex items-center gap-2 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
          <span>
            Cliente #{clienteId}
            {erpCode ? ` · ERP ${erpCode}` : ""}
          </span>
          <button
            type="button"
            onClick={onSoltar}
            title="Soltar el enlace y dejar el texto"
            className="text-slate-400 hover:text-slate-200"
          >
            ✕
          </button>
        </div>
      )}

      {hayLista && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-slate-600 bg-slate-950 shadow-xl shadow-black/50">
          {resultados.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onElegir(c, contactoPropuesto(c.contactos));
                setAbierta(false);
              }}
              className="flex w-full items-start gap-3 border-b border-slate-800 px-3 py-2 text-left last:border-b-0 hover:bg-slate-800/70"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-slate-100">{c.name}</span>
                {detalleDe(c) && (
                  <span className="block truncate text-[11px] text-slate-500">{detalleDe(c)}</span>
                )}
              </span>
              <span className="ml-auto shrink-0 pt-0.5 text-[10px] font-bold">
                {c.erpCode ? (
                  <span className="rounded-full border border-blue-400/40 bg-blue-500/15 px-2 py-0.5 text-blue-300">
                    ERP {c.erpCode}
                  </span>
                ) : (
                  <span className="rounded-full border border-slate-600/50 bg-slate-700/20 px-2 py-0.5 text-slate-400">
                    Sin ERP
                  </span>
                )}
              </span>
            </button>
          ))}

          {/* El alta se hace aquí. Si obligara a irse a la pantalla de Clientes
              nadie lo haría, se seguiría escribiendo a mano, y los duplicados
              que esto viene a evitar seguirían apareciendo igual. */}
          {puedeAlta && (
            <button
              type="button"
              onClick={() => {
                onAlta(valor.trim());
                setAbierta(false);
              }}
              className="flex w-full items-center gap-2 border-t border-emerald-800/50 bg-emerald-950/40 px-3 py-2 text-left text-xs font-semibold text-emerald-300 hover:bg-emerald-900/40"
            >
              <span className="text-base leading-none">+</span>
              Dar de alta «{valor.trim()}» como cliente nuevo
            </button>
          )}
        </div>
      )}

      {buscando && clienteId == null && (
        <div className="mt-1 text-[11px] text-slate-500">Buscando…</div>
      )}
    </div>
  );
}
