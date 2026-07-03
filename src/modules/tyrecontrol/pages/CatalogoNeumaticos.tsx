import { useEffect, useMemo, useState } from "react";
import { listarReferenciasNeumatico } from "../services/data";
import type { ReferenciaNeumatico, EjeRecomendado } from "../types";
import { Modal, inputCls, TableWrap, tdCls, thCls } from "../components/ui";

const EJE_LABELS: Record<EjeRecomendado, string> = {
  direccion: "Dirección", traccion: "Tracción", remolque: "Remolque", mixto: "Mixto",
};

export default function CatalogoNeumaticos() {
  const [items, setItems] = useState<ReferenciaNeumatico[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [fMarca, setFMarca] = useState("");
  const [fEje, setFEje] = useState("");
  const [fMs, setFMs] = useState("");
  const [fPmsf, setFPmsf] = useState("");
  const [ficha, setFicha] = useState<ReferenciaNeumatico | null>(null);

  async function cargar() {
    setLoading(true);
    try { setItems(await listarReferenciasNeumatico()); } finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); }, []);

  const marcas = useMemo(() => Array.from(new Set(items.map((r) => r.modelo?.marca?.nombre).filter(Boolean))) as string[], [items]);

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((r) => {
      if (fMarca && r.modelo?.marca?.nombre !== fMarca) return false;
      if (fEje && r.modelo?.eje_recomendado !== fEje) return false;
      if (fMs === "si" && !r.modelo?.m_s) return false;
      if (fMs === "no" && r.modelo?.m_s) return false;
      if (fPmsf === "si" && !r.modelo?.tres_pmsf) return false;
      if (fPmsf === "no" && r.modelo?.tres_pmsf) return false;
      if (s && !r.referencia_completa.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [items, q, fMarca, fEje, fMs, fPmsf]);

  return (
    <div>
      <h1 className="mb-3 text-lg font-black">Catálogo de neumáticos</h1>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={`${inputCls} max-w-[240px]`} placeholder="Buscar (ej. AH51, 315/80, regional)…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${inputCls} w-auto`} value={fMarca} onChange={(e) => setFMarca(e.target.value)}>
          <option value="">Todas las marcas</option>{marcas.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fEje} onChange={(e) => setFEje(e.target.value)}>
          <option value="">Todos los ejes</option>
          {(Object.keys(EJE_LABELS) as EjeRecomendado[]).map((e) => <option key={e} value={e}>{EJE_LABELS[e]}</option>)}
        </select>
        <select className={`${inputCls} w-auto`} value={fMs} onChange={(e) => setFMs(e.target.value)}>
          <option value="">M+S: todos</option><option value="si">Con M+S</option><option value="no">Sin M+S</option>
        </select>
        <select className={`${inputCls} w-auto`} value={fPmsf} onChange={(e) => setFPmsf(e.target.value)}>
          <option value="">3PMSF: todos</option><option value="si">Con 3PMSF</option><option value="no">Sin 3PMSF</option>
        </select>
        <span className="text-xs text-slate-500">{visibles.length}</span>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Marca</th><th className={thCls}>Modelo</th><th className={thCls}>Medida completa</th>
          <th className={thCls}>Eje</th><th className={thCls}>Aplicación</th><th className={thCls}>M+S</th><th className={thCls}>3PMSF</th><th className={thCls}>Estado</th>
        </tr></thead>
        <tbody>
          {loading ? <tr><td className={tdCls + " text-slate-500"} colSpan={8}>Cargando…</td></tr>
          : visibles.length === 0 ? <tr><td className={tdCls + " text-slate-500"} colSpan={8}>Sin resultados.</td></tr>
          : visibles.map((r) => (
            <tr key={r.id} onClick={() => setFicha(r)} className="cursor-pointer border-t border-slate-700/60 hover:bg-slate-800/60">
              <td className={tdCls + " font-semibold"}>{r.modelo?.marca?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-300"}>{r.modelo?.nombre ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{r.tyre_size?.referencia_completa ?? "—"}</td>
              <td className={tdCls + " text-slate-400"}>{r.modelo?.eje_recomendado ? EJE_LABELS[r.modelo.eje_recomendado] : "—"}</td>
              <td className={tdCls + " text-slate-400"}>{r.modelo?.aplicacion ?? "—"}</td>
              <td className={tdCls}>{r.modelo?.m_s ? <span className="text-emerald-400">Sí</span> : <span className="text-slate-500">—</span>}</td>
              <td className={tdCls}>{r.modelo?.tres_pmsf ? <span className="text-emerald-400">Sí</span> : <span className="text-slate-500">—</span>}</td>
              <td className={tdCls}><span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-bold text-emerald-300">Activo</span></td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {ficha && (
        <Modal title={ficha.referencia_completa} onClose={() => setFicha(null)}>
          <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
            {ficha.modelo?.foto_modelo_url ? (
              <img src={ficha.modelo.foto_modelo_url} alt={ficha.modelo.nombre} className="h-32 w-32 rounded-lg bg-white object-contain" />
            ) : (
              <div className="flex h-32 w-32 items-center justify-center rounded-lg bg-slate-900 text-center text-[10px] text-slate-500">Imagen no disponible</div>
            )}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <Dato label="Marca" v={ficha.modelo?.marca?.nombre} />
              <Dato label="Modelo" v={ficha.modelo?.nombre} />
              <Dato label="Gama" v={ficha.modelo?.gama} />
              <Dato label="Medida" v={ficha.tyre_size?.medida} />
              <Dato label="Índice carga" v={ficha.tyre_size ? (ficha.tyre_size.indice_carga_doble ? `${ficha.tyre_size.indice_carga_simple}/${ficha.tyre_size.indice_carga_doble}` : ficha.tyre_size.indice_carga_simple) : null} />
              <Dato label="Código velocidad" v={ficha.tyre_size?.codigo_velocidad} />
              <Dato label="Eje recomendado" v={ficha.modelo?.eje_recomendado ? EJE_LABELS[ficha.modelo.eje_recomendado] : null} />
              <Dato label="Aplicación" v={ficha.modelo?.aplicacion} />
              <Dato label="Tipo de vehículo" v={ficha.modelo?.tipo_vehiculo} />
              <Dato label="M+S" v={ficha.modelo?.m_s ? "Sí" : "No"} />
              <Dato label="3PMSF" v={ficha.modelo?.tres_pmsf ? "Sí" : "No"} />
              <Dato label="Reesculturable" v={ficha.modelo?.reesculturable ? "Sí" : "No"} />
              <Dato label="Recauchutable" v={ficha.modelo?.recauchutable ? "Sí" : "No"} />
              <Dato label="Profundidad dibujo" v={ficha.profundidad_dibujo_mm != null ? `${ficha.profundidad_dibujo_mm} mm` : null} />
              <Dato label="Llanta recomendada" v={ficha.llanta_recomendada} />
              <Dato label="Diámetro exterior" v={ficha.diametro_exterior_mm != null ? `${ficha.diametro_exterior_mm} mm` : null} />
              <Dato label="Revoluciones/km" v={ficha.revoluciones_km} />
              <Dato label="Carga máxima" v={ficha.carga_maxima_kg != null ? `${ficha.carga_maxima_kg} kg` : null} />
              <Dato label="Presión máxima" v={ficha.presion_maxima_bar != null ? `${ficha.presion_maxima_bar} bar` : null} />
              <Dato label="Peso" v={ficha.peso_kg != null ? `${ficha.peso_kg} kg` : null} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Dato({ label, v }: { label: string; v?: string | number | null }) {
  return (
    <div>
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-slate-200">{v ?? "—"}</div>
    </div>
  );
}
