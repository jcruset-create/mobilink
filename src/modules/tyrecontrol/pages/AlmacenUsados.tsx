import { useEffect, useMemo, useState } from "react";
import {
  listarEmpresas, listarUsadosAlmacen, resumenUsadosAlmacen, reesculturarEnAlmacen,
  obtenerUmbralesEmpresa,
} from "../services/data";
import type { Empresa, UsadoEnAlmacen, ResumenAlmacenUsados } from "../types";
import { TableWrap, tdCls, thCls, inputCls, Modal } from "../components/ui";
import { useTyreAuth } from "../contexts/TyreAuthContext";

// Almacén de neumáticos usados: una fila por goma real, con su identidad y los
// milímetros que le quedan.
//
// No es el maestro de neumáticos (esa es la pantalla "Neumáticos", que lista
// todo). Aquí solo está lo que hay en el almacén, y ordenado por lo que sirve
// para elegir: cuánto dibujo queda y qué número de serie tiene.
//
// Los umbrales de color son los de la empresa (tc_config_umbrales), no unos
// inventados aquí: el panel y la APK tienen que decir lo mismo de la misma rueda.
type Orden = "profundidad" | "serie" | "medida" | "desmontaje";

const ORDENES: { valor: Orden; label: string }[] = [
  { valor: "profundidad", label: "Profundidad (más dibujo primero)" },
  { valor: "serie", label: "Número de serie" },
  { valor: "medida", label: "Medida" },
  { valor: "desmontaje", label: "Fecha de desmontaje (reciente primero)" },
];

