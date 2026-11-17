/**
 * Configuración · medidas, índices de carga, códigos de velocidad y modelos,
 * cada uno con lo que tiene vinculado.
 *
 * Las medidas, los índices, las velocidades y los modelos se crean aquí. Las
 * COMBINACIONES (medida + índice + velocidad) y su vínculo con el modelo no:
 * nacen al dar de alta un neumático, y aquí solo se ven. El cruce lo hace
 * `services/catalogoVinculado.ts`.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  actualizarKgIndiceCarga, actualizarKmhVelocidad, crearIndiceCarga, crearIndiceVelocidad,
  leerCombinacionesYReferencias, listarIndicesCarga, listarIndicesVelocidad, listarMarcas, listarMedidas,
  listarModelos,
} from "../services/data";
import {
  combosVista, delModelo, porIndice, porMedida, porVelocidad,
  type CombinacionCat, type ComboVista, type ReferenciaCat,
} from "../services/catalogoVinculado";
import type { IndiceCarga, IndiceVelocidad, MarcaNeumatico, MedidaNeumatico, ModeloNeumatico } from "../types";
import { inputCls } from "./ui";
import ImportarCatalogo from "./ImportarCatalogo";

type Pestana = "medidas" | "indices" | "velocidades" | "modelos" | "importar";

const ETIQUETAS: Record<Pestana, string> = {
  medidas: "Medidas",
  indices: "Índices de carga",
  velocidades: "Códigos de velocidad",
  modelos: "Modelos",
  importar: "Importar Excel",
};

const COMO: Record<string, string> = { sencillo: "Sencillo", gemelo: "Gemelo", ambos: "Sencillo y gemelo" };

function Chip({ children, tono = "gris" }: { children: ReactNode; tono?: "gris" | "verde" | "azul" }) {
  const cls = tono === "verde"
    ? "border border-emerald-800 bg-emerald-950 text-emerald-200"
    : tono === "azul" ? "bg-sky-900 text-sky-100" : "bg-slate-700 text-slate-100";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

function TablaCombos({ combos, conModelos }: { combos: ComboVista[]; conModelos: boolean }) {
  if (combos.length === 0) {
    return (
      <div className="rounded border border-dashed border-slate-600 p-3 text-[12px] text-slate-400">
        Sin combinaciones todavía. Se crean solas al dar de alta un neumático con su medida, su índice de carga y su
        velocidad.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded border border-slate-700">
      <table className="w-full min-w-[480px] text-[12px]">
        <thead>
          <tr className="bg-slate-900 text-left text-[10px] uppercase tracking-wide text-slate-400">
            {!conModelos && <th scope="col" className="px-3 py-2">Medida</th>}
            <th scope="col" className="px-3 py-2">Índice de carga</th>
            <th scope="col" className="px-3 py-2">Velocidad</th>
            {conModelos && <th scope="col" className="px-3 py-2">Modelos</th>}
          </tr>
        </thead>
        <tbody>
          {combos.map((c) => (
            <tr key={c.id} className="border-t border-slate-700 align-top">
              {!conModelos && <td className="px-3 py-2 font-bold">{c.medida}</td>}
              <td className="px-3 py-2 text-[14px] font-black">{c.ic}</td>
              <td className="px-3 py-2"><Chip tono="azul">{c.cv || "—"}</Chip></td>
              {conModelos && (
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {c.modelos.length ? c.modelos.map((m) => <Chip key={m} tono="verde">{m}</Chip>)
                      : <span className="text-slate-500">Ningún modelo</span>}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Un número que se edita en su sitio y se guarda al salir del campo. */
