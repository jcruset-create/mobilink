/**
 * Contratos del centro elegido: filtro por estado y búsqueda, importe
 * pendiente y si están en impago. Desde aquí se crean (también llegando con
 * `?nuevo=1&customerId=…&unitId=…` desde la ficha del cliente o el plano).
 */

import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import * as api from "../services/api";
import { CONTRACT_STATUSES, type Contrato } from "../types";
import FormContrato from "../components/FormContrato";
import { Cabecera, ChipContrato, EmptyRow, ErrorBox, SelectField, TableWrap, TextField, btnPrimary, euros, fecha, msgError, tdCls, thCls } from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

export default function Contratos() {
  const { centroId, puede, etqContrato, etqMetodo } = useSelfStorage();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [lista, setLista] = useState<Contrato[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const nuevo = params.get("nuevo") === "1";

  const cargar = useCallback(async () => {
    try {
      setLista(await api.contratos({ centerId: centroId ?? undefined, status: status || undefined, q: q || undefined }));
      setError(null);
    } catch (e) {
      setError(msgError(e));
    }
  }, [centroId, status, q]);

  useEffect(() => {
    const t = setTimeout(() => void cargar(), 200);
    return () => clearTimeout(t);
  }, [cargar]);

  return (
    <div className="space-y-3">
      <Cabecera titulo="Contratos" descripcion="Del borrador a la firma, el primer cobro y la finalización.">
        {puede("ss.contracts.manage") && (
          <button className={btnPrimary} onClick={() => setParams({ nuevo: "1" })}>
            Nuevo contrato
          </button>
        )}
      </Cabecera>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_220px]">
        <TextField label="Buscar" value={q} onChange={setQ} placeholder="Número, trastero, cliente…" />
        <SelectField label="Estado" value={status} onChange={setStatus}>
          <option value="">Todos</option>
          {CONTRACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {etqContrato(s)}
            </option>
          ))}
        </SelectField>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Número</th>
            <th className={thCls}>Cliente</th>
            <th className={thCls}>Trastero</th>
            <th className={thCls}>Inicio</th>
            <th className={thCls}>PVP/mes</th>
            <th className={thCls}>Pago</th>
            <th className={thCls}>Pendiente</th>
            <th className={thCls}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {lista && lista.length === 0 && <EmptyRow cols={8} text="No hay contratos con este filtro." />}
          {!lista && <EmptyRow cols={8} text="Cargando…" />}
          {lista?.map((k) => (
            <tr key={k.id} className="cursor-pointer border-t border-slate-700 hover:bg-slate-800/60" onClick={() => navigate(`/self-storage/contratos/${k.id}`)}>
              <td className={tdCls}>
                <Link to={`/self-storage/contratos/${k.id}`} className="font-bold text-sky-300 hover:underline">
                  {k.contractNumber}
                </Link>
              </td>
              <td className={tdCls}>{k.customerName}</td>
              <td className={tdCls}>{k.unitCode}</td>
              <td className={tdCls}>{fecha(k.startDate)}</td>
              <td className={tdCls}>{euros(k.monthlyPriceGross)}</td>
              <td className={tdCls}>{etqMetodo(k.paymentMethod)}</td>
              <td className={tdCls}>
                {k.pendingAmount ? <span className={k.inDunning ? "text-rose-300" : "text-amber-300"}>{euros(k.pendingAmount)}</span> : "—"}
                {k.inDunning && <span className="ml-1 text-[10px] font-bold text-rose-300">IMPAGO</span>}
              </td>
              <td className={tdCls}>
                <ChipContrato estado={k.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>

      {nuevo && (
        <FormContrato
          inicial={{ customerId: params.get("customerId") ?? undefined, unitId: params.get("unitId") ?? undefined }}
          onCerrar={() => setParams({})}
          onHecho={(c) => navigate(`/self-storage/contratos/${c.id}`)}
        />
      )}
    </div>
  );
}
