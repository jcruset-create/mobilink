import { useEffect, useState } from "react";
import { fetchOtfList } from "../modules/roadsideAssistanceApi";

// Panel TV de Órdenes de Trabajo de Flota: progreso en grande, auto-refresco.
export default function OtfTvPage() {
  const [list, setList] = useState<any[]>([]);
  const [updated, setUpdated] = useState<Date | null>(null);

  async function load() {
    try {
      const all = await fetchOtfList();
      // Solo en curso / planificadas (no finalizadas/canceladas)
      setList(all.filter((o) => o.status === "planificada" || o.status === "en_curso"));
      setUpdated(new Date());
    } catch {
      /* mantener lo anterior */
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ minHeight: "100vh", background: "#0d1b2a", color: "#fff", padding: "24px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <h1 style={{ fontSize: 34, fontWeight: 800, margin: 0 }}>🚛 Órdenes de Flota — En curso</h1>
        <div style={{ fontSize: 16, color: "#8bafd4" }}>
          {list.length} activas{updated ? ` · ${updated.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
        </div>
      </div>

      {list.length === 0 ? (
        <div style={{ textAlign: "center", color: "#4a6080", fontSize: 24, marginTop: 80 }}>
          No hay órdenes de flota en curso
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 18 }}>
          {list.map((o) => {
            const hechos = o.progreso?.hechos ?? 0;
            const total = o.progreso?.total ?? 0;
            const pct = total > 0 ? Math.round((hechos / total) * 100) : 0;
            const done = total > 0 && hechos >= total;
            return (
              <div key={o.id} style={{ background: "#162232", borderRadius: 16, padding: 22, border: "1px solid #2d4a6a" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span style={{ fontSize: 26, fontWeight: 800 }}>{o.clientName || "Sin cliente"}</span>
                  <span style={{ fontSize: 30, fontWeight: 800, color: done ? "#3dcea8" : "#f0c040" }}>{hechos}/{total}</span>
                </div>
                <div style={{ fontSize: 16, color: "#8bafd4", marginTop: 4 }}>
                  {o.baseName || o.direccion || "—"}{o.assignedTechName ? ` · ${o.assignedTechName}` : ""}
                </div>
                <div style={{ marginTop: 16, height: 18, background: "#0d1b2a", borderRadius: 10, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: done ? "#3dcea8" : "#f0c040", transition: "width .5s" }} />
                </div>
                <div style={{ marginTop: 6, fontSize: 14, color: "#8bafd4" }}>{pct}% completado</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
