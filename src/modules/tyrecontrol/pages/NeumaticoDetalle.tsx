import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { obtenerNeumatico, historialNeumatico, montajeActualDeNeumatico, repararNeumatico, descartarNeumaticoStd, actualizarNeumatico } from "../services/data";
import type { HistorialMontaje, MontajeActual, Neumatico } from "../types";
import { ESTADO_NEUMATICO_LABELS } from "../types";
import { TableWrap, tdCls, thCls, Modal, Field, inputCls } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

type CamposEditables = "dot" | "rfid_epc" | "marca" | "modelo" | "medida" | "indice_carga" | "indice_velocidad" | "proveedor" | "fecha_compra" | "coste_compra";

export default function NeumaticoDetalle() {
  const { perfil } = useTyreAuth();
  const puedeEditar = !!(perfil?.es_superadmin || perfil?.rol === "administrador");
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [n, setN] = useState<Neumatico | null>(null);
  const [montaje, setMontaje] = useState<MontajeActual | null>(null);
  const [historial, setHistorial] = useState<HistorialMontaje[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<Record<CamposEditables, string>>({
    dot: "", rfid_epc: "", marca: "", modelo: "", medida: "", indice_carga: "", indice_velocidad: "",
    proveedor: "", fecha_compra: "", coste_compra: "",
  });

  function abrirEdicion() {
    if (!n) return;
    setForm({
      dot: n.dot ?? "", rfid_epc: n.rfid_epc ?? "", marca: n.marca ?? "", modelo: n.modelo ?? "",
      medida: n.medida ?? "", indice_carga: n.indice_carga ?? "", indice_velocidad: n.indice_velocidad ?? "",
      proveedor: n.proveedor ?? "", fecha_compra: n.fecha_compra ?? "",
      coste_compra: n.coste_compra != null ? String(n.coste_compra) : "",
    });
    setMsg(""); setEditando(true);
  }

  async function guardarEdicion() {
    setSaving(true); setMsg("");
    try {
      await actualizarNeumatico(id, {
        dot: form.dot.trim() || null, rfid_epc: form.rfid_epc.trim() || null,
        marca: form.marca.trim() || null, modelo: form.modelo.trim() || null, medida: form.medida.trim() || null,
        indice_carga: form.indice_carga.trim() || null, indice_velocidad: form.indice_velocidad.trim() || null,
        proveedor: form.proveedor.trim() || null, fecha_compra: form.fecha_compra || null,
        coste_compra: form.coste_compra.trim() === "" ? null : Number(form.coste_compra),
      });
      setEditando(false); await cargar();
    } catch (e: any) { setMsg(e?.message || "Error al guardar"); } finally { setSaving(false); }
  }

  async function cargar() {
    setN(await obtenerNeumatico(id));
    setMontaje(await montajeActualDeNeumatico(id));
    setHistorial(await historialNeumatico(id));
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [id]);

  async function reparar() {
    const motivo = window.prompt("Motivo de la reparación:", "reparacion");
    if (!motivo) return;
    setSaving(true); setMsg("");
    try { await repararNeumatico(id, motivo); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setSaving(false); }
  }

  async function descartar() {
    if (!window.confirm("¿Confirmas el descarte definitivo de este neumático?")) return;
    const motivo = window.prompt("Motivo del descarte:", "fin_vida");
    if (!motivo) return;
    setSaving(true); setMsg("");
    try { await descartarNeumaticoStd(id, motivo); await cargar(); }
    catch (e: any) { setMsg(e?.message || "Error"); } finally { setSaving(false); }
  }

  const dato = (l: string, v?: string | null) => (
    <div><div className="text-[10px] text-slate-400">{l}</div><div className="text-sm text-slate-200">{v || "—"}</div></div>
  );
  if (!n) return <div className="text-slate-400">Cargando…</div>;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <button onClick={() => navigate("/tyrecontrol/neumaticos")} className="rounded bg-slate-800 px-3 py-1 text-[12px] text-slate-200">← Neumáticos</button>
        <h1 className="text-lg font-black">{n.numero_interno ?? n.codigo_interno ?? n.numero_serie ?? "Neumático"}</h1>
        <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs font-bold text-slate-200">{ESTADO_NEUMATICO_LABELS[n.estado]}</span>
        <div className="ml-auto flex gap-2">
          {puedeEditar && <button onClick={abrirEdicion} className="rounded bg-sky-600 px-3 py-1 text-[12px] font-bold text-white">Editar datos</button>}
          {n.estado !== "montado" && n.estado !== "descartado" && (
            <>
              {n.estado !== "reparacion" && <button onClick={reparar} disabled={saving} className="rounded bg-purple-600 px-3 py-1 text-[12px] font-bold text-white disabled:opacity-50">Enviar a reparación</button>}
              <button onClick={descartar} disabled={saving} className="rounded bg-rose-600 px-3 py-1 text-[12px] font-bold text-white disabled:opacity-50">Descartar</button>
            </>
          )}
        </div>
      </div>
      {msg && <div className="mb-3 text-sm text-red-300">{msg}</div>}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Datos técnicos</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {dato("Empresa", n.empresa?.nombre)}{dato("Nº serie", n.numero_serie)}{dato("DOT", n.dot)}
            {dato("RFID", n.rfid_epc)}{dato("Marca", n.marca)}{dato("Modelo", n.modelo)}
            {dato("Medida", n.medida)}{dato("Índice carga", n.indice_carga)}{dato("Índice velocidad", n.indice_velocidad)}
            {dato("Proveedor", n.proveedor)}{dato("Fecha compra", n.fecha_compra)}
            {dato("Coste", n.coste_compra != null ? `${n.coste_compra} €` : null)}
          </div>
        </div>
        <div className="rounded-lg bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Estado y almacén</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {dato("Estado técnico", ESTADO_NEUMATICO_LABELS[n.estado])}
            {dato("Referencia almacén", n.referencia_almacen)}
            {dato("Sincronizado almacén", n.sincronizado_almacen ? "Sí" : "No")}
            {dato("Montaje actual", montaje ? `${montaje.posicion?.codigo_posicion ?? ""} · desde ${montaje.fecha_montaje}` : "No montado")}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">El stock físico y los movimientos se gestionan en el módulo de Almacén.</div>
        </div>
      </div>

      <div className="mt-3 rounded-lg bg-slate-800 p-3">
        <div className="mb-2 text-[11px] font-bold uppercase text-slate-400">Historial de montajes ({historial.length})</div>
        <TableWrap>
          <thead className="bg-slate-900"><tr>
            <th className={thCls}>Montaje</th><th className={thCls}>Km montaje</th><th className={thCls}>Desmontaje</th>
            <th className={thCls}>Km desmontaje</th><th className={thCls}>Motivo</th>
          </tr></thead>
          <tbody>
            {historial.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={5}>Sin historial.</td></tr>
            : historial.map((h) => (
              <tr key={h.id} className="border-t border-slate-700/60">
                <td className={tdCls + " text-slate-400"}>{h.fecha_montaje ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{h.km_montaje ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{h.fecha_desmontaje ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{h.km_desmontaje ?? "—"}</td>
                <td className={tdCls + " text-slate-400"}>{h.motivo_desmontaje ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {["Inspecciones", "Mediciones", "Fotos"].map((t) => (
          <div key={t} className="rounded-lg border border-dashed border-slate-700 bg-slate-800 p-6 text-center text-sm text-slate-500">{t}<div className="text-[11px]">Próximas fases</div></div>
        ))}
      </div>

      {editando && (
        <Modal title="Editar datos técnicos" onClose={() => setEditando(false)}
          footer={<div className="flex justify-end gap-2">
            <button onClick={() => setEditando(false)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
            <button onClick={guardarEdicion} disabled={saving} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>}>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Marca"><input className={inputCls} value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} /></Field>
            <Field label="Modelo"><input className={inputCls} value={form.modelo} onChange={(e) => setForm({ ...form, modelo: e.target.value })} /></Field>
            <Field label="Medida"><input className={inputCls} value={form.medida} onChange={(e) => setForm({ ...form, medida: e.target.value })} /></Field>
            <Field label="Índice carga"><input className={inputCls} value={form.indice_carga} onChange={(e) => setForm({ ...form, indice_carga: e.target.value })} /></Field>
            <Field label="Índice velocidad"><input className={inputCls} value={form.indice_velocidad} onChange={(e) => setForm({ ...form, indice_velocidad: e.target.value })} /></Field>
            <Field label="DOT"><input className={inputCls} value={form.dot} onChange={(e) => setForm({ ...form, dot: e.target.value })} /></Field>
            <Field label="RFID"><input className={inputCls} value={form.rfid_epc} onChange={(e) => setForm({ ...form, rfid_epc: e.target.value })} /></Field>
            <Field label="Proveedor"><input className={inputCls} value={form.proveedor} onChange={(e) => setForm({ ...form, proveedor: e.target.value })} /></Field>
            <Field label="Fecha compra"><input type="date" className={inputCls} value={form.fecha_compra} onChange={(e) => setForm({ ...form, fecha_compra: e.target.value })} /></Field>
            <Field label="Coste (€)"><input type="number" step="0.01" className={inputCls} value={form.coste_compra} onChange={(e) => setForm({ ...form, coste_compra: e.target.value })} /></Field>
          </div>
          {msg && <div className="mt-2 text-xs text-red-300">{msg}</div>}
        </Modal>
      )}
    </div>
  );
}
