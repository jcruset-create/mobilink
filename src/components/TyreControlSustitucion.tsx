/**
 * Marcar una sustitución de neumático desde el back-office.
 *
 * ── Por qué el selector es de PRODUCTOS y no de neumáticos ──────────────────
 *
 * Lo natural sería elegir «el neumático que se montó» de una lista de fichas.
 * TyreControl no lo admite: `tc_sustituir_neumatico` recibe un producto del
 * almacén, la condición (nuevo/usado) y, si se conoce, la identidad de la
 * unidad (RFID o número de serie). Con eso decide él si reengancha una ficha
 * existente, coge uno de usados o crea una nueva consumiendo stock.
 *
 * Un selector de fichas sería más cómodo de usar y no se podría enviar. Así que
 * la pantalla enseña lo que de verdad se puede mandar, y los campos de RFID y
 * número de serie están ahí precisamente porque son los dos que hacen que TC
 * reconozca una rueda concreta en vez de crear otra ficha.
 *
 * ── Y por qué nunca dice «sincronizado» ─────────────────────────────────────
 *
 * En esta fase no se escribe en TyreControl. El estado que se enseña es
 * «preparado», «bloqueado», «conflicto» o «no habilitado»: decir sincronizado
 * cuando no se ha mandado nada sería mentirle a quien está mirando la ficha.
 */

import { useEffect, useState } from "react";

import { API_BASE, getAdminHeaders } from "../modules/workshopApi";

type Producto = {
  productoId: string; marca: string | null; modelo: string | null; medida: string | null;
  nuevo: number; usado: number;
};

type Opcion = { valor: string; etiqueta: string };

type Simulacro = {
  apta: boolean;
  motivoNoApta: string | null;
  empresaEnAlcance: boolean;
  sincronizacionSustitucion: boolean;
  preparacion:
    | { estado: "READY_BUT_DISABLED"; llamada: { rpc: string; argumentos: Record<string, unknown> };
        avisos: string[] }
    | { estado: "CONFLICT"; motivo: string }
    | { estado: "BLOCKED"; codigo: string; motivo: string }
    | { estado: "RETRY"; codigo: string; motivo: string }
    | null;
};

type Marca = {
  tcOperacion: string | null;
  tcPosicionCodigo: string | null;
  tcProductoAlmacenId: string | null;
  tcCondicion: string | null;
  tcDestinoRetirado: string | null;
  tcMotivoDesmontaje: string | null;
  tcRfidEntrante: string | null;
  tcSerieEntrante: string | null;
  tcDotEntrante: string | null;
};

const VACIA: Marca = {
  tcOperacion: null, tcPosicionCodigo: null, tcProductoAlmacenId: null,
  tcCondicion: "nuevo", tcDestinoRetirado: "almacen", tcMotivoDesmontaje: "desgaste",
  tcRfidEntrante: null, tcSerieEntrante: null, tcDotEntrante: null,
};

const CAJA = "rounded border border-slate-600 bg-slate-800 px-2 py-1 text-[12px] text-slate-200";

