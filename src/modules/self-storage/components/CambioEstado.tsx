/**
 * Cambio manual de estado de un trastero: disponible ⇄ mantenimiento ⇄
 * bloqueado. «Reservado» y «Alquilado» no se ofrecen: los pone el sistema al
 * reservar o contratar. Las reglas las vuelve a aplicar el servidor.
 */

import { useState } from "react";
import * as api from "../services/api";
import type { Trastero, UnitStatus } from "../types";
import { ErrorBox, Modal, TextAreaField, btnPrimary, btnSecondary } from "./ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

const MANUALES: UnitStatus[] = ["available", "maintenance", "blocked"];

export default function CambioEstado({ trastero, onCerrar, onHecho }: { trastero: Trastero; onCerrar: () => void; onHecho: (t: Trastero) => void }) {
  const { etqUnidad } = useSelfStorage();
  const opciones = MANUALES.filter((e) => e !== trastero.status);
  const [estado, setEstado] = useState<UnitStatus>(opciones[0]);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const comprometido = trastero.status === "reserved" || trastero.status === "occupied";

  const guardar = async () => {
    setEnviando(true);
    setError(null);
    try {
      onHecho(await api.cambiarEstado(trastero.id, estado, motivo || undefined));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cambiar el estado");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      title={`Estado del trastero ${trastero.code}`}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>Cancelar</button>
          {!comprometido && (
            <button className={btnPrimary} disabled={enviando || ((estado === "maintenance" || estado === "blocked") && !motivo.trim())} onClick={guardar}>
              Guardar
            </button>
          )}
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      {comprometido ? (
        <p className="text-sm text-slate-300">
          Está «{etqUnidad(trastero.status)}». Ese estado lo gestiona el contrato o la reserva: para liberarlo hay que finalizar el contrato o
          cancelar la reserva (fase 2).
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {opciones.map((e) => (
              <button
                key={e}
                onClick={() => setEstado(e)}
                className={`rounded-xl border px-3 py-2 text-sm ${estado === e ? "border-orange-500 bg-orange-500/20 text-orange-200" : "border-slate-600 text-slate-300"}`}
              >
                {etqUnidad(e)}
              </button>
            ))}
          </div>
          {(estado === "maintenance" || estado === "blocked") && (
            <TextAreaField label="Motivo (obligatorio)" value={motivo} onChange={setMotivo} placeholder="p. ej. puerta del box dañada, revisión de humedad…" />
          )}
        </div>
      )}
    </Modal>
  );
}
