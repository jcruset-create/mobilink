/**
 * Autorizar el cobro de una factura que ya consta cobrada.
 *
 * Es la segunda confirmación, y a propósito no se parece a un botón más: quien
 * llega hasta aquí tiene que leer qué factura es, cuánto se cobró antes y
 * cuándo, y luego llamar a alguien con permiso para que teclee su clave.
 *
 * Lo que este componente NO hace:
 *
 * · **No decide.** Manda usuario y clave al servidor y espera. La comprobación
 *   —que exista de verdad el duplicado, que esa persona tenga permiso, que sea
 *   de esta empresa, que no sea el mismo que está cobrando— está toda del otro
 *   lado, donde no la puede saltar quien abra las herramientas del navegador.
 *
 * · **No guarda la clave.** Vive en el estado del formulario mientras el modal
 *   está abierto y se va con él. No entra en el cobro, ni en la propuesta, ni
 *   en ningún sitio del que pueda salir después.
 *
 * Lo que devuelve es un permiso de un solo uso, atado a esta factura y a este
 * importe, que el cobro adjunta al confirmarse.
 */

import { useState } from "react";
import { euros } from "../utils/money";
import * as api from "../services/api";
import { ErrorBox, inputCls } from "./ui";
import type { PropuestaEscaneo } from "../types";

/** Por qué se cobra otra vez. Sale en la auditoría, no en el cobro. */
const MOTIVOS = [
  "Segundo pago real",
  "Corrección de un cobro anterior",
  "El cobro anterior se anuló fuera del sistema",
  "Incidencia administrativa",
  "Otro",
] as const;

export default function AutorizarDuplicado({
  cobroPrevio,
  referencia,
  importeCentimos,
  formaNombre,
  onAutorizado,
  onCancelar,
}: {
  cobroPrevio: NonNullable<PropuestaEscaneo["cobroPrevio"]>;
  referencia: string;
  importeCentimos: number;
  formaNombre: string;
  /** Recibe el permiso de un solo uso. */
  onAutorizado: (token: string) => void;
  onCancelar: () => void;
}) {
  const [autorizador, setAutorizador] = useState("");
  const [clave, setClave] = useState("");
  const [motivo, setMotivo] = useState<string>(MOTIVOS[0]);
  const [detalle, setDetalle] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function autorizar() {
    setOcupado(true);
    setError("");
    try {
      const r = await api.autorizarCobroDuplicado({
        autorizador: autorizador.trim(),
        clave,
        referencia,
        importeCentimos,
        motivo: motivo === "Otro" ? detalle.trim() || "Otro" : motivo,
      });
      // La clave se va con el componente en cuanto esto cierra; que no quede
      // ni un render de más con ella en memoria.
      setClave("");
      onAutorizado(r.token);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido autorizar");
    } finally {
      setOcupado(false);
    }
  }

  const listo = autorizador.trim() !== "" && clave !== "" && !ocupado;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg border border-rose-500/50 bg-slate-900 p-4 shadow-xl">
        <h2 className="text-[13px] font-black uppercase tracking-wide text-rose-300">
          Autorizar un posible cobro duplicado
        </h2>

        <div className="mt-3 space-y-1 rounded-lg border border-slate-700 bg-slate-800/60 p-3 text-[12px]">
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Factura</span>
            <span className="font-bold text-slate-100">{referencia}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Importe</span>
            <span className="font-bold tabular-nums text-slate-100">
              {euros(importeCentimos)}
            </span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Forma de cobro nueva</span>
            <span className="font-bold text-slate-100">{formaNombre}</span>
          </div>
          <div className="mt-1 border-t border-slate-700 pt-1" />
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Ya cobrada en</span>
            <span className="font-bold text-amber-300">
              {cobroPrevio.numero} · {cobroPrevio.fecha}
            </span>
          </div>
          {cobroPrevio.partyNombre && (
            <div className="flex justify-between gap-3">
              <span className="text-slate-400">Cliente</span>
              <span className="text-slate-200">{cobroPrevio.partyNombre}</span>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <span className="text-slate-400">Importe de aquel cobro</span>
            <span className="tabular-nums text-slate-200">
              {euros(cobroPrevio.importeCentimos)}
            </span>
          </div>
        </div>

        <p className="mt-3 text-[12px] text-slate-300">
          Para cobrarla otra vez tiene que identificarse alguien con permiso para autorizarlo.
        </p>

        <label className="mt-2 block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
            Usuario o correo de quien autoriza
          </span>
          <input
            value={autorizador}
            onChange={(e) => setAutorizador(e.target.value)}
            autoComplete="off"
            className={inputCls}
          />
        </label>

        <label className="mt-2 block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
            Su clave
          </span>
          <input
            type="password"
            value={clave}
            onChange={(e) => setClave(e.target.value)}
            autoComplete="off"
            className={inputCls}
          />
        </label>

        <label className="mt-2 block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
            Motivo
          </span>
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className={inputCls}
          >
            {MOTIVOS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        {motivo === "Otro" && (
          <input
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            placeholder="Explica brevemente por qué"
            className={`${inputCls} mt-2`}
          />
        )}

        {error && (
          <div className="mt-2">
            <ErrorBox>{error}</ErrorBox>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="flex-1 rounded-lg border border-slate-600 px-3 py-2 text-[13px] font-bold text-slate-300 hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void autorizar()}
            disabled={!listo}
            className="flex-1 rounded-lg bg-rose-600 px-3 py-2 text-[13px] font-bold text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {ocupado ? "Comprobando…" : "Autorizar"}
          </button>
        </div>

        <p className="mt-2 text-[11px] text-slate-500">
          Queda registrado quién cobra y quién autoriza, por separado.
        </p>
      </div>
    </div>
  );
}
