/**
 * Pedir a la telemática (o escribir) los km de una revisión o del montaje,
 * desde la ficha del neumático. El km de una revisión vale para TODA ella.
 */
import { useState } from "react";
import {
  guardarKmMontaje, guardarKmRevision, pedirKmTodasRevisiones, proponerKmMontaje, proponerKmRevision,
  type PropuestaKm,
} from "../services/kmFicha";

const kmTxt = (n: number) => `${Math.round(n).toLocaleString("es-ES")} km`;
const BTN = "rounded-lg border px-2.5 py-1 text-[11px] font-bold disabled:opacity-40";

type Vecina = { km: number; fecha: string } | null;

/** Botones + propuesta, para una revisión (`revisionId`) o para el montaje (`neumaticoId`). */
export function PedirKm({ revisionId, neumaticoId, onHecho }: {
  revisionId?: string; neumaticoId?: string; onHecho: (texto: string) => void;
}) {
  const esMontaje = !revisionId;
  const [modo, setModo] = useState<"" | "pidiendo" | "propuesta" | "manual">("");
  const [prop, setProp] = useState<{ p: PropuestaKm; neumaticos?: number; anterior: Vecina; siguiente: Vecina } | null>(null);
  const [km, setKm] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function pedir() {
    setModo("pidiendo"); setError(""); setProp(null);
    try {
      const r = esMontaje ? await proponerKmMontaje(neumaticoId!) : await proponerKmRevision(revisionId!);
      setProp({ p: r.propuesta, neumaticos: "neumaticos" in r ? r.neumaticos : undefined, anterior: r.anterior, siguiente: r.siguiente });
      setModo(r.propuesta.estado === "ok" ? "propuesta" : "manual");
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); setModo(""); }
  }

  async function guardar(origen: "telematica" | "manual") {
    setGuardando(true); setError("");
    try {
      if (esMontaje) {
        const r = await guardarKmMontaje(neumaticoId!, origen, origen === "manual" ? km : undefined);
        onHecho(`✔ Montaje con ${kmTxt(r.km)} (${origen === "manual" ? "a mano" : "telemática"}).`);
      } else {
        const r = await guardarKmRevision(revisionId!, origen, origen === "manual" ? km : undefined);
        onHecho(`✔ Revisión con ${kmTxt(r.km)} (${origen === "manual" ? "a mano" : "telemática"}) · aplicado a sus ${r.neumaticos} neumáticos.`);
      }
      setModo(""); setProp(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setGuardando(false); }
  }

  const vecinas = prop && (prop.anterior || prop.siguiente) && (
    <div className="text-[11px] text-slate-400">
      Tiene que cuadrar con: {prop.anterior ? `${kmTxt(prop.anterior.km)} (${prop.anterior.fecha})` : "—"} ≤ km ≤{" "}
      {prop.siguiente ? `${kmTxt(prop.siguiente.km)} (${prop.siguiente.fecha})` : "—"}
    </div>
  );

  return (
    <div className="mt-1.5">
      {modo === "" && (
        <div className="flex flex-wrap gap-1.5">
          <button className={`${BTN} border-sky-500 text-sky-300 hover:bg-sky-500/10`} onClick={() => void pedir()}>📡 Pedir km a la telemática</button>
          <button className={`${BTN} border-slate-600 text-slate-300 hover:bg-slate-700`} onClick={() => { setModo("manual"); setProp(null); setError(""); }}>✎ Escribir km</button>
        </div>
      )}
      {modo === "pidiendo" && <div className="text-[11px] text-sky-300">Preguntando a la telemática… (unos segundos)</div>}

      {modo === "propuesta" && prop?.p.estado === "ok" && (
        <div className="mt-1 grid gap-1.5 rounded-lg border border-sky-500/50 bg-sky-500/10 p-2.5">
          <div className="text-[11px] text-slate-400">Odómetro del vehículo en esa fecha</div>
          <div className="text-lg font-black tabular-nums text-slate-100">
            {kmTxt(prop.p.km)}{" "}
            <span className="text-[11px] font-semibold text-emerald-300">
              ✓ {prop.p.corroboracion === "dos_ventanas" ? "dos consultas coinciden" : "una consulta, comprobada con otras cotas"}
            </span>
          </div>
          {vecinas}
          {!esMontaje && <div className="text-[11px] text-slate-300">Se aplica a <b>toda la revisión</b>{prop.neumaticos ? `: sus ${prop.neumaticos} neumáticos` : ""}.</div>}
          <div className="flex flex-wrap gap-1.5">
            <button disabled={guardando} className="rounded-lg bg-emerald-600 px-3 py-1 text-[12px] font-bold text-white disabled:opacity-40" onClick={() => void guardar("telematica")}>
              {guardando ? "Guardando…" : `Guardar ${kmTxt(prop.p.km)}`}
            </button>
            <button className={`${BTN} border-slate-600 text-slate-300`} onClick={() => setModo("")}>Cancelar</button>
          </div>
        </div>
      )}

      {modo === "manual" && (
        <div className="mt-1 grid gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
          {prop?.p.estado === "no" && <div className="text-[11px] text-amber-200">{prop.p.motivo}</div>}
          {vecinas}
          <div className="flex flex-wrap items-center gap-1.5">
            <input id={`km-${revisionId ?? neumaticoId}`} inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value)} placeholder="km del vehículo"
              className="w-36 rounded-lg border border-slate-600 bg-slate-900 px-2 py-1 text-base text-slate-100 sm:text-[12px]" />
            <button disabled={guardando || !km.trim()} className="rounded-lg bg-emerald-600 px-3 py-1 text-[12px] font-bold text-white disabled:opacity-40" onClick={() => void guardar("manual")}>
              {guardando ? "Guardando…" : "Guardar"}
            </button>
            <button className={`${BTN} border-slate-600 text-slate-300`} onClick={() => setModo("")}>Cancelar</button>
          </div>
          <div className="text-[10px] text-slate-500">Se guarda como «manual»{esMontaje ? "" : " y vale para toda la revisión"}.</div>
        </div>
      )}
      {error && <div className="mt-1 text-[11px] text-rose-300">{error}</div>}
    </div>
  );
}

/** Pedir de una vez los km de todas las revisiones sin km del vehículo. */
export function PedirKmTodas({ vehiculoId, onHecho }: { vehiculoId: string; onHecho: (texto: string) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  async function pedir() {
    setOcupado(true); setError("");
    try {
      const r = await pedirKmTodasRevisiones(vehiculoId);
      const ok = r.revisiones.filter((x) => x.km != null);
      const no = r.revisiones.filter((x) => x.km == null);
      onHecho(`✔ ${ok.length} de ${r.revisiones.length} revisiones con km de la telemática` +
        (no.length ? ` · sin dato fiable: ${no.map((x) => `${x.fecha} (${x.motivo})`).join("; ")}` : "") + ".");
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setOcupado(false); }
  }
  return (
    <div className="mt-2">
      <button disabled={ocupado} className={`${BTN} border-sky-500 text-sky-300 hover:bg-sky-500/10`} onClick={() => void pedir()}>
        {ocupado ? "Preguntando a la telemática…" : "📡 Pedir a la telemática los km de todas las revisiones sin km de este vehículo"}
      </button>
      {error && <div className="mt-1 text-[11px] text-rose-300">{error}</div>}
    </div>
  );
}
