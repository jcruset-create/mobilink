import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import * as XLSX from "xlsx";
import { listPayments, listTracking, listRecoveryCases } from "../services/data";
import {
  Card, TableWrap, thCls, tdCls, SelectField, Field,
  btnSecondary, inputCls, EmptyRow, ErrorBox,
} from "../components/ui";
import {
  fmtEur, fmtFecha, hoyISO, diasVencidos, CENTRO_LABELS, CENTROS,
  type Payment, type PaymentTracking, type RecoveryCase, type Centro,
} from "../types";

function primerDiaMes(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function Informes() {
  const [desde, setDesde] = useState(primerDiaMes());
  const [hasta, setHasta] = useState(hoyISO());
  const [centro, setCentro] = useState<Centro | "">("");
  const [cobros, setCobros] = useState<Payment[]>([]);
  const [seguimientos, setSeguimientos] = useState<PaymentTracking[]>([]);
  const [recobros, setRecobros] = useState<RecoveryCase[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const [c, t, r] = await Promise.all([
        listPayments({ desde, hasta, center: centro }),
        listTracking(),
        listRecoveryCases(),
      ]);
      setCobros(c.filter((x) => !x.is_cancelled));
      setSeguimientos(t);
      setRecobros(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando informes");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, centro]);

  useEffect(() => { void cargar(); }, [cargar]);

  // Cobros por forma de pago
  const porForma = useMemo(() => {
    const m = new Map<string, { n: number; total: number }>();
    for (const c of cobros) {
      const e = m.get(c.payment_method) ?? { n: 0, total: 0 };
      e.n += 1;
      e.total += Number(c.amount);
      m.set(c.payment_method, e);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [cobros]);

  // Cobros por día
  const porDia = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cobros) m.set(c.payment_date, (m.get(c.payment_date) ?? 0) + Number(c.amount));
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [cobros]);

  // Ranking clientes con más retraso (recobros + seguimientos vencidos)
  const ranking = useMemo(() => {
    const m = new Map<string, { nombre: string; pendiente: number; maxDias: number }>();
    for (const r of recobros) {
      const key = r.customer_id;
      const e = m.get(key) ?? { nombre: r.customer?.name ?? "Cliente", pendiente: 0, maxDias: 0 };
      e.pendiente += Number(r.pending_amount);
      e.maxDias = Math.max(e.maxDias, diasVencidos(r.due_date));
      m.set(key, e);
    }
    const hoy = hoyISO();
    for (const t of seguimientos) {
      if (!t.expected_payment_date || t.expected_payment_date >= hoy) continue;
      const key = t.customer_id;
      const e = m.get(key) ?? { nombre: t.customer?.name ?? "Cliente", pendiente: 0, maxDias: 0 };
      e.pendiente += Number(t.pending_amount);
      e.maxDias = Math.max(e.maxDias, diasVencidos(t.expected_payment_date));
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => b.pendiente - a.pendiente).slice(0, 15);
  }, [recobros, seguimientos]);

  const totalCobrado = cobros.reduce((s, c) => s + Number(c.amount), 0);
  const totalSeguimiento = seguimientos.reduce((s, t) => s + Number(t.pending_amount), 0);
  const totalRecobro = recobros.reduce((s, r) => s + Number(r.pending_amount), 0);

  function exportar() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porForma.map(([forma, e]) => ({
      "Forma de pago": forma, "Nº cobros": e.n, Total: e.total,
    }))), "Por forma de pago");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(porDia.map(([dia, total]) => ({
      Fecha: fmtFecha(dia), Total: total,
    }))), "Por día");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ranking.map((r) => ({
      Cliente: r.nombre, "Importe pendiente": r.pendiente, "Días máx. retraso": r.maxDias,
    }))), "Clientes con retraso");
    XLSX.writeFile(wb, `informe_administracion_${desde}_a_${hasta}.xlsx`);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-black">Informes</h1>
          <p className="text-sm text-slate-400">Control operativo de cobros y pendientes.</p>
        </div>
        <button onClick={exportar} className={btnSecondary} disabled={cargando}>
          <span className="flex items-center gap-1"><Download className="h-4 w-4" /> Exportar Excel</span>
        </button>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {/* Filtros */}
      <div className="mb-3 grid max-w-2xl grid-cols-3 gap-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
        <Field label="Desde"><input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} /></Field>
        <Field label="Hasta"><input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} /></Field>
        <SelectField label="Centro" value={centro} onChange={(v) => setCentro(v as Centro | "")}>
          <option value="">Todos</option>
          {CENTROS.map((c) => <option key={c} value={c}>{CENTRO_LABELS[c]}</option>)}
        </SelectField>
      </div>

      {/* Totales */}
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Card title="Cobrado en el periodo" value={cargando ? "…" : fmtEur(totalCobrado)} accent="text-emerald-300" />
        <Card title="Pendiente en seguimiento" value={cargando ? "…" : fmtEur(totalSeguimiento)} accent="text-amber-300" />
        <Card title="Pendiente en recobro" value={cargando ? "…" : fmtEur(totalRecobro)} accent="text-rose-300" />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {/* Por forma de pago */}
        <div>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Cobros por forma de pago</h2>
          <TableWrap>
            <thead>
              <tr className="border-b border-slate-700">
                <th className={thCls}>Forma</th>
                <th className={`${thCls} text-right`}>Nº</th>
                <th className={`${thCls} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {porForma.length === 0 && <EmptyRow cols={3} text="Sin cobros en el periodo." />}
              {porForma.map(([forma, e]) => (
                <tr key={forma} className="border-b border-slate-700/50">
                  <td className={`${tdCls} font-semibold`}>{forma}</td>
                  <td className={`${tdCls} text-right`}>{e.n}</td>
                  <td className={`${tdCls} text-right font-bold text-emerald-300`}>{fmtEur(e.total)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>

        {/* Por día */}
        <div>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Cobros por día</h2>
          <TableWrap>
            <thead>
              <tr className="border-b border-slate-700">
                <th className={thCls}>Fecha</th>
                <th className={`${thCls} text-right`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {porDia.length === 0 && <EmptyRow cols={2} text="Sin cobros en el periodo." />}
              {porDia.map(([dia, total]) => (
                <tr key={dia} className="border-b border-slate-700/50">
                  <td className={tdCls}>{fmtFecha(dia)}</td>
                  <td className={`${tdCls} text-right font-bold text-emerald-300`}>{fmtEur(total)}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>

        {/* Ranking retraso */}
        <div>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-400">Clientes con más retraso</h2>
          <TableWrap>
            <thead>
              <tr className="border-b border-slate-700">
                <th className={thCls}>Cliente</th>
                <th className={`${thCls} text-right`}>Pendiente</th>
                <th className={`${thCls} text-right`}>Días máx.</th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 && <EmptyRow cols={3} text="Sin retrasos. 👌" />}
              {ranking.map((r) => (
                <tr key={r.nombre} className="border-b border-slate-700/50">
                  <td className={`${tdCls} font-semibold`}>{r.nombre}</td>
                  <td className={`${tdCls} text-right font-bold text-rose-300`}>{fmtEur(r.pendiente)}</td>
                  <td className={`${tdCls} text-right`}>{r.maxDias}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </div>
    </div>
  );
}
