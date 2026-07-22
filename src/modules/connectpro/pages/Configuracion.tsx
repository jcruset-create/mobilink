/** Connect Pro — Configuración: catálogos de tipos de asistencia y motivos de rechazo. */

import { useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { PageTitle, Card, Th, Td, Badge, ErrorBanner } from "../components/ui";
import type { ServiceType, RejectionReason } from "../types";

export default function Configuracion() {
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [reasons, setReasons] = useState<RejectionReason[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    boFetch<{ service_types: ServiceType[]; rejection_reasons: RejectionReason[] }>("/catalogs")
      .then((r) => { setTypes(r.service_types); setReasons(r.rejection_reasons); })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <PageTitle title="Configuración" subtitle="Catálogos del centro de control. La edición llega en el Sprint 5." />
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-x-auto">
          <h2 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">Tipos de asistencia</h2>
          <table className="w-full">
            <thead><tr className="border-b border-slate-700"><Th>Código</Th><Th>Nombre</Th><Th>Estado</Th></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id} className="border-b border-slate-700/50">
                  <Td className="font-mono text-[12px]">{t.code}</Td>
                  <Td className="text-slate-100">{t.name}</Td>
                  <Td><Badge className={t.active ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-slate-600 text-slate-500"}>{t.active ? "Activo" : "Inactivo"}</Badge></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card className="overflow-x-auto">
          <h2 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">Motivos de rechazo</h2>
          <table className="w-full">
            <thead><tr className="border-b border-slate-700"><Th>Código</Th><Th>Motivo</Th><Th>Afecta al score</Th></tr></thead>
            <tbody>
              {reasons.map((r) => (
                <tr key={r.id} className="border-b border-slate-700/50">
                  <Td className="font-mono text-[12px]">{r.code}</Td>
                  <Td className="text-slate-100">{r.label}</Td>
                  <Td>{r.affectsScoreDefault ? "Sí" : "No"}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
