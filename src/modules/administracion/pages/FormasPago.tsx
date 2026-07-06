import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { listPaymentMethods, savePaymentMethod } from "../services/data";
import {
  Modal, TableWrap, thCls, tdCls, TextField, CheckField,
  btnPrimary, btnSecondary, btnMini, Pill, EmptyRow, ErrorBox,
} from "../components/ui";
import type { PaymentMethod } from "../types";

export default function FormasPago() {
  const [formas, setFormas] = useState<PaymentMethod[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<PaymentMethod | null | "nueva">(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      setFormas(await listPaymentMethods());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando formas de pago");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black">Configuración de formas de pago</h1>
          <p className="text-sm text-slate-400">Formas de pago disponibles al registrar cobros.</p>
        </div>
        <button onClick={() => setEditando("nueva")} className={btnPrimary}>
          <span className="flex items-center gap-1"><Plus className="h-4 w-4" /> Nueva forma de pago</span>
        </button>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="max-w-2xl">
        <TableWrap>
          <thead>
            <tr className="border-b border-slate-700">
              <th className={thCls}>Orden</th>
              <th className={thCls}>Nombre</th>
              <th className={thCls}>Estado</th>
              <th className={thCls}></th>
            </tr>
          </thead>
          <tbody>
            {cargando && <EmptyRow cols={4} text="Cargando…" />}
            {!cargando && formas.length === 0 && <EmptyRow cols={4} text="No hay formas de pago." />}
            {!cargando && formas.map((f) => (
              <tr key={f.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                <td className={tdCls}>{f.sort_order}</td>
                <td className={`${tdCls} font-semibold`}>{f.name}</td>
                <td className={tdCls}>
                  <Pill className={f.active ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}>
                    {f.active ? "Activa" : "Inactiva"}
                  </Pill>
                </td>
                <td className={`${tdCls} text-right`}>
                  <button onClick={() => setEditando(f)} className={btnMini}><Pencil className="h-3.5 w-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      {editando && (
        <ModalForma
          forma={editando === "nueva" ? null : editando}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); void cargar(); }}
        />
      )}
    </div>
  );
}

function ModalForma({ forma, onClose, onSaved }: {
  forma: PaymentMethod | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(forma?.name ?? "");
  const [orden, setOrden] = useState(String(forma?.sort_order ?? 0));
  const [activa, setActiva] = useState(forma?.active ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!nombre.trim()) { setError("El nombre es obligatorio."); return; }
    setGuardando(true);
    setError("");
    try {
      await savePaymentMethod({
        id: forma?.id,
        name: nombre.trim(),
        active: activa,
        sort_order: parseInt(orden) || 0,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando");
      setGuardando(false);
    }
  }

  return (
    <Modal title={forma ? "Editar forma de pago" : "Nueva forma de pago"} onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={guardando} className={btnPrimary}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Nombre" value={nombre} onChange={setNombre} />
        <TextField label="Orden" value={orden} onChange={setOrden} type="number" />
      </div>
      <div className="mt-3">
        <CheckField label="Activa (visible al registrar cobros)" checked={activa} onChange={setActiva} />
      </div>
    </Modal>
  );
}
