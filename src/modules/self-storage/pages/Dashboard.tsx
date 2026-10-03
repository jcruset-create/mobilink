/**
 * Dashboard — ocupación y cobros. Accesos y puertas aparecen con su fase en vez
 * de con un cero que parecería un dato; los cobros, sólo a quien ve facturación.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../services/api";
import type { Dashboard as DatosDashboard } from "../types";
import { Aviso, Cabecera, Card, Cargando, ErrorBox, LeyendaPlano, TableWrap, decimal, euros, pct, tdCls, thCls } from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";
import { COLOR_PLANO } from "../types";

function Pendiente({ titulo, fase }: { titulo: string; fase: number }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-700 p-4">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{titulo}</div>
      <div className="mt-1 text-sm text-slate-500">Disponible en la fase {fase}</div>
    </div>
  );
}

function BarraOcupacion({ d }: { d: DatosDashboard["units"] }) {
  if (!d.total) return null;
  const tramos = (["occupied", "reserved", "available", "maintenance", "blocked"] as const).map((e) => ({ e, n: d[e] }));
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800" role="img" aria-label="Reparto de trasteros por estado">
      {tramos.map(({ e, n }) => (n ? <div key={e} style={{ width: `${(n / d.total) * 100}%`, backgroundColor: COLOR_PLANO[e].fill }} /> : null))}
    </div>
  );
}

export default function Dashboard() {
  const { centroId, centros, puede } = useSelfStorage();
  const [datos, setDatos] = useState<DatosDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [todos, setTodos] = useState(false);

  useEffect(() => {
    let vivo = true;
    api
      .dashboard(todos ? null : centroId)
      .then((d) => vivo && (setDatos(d), setError(null)))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : "Error"));
    return () => {
      vivo = false;
    };
  }, [centroId, todos]);

  if (!centros.length) {
    return (
      <>
        <Cabecera titulo="Dashboard" />
        <Aviso tono="info">
          Todavía no hay ningún centro.{" "}
          {puede("ss.centers.manage") ? (
            <Link className="underline" to="/self-storage/centros">
              Crea el primero
            </Link>
          ) : (
            "Pídele a un administrador que lo cree."
          )}
          .
        </Aviso>
      </>
    );
  }
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!datos) return <Cargando />;
  const u = datos.units;

  return (
    <div className="space-y-4">
      <Cabecera titulo="Dashboard" descripcion={todos ? "Todos los centros" : centros.find((c) => c.id === centroId)?.name}>
        {centros.length > 1 && (
          <label className="flex items-center gap-2 text-[12px] text-slate-300">
            <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} /> Todos los centros
          </label>
        )}
      </Cabecera>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card title="Trasteros" value={String(u.total)} />
        <Card title="Disponibles" value={String(u.available)} accent="text-emerald-400" />
        <Card title="Ocupados" value={String(u.occupied)} accent="text-rose-400" />
        <Card title="Reservados" value={String(u.reserved)} accent="text-orange-400" />
        <Card title="Mant. / bloqueados" value={String(u.maintenance + u.blocked)} accent="text-slate-400" />
        <Card title="Ocupación" value={pct(u.occupancyPct)} hint={`${pct(u.occupancyRentablePct)} de los alquilables · ${pct(u.areaOccupancyPct)} en m²`} />
      </div>

      <div className="space-y-2 rounded-lg bg-slate-800 p-4">
        <BarraOcupacion d={u} />
        <LeyendaPlano />
        <div className="text-[11px] text-slate-400">
          {decimal(u.areaOcupada)} m² ocupados de {decimal(u.areaTotal)} m² · Clientes activos: {datos.customers.active}
          {datos.customers.blocked ? ` · bloqueados: ${datos.customers.blocked}` : ""}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {datos.billing.visible && (
          <>
            <Link to="/self-storage/facturas">
              <Card title="Facturado este mes" value={euros(datos.billing.monthlyInvoiced)} />
            </Link>
            <Link to="/self-storage/facturas">
              <Card title="Pendiente de cobro" value={euros(datos.billing.pendingCollection)} accent="text-amber-300" />
            </Link>
            <Link to="/self-storage/impagos">
              <Card
                title="Impagos"
                value={euros(datos.billing.overdue)}
                accent={datos.billing.overdue ? "text-rose-400" : undefined}
                hint={datos.billing.openDunning != null ? `${datos.billing.openDunning} casos abiertos` : undefined}
              />
            </Link>
          </>
        )}
        <Pendiente titulo="Accesos hoy" fase={datos.access.phase} />
        <Pendiente titulo="Estado de puertas" fase={datos.access.phase} />
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Zona</th>
            {todos && <th className={thCls}>Centro</th>}
            <th className={thCls}>Total</th>
            <th className={thCls}>Disp.</th>
            <th className={thCls}>Ocup.</th>
            <th className={thCls}>Res.</th>
            <th className={thCls}>Mant./bloq.</th>
            <th className={thCls}>Ocupación</th>
          </tr>
        </thead>
        <tbody>
          {datos.byZone.map((z) => (
            <tr key={z.id} className="border-t border-slate-700">
              <td className={tdCls}>{z.name}</td>
              {todos && <td className={tdCls}>{z.centerName}</td>}
              <td className={tdCls}>{z.total}</td>
              <td className={tdCls}>{z.available}</td>
              <td className={tdCls}>{z.occupied}</td>
              <td className={tdCls}>{z.reserved}</td>
              <td className={tdCls}>{z.maintenance + z.blocked}</td>
              <td className={tdCls}>{pct(z.occupancyPct)}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