export default function TyreControlSustitucion({ assistanceId, tcEmpresaId, posiciones }: {
  assistanceId: number;
  tcEmpresaId: string;
  /** Solo las que TIENEN rueda: no se sustituye una posición vacía. */
  posiciones: { codigo: string; eje: number | null; medida: string | null }[];
}) {
  const [marca, setMarca] = useState<Marca>(VACIA);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [opciones, setOpciones] = useState<{ destinos: Opcion[]; motivos: Opcion[] }>(
    { destinos: [], motivos: [] });
  const [simulacro, setSimulacro] = useState<Simulacro | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [recarga, setRecarga] = useState(0);

  const activa = marca.tcOperacion === "sustitucion_neumatico";

  useEffect(() => {
    let vivo = true;
    fetch(`${API_BASE}/api/roadside-assistances/${assistanceId}`, { headers: getAdminHeaders() })
      .then((r) => r.json())
      .then((a) => {
        if (!vivo || !a) return;
        setMarca({
          tcOperacion: a.tcOperacion ?? null,
          tcPosicionCodigo: a.tcPosicionCodigo ?? null,
          tcProductoAlmacenId: a.tcProductoAlmacenId ?? null,
          tcCondicion: a.tcCondicion ?? "nuevo",
          tcDestinoRetirado: a.tcDestinoRetirado ?? "almacen",
          tcMotivoDesmontaje: a.tcMotivoDesmontaje ?? "desgaste",
          tcRfidEntrante: a.tcRfidEntrante ?? null,
          tcSerieEntrante: a.tcSerieEntrante ?? null,
          tcDotEntrante: a.tcDotEntrante ?? null,
        });
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [assistanceId, recarga]);

  /* Las listas vienen del servidor: son los CHECK de TyreControl, no una copia. */
  useEffect(() => {
    let vivo = true;
    fetch(`${API_BASE}/api/tyrecontrol/sustitucion/opciones`, { headers: getAdminHeaders() })
      .then((r) => r.json())
      .then((o) => { if (vivo && o) setOpciones({ destinos: o.destinos ?? [], motivos: o.motivos ?? [] }); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  /* El almacén solo se pide cuando hace falta: es una llamada a TyreControl. */
  useEffect(() => {
    if (!activa || !tcEmpresaId) return;
    let vivo = true;
    fetch(`${API_BASE}/api/tyrecontrol/stock?tcEmpresaId=${encodeURIComponent(tcEmpresaId)}`,
      { headers: getAdminHeaders() })
      .then((r) => r.json())
      .then((s) => { if (vivo) setProductos(s?.data ?? []); })
      .catch(() => { if (vivo) setProductos([]); });
    return () => { vivo = false; };
  }, [activa, tcEmpresaId]);

  /* El simulacro es un GET sin efectos: se puede repedir sin consecuencias. */
  useEffect(() => {
    if (!activa) return;
    let vivo = true;
    fetch(`${API_BASE}/api/tyrecontrol/simulacro/sustitucion/${assistanceId}`,
      { headers: getAdminHeaders() })
      .then((r) => r.json())
      .then((s) => { if (vivo) setSimulacro(s ?? null); })
      .catch(() => { if (vivo) setSimulacro(null); });
    return () => { vivo = false; };
  }, [activa, assistanceId, recarga]);

  async function guardar(cambios: Partial<Marca>) {
    const siguiente = { ...marca, ...cambios };
    setMarca(siguiente);
    // Sin rueda y sin producto el PATCH no pasa la validación del servidor: se
    // deja escrito en pantalla y se manda cuando esté completo.
    if (!siguiente.tcPosicionCodigo || !siguiente.tcProductoAlmacenId) return;
    setOcupado(true);
    try {
      await fetch(`${API_BASE}/api/tyrecontrol/asistencias/${assistanceId}/marca-sustitucion`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...getAdminHeaders() },
        body: JSON.stringify(siguiente),
      });
      setRecarga((n) => n + 1);
    } finally { setOcupado(false); }
  }

  const medidaRueda = posiciones.find((p) => p.codigo === marca.tcPosicionCodigo)?.medida ?? null;
  const texto = busqueda.trim().toLowerCase();
  const visibles = productos.filter((p) => {
    if (!texto) return true;
    return [p.marca, p.modelo, p.medida, p.productoId]
      .some((c) => String(c ?? "").toLowerCase().includes(texto));
  });

  return (
    <div className="mt-2 border-t border-cyan-500/20 pt-2">
      <label className="flex items-center gap-1.5 text-[12px] text-slate-300">
        <input
          type="checkbox" checked={activa} disabled={ocupado}
          onChange={(e) => setMarca({ ...marca, tcOperacion: e.target.checked ? "sustitucion_neumatico" : null })}
        />
        Se sustituyó un neumático
      </label>

      {activa && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={marca.tcPosicionCodigo ?? ""} disabled={ocupado} className={CAJA}
              onChange={(e) => void guardar({ tcPosicionCodigo: e.target.value || null })}
            >
              <option value="">¿Qué rueda?</option>
              {posiciones.map((p) => (
                <option key={p.codigo} value={p.codigo}>
                  {p.codigo}{p.eje ? ` (eje ${p.eje})` : ""}{p.medida ? ` · ${p.medida}` : ""}
                </option>
              ))}
            </select>

            <select
              value={marca.tcMotivoDesmontaje ?? "desgaste"} disabled={ocupado} className={CAJA}
              onChange={(e) => void guardar({ tcMotivoDesmontaje: e.target.value })}
            >
              {opciones.motivos.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
            </select>

            <select
              value={marca.tcDestinoRetirado ?? "almacen"} disabled={ocupado} className={CAJA}
              onChange={(e) => void guardar({ tcDestinoRetirado: e.target.value })}
            >
              {opciones.destinos.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
            </select>
          </div>

          {/* ── El entrante ─────────────────────────────────────────────── */}
          <div className="rounded border border-slate-700 bg-slate-900/40 p-2">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-slate-300">Neumático montado</span>
              <input
                value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar marca, modelo o medida" className={`${CAJA} w-52`}
              />
              <select
                value={marca.tcCondicion ?? "nuevo"} disabled={ocupado} className={CAJA}
                onChange={(e) => void guardar({ tcCondicion: e.target.value })}
              >
                <option value="nuevo">Nuevo</option>
                <option value="usado">Usado</option>
              </select>
            </div>

            <select
              value={marca.tcProductoAlmacenId ?? ""} disabled={ocupado} className={`${CAJA} w-full`}
              onChange={(e) => void guardar({ tcProductoAlmacenId: e.target.value || null })}
            >
              <option value="">Elige del almacén de la empresa…</option>
              {visibles.map((p) => {
                const hay = marca.tcCondicion === "usado" ? p.usado : p.nuevo;
                return (
                  <option key={p.productoId} value={p.productoId} disabled={hay <= 0}>
                    {[p.marca, p.modelo, p.medida].filter(Boolean).join(" ") || p.productoId}
                    {` · ${hay} ${marca.tcCondicion === "usado" ? "usados" : "nuevos"}`}
                    {hay <= 0 ? " · sin stock" : ""}
                  </option>
                );
              })}
            </select>

            {productos.length === 0 && (
              <p className="mt-1 text-[11px] text-slate-400">
                No se ha podido leer el almacén de esta empresa en TyreControl.
              </p>
            )}

            <div className="mt-2 flex flex-wrap gap-2">
              <input
                value={marca.tcRfidEntrante ?? ""} placeholder="RFID (si lo tiene)" className={`${CAJA} w-40`}
                onChange={(e) => setMarca({ ...marca, tcRfidEntrante: e.target.value || null })}
                onBlur={() => void guardar({})}
              />
              <input
                value={marca.tcSerieEntrante ?? ""} placeholder="Nº de serie" className={`${CAJA} w-36`}
                onChange={(e) => setMarca({ ...marca, tcSerieEntrante: e.target.value || null })}
                onBlur={() => void guardar({})}
              />
              <input
                value={marca.tcDotEntrante ?? ""} placeholder="DOT" className={`${CAJA} w-24`}
                onChange={(e) => setMarca({ ...marca, tcDotEntrante: e.target.value || null })}
                onBlur={() => void guardar({})}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              El RFID y el número de serie son lo único que identifica una unidad concreta: con
              ellos TyreControl reengancha su ficha en vez de crear otra. El DOT es la semana de
              fabricación, no identifica la rueda.
            </p>
          </div>

          {medidaRueda && <p className="text-[11px] text-slate-400">Medida de la rueda: {medidaRueda}</p>}

          <Preparado simulacro={activa ? simulacro : null} />
        </div>
      )}
    </div>
  );
}

/**
 * El estado de la preparación, sin usar nunca la palabra «sincronizado».
 */
function Preparado({ simulacro }: { simulacro: Simulacro | null }) {
  if (!simulacro) return null;

  if (!simulacro.apta) {
    return <Chapa clase="border-slate-600 text-slate-400" texto="TC no habilitado"
                  detalle={simulacro.motivoNoApta} />;
  }
  const p = simulacro.preparacion;
  if (!p) return null;

  if (p.estado === "CONFLICT") {
    return <Chapa clase="border-amber-500/40 bg-amber-500/10 text-amber-300"
                  texto="TC conflicto" detalle={p.motivo} />;
  }
  if (p.estado === "BLOCKED" || p.estado === "RETRY") {
    return <Chapa clase="border-amber-500/40 bg-amber-500/10 text-amber-300"
                  texto="TC bloqueado" detalle={p.motivo} />;
  }

  return (
    <div>
      <Chapa clase="border-cyan-500/40 bg-cyan-500/10 text-cyan-300" texto="TC preparado"
             detalle="Todo comprobado contra TyreControl. No se ha enviado nada." />
      {p.avisos.length > 0 && (
        <ul className="mt-1 space-y-0.5 text-[11px] text-amber-300">
          {p.avisos.map((a) => <li key={a}>⚠ {a}</li>)}
        </ul>
      )}
      <details className="mt-1">
        <summary className="cursor-pointer text-[11px] text-slate-400">
          Ver lo que se le mandaría a TyreControl
        </summary>
        <pre className="mt-1 overflow-x-auto rounded bg-slate-900 p-2 text-[10px] text-slate-300">
          {p.llamada.rpc}({JSON.stringify(p.llamada.argumentos, null, 2)})
        </pre>
      </details>
    </div>
  );
}

function Chapa({ texto, clase, detalle }: { texto: string; clase: string; detalle: string | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${clase}`}>{texto}</span>
      {detalle && <span className="text-[11px] text-slate-400">{detalle}</span>}
    </div>
  );
}