function NumeroEditable({ id, valor, unidad, puedeEditar, onGuardar }: {
  id: string; valor: number | null | undefined; unidad: string; puedeEditar: boolean;
  onGuardar: (n: number | null) => Promise<void>;
}) {
  // Quien la pinta le pone `key` con el valor guardado: si cambia, se monta de
  // nuevo con él, sin sincronizar estado a mano.
  const [texto, setTexto] = useState(valor == null ? "" : String(valor));
  if (!puedeEditar) return <span>{valor == null ? "—" : `${valor.toLocaleString("es-ES")} ${unidad}`}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <input
        id={id}
        aria-label={unidad === "kg" ? "Carga máxima en kg" : "Velocidad máxima en km/h"}
        inputMode="numeric"
        className="w-20 rounded border border-slate-600 bg-slate-900 px-2 py-1 text-[12px]"
        value={texto}
        onChange={(e) => setTexto(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={() => {
          const n = texto.trim() ? Number(texto) : null;
          if (n !== (valor ?? null)) void onGuardar(n);
        }}
      />
      <span className="text-slate-400">{unidad}</span>
    </span>
  );
}

export default function CatalogoVinculado({ puedeEditar }: { puedeEditar: boolean }) {
  const [pestana, setPestana] = useState<Pestana>("medidas");
  const [medidas, setMedidas] = useState<MedidaNeumatico[]>([]);
  const [indices, setIndices] = useState<IndiceCarga[]>([]);
  const [velocidades, setVelocidades] = useState<IndiceVelocidad[]>([]);
  const [marcas, setMarcas] = useState<MarcaNeumatico[]>([]);
  const [modelos, setModelos] = useState<ModeloNeumatico[]>([]);
  const [crudos, setCrudos] = useState<{ combos: CombinacionCat[]; refs: ReferenciaCat[] }>({ combos: [], refs: [] });
  const [msg, setMsg] = useState("");

  const [busca, setBusca] = useState("");
  const [medidaSel, setMedidaSel] = useState("");
  const [marcaSel, setMarcaSel] = useState("");
  const [modeloSel, setModeloSel] = useState("");
  const [nuevoIc, setNuevoIc] = useState({ valor: "", kg: "" });
  const [nuevaV, setNuevaV] = useState({ valor: "", kmh: "" });

  // Cada cambio sube `vuelta` y se vuelve a leer todo.
  const [vuelta, setVuelta] = useState(0);
  useEffect(() => {
    let vivo = true;
    Promise.all([
      listarMedidas(), listarIndicesCarga(), listarIndicesVelocidad(), listarMarcas(), listarModelos(),
      leerCombinacionesYReferencias(),
    ]).then(([me, ic, cv, ma, mo, cr]) => {
      if (!vivo) return;
      setMedidas(me); setIndices(ic); setVelocidades(cv); setMarcas(ma); setModelos(mo); setCrudos(cr);
    }).catch((e: unknown) => {
      if (vivo) setMsg(e instanceof Error ? e.message : "No se ha podido leer el catálogo");
    });
    return () => { vivo = false; };
  }, [vuelta]);

  const combos = useMemo(() => combosVista(crudos.combos, crudos.refs), [crudos]);
  const vMedidas = useMemo(() => porMedida(medidas, combos, crudos.combos), [medidas, combos, crudos]);
  const vIndices = useMemo(() => porIndice(indices, combos), [indices, combos]);
  const vVelocidades = useMemo(() => porVelocidad(velocidades, combos), [velocidades, combos]);

  const medidasFiltradas = vMedidas.filter((m) =>
    !busca.trim() || m.medida.valor.toUpperCase().replace(/\s/g, "").includes(busca.toUpperCase().replace(/\s/g, "")));
  const medidaVista = vMedidas.find((m) => m.medida.id === medidaSel) ?? medidasFiltradas[0];
  const modelosDeMarca = modelos.filter((m) => !marcaSel || m.marca_id === marcaSel);
  const modeloVista = modeloSel ? delModelo(modeloSel, combos, crudos.refs) : null;

  async function hacer(f: () => Promise<void>, ok: string) {
    setMsg("");
    try { await f(); setMsg(ok); setVuelta((n) => n + 1); }
    catch (e: unknown) {
      const m = e instanceof Error ? e.message : "Error";
      setMsg(/duplicate|unique/i.test(m) ? "Ya existe." : m);
    }
  }

  return (
    <div className="mt-4 rounded-lg bg-slate-800 p-3">
      <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Medidas, cargas y velocidades vinculadas</div>
      <div className="mb-3 text-[11px] text-slate-500">
        Cada medida con las combinaciones de índice de carga y velocidad que se montan, y los modelos de cada una. Las
        combinaciones se crean al dar de alta un neumático; aquí se consultan.
      </div>

      <div role="tablist" aria-label="Tablas del catálogo" className="mb-3 flex flex-wrap gap-1 border-b border-slate-700 pb-2">
        {(Object.keys(ETIQUETAS) as Pestana[]).filter((p) => p !== "importar" || puedeEditar).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pestana === p}
            onClick={() => setPestana(p)}
            className={`rounded px-3 py-1.5 text-[12px] font-bold ${pestana === p ? "bg-sky-900 text-sky-100" : "text-slate-300 hover:bg-slate-700"}`}
          >
            {ETIQUETAS[p]}
          </button>
        ))}
      </div>

      {msg && <div className={`mb-2 text-[12px] ${msg.startsWith("✔") ? "text-emerald-400" : "text-rose-300"}`}>{msg}</div>}

      {pestana === "medidas" && (
        <div className="flex flex-wrap gap-3">
          <div className="flex w-full flex-col gap-2 sm:w-64">
            <label htmlFor="cat-buscar-medida" className="text-[11px] text-slate-400">Buscar medida</label>
            <input id="cat-buscar-medida" className={inputCls} placeholder="195/70R15" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <div className="max-h-96 space-y-1 overflow-y-auto">
              {medidasFiltradas.map((m) => (
                <button
                  key={m.medida.id}
                  type="button"
                  aria-pressed={medidaVista?.medida.id === m.medida.id}
                  onClick={() => setMedidaSel(m.medida.id)}
                  className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[12px] ${medidaVista?.medida.id === m.medida.id ? "bg-sky-950 text-sky-100 ring-1 ring-sky-600" : "text-slate-200 hover:bg-slate-700"}`}
                >
                  <span className="font-bold">{m.medida.valor}</span>
                  <span className="text-[11px] text-slate-400">{m.combos.length || "—"}</span>
                </button>
              ))}
            </div>
            <div className="text-[10px] text-slate-500">Las medidas nuevas se dan de alta arriba, en «Medidas».</div>
          </div>
          <div className="min-w-0 flex-1">
            {medidaVista && (
              <>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[18px] font-black">{medidaVista.medida.valor}</span>
                  {medidaVista.medida.categoria && <Chip>{medidaVista.medida.categoria}</Chip>}
                  <span className="text-[11px] text-slate-400">
                    {medidaVista.combos.length} {medidaVista.combos.length === 1 ? "combinación" : "combinaciones"}
                  </span>
                </div>
                <TablaCombos combos={medidaVista.combos} conModelos />
              </>
            )}
          </div>
        </div>
      )}

      {pestana === "indices" && (
        <div className="flex flex-col gap-3">
          {puedeEditar && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="cat-nuevo-ic" className="text-[11px] text-slate-400">Nuevo índice</label>
                <input id="cat-nuevo-ic" className={inputCls} inputMode="numeric" placeholder="109" value={nuevoIc.valor}
                  onChange={(e) => setNuevoIc({ ...nuevoIc, valor: e.target.value.replace(/[^\d]/g, "") })} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="cat-nuevo-ic-kg" className="text-[11px] text-slate-400">Carga máxima (kg)</label>
                <input id="cat-nuevo-ic-kg" className={inputCls} inputMode="numeric" placeholder="1030" value={nuevoIc.kg}
                  onChange={(e) => setNuevoIc({ ...nuevoIc, kg: e.target.value.replace(/[^\d]/g, "") })} />
              </div>
              <button type="button" disabled={!nuevoIc.valor}
                onClick={() => void hacer(async () => { await crearIndiceCarga(nuevoIc.valor, nuevoIc.kg ? Number(nuevoIc.kg) : null); setNuevoIc({ valor: "", kg: "" }); }, "✔ Índice añadido")}
                className="rounded bg-emerald-600 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">Añadir</button>
            </div>
          )}
          <div className="overflow-x-auto rounded border border-slate-700">
            <table className="w-full min-w-[560px] text-[12px]">
              <thead>
                <tr className="bg-slate-900 text-left text-[10px] uppercase tracking-wide text-slate-400">
                  <th scope="col" className="px-3 py-2">Índice</th>
                  <th scope="col" className="px-3 py-2">Carga máxima</th>
                  <th scope="col" className="px-3 py-2">Como</th>
                  <th scope="col" className="px-3 py-2">Usado en</th>
                </tr>
              </thead>
              <tbody>
                {vIndices.map((v) => (
                  <tr key={v.indice.id} className="border-t border-slate-700 align-top">
                    <td className="px-3 py-2 text-[14px] font-black">{v.indice.valor}</td>
                    <td className="px-3 py-2">
                      <NumeroEditable key={`${v.indice.id}-${v.indice.kg ?? ""}`} id={`kg-${v.indice.id}`} valor={v.indice.kg} unidad="kg" puedeEditar={puedeEditar}
                        onGuardar={(n) => hacer(() => actualizarKgIndiceCarga(v.indice.id, n), "✔ Guardado")} />
                    </td>
                    <td className="px-3 py-2 text-slate-300">{v.como ? COMO[v.como] : "—"}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {v.medidas.length ? v.medidas.map((m) => <Chip key={m}>{m}</Chip>)
                          : <span className="text-slate-500">Ninguna combinación todavía</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pestana === "velocidades" && (
        <div className="flex flex-col gap-3">
          {puedeEditar && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="cat-nueva-v" className="text-[11px] text-slate-400">Nuevo código</label>
                <input id="cat-nueva-v" className={inputCls} maxLength={1} placeholder="S" value={nuevaV.valor}
                  onChange={(e) => setNuevaV({ ...nuevaV, valor: e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase() })} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="cat-nueva-v-kmh" className="text-[11px] text-slate-400">Velocidad máxima (km/h)</label>
                <input id="cat-nueva-v-kmh" className={inputCls} inputMode="numeric" placeholder="180" value={nuevaV.kmh}
                  onChange={(e) => setNuevaV({ ...nuevaV, kmh: e.target.value.replace(/[^\d]/g, "") })} />
              </div>
              <button type="button" disabled={!nuevaV.valor}
                onClick={() => void hacer(async () => { await crearIndiceVelocidad(nuevaV.valor, nuevaV.kmh ? Number(nuevaV.kmh) : null); setNuevaV({ valor: "", kmh: "" }); }, "✔ Código añadido")}
                className="rounded bg-emerald-600 px-3 py-2 text-[12px] font-bold text-white disabled:opacity-50">Añadir</button>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {vVelocidades.map((v) => (
              <div key={v.velocidad.id} className="flex flex-col gap-2 rounded border border-slate-700 bg-slate-900 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded bg-sky-900 text-[18px] font-black text-sky-100">{v.velocidad.valor}</span>
                  <NumeroEditable key={`${v.velocidad.id}-${v.velocidad.km_h ?? ""}`} id={`kmh-${v.velocidad.id}`} valor={v.velocidad.km_h} unidad="km/h" puedeEditar={puedeEditar}
                    onGuardar={(n) => hacer(() => actualizarKmhVelocidad(v.velocidad.id, n), "✔ Guardado")} />
                </div>
                <div className="text-[10px] font-bold uppercase text-slate-400">Medidas</div>
                <div className="flex flex-wrap gap-1">
                  {v.medidas.length ? v.medidas.map((m) => <Chip key={m}>{m}</Chip>) : <span className="text-[11px] text-slate-500">Ninguna</span>}
                </div>
                <div className="text-[10px] font-bold uppercase text-slate-400">Modelos</div>
                <div className="flex flex-wrap gap-1">
                  {v.modelos.length ? v.modelos.map((m) => <Chip key={m} tono="verde">{m}</Chip>) : <span className="text-[11px] text-slate-500">Ninguno</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pestana === "modelos" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor="cat-marca" className="text-[11px] text-slate-400">Marca</label>
              <select id="cat-marca" className={inputCls} value={marcaSel} onChange={(e) => { setMarcaSel(e.target.value); setModeloSel(""); }}>
                <option value="">Todas</option>
                {marcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="cat-modelo" className="text-[11px] text-slate-400">Modelo</label>
              <select id="cat-modelo" className={inputCls} value={modeloSel} onChange={(e) => setModeloSel(e.target.value)}>
                <option value="">Elige un modelo…</option>
                {modelosDeMarca.map((m) => (
                  <option key={m.id} value={m.id}>
                    {marcaSel ? m.nombre : `${marcas.find((x) => x.id === m.marca_id)?.nombre ?? ""} ${m.nombre}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {modeloVista && (
            <>
              <div className="flex flex-wrap gap-4 text-[12px]">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Medidas</span>
                  {modeloVista.medidas.length ? modeloVista.medidas.map((m) => <Chip key={m}>{m}</Chip>) : <span className="text-slate-500">—</span>}
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <span className="text-[10px] font-bold uppercase text-slate-400">Velocidades</span>
                  {modeloVista.velocidades.length ? modeloVista.velocidades.map((v) => <Chip key={v} tono="azul">{v}</Chip>) : <span className="text-slate-500">—</span>}
                </div>
              </div>
              <TablaCombos combos={modeloVista.combos} conModelos={false} />
            </>
          )}
        </div>
      )}
      {pestana === "importar" && puedeEditar && (
        <ImportarCatalogo
          catalogo={{ marcas, modelos, medidas, indices, velocidades }}
          onImportado={() => setVuelta((n) => n + 1)}
        />
      )}
    </div>
  );
}
