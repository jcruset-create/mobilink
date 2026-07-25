/**
 * Centro de Inteligencia Operacional — Informes.
 *
 * Catálogo de informes analíticos: visualización web, descarga en CSV/Excel y
 * programación de envíos periódicos por correo.
 */

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Download, FileText, Trash2 } from "lucide-react";
import { Card, ErrorBanner, Th, Td, Button, Input, Select, EmptyState, Badge } from "../../components/ui";
import { useConnectAuth, hasRole } from "../../contexts/ConnectAuthContext";
import { PeriodPicker, useOiFilters } from "./IntelligenceLayout";
import { oiDownloadCsv, oiFetch, fmtDateTime, type ReportOutput } from "../../services/oiApi";

type CatalogEntry = { kind: string; name: string; description: string };
type Schedule = {
  id: number; reportKind: string; name: string; frequency: string; hourUtc: number;
  recipients: string[]; format: string; active: boolean;
  lastRunAtMs: number | null; lastResult: string | null; nextRunAtMs: number | null;
};

export default function InformesIA() {
  const { user } = useConnectAuth();
  const { filters } = useOiFilters();
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [report, setReport] = useState<ReportOutput | null>(null);
  const [selected, setSelected] = useState<string>("resumen_diario");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ kind: "resumen_diario", frequency: "daily", hourUtc: "6", recipients: "" });
  const canSchedule = hasRole(user, "cc_admin");

  const load = useCallback(() => {
    oiFetch<{ catalog: CatalogEntry[]; schedules: Schedule[] }>("/reports")
      .then((r) => { setCatalog(r.catalog); setSchedules(r.schedules); })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(load, [load]);

  const generate = useCallback((kind: string) => {
    setSelected(kind);
    setLoading(true);
    oiFetch<ReportOutput>("/reports/generate", { method: "POST", body: { kind, from: filters.from, to: filters.to } })
      .then(setReport)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { if (selected) generate(selected); }, [generate, selected]);

  async function schedule() {
    const recipients = form.recipients.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!recipients.length) { setError("Indica al menos un destinatario"); return; }
    try {
      await oiFetch("/reports/schedule", {
        method: "POST",
        body: { kind: form.kind, frequency: form.frequency, hourUtc: Number(form.hourUtc), recipients },
      });
      setForm({ ...form, recipients: "" });
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function removeSchedule(id: number) {
    if (!window.confirm("¿Desactivar este envío programado?")) return;
    await oiFetch(`/reports/schedule/${id}`, { method: "DELETE" }).catch((e) => setError(e.message));
    load();
  }

  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {catalog.map((c) => (
            <button
              key={c.kind}
              onClick={() => setSelected(c.kind)}
              title={c.description}
              className={`rounded-lg px-3 py-1.5 text-[12px] transition ${
                selected === c.kind ? "bg-cyan-600/20 font-semibold text-cyan-300" : "border border-slate-700 text-slate-400 hover:bg-slate-800"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <PeriodPicker />
          <Button variant="ghost" onClick={() => oiDownloadCsv(selected, { from: filters.from, to: filters.to }).catch((e) => setError(e.message))}>
            <span className="flex items-center gap-1"><Download className="h-3.5 w-3.5" /> Descargar CSV</span>
          </Button>
        </div>
      </div>

      <Card className="overflow-x-auto">
        {report && (
          <div className="flex items-center gap-2 border-b border-slate-700 px-3 py-2">
            <FileText className="h-4 w-4 text-cyan-400" />
            <div>
              <div className="text-sm font-black text-slate-100">{report.title}</div>
              {report.subtitle && <div className="text-[11px] text-slate-500">{report.subtitle}</div>}
            </div>
            <span className="ml-auto text-[11px] text-slate-500">{report.rows.length} fila(s)</span>
          </div>
        )}
        {loading ? (
          <div className="p-6 text-sm text-slate-400">Generando informe…</div>
        ) : report && report.rows.length > 0 ? (
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 bg-slate-800">
                <tr className="border-b border-slate-700">{report.columns.map((c) => <Th key={c}>{c}</Th>)}</tr>
              </thead>
              <tbody>
                {report.rows.map((row, i) => (
                  <tr key={i} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                    {row.map((cell, j) => <Td key={j} className={j === 0 ? "font-semibold text-slate-100" : ""}>{cell ?? "—"}</Td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="Sin datos para este informe en el periodo seleccionado." />
        )}
      </Card>

      <Card className="p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-black text-slate-100">
          <CalendarClock className="h-4 w-4 text-cyan-400" /> Envíos programados
        </h3>

        {canSchedule && (
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {catalog.map((c) => <option key={c.kind} value={c.kind}>{c.name}</option>)}
            </Select>
            <Select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              <option value="daily">Diario</option>
              <option value="weekly">Semanal (lunes)</option>
              <option value="monthly">Mensual (día 1)</option>
            </Select>
            <Select value={form.hourUtc} onChange={(e) => setForm({ ...form, hourUtc: e.target.value })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={String(h)}>{String(h).padStart(2, "0")}:00 UTC</option>)}
            </Select>
            <Input
              value={form.recipients}
              onChange={(e) => setForm({ ...form, recipients: e.target.value })}
              placeholder="destinatarios separados por comas"
              className="min-w-[260px] flex-1"
            />
            <Button onClick={schedule}>Programar</Button>
          </div>
        )}

        {schedules.length === 0 ? (
          <p className="text-[13px] text-slate-500">No hay envíos programados.</p>
        ) : (
          <table className="w-full">
            <thead><tr className="border-b border-slate-700">
              <Th>Informe</Th><Th>Frecuencia</Th><Th>Destinatarios</Th><Th>Última ejecución</Th><Th>Próxima</Th><Th>Estado</Th><Th></Th>
            </tr></thead>
            <tbody>
              {schedules.map((s) => (
                <tr key={s.id} className="border-b border-slate-700/50">
                  <Td className="text-slate-200">{s.name}</Td>
                  <Td>{s.frequency} · {String(s.hourUtc).padStart(2, "0")}:00 UTC</Td>
                  <Td className="text-[11px]">{s.recipients.join(", ")}</Td>
                  <Td className="text-[11px]">{fmtDateTime(s.lastRunAtMs)}{s.lastResult ? ` — ${s.lastResult}` : ""}</Td>
                  <Td className="text-[11px]">{fmtDateTime(s.nextRunAtMs)}</Td>
                  <Td>
                    <Badge className={s.active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 bg-slate-700/40 text-slate-400"}>
                      {s.active ? "Activo" : "Desactivado"}
                    </Badge>
                  </Td>
                  <Td>
                    {canSchedule && s.active && (
                      <button onClick={() => removeSchedule(s.id)} className="text-slate-500 hover:text-red-400" title="Desactivar">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] text-slate-500">
          El envío usa la configuración SMTP de la aplicación y adjunta el informe en CSV; si no hay SMTP configurado,
          la ejecución queda registrada con el motivo.
        </p>
      </Card>
    </div>
  );
}
