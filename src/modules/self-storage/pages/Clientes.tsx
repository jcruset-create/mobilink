/**
 * Clientes de Self Storage. Son SUYOS: no se buscan ni se crean en ninguna
 * otra tabla de clientes de Mobilink.
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import * as api from "../services/api";
import type { Cliente } from "../types";
import FormCliente from "../components/FormCliente";
import { Cabecera, ChipCliente, EmptyRow, ErrorBox, TableWrap, btnMini, btnPrimary, inputCls, tdCls, thCls } from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

const POR_PAGINA = 50;

export default function Clientes() {
  const { puede, etqTipoCliente } = useSelfStorage();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<{ total: number; items: Cliente[] }>({ total: 0, items: [] });
  const [error, setError] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.clientes({ q: q || undefined, status: status || undefined, limit: POR_PAGINA, offset: pagina * POR_PAGINA }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [q, status, pagina]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 250);
    return () => clearTimeout(t);
  }, [cargar]);

  return (
    <div className="space-y-4">
      <Cabecera titulo="Clientes" descripcion={`${datos.total} cliente(s) de Self Storage`}>
        {puede("ss.customers.manage") && (
          <button className={btnPrimary} onClick={() => setNuevo(true)}>
            Nuevo cliente
          </button>
        )}
      </Cabecera>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px]">
        <input className={inputCls} placeholder="Nombre, NIF, email o teléfono…" value={q} onChange={(e) => (setQ(e.target.value), setPagina(0))} />
        <select className={inputCls} value={status} onChange={(e) => (setStatus(e.target.value), setPagina(0))}>
          <option value="">Todos</option>
          <option value="active">Activos</option>
          <option value="blocked">Bloqueados</option>
          <option value="inactive">Inactivos</option>
        </select>
      </div>
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Cliente</th>
            <th className={`${thCls} hidden sm:table-cell`}>Tipo</th>
            <th className={thCls}>NIF</th>
            <th className={`${thCls} hidden md:table-cell`}>Teléfono</th>
            <th className={`${thCls} hidden lg:table-cell`}>Email</th>
            <th className={thCls}>Contratos</th>
            <th className={thCls}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {datos.items.length === 0 && <EmptyRow cols={7} text="No hay clientes con este filtro." />}
          {datos.items.map((c) => (
            <tr key={c.id} className="cursor-pointer border-t border-slate-700 hover:bg-slate-700/40" onClick={() => navigate(`/self-storage/clientes/${c.id}`)}>
              <td className={tdCls}>
                <Link to={`/self-storage/clientes/${c.id}`} className="font-medium text-sky-300 hover:underline" onClick={(e) => e.stopPropagation()}>
                  {c.displayName}
                </Link>
              </td>
              <td className={`${tdCls} hidden sm:table-cell`}>{etqTipoCliente(c.customerType)}</td>
              <td className={tdCls}>{c.taxId}</td>
              <td className={`${tdCls} hidden md:table-cell`}>{c.phone}</td>
              <td className={`${tdCls} hidden lg:table-cell`}>{c.email}</td>
              <td className={tdCls}>{c.contratosVivos ?? 0}</td>
              <td className={tdCls}>
                <ChipCliente estado={c.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {datos.total > POR_PAGINA && (
        <div className="flex items-center justify-end gap-2 text-[12px] text-slate-400">
          <button className={btnMini} disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>
            Anterior
          </button>
          <span>
            {pagina * POR_PAGINA + 1}–{Math.min(datos.total, (pagina + 1) * POR_PAGINA)} de {datos.total}
          </span>
          <button className={btnMini} disabled={(pagina + 1) * POR_PAGINA >= datos.total} onClick={() => setPagina((p) => p + 1)}>
            Siguiente
          </button>
        </div>
      )}
      {nuevo && <FormCliente cliente={null} onCerrar={() => setNuevo(false)} onHecho={(c) => navigate(`/self-storage/clientes/${c.id}`)} />}
    </div>
  );
}
