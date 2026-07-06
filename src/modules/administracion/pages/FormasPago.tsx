import { useCallback, useEffect, useState } from "react";
import { Plus, Pencil, Trash2, MessageCircle, CreditCard } from "lucide-react";
import {
  listPaymentMethods, savePaymentMethod,
  listDestinatarios, saveDestinatario, deleteDestinatario, type Destinatario,
} from "../services/data";
import {
  Modal, TableWrap, thCls, tdCls, TextField, CheckField,
  btnPrimary, btnSecondary, btnMini, Pill, EmptyRow, ErrorBox,
} from "../components/ui";
import type { PaymentMethod } from "../types";

export default function FormasPago() {
  const [formas, setFormas] = useState<PaymentMethod[]>([]);
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [editando, setEditando] = useState<PaymentMethod | null | "nueva">(null);
  const [editandoDest, setEditandoDest] = useState<Destinatario | null | "nuevo">(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [f, d] = await Promise.all([listPaymentMethods(), listDestinatarios()]);
      setFormas(f);
      setDestinatarios(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando la configuración");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-lg font-black">Configuración</h1>
        <p className="text-sm text-slate-400">Formas de pago y avisos automáticos por WhatsApp.</p>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Formas de pago */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-400">
              <CreditCard className="h-4 w-4" /> Formas de pago
            </h2>
            <button onClick={() => setEditando("nueva")} className={btnPrimary}>
              <span className="flex items-center gap-1"><Plus className="h-4 w-4" /> Nueva</span>
            </button>
          </div>
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

        {/* Destinatarios de avisos WhatsApp */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-slate-400">
              <MessageCircle className="h-4 w-4" /> Avisos WhatsApp internos
            </h2>
            <button onClick={() => setEditandoDest("nuevo")} className={btnPrimary}>
              <span className="flex items-center gap-1"><Plus className="h-4 w-4" /> Nuevo</span>
            </button>
          </div>
          <TableWrap>
            <thead>
              <tr className="border-b border-slate-700">
                <th className={thCls}>Nombre</th>
                <th className={thCls}>Teléfono</th>
                <th className={thCls}>Estado</th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody>
              {cargando && <EmptyRow cols={4} text="Cargando…" />}
              {!cargando && destinatarios.length === 0 && (
                <EmptyRow cols={4} text="Sin destinatarios. Añade los teléfonos que deben recibir los avisos." />
              )}
              {!cargando && destinatarios.map((d) => (
                <tr key={d.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
                  <td className={`${tdCls} font-semibold`}>{d.nombre}</td>
                  <td className={tdCls}>{d.telefono}</td>
                  <td className={tdCls}>
                    <Pill className={d.activo ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}>
                      {d.activo ? "Activo" : "Inactivo"}
                    </Pill>
                  </td>
                  <td className={`${tdCls} whitespace-nowrap text-right`}>
                    <span className="flex justify-end gap-1">
                      <button onClick={() => setEditandoDest(d)} className={btnMini}><Pencil className="h-3.5 w-3.5" /></button>
                      <button
                        onClick={async () => {
                          try { await deleteDestinatario(d.id); await cargar(); }
                          catch (e) { setError(e instanceof Error ? e.message : "Error"); }
                        }}
                        className={`${btnMini} text-rose-300`}
                      ><Trash2 className="h-3.5 w-3.5" /></button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-[12px] text-slate-500">
            Estos teléfonos reciben cada mañana el resumen de recobros (compromisos que vencen, acciones vencidas y pagos previstos) y la copia de los envíos programados.
          </p>
        </div>
      </div>

      {editando && (
        <ModalForma
          forma={editando === "nueva" ? null : editando}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); void cargar(); }}
        />
      )}

      {editandoDest && (
        <ModalDestinatario
          dest={editandoDest === "nuevo" ? null : editandoDest}
          onClose={() => setEditandoDest(null)}
          onSaved={() => { setEditandoDest(null); void cargar(); }}
        />
      )}
    </div>
  );
}

// ── Modal destinatario de avisos ─────────────────────────────
function ModalDestinatario({ dest, onClose, onSaved }: {
  dest: Destinatario | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nombre, setNombre] = useState(dest?.nombre ?? "");
  const [telefono, setTelefono] = useState(dest?.telefono ?? "");
  const [activo, setActivo] = useState(dest?.activo ?? true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!nombre.trim()) { setError("El nombre es obligatorio."); return; }
    const tel = telefono.replace(/[^\d]/g, "");
    if (tel.length < 9) { setError("Introduce un teléfono válido."); return; }
    setGuardando(true);
    setError("");
    try {
      await saveDestinatario({ id: dest?.id, nombre: nombre.trim(), telefono: tel, activo });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error guardando");
      setGuardando(false);
    }
  }

  return (
    <Modal title={dest ? "Editar destinatario" : "Nuevo destinatario de avisos"} onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className={btnSecondary}>Cancelar</button>
          <button onClick={guardar} disabled={guardando} className={btnPrimary}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Nombre" value={nombre} onChange={setNombre} placeholder="Jordi" />
        <TextField label="Teléfono (WhatsApp)" value={telefono} onChange={setTelefono} placeholder="610473079" />
      </div>
      <div className="mt-3">
        <CheckField label="Activo (recibe los avisos)" checked={activo} onChange={setActivo} />
      </div>
    </Modal>
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
