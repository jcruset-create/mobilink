/**
 * El expediente administrativo de una asistencia: qué papeles hay, cuáles
 * faltan y en qué punto está el cobro.
 *
 * Va aparte del estado del servicio a propósito, porque son dos verdades a la
 * vez: la grúa puede haber terminado hace tres días y el albarán no haber
 * llegado. Antes había que elegir cuál de las dos enseñar, y la que se perdía
 * siempre era ésta.
 *
 * El estado NO se elige aquí: se deduce en el servidor de lo que hay. Lo que sí
 * son decisiones —validar el coste, dar por facturado— tienen su botón.
 */

import { useCallback, useEffect, useState } from "react";
import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

type Documento = {
  uuid: string;
  tipo: string;
  origen: string;
  visibilidad: "interno" | "compartido" | "cliente";
  url: string | null;
  fileName: string | null;
  documentNumber: string | null;
  amount: number | null;
  createdAtMs: number;
};

type Situacion = {
  estado: string | null;
  etiqueta: string | null;
  faltan: string[];
  faltanEtiquetas: string[];
  documentos: Documento[];
};

const TONO_ADMIN: Record<string, string> = {
  SIN_DOCUMENTACION: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  PENDIENTE_ALBARAN: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  PENDIENTE_FACTURA: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  DOCUMENTACION_COMPLETA: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  COSTE_PENDIENTE: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  COSTE_VALIDADO: "border-lime-500/40 bg-lime-500/10 text-lime-300",
  LISTA_PARA_FACTURAR: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  FACTURADA: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
};

const ETIQUETA_TIPO: Record<string, string> = {
  albaran: "Albarán", parte: "Parte", factura: "Factura", presupuesto: "Presupuesto",
  fotografia: "Foto", autorizacion: "Autorización", firma: "Firma", otro: "Otro",
};

/** Qué significa cada visibilidad, en una palabra que se entienda al vuelo. */
const ETIQUETA_VISIBILIDAD: Record<string, string> = {
  interno: "solo nosotros",
  compartido: "la plataforma lo ve",
  cliente: "sale en el informe",
};

async function pedir(ruta: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}${ruta}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...getAdminHeaders() },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Error de servidor");
  return data;
}

export default function ExpedienteAdministrativo({ assistanceId }: { assistanceId: number }) {
  const [s, setS] = useState<Situacion | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [alta, setAlta] = useState({ tipo: "albaran", documentNumber: "", origen: "propio" });

  const cargar = useCallback(async () => {
    try {
      setS(await pedir(`/api/documentos/asistencias/${assistanceId}/situacion`));
      setError("");
    } catch (e: any) { setError(e.message); }
  }, [assistanceId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const accion = async (ruta: string, cuerpo?: unknown) => {
    setBusy(true); setError("");
    try {
      await pedir(ruta, { method: "POST", body: JSON.stringify(cuerpo ?? {}) });
      await cargar();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  const registrar = async () => {
    await accion(`/api/documentos/asistencias/${assistanceId}/documentos`, {
      tipo: alta.tipo,
      origen: alta.origen,
      documentNumber: alta.documentNumber.trim() || null,
    });
    setAlta({ ...alta, documentNumber: "" });
  };

  const cambiarVisibilidad = async (uuid: string, visibilidad: string) => {
    setBusy(true); setError("");
    try {
      await pedir(`/api/documentos/documentos/${uuid}/visibilidad`, {
        method: "PATCH", body: JSON.stringify({ visibilidad }),
      });
      await cargar();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  if (!s) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-[12px] text-slate-500">
        {error || "Cargando expediente…"}
      </div>
    );
  }

  const puedeValidar = s.faltan.length === 0 && s.estado !== "FACTURADA"
    && s.estado !== "LISTA_PARA_FACTURAR" && s.estado !== "COSTE_VALIDADO";
  const puedeFacturar = s.estado === "LISTA_PARA_FACTURAR";

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-slate-300">
          Expediente
        </span>
        {s.estado && (
          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${TONO_ADMIN[s.estado] ?? ""}`}>
            {s.etiqueta}
          </span>
        )}
        <span className="text-[11px] text-slate-500">
          Independiente del estado del servicio
        </span>
      </div>

      {error && <p className="mb-2 text-[12px] text-red-300">{error}</p>}

      {s.faltanEtiquetas.length > 0 && (
        <p className="mb-2 text-[12px] text-amber-300">
          Falta: {s.faltanEtiquetas.join(", ")}
        </p>
      )}

      {s.documentos.length === 0 ? (
        <p className="mb-2 text-[12px] text-slate-500">Todavía no hay documentos.</p>
      ) : (
        <ul className="mb-2 space-y-1 text-[13px]">
          {s.documentos.map((d) => (
            <li key={d.uuid} className="flex flex-wrap items-center gap-2 border-b border-slate-700/40 pb-1">
              <span className="font-semibold text-slate-100">
                {ETIQUETA_TIPO[d.tipo] ?? d.tipo}
              </span>
              {d.documentNumber && <span className="text-slate-400">{d.documentNumber}</span>}
              {d.origen === "proveedor" && (
                <span className="rounded border border-slate-600 px-1.5 text-[10px] text-slate-400">
                  del proveedor
                </span>
              )}
              {d.fileName && (
                <a href={d.url ?? "#"} target="_blank" rel="noopener noreferrer"
                   className="text-slate-400 underline decoration-dotted hover:text-orange-400">
                  {d.fileName}
                </a>
              )}
              {/* Quién lo ve se cambia aquí mismo: la regla por defecto acierta
                  casi siempre, pero «casi» deja casos que hay que poder tocar. */}
              <select
                value={d.visibilidad}
                disabled={busy}
                onChange={(e) => void cambiarVisibilidad(d.uuid, e.target.value)}
                className="ml-auto rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px] text-slate-300"
              >
                {Object.entries(ETIQUETA_VISIBILIDAD).map(([v, etiqueta]) => (
                  <option key={v} value={v}>{etiqueta}</option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={alta.tipo}
          onChange={(e) => setAlta({ ...alta, tipo: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100"
        >
          {Object.entries(ETIQUETA_TIPO).map(([v, etiqueta]) => (
            <option key={v} value={v}>{etiqueta}</option>
          ))}
        </select>
        <select
          value={alta.origen}
          onChange={(e) => setAlta({ ...alta, origen: e.target.value })}
          className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100"
        >
          <option value="propio">Nuestro</option>
          <option value="proveedor">Del proveedor</option>
        </select>
        <input
          value={alta.documentNumber}
          onChange={(e) => setAlta({ ...alta, documentNumber: e.target.value })}
          placeholder="Nº de documento"
          className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[12px] text-slate-100"
        />
        <button
          onClick={() => void registrar()}
          disabled={busy}
          className="rounded-lg border border-slate-600 px-2 py-1.5 text-[12px] font-bold text-slate-300 hover:bg-slate-700 disabled:opacity-50"
        >
          Registrar
        </button>

        {puedeValidar && (
          <button
            onClick={() => void accion(`/api/documentos/asistencias/${assistanceId}/validar-coste`)}
            disabled={busy}
            className="rounded-lg bg-lime-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-lime-600 disabled:opacity-50"
          >
            Validar coste
          </button>
        )}
        {puedeFacturar && (
          <button
            onClick={() => void accion(`/api/documentos/asistencias/${assistanceId}/facturada`)}
            disabled={busy}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            Marcar facturada
          </button>
        )}
      </div>
    </div>
  );
}
