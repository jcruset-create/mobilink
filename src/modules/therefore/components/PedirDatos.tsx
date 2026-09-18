/**
 * Mover una actuación: el verbo, y lo que hay que escribir antes de moverla.
 *
 * Vive aparte de la pantalla del expediente porque lo piden dos sitios: la
 * lista de actuaciones y la tarjeta del albarán analizado, donde el botón
 * «Resuelto» tiene que abrir exactamente el mismo formulario. Duplicarlo
 * sería la manera de que dentro de un mes uno pidiera la referencia del ERP
 * y el otro no.
 */

import { useState } from "react";
import { Modal, TextAreaField, TextField, btnPrimary, btnSecondary } from "./ui";

export const VERBOS: Record<string, { etiqueta: string; desde: string[]; pideMotivo?: boolean }> = {
  iniciar: { etiqueta: "Iniciar", desde: ["PENDIENTE", "BLOQUEADA"] },
  resolver: { etiqueta: "Resolver", desde: ["PENDIENTE", "EN_PROCESO", "BLOQUEADA"] },
  bloquear: { etiqueta: "Bloquear", desde: ["PENDIENTE", "EN_PROCESO"], pideMotivo: true },
  descartar: {
    etiqueta: "Descartar",
    desde: ["PENDIENTE", "EN_PROCESO", "BLOQUEADA"],
    pideMotivo: true,
  },
  reabrir: { etiqueta: "Reabrir", desde: ["RESUELTA"] },
};

export type DatosDelMovimiento = { motivo?: string; resultado?: string; erpReferencia?: string };

/** Pide lo que hace falta antes de mover: el motivo, o el resultado y la referencia. */
export default function PedirDatos({
  verbo,
  onCerrar,
  onConfirmar,
  ocupado,
}: {
  verbo: string;
  onCerrar: () => void;
  onConfirmar: (datos: DatosDelMovimiento) => void;
  ocupado: boolean;
}) {
  const [motivo, setMotivo] = useState("");
  const [resultado, setResultado] = useState("");
  const [erpReferencia, setErpReferencia] = useState("");
  const resolviendo = verbo === "resolver";

  return (
    <Modal
      title={VERBOS[verbo]?.etiqueta ?? verbo}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onCerrar} className={btnSecondary}>
            Cancelar
          </button>
          <button
            className={btnPrimary}
            disabled={ocupado || (!resolviendo && !motivo.trim())}
            onClick={() => onConfirmar(resolviendo ? { resultado, erpReferencia } : { motivo })}
          >
            Confirmar
          </button>
        </div>
      }
    >
      {resolviendo ? (
        <div className="space-y-3">
          <TextField label="Qué se ha hecho" value={resultado} onChange={setResultado} />
          <TextField
            label="Referencia en el ERP"
            value={erpReferencia}
            onChange={setErpReferencia}
            placeholder="Nº de albarán o de asiento"
          />
        </div>
      ) : (
        <TextAreaField
          label="Motivo"
          value={motivo}
          onChange={setMotivo}
          rows={3}
          placeholder="Quien se encuentre esto mañana necesita saber por qué."
        />
      )}
    </Modal>
  );
}
