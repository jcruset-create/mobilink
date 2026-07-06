import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { useAdminAuth } from "../contexts/AdminAuthContext";
import { listCustomers } from "../services/data";
import { TableWrap, thCls, tdCls, btnPrimary, inputCls, Pill, EmptyRow, ErrorBox } from "../components/ui";
import { fmtEur, type Customer } from "../types";
import { ModalCliente } from "./ClienteFicha";

export default function Clientes() {
  const { perfil } = useAdminAuth();
  const puedeGestionar = perfil ? ["admin", "administracion"].includes(perfil.rol) : false;

  const [clientes, setClientes] = useState<Customer[]>([]);
  const [filtro, setFiltro] = useState("");
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      setClientes(await listCustomers(filtro));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando clientes");
    } finally {
      setCargando(false);
    }
  }, [filtro]);

  useEffect(() => {
    const timer = setTimeout(() => void cargar(), 250);
    return () => clearTimeout(timer);
  }, [cargar]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black">Clientes con seguimiento</h1>
          <p className="text-sm text-slate-400">Ficha económica y condiciones de pago de cada cliente.</p>
        </div>
        {puedeGestionar && (
          <button onClick={() => setCreando(true)} className={btnPrimary}>
            <span className="flex items-center gap-1"><Plus className="h-4 w-4" /> Nuevo cliente</span>
          </button>
        )}
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="relative mb-3 max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
        <input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar por nombre o CIF/NIF…"
          className={`${inputCls} pl-9`}
        />
      </div>

      <TableWrap>
        <thead>
          <tr className="border-b border-slate-700">
            <th className={thCls}>Cliente</th>
            <th className={thCls}>CIF/NIF</th>
            <th className={thCls}>Teléfono</th>
            <th className={thCls}>Forma de pago</th>
            <th className={thCls}>Giro bancario</th>
            <th className={thCls}>Seguimiento</th>
            <th className={`${thCls} text-right`}>Días de pago</th>
            <th className={`${thCls} text-right`}>Límite crédito</th>
          </tr>
        </thead>
        <tbody>
          {cargando && <EmptyRow cols={8} text="Cargando…" />}
          {!cargando && clientes.length === 0 && <EmptyRow cols={8} text="No hay clientes. Crea el primero." />}
          {!cargando && clientes.map((c) => (
            <tr key={c.id} className="border-b border-slate-700/50 hover:bg-slate-700/30">
              <td className={`${tdCls} font-semibold`}>
                <Link to={`/administracion/clientes/${c.id}`} className="text-sky-400 hover:underline">{c.name}</Link>
              </td>
              <td className={tdCls}>{c.tax_id ?? "—"}</td>
              <td className={tdCls}>{c.phone ?? "—"}</td>
              <td className={tdCls}>{c.payment_method ?? "—"}</td>
              <td className={tdCls}>
                <Pill className={c.has_direct_debit ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-700 text-slate-400"}>
                  {c.has_direct_debit ? "Sí" : "No"}
                </Pill>
              </td>
              <td className={tdCls}>
                <Pill className={c.requires_payment_tracking && !c.has_direct_debit ? "bg-amber-500/20 text-amber-300" : "bg-slate-700 text-slate-400"}>
                  {c.has_direct_debit ? "No aplica" : c.requires_payment_tracking ? "Sí" : "No"}
                </Pill>
              </td>
              <td className={`${tdCls} text-right`}>{c.expected_payment_days}</td>
              <td className={`${tdCls} text-right`}>{c.internal_credit_limit != null ? fmtEur(c.internal_credit_limit) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {creando && (
        <ModalCliente
          cliente={null}
          onClose={() => setCreando(false)}
          onSaved={() => { setCreando(false); void cargar(); }}
        />
      )}
    </div>
  );
}
