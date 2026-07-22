/** Connect Pro — editor del tarifario de una autorización (base + €/km por tipo de servicio). */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { Card, Th, Td, Input, Button, ErrorBanner } from "./ui";
import type { ServiceType } from "../types";

type TariffLine = { serviceTypeCode: string; baseAmount: number; perKmAmount: number; active: boolean };

export default function TarifasEditor({ authorizationId, providerName, canEdit }: {
  authorizationId: number; providerName: string; canEdit: boolean;
}) {
  const [types, setTypes] = useState<ServiceType[]>([]);
  const [lines, setLines] = useState<Record<string, { base: string; perKm: string }>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [cat, tar] = await Promise.all([
        boFetch<{ service_types: ServiceType[] }>("/catalogs"),
        boFetch<{ data: TariffLine[] }>(`/authorizations/${authorizationId}/tariffs`),
      ]);
      setTypes(cat.service_types.filter((t) => t.active));
      const map: Record<string, { base: string; perKm: string }> = {};
      const sv: Record<string, boolean> = {};
      for (const l of tar.data) {
        map[l.serviceTypeCode] = { base: String(l.baseAmount), perKm: String(l.perKmAmount) };
        sv[l.serviceTypeCode] = true;
      }
      setLines(map);
      setSaved(sv);
    } catch (e: any) { setError(e.message); }
  }, [authorizationId]);
  useEffect(() => { load(); }, [load]);

  const save = async (code: string) => {
    const l = lines[code];
    if (!l) return;
    setBusy(true); setError(null);
    try {
      await boFetch(`/authorizations/${authorizationId}/tariffs/${code}`, {
        method: "PUT",
        body: { baseAmount: Number(l.base) || 0, perKmAmount: Number(l.perKm) || 0 },
      });
      setSaved({ ...saved, [code]: true });
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Card className="mt-4 overflow-x-auto">
      <h3 className="border-b border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300">
        Tarifario de {providerName} <span className="text-slate-500">(base € + €/km desde el taller; sin tarifa = sin coste estimado)</span>
      </h3>
      {error && <div className="p-3"><ErrorBanner message={error} onClose={() => setError(null)} /></div>}
      <table className="w-full">
        <thead><tr className="border-b border-slate-700"><Th>Servicio</Th><Th>Base (€)</Th><Th>€/km</Th>{canEdit && <Th></Th>}</tr></thead>
        <tbody>
          {types.map((t) => {
            const l = lines[t.code] ?? { base: "", perKm: "" };
            return (
              <tr key={t.code} className="border-b border-slate-700/50">
                <Td className="text-slate-100">{t.name}</Td>
                <Td>
                  <Input value={l.base} disabled={!canEdit}
                    onChange={(e) => { setLines({ ...lines, [t.code]: { ...l, base: e.target.value } }); setSaved({ ...saved, [t.code]: false }); }}
                    className="w-24" placeholder="0" />
                </Td>
                <Td>
                  <Input value={l.perKm} disabled={!canEdit}
                    onChange={(e) => { setLines({ ...lines, [t.code]: { ...l, perKm: e.target.value } }); setSaved({ ...saved, [t.code]: false }); }}
                    className="w-24" placeholder="0" />
                </Td>
                {canEdit && (
                  <Td>
                    {(l.base || l.perKm) && !saved[t.code] && (
                      <Button variant="ghost" disabled={busy} onClick={() => save(t.code)}>Guardar</Button>
                    )}
                    {saved[t.code] && <span className="text-[11px] text-emerald-400">✓</span>}
                  </Td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
