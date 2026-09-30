/**
 * Contar a mano lo que quedó sin ingresar y del que no se saben las piezas.
 *
 * Pasa con los ingresos anteriores a guardar el desglose: el importe se sabe
 * (0,21 €), las monedas no. Se cuentan una vez y a partir de ahí salen
 * desglosadas en la bolsa y en la posición global. El servidor comprueba que
 * sumen justo lo pendiente.
 */

import { useState } from "react";
import { useCash } from "../contexts/CashContext";
import DenominationGrid, { type CantidadesPorValor, lineasDesde } from "./DenominationGrid";
import { ErrorBox, Modal, btnPrimary, btnSecondary } from "./ui";
import { euros } from "../utils/money";
import * as api from "../services/api";

export default function ContarRemanente({
  registerId,
  importeCentimos,
  onHecho,
}: {
  registerId: number;
  /** Lo que tienen que sumar las piezas. */
  importeCentimos: number;
  onHecho: () => void | Promise<void>;
}) {
  const { denominaciones, puede } = useCash();
  const [abierto, setAbierto] = useState(false);
  const [cantidades, setCantidades] = useState<CantidadesPorValor>({});
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!puede("cash.treasury.manage")) return null;

  const lineas = lineasDesde(cantidades);
  const suma = lineas.reduce((a, l) => a + l.valor * l.cantidad, 0);

  async function guardar() {
    setGuardando(true);
    setError("");
    try {
      await api.desglosarRemanente(registerId, lineas);
      setAbierto(false);
      setCantidades({});
      await onHecho();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setAbierto(true)}
        className="rounded-md bg-slate-700 px-2 py-0.5 text-[11px] font-semibold text-slate-100 hover:bg-slate-600"
      >
        Contar
      </button>
      {abierto && (
        <Modal
          title="¿En qué piezas está lo que quedó sin ingresar?"
          onClose={() => setAbierto(false)}
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setAbierto(false)} className={btnSecondary}>
                Cancelar
              </button>
              <button
                onClick={() => void guardar()}
                disabled={guardando || suma !== importeCentimos}
                className={btnPrimary}
              >
                {guardando ? "Guardando…" : "Guardar"}
              </button>
            </div>
          }
        >
          {error && <ErrorBox>{error}</ErrorBox>}
          <p className="mb-2 text-sm text-slate-300">
            Del último ingreso quedaron <strong>{euros(importeCentimos)}</strong> sin ingresar, pero no
            se apuntó en qué monedas. Cuéntalas una vez y a partir de ahora saldrán desglosadas.
          </p>
          <DenominationGrid
            denominaciones={denominaciones}
            cantidades={cantidades}
            onChange={setCantidades}
            objetivoCentimos={importeCentimos}
            compacto
          />
          <p className={`mt-2 text-sm ${suma === importeCentimos ? "text-emerald-300" : "text-amber-300"}`}>
            Contado {euros(suma)} de {euros(importeCentimos)}
          </p>
        </Modal>
      )}
    </>
  );
}
