/**
 * Firmas del expediente, recogidas antes de emitir.
 *
 * El orden importa y por eso la pantalla lo dice: se firma, luego se emite, y
 * el PDF nace con la rúbrica dentro. Pegar la firma después obligaría a
 * reescribir el documento, y su hash dejaría de significar nada.
 */

import { useEffect, useState } from "react";
import { Check, PenLine, Trash2 } from "lucide-react";
import * as api from "../services/api";
import { useTacografos } from "../contexts/TacografosContext";
import CapturaFirma from "../components/CapturaFirma";
import { ETIQUETA_FIRMA, FIRMAS_POR_DOCUMENTO, type Firma, type PapelFirma } from "../types";
import type { TipoOperacion } from "../types";

/** Qué firmas hacen falta según el tipo de operación del expediente. */
function papelesDe(tipo: TipoOperacion): PapelFirma[] {
  return tipo === "transferencia"
    ? FIRMAS_POR_DOCUMENTO.justificante
    : [...FIRMAS_POR_DOCUMENTO.acuse_cliente, ...FIRMAS_POR_DOCUMENTO.comunicacion_admin];
}

type Props = {
  expedienteId: string;
  tipo: TipoOperacion;
  /** Nombres con los que se abre el cuadro de firma; la persona los corrige. */
  nombres: Partial<Record<PapelFirma, string>>;
  /** DNI iniciales de los papeles que llevan (autoriza y receptor). */
  dnis: Partial<Record<PapelFirma, string>>;
  onCambio: () => void;
  /** Firmar puede escribir nombre y DNI en el expediente: se sube actualizado. */
  onExpediente: (e: import("../types").Expediente) => void;
};

export default function FirmasExpediente({
  expedienteId,
  tipo,
  nombres,
  dnis,
  onCambio,
  onExpediente,
}: Props) {
  const { puede } = useTacografos();
  const [firmas, setFirmas] = useState<Firma[]>([]);
  const [firmando, setFirmando] = useState<PapelFirma | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const r = await api.listarFirmas(expedienteId);
        if (vivo) setFirmas(r.firmas);
      } catch {
        // Que no se puedan listar las firmas no debe tapar la ficha entera:
        // el resto del expediente sigue siendo utilizable.
      }
    })();
    return () => {
      vivo = false;
    };
  }, [expedienteId]);

  async function recargar() {
    setFirmas((await api.listarFirmas(expedienteId)).firmas);
    onCambio();
  }

  async function guardar(papel: PapelFirma, imagen: string, nombre: string, dni: string) {
    setError(null);
    try {
      const r = await api.firmar(expedienteId, papel, imagen, nombre, dni);
      if (r.expediente) onExpediente(r.expediente);
      setFirmando(null);
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar la firma");
      setFirmando(null);
    }
  }

  async function borrar(papel: PapelFirma) {
    setError(null);
    try {
      await api.borrarFirma(expedienteId, papel);
      await recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido borrar la firma");
    }
  }

  const puedeFirmar = puede("tacografos.documento.sign");

  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-slate-800">
      <h2 className="bg-slate-800/70 px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-slate-200">
        Firmas
      </h2>
      <div className="p-3">
        <p className="mb-3 text-[12px] text-slate-400">
          Se firma antes de emitir: el documento nace con la rúbrica dentro.
        </p>
        {error && (
          <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-amber-200">
            {error}
          </p>
        )}
        <ul className="space-y-2">
          {papelesDe(tipo).map((papel) => {
            const firma = firmas.find((f) => f.papel === papel);
            return (
              <li
                key={papel}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 p-2 text-[13px]"
              >
                <span className="font-semibold">{ETIQUETA_FIRMA[papel]}</span>
                {firma ? (
                  <>
                    <span className="flex items-center gap-1 text-emerald-400">
                      <Check className="h-3.5 w-3.5" /> Firmada
                    </span>
                    {firma.url && (
                      <img
                        src={firma.url}
                        alt={`Firma de ${ETIQUETA_FIRMA[papel]}`}
                        className="h-8 rounded border border-slate-700 bg-white"
                      />
                    )}
                  </>
                ) : (
                  <span className="text-slate-500">Sin firmar</span>
                )}
                {puedeFirmar && (
                  <span className="ml-auto flex gap-2">
                    <button
                      onClick={() => setFirmando(papel)}
                      className="flex items-center gap-1 rounded-lg px-2 py-1 text-sky-400 hover:bg-slate-800"
                    >
                      <PenLine className="h-4 w-4" /> {firma ? "Volver a firmar" : "Firmar"}
                    </button>
                    {firma && (
                      <button
                        onClick={() => void borrar(papel)}
                        className="flex items-center gap-1 rounded-lg px-2 py-1 text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" /> Borrar
                      </button>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {firmando && (
        <CapturaFirma
          titulo={ETIQUETA_FIRMA[firmando]}
          nombreInicial={nombres[firmando] ?? ""}
          dniInicial={dnis[firmando] ?? ""}
          pedirDni={firmando === "autoriza" || firmando === "receptor"}
          onFirmar={(png, nombre, dni) => guardar(firmando, png, nombre, dni)}
          onCancelar={() => setFirmando(null)}
        />
      )}
    </section>
  );
}
