import { inputCls } from "../ui";
import type { Empresa } from "../../types";
import type { FiltrosInformes } from "../../types/informes";

export function FiltroBarInformes({ filtros, setFiltros, esCliente, empresas }: {
  filtros: FiltrosInformes;
  setFiltros: (f: FiltrosInformes) => void;
  esCliente: boolean;
  empresas: Empresa[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {!esCliente && (
        <select
          className={`${inputCls} w-auto`}
          value={filtros.empresaId ?? ""}
          onChange={(e) => setFiltros({ ...filtros, empresaId: e.target.value || null })}
        >
          <option value="">Todas las empresas</option>
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
        </select>
      )}
      <input type="date" className={`${inputCls} w-auto`} value={filtros.desde ?? ""} onChange={(e) => setFiltros({ ...filtros, desde: e.target.value || null })} title="Desde" />
      <input type="date" className={`${inputCls} w-auto`} value={filtros.hasta ?? ""} onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value || null })} title="Hasta" />
    </div>
  );
}
