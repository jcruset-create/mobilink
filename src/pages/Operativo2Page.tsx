import { useEffect, useMemo, useState } from "react";
import {
  loadJobsFromBackend,
  loadTechsFromBackend,
  loadScheduledJobsFromBackend,
} from "../modules/workshopApi";
import { normalizeWorkshopId } from "../modules/workshops";
import type { Job, Tech } from "../modules/workshopTypes";
import type { ScheduledJob } from "../components/AgendaView";

const C = {
  bg: "#0b1622", panel: "#101f30", card: "#16263a", line: "#2d4a6a",
  text: "#e8eef7", mut: "#8bafd4", dim: "#5f7794",
  red: "#e2504a", orange: "#f0843a", green: "#3dcea8", blue: "#4dc3ff", yellow: "#f0c040",
};

function mins(n?: number | null) {
  if (!n) return "0 min";
  const h = Math.floor(n / 60), m = Math.round(n % 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function nowHHMM() {
  return new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function Operativo2Page() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledJob[]>([]);
  const [clock, setClock] = useState(nowHHMM());
  const ws = normalizeWorkshopId((typeof localStorage !== "undefined" && localStorage.getItem("sea-selected-workshop")) || undefined);

  async function load() {
    try {
      const [j, t, s] = await Promise.all([
        loadJobsFromBackend().catch(() => []),
        loadTechsFromBackend().catch(() => []),
        loadScheduledJobsFromBackend().catch(() => []),
      ]);
      const sameWs = (x: any) => normalizeWorkshopId(x?.workshopId) === ws;
      setJobs((Array.isArray(j) ? j : []).filter(sameWs));
      setTechs((Array.isArray(t) ? t : []));
      setScheduled((Array.isArray(s) ? s : []).filter(sameWs));
    } catch { /* mantener */ }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    const c = setInterval(() => setClock(nowHHMM()), 1000);
    return () => { clearInterval(t); clearInterval(c); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activos = useMemo(() => jobs.filter((j) => j.status === "activo"), [jobs]);
  const cola = useMemo(() => jobs.filter((j) => j.status === "espera"), [jobs]);
  const standby = useMemo(() => jobs.filter((j) => j.status === "parado"), [jobs]);
  const bloqueados = useMemo(() => jobs.filter((j) => j.status === "bloqueado"), [jobs]);

  // Roles: primer asignado = responsable, resto = soporte
  const { responsables, soportes } = useMemo(() => {
    const resp = new Set<string>(); const sop = new Set<string>();
    for (const j of activos) {
      (j.assignedNames || []).forEach((n, i) => (i === 0 ? resp : sop).add(n));
    }
    return { responsables: resp, soportes: sop };
  }, [activos]);

  const trabajando = useMemo(
    () => techs.filter((t) => t.status === "ocupado" || responsables.has(t.name) || soportes.has(t.name)),
    [techs, responsables, soportes]
  );
  const disponibles = useMemo(() => techs.filter((t) => t.status === "disponible"), [techs]);
  const refuerzos = useMemo(() => techs.filter((t) => t.status === "refuerzo"), [techs]);

  const today = new Date().toISOString().slice(0, 10);
  const agendados = useMemo(
    () => scheduled.filter((s) => s.date === today).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [scheduled, today]
  );

  function techColor(name: string) {
    if (responsables.has(name)) return C.red;
    if (soportes.has(name)) return C.orange;
    return C.text;
  }

  function enMin(startTime: string) {
    const [h, m] = startTime.split(":").map(Number);
    const t = new Date(); t.setHours(h, m, 0, 0);
    const diff = Math.round((t.getTime() - Date.now()) / 60000);
    return diff;
  }

  const box = { background: C.panel, borderRadius: 8, padding: 8 } as const;
  const chip = { background: C.card, borderRadius: 5, padding: "3px 8px", fontSize: 12 } as const;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, padding: 10, fontFamily: "system-ui, sans-serif" }}>
      {/* Barra superior */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>📊 SEA Tarragona · Operativo 2</span>
        <span style={{ fontSize: 12, color: C.dim }}>Actualizado {clock}</span>
      </div>

      {/* CABECERA: trabajando · disponibles · entradas */}
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.9fr 1.7fr", gap: 8, marginBottom: 10 }}>
        <div style={box}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.mut, marginBottom: 5 }}>TRABAJANDO ({trabajando.length})</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {trabajando.length === 0 ? <span style={{ fontSize: 11, color: C.dim }}>—</span> :
              trabajando.map((t) => (
                <span key={t.name} style={{ ...chip, fontWeight: 600, color: techColor(t.name) }}>{t.name}</span>
              ))}
          </div>
          <div style={{ marginTop: 6, fontSize: 9, color: C.dim }}>
            <span style={{ color: C.red }}>●</span> responsable &nbsp; <span style={{ color: C.orange }}>●</span> soporte
          </div>
        </div>
        <div style={box}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.green, marginBottom: 5 }}>DISPONIBLES ({disponibles.length})</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {disponibles.length === 0 ? <span style={{ fontSize: 11, color: C.dim }}>—</span> :
              disponibles.map((t) => <span key={t.name} style={{ ...chip, color: C.green }}>{t.name}</span>)}
            {refuerzos.map((t) => <span key={t.name} style={{ ...chip, color: C.blue }}>{t.name} (refz)</span>)}
          </div>
        </div>
        <div style={box}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.blue, marginBottom: 5 }}>RESUMEN</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12 }}>
            <span style={chip}>Activos {activos.length}</span>
            <span style={chip}>Cola {cola.length}</span>
            <span style={chip}>Stand by {standby.length}</span>
            <span style={{ ...chip, color: C.red }}>Urgentes {activos.filter((j) => j.urgent).length}</span>
            <span style={{ ...chip, color: bloqueados.length ? C.red : C.text }}>Bloqueados {bloqueados.length}</span>
          </div>
        </div>
      </div>

      {/* Cuerpo */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 8 }}>
        {/* Trabajos activos */}
        <div style={box}>
          <div style={{ fontSize: 11, fontWeight: 600, color: C.mut, marginBottom: 6 }}>TRABAJOS ACTIVOS ({activos.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {activos.length === 0 ? <div style={{ fontSize: 11, color: C.dim }}>Sin trabajos activos</div> :
              activos.map((j) => {
                const resp = (j.assignedNames || [])[0];
                const sop = (j.assignedNames || []).slice(1);
                const color = j.urgent ? C.red : C.green;
                return (
                  <div key={j.id} style={{ background: C.card, borderRadius: 6, padding: "7px 9px", borderLeft: `3px solid ${color}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {j.plate || j.quickEntryLabel || "Trabajo"}{j.urgent ? " ⚠️" : ""}
                        {resp && <> · <span style={{ color: C.red }}>{resp}</span></>}
                        {sop.map((n) => <span key={n} style={{ color: C.orange }}> · {n}</span>)}
                      </span>
                      <span style={{ fontSize: 10, color: C.mut }}>
                        {mins(j.workedAccumulatedMinutes)} / {mins(j.standardMinutes)}
                      </span>
                    </div>
                    <div style={{ fontSize: 10, color: C.mut, marginTop: 2 }}>{j.reason || j.quickEntryLabel || ""}</div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Derecha: agendados + cola/standby */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={box}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.mut, marginBottom: 6 }}>LLEGADAS / TRABAJOS AGENDADOS ({agendados.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {agendados.map((s) => {
                const d = enMin(s.startTime);
                return (
                  <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 7, background: C.card, borderRadius: 6, padding: "5px 8px" }}>
                    <span style={{ fontSize: 10, color: C.yellow, minWidth: 64 }}>
                      {s.startTime} {d >= 0 ? <span style={{ color: C.dim }}>·{d}m</span> : <span style={{ color: C.dim }}>—</span>}
                    </span>
                    <span style={{ fontSize: 11 }}>
                      {s.plate || s.templateLabel || s.area} · <span style={{ color: C.mut }}>{s.customerName || ""}</span>
                    </span>
                  </div>
                );
              })}
              {/* Espacio reservado para nuevas citas */}
              <div style={{ border: `1px dashed ${C.line}`, borderRadius: 6, padding: 7, textAlign: "center", color: C.dim, fontSize: 10 }}>
                📅 Las citas nuevas de la agenda aparecen aquí
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={box}>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.mut }}>COLA ({cola.length})</div>
              <div style={{ fontSize: 10, color: "#cdd9e8", marginTop: 3 }}>
                {cola.slice(0, 4).map((j) => <div key={j.id}>{j.plate || j.quickEntryLabel}</div>)}
                {cola.length === 0 && <span style={{ color: C.dim }}>Vacía</span>}
              </div>
            </div>
            <div style={box}>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.mut }}>STAND BY ({standby.length})</div>
              <div style={{ fontSize: 10, color: "#cdd9e8", marginTop: 3 }}>
                {standby.slice(0, 4).map((j) => <div key={j.id}>{j.plate || j.quickEntryLabel}</div>)}
                {standby.length === 0 && <span style={{ color: C.dim }}>Sin trabajos</span>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Pie KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 8 }}>
        <div style={box}><div style={{ fontSize: 10, color: C.mut }}>KPIs</div>
          <div style={{ fontSize: 11, marginTop: 2 }}>Libres {disponibles.length} · Resp. {responsables.size} · Refz {refuerzos.length} · <span style={{ color: C.red }}>Urg {activos.filter((j) => j.urgent).length}</span></div>
        </div>
        <div style={box}><div style={{ fontSize: 10, color: C.mut }}>Alertas</div>
          <div style={{ fontSize: 11, marginTop: 2 }}><span style={{ color: C.red }}>{bloqueados.length} bloq</span> · <span style={{ color: C.orange }}>{activos.filter((j) => j.urgent).length} urg</span> · <span style={{ color: C.green }}>{activos.length} act</span></div>
        </div>
        <div style={box}><div style={{ fontSize: 10, color: C.mut }}>Total técnicos</div>
          <div style={{ fontSize: 11, marginTop: 2 }}>{techs.length} · trabajando {trabajando.length} · libres {disponibles.length}</div>
        </div>
      </div>

      <div style={{ marginTop: 8, textAlign: "right" }}>
        <a href="/" style={{ fontSize: 11, color: C.mut }}>← Volver</a>
      </div>
    </div>
  );
}