export default function AlmacenUsados() {
  const { perfil } = useTyreAuth();
  const puedeEditar = !!(perfil?.es_superadmin || perfil?.rol === "administrador");

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState("");
  const [items, setItems] = useState<UsadoEnAlmacen[]>([]);
  const [resumen, setResumen] = useState<ResumenAlmacenUsados | null>(null);
  const [umbrales, setUmbrales] = useState<{ min: number; aviso: number }>({ min: 1.6, aviso: 3.0 });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const [q, setQ] = useState("");
  const [fMedida, setFMedida] = useState("");
  const [soloReesculturadas, setSoloReesculturadas] = useState(false);
  const [orden, setOrden] = useState<Orden>("profundidad");

  const [modal, setModal] = useState<UsadoEnAlmacen | null>(null);
  const [mm, setMm] = useState("");
  const [obs, setObs] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    listarEmpresas()
      .then((e) => { setEmpresas(e); if (e.length && !empresaId) setEmpresaId(e[0].id); })
      .catch((er: any) => setMsg(er?.message || "Error cargando empresas"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargar() {
    if (!empresaId) return;
    setLoading(true); setMsg("");
    try {
      const [lista, res, umb] = await Promise.all([
        listarUsadosAlmacen(empresaId),
        resumenUsadosAlmacen(empresaId).catch(() => null),
        obtenerUmbralesEmpresa(empresaId).catch(() => null),
      ]);
      setItems(lista);
      setResumen(res);
      if (umb) setUmbrales({ min: umb.profundidad_minima_mm, aviso: umb.profundidad_aviso_mm });
    } catch (er: any) { setMsg(er?.message || "Error cargando el almacén"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [empresaId]);

  const medidas = useMemo(
    () => Array.from(new Set(items.map((i) => i.medida).filter(Boolean))).sort() as string[],
    [items],
  );

  const visibles = useMemo(() => {
    const s = q.trim().toLowerCase();
    const filtrados = items.filter((i) => {
      if (fMedida && i.medida !== fMedida) return false;
      if (soloReesculturadas && !i.reesculturado) return false;
      if (s && ![i.numero_interno, i.numero_serie, i.rfid_epc, i.dot, i.marca, i.matricula_anterior]
          .some((x) => (x ?? "").toLowerCase().includes(s))) return false;
      return true;
    });
    const txt = (v: string | null) => (v ?? "").toLowerCase();
    return [...filtrados].sort((a, b) => {
      switch (orden) {
        case "serie": return txt(a.numero_serie || a.numero_interno).localeCompare(txt(b.numero_serie || b.numero_interno));
        case "medida": return txt(a.medida).localeCompare(txt(b.medida));
        case "desmontaje": return txt(b.fecha_desmontaje).localeCompare(txt(a.fecha_desmontaje));
        default: return (b.profundidad_actual_mm ?? -1) - (a.profundidad_actual_mm ?? -1);
      }
    });
  }, [items, q, fMedida, soloReesculturadas, orden]);

  // Mismo criterio que el resto del módulo: por debajo del mínimo legal es
  // crítico, por debajo del aviso hay que vigilarla.
  function colorMm(v: number | null) {
    if (v == null) return "text-slate-500";
    if (v < umbrales.min) return "text-red-300 font-bold";
    if (v < umbrales.aviso) return "text-amber-300 font-semibold";
    return "text-emerald-300";
  }

  function abrirReescultura(u: UsadoEnAlmacen) {
    setModal(u);
    setMm(u.profundidad_actual_mm != null ? String(u.profundidad_actual_mm) : "");
    setObs("");
  }

  async function guardarReescultura() {
    if (!modal) return;
    const v = Number(mm.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) { setMsg("Indica los milímetros que quedan tras reesculturar."); return; }
    setGuardando(true); setMsg("");
    try {
      await reesculturarEnAlmacen(modal.neumatico_id, v, obs || undefined);
      setModal(null);
      await cargar();
      setMsg("✔ Reescultura registrada");
    } catch (e: any) { setMsg(limpiar(e?.message || "Error al reesculturar")); }
    finally { setGuardando(false); }
  }

  // Los errores del RPC vienen con el prefijo del código; para pantalla sobra.
  const limpiar = (t: string) => t.replace(/^REESCULTURA_[A-Z_]+:\s*/, "");

  // Si los dos mundos no cuadran es el doble conteo: la misma goma contada como
  // ficha y como unidad anónima de movimientos_stock (ver Decisión 1 en
  // docs/PROMPT_almacen_usados_individual.md).
  const desfase = resumen ? Number(resumen.unidades_stock) - Number(resumen.fichas) : 0;

  return (
    <div>
      <h1 className="mb-1 text-lg font-black">Almacén de usados</h1>
      <p className="mb-3 text-sm text-slate-400">
        Las gomas que están en el almacén, una a una, con lo que les queda de dibujo. Ordenadas por
        profundidad para elegir la que mejor casa con el eje.
      </p>
      {msg && <div className={`mb-3 text-sm ${msg.startsWith("✔") ? "text-emerald-400" : "text-red-300"}`}>{msg}</div>}

      {/* Resumen */}
      {resumen && (
        <div className="mb-3 grid gap-2 sm:grid-cols-4">
          <Tarjeta titulo="En almacén" valor={resumen.fichas} pie="gomas con ficha propia" />
          <Tarjeta titulo="Identificadas" valor={resumen.con_identidad} pie="con RFID o nº de serie" />
          <Tarjeta titulo="Reesculturadas" valor={resumen.reesculturadas} pie="se les ha añadido dibujo" />
          <Tarjeta titulo="Según el stock" valor={Number(resumen.unidades_stock)} pie="unidades en movimientos_stock" />
        </div>
      )}

      {desfase !== 0 && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[12px] text-amber-200">
          <b>Los dos recuentos no cuadran</b> ({resumen?.fichas} fichas frente a {Number(resumen?.unidades_stock)} unidades
          de stock). Es el doble conteo: al desmontar a almacén la goma queda como ficha propia <i>y</i> además suma
          una unidad anónima en <code>movimientos_stock</code>. Está pendiente de decidir cuál de los dos manda.
        </div>
      )}

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-[10px] text-slate-500">Empresa
          <select className={`${inputCls} max-w-[220px]`} value={empresaId} onChange={(e) => setEmpresaId(e.target.value)}>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Buscar
          <input className={`${inputCls} max-w-[220px]`} placeholder="serie, RFID, DOT, matrícula…"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Medida
          <select className={`${inputCls} max-w-[170px]`} value={fMedida} onChange={(e) => setFMedida(e.target.value)}>
            <option value="">Todas</option>
            {medidas.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-[10px] text-slate-500">Ordenar por
          <select className={`${inputCls} max-w-[260px]`} value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
            {ORDENES.map((o) => <option key={o.valor} value={o.valor}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2 text-[12px] text-slate-200">
          <input type="checkbox" checked={soloReesculturadas} onChange={(e) => setSoloReesculturadas(e.target.checked)} />
          Solo reesculturadas
        </label>
      </div>

      <TableWrap>
        <thead className="bg-slate-900"><tr>
          <th className={thCls}>Neumático</th>
          <th className={thCls}>Serie / RFID</th>
          <th className={thCls}>Marca y medida</th>
          <th className={thCls}>mm</th>
          <th className={thCls}>Procedencia</th>
          <th className={thCls}>Km rodados</th>
          <th className={thCls}></th>
        </tr></thead>
        <tbody>
          {loading ? (
            <tr><td className={tdCls + " text-slate-500"} colSpan={7}>Cargando…</td></tr>
          ) : visibles.length === 0 ? (
            <tr><td className={tdCls + " text-slate-500"} colSpan={7}>
              No hay gomas en el almacén de esta empresa (o ninguna pasa los filtros).
            </td></tr>
          ) : visibles.map((u) => (
            <tr key={u.neumatico_id} className="border-t border-slate-700/60">
              <td className={tdCls + " font-semibold text-slate-200"}>
                {u.numero_interno ?? "—"}
                {u.reesculturado && (
                  <span className="ml-2 rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold text-orange-300">REESC.</span>
                )}
              </td>
              <td className={tdCls + " text-slate-400"}>
                {u.numero_serie ?? u.rfid_epc ?? <span className="text-slate-600">sin identificar</span>}
                {u.dot && <div className="text-[10px] text-slate-500">DOT {u.dot}</div>}
              </td>
              <td className={tdCls + " text-slate-400"}>
                {[u.marca, u.modelo].filter(Boolean).join(" ")}
                <div className="text-[10px] text-slate-500">{u.medida ?? "—"}</div>
              </td>
              <td className={tdCls + " " + colorMm(u.profundidad_actual_mm)}>
                {u.profundidad_actual_mm ?? "sin medir"}
              </td>
              <td className={tdCls + " text-slate-400"}>
                {u.matricula_anterior ?? "—"}
                {u.fecha_desmontaje && <div className="text-[10px] text-slate-500">{u.fecha_desmontaje}</div>}
              </td>
              <td className={tdCls + " text-slate-400"}>
                {u.km_acumulados ? Number(u.km_acumulados).toLocaleString("es-ES") : "—"}
              </td>
              <td className={tdCls}>
                {puedeEditar && (
                  <button onClick={() => abrirReescultura(u)} className="text-sky-400 hover:underline">Reesculturar</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {modal && (
        <Modal onClose={() => setModal(null)} title={`Reesculturar ${modal.numero_interno ?? ""}`}>
          <div className="space-y-3">
            <div className="text-[12px] text-slate-400">
              {[modal.marca, modal.modelo].filter(Boolean).join(" ")} · {modal.medida ?? "—"}
              <div>Ahora tiene <b className="text-slate-200">{modal.profundidad_actual_mm ?? "sin medir"} mm</b>.</div>
            </div>
            <label className="block text-[11px] text-slate-400">
              Milímetros tras reesculturar
              <input type="number" step="0.1" className={inputCls} value={mm} onChange={(e) => setMm(e.target.value)} />
            </label>
            <label className="block text-[11px] text-slate-400">
              Observaciones (opcional)
              <input className={inputCls} value={obs} onChange={(e) => setObs(e.target.value)} />
            </label>
            <div className="text-[11px] text-slate-500">
              Reesculturar añade dibujo: el valor tiene que ser mayor que el actual. Si la goma está
              montada, la reescultura se hace desde el plan de trabajo del vehículo, no aquí.
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setModal(null)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
              <button onClick={guardarReescultura} disabled={guardando}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {guardando ? "Guardando…" : "Reesculturar"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Tarjeta({ titulo, valor, pie }: { titulo: string; valor: number; pie: string }) {
  return (
    <div className="rounded-lg bg-slate-800 p-3">
      <div className="text-[11px] font-bold uppercase text-slate-400">{titulo}</div>
      <div className="text-xl font-black text-slate-100">{valor}</div>
      <div className="text-[10px] text-slate-500">{pie}</div>
    </div>
  );
}
