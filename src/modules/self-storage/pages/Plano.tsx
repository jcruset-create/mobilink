/**
 * Plano interactivo del centro.
 *
 * Verde disponible · rojo alquilado · naranja reservado · gris mantenimiento o
 * bloqueado, con el estado REAL de la base. Al pulsar un trastero se abre su
 * ficha rápida; al pulsar una forma sin vincular, quien gestiona el plano
 * puede asociarle un trastero.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../services/api";
import type { Plano as DatosPlano } from "../types";
import FloorPlan, { type FormaPlano } from "../components/FloorPlan";
import PanelTrastero from "../components/PanelTrastero";
import CambioEstado from "../components/CambioEstado";
import { Aviso, Cabecera, Cargando, ErrorBox, LeyendaPlano, btnPrimary, btnSecondary, inputCls } from "../components/ui";
import { useSelfStorage } from "../contexts/SelfStorageContext";

export default function Plano() {
  const { centroId, puede } = useSelfStorage();
  const [datos, setDatos] = useState<DatosPlano | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [vincular, setVincular] = useState("");
  const [cambiarEstado, setCambiarEstado] = useState(false);
  const fichero = useRef<HTMLInputElement>(null);
  const gestiona = puede("ss.floorplan.manage");

  const cargar = useCallback(async () => {
    if (!centroId) return;
    try {
      setDatos(await api.plano(centroId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
  }, [centroId]);

  useEffect(() => {
    setSel(null);
    void cargar();
  }, [cargar]);

  const porForma = useMemo(() => new Map((datos?.units ?? []).filter((u) => u.floorPlanShapeId).map((u) => [u.floorPlanShapeId!, u])), [datos]);
  const formas: FormaPlano[] = useMemo(
    () =>
      (datos?.plan?.shapeIds ?? [])
        .filter((id) => porForma.has(id))
        .map((id) => {
          const u = porForma.get(id)!;
          return { shapeId: id, status: u.status, etiqueta: `Trastero ${u.code}` };
        }),
    [datos, porForma]
  );
  const sinForma = useMemo(() => (datos?.units ?? []).filter((u) => !u.floorPlanShapeId), [datos]);
  const seleccionado = sel ? porForma.get(sel) ?? null : null;

  const subir = async (f: File) => {
    if (!centroId) return;
    setError(null);
    setAviso(null);
    try {
      const r = await api.subirPlano(centroId, await f.text(), f.name.replace(/\.svg$/i, ""));
      const partes = [`Plano v${r.version} guardado con ${r.shapeIds.length} forma(s).`];
      if (r.removed.length) partes.push(`Se ha quitado por seguridad: ${r.removed.join(", ")}.`);
      if (r.warnings.length) partes.push(r.warnings.join(" "));
      setAviso(partes.join(" "));
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido subir el plano");
    } finally {
      if (fichero.current) fichero.current.value = "";
    }
  };

  const hacerVinculo = async () => {
    if (!sel || !vincular) return;
    try {
      await api.vincularForma(vincular, sel);
      setVincular("");
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido vincular");
    }
  };

  const desvincular = async (unitId: string) => {
    try {
      await api.vincularForma(unitId, null);
      setSel(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido desvincular");
    }
  };

  if (!centroId) return <Aviso tono="info">Elige o crea un centro.</Aviso>;
  if (!datos && !error) return <Cargando />;

  return (
    <div className="space-y-3">
      <Cabecera titulo="Plano interactivo" descripcion={datos?.plan ? `${datos.center.name} · versión ${datos.plan.version}` : datos?.center.name}>
        {gestiona && (
          <>
            <input ref={fichero} type="file" accept=".svg,image/svg+xml" className="hidden" onChange={(e) => e.target.files?.[0] && void subir(e.target.files[0])} />
            <button className={btnSecondary} onClick={() => fichero.current?.click()}>
              {datos?.plan ? "Subir nueva versión (SVG)" : "Subir plano (SVG)"}
            </button>
          </>
        )}
      </Cabecera>
      {error && <ErrorBox>{error}</ErrorBox>}
      {aviso && <Aviso tono="bien">{aviso}</Aviso>}
      {datos && datos.orphanUnits.length > 0 && (
        <Aviso tono="aviso">
          {datos.orphanUnits.length} trastero(s) apuntan a formas que el plano vigente ya no tiene: {datos.orphanUnits.map((o) => `${o.code} (${o.shapeId})`).join(", ")}.
        </Aviso>
      )}

      {!datos?.plan ? (
        <Aviso tono="info">
          Este centro aún no tiene plano. {gestiona ? "Sube un SVG en el que cada trastero sea una forma con su propio id." : "Pídele a un administrador que lo suba."}
        </Aviso>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_340px]">
          <div className="space-y-2">
            <FloorPlan svg={datos.plan.svg} formas={formas} sinVincular={gestiona ? datos.unlinkedShapes : []} seleccionada={sel} onSeleccionar={setSel} />
            <LeyendaPlano />
          </div>
          <div>
            {seleccionado ? (
              <div className="space-y-2 text-[11px]">
                <PanelTrastero t={seleccionado} onCambiarEstado={() => setCambiarEstado(true)} />
                {gestiona && (
                  <button className="text-slate-400 underline" onClick={() => void desvincular(seleccionado.id)}>
                    Desvincular de la forma «{sel}»
                  </button>
                )}
              </div>
            ) : sel ? (
              <div className="space-y-2 rounded-xl border border-dashed border-slate-600 p-4 text-sm">
                <p>
                  La forma <b>{sel}</b> no tiene trastero.
                </p>
                {gestiona && (
                  <>
                    <select className={inputCls} value={vincular} onChange={(e) => setVincular(e.target.value)}>
                      <option value="">Elige un trastero sin forma…</option>
                      {sinForma.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code} · {u.zone.name}
                        </option>
                      ))}
                    </select>
                    <button className={btnPrimary} disabled={!vincular} onClick={() => void hacerVinculo()}>
                      Vincular
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-700 p-4 text-sm text-slate-400">
                Pulsa un trastero para ver su ficha.
                {gestiona && datos.unlinkedShapes.length > 0 && <p className="mt-2">Hay {datos.unlinkedShapes.length} forma(s) sin trastero (borde discontinuo).</p>}
                {sinForma.length > 0 && <p className="mt-2">{sinForma.length} trastero(s) todavía no están en el plano.</p>}
              </div>
            )}
          </div>
        </div>
      )}
      {cambiarEstado && seleccionado && (
        <CambioEstado
          trastero={seleccionado}
          onCerrar={() => setCambiarEstado(false)}
          onHecho={() => {
            setCambiarEstado(false);
            void cargar();
          }}
        />
      )}
    </div>
  );
}
