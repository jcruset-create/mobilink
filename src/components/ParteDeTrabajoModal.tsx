import { useEffect, useMemo, useRef, useState } from "react";
import { FileScan, Loader2, Upload } from "lucide-react";
import { API_BASE } from "../modules/workshopApi";
import { getAdminHeaders } from "../modules/adminHeaders";
import {
  parteATrabajos,
  type MapaArticulos,
  type ParteTrabajo,
  type TrabajoPropuesto,
} from "../modules/parteTrabajoATrabajos";
import { camposDeNumeroDeParte, camposDeParte, indiceSugerido } from "../modules/parteParaTrabajo";
import type { Job, QuickTemplate } from "../modules/workshopTypes";

/**
 * Engancha un parte del ERP a un trabajo que ya está pendiente de validar.
 *
 * Dos caminos, porque en el taller se dan los dos: teclear el número cuando ya
 * se sabe, y escanear el papel cuando hay que sacarle el material y las
 * tareas. El escaneo reutiliza el mismo lector y la misma conversión que la
 * pantalla «Partes de trabajo»; aquí no se interpreta nada por segunda vez.
 *
 * Lo que la IA ha leído se enseña antes de guardar. Un parte mal leído
 * imputaría el material al vehículo de al lado, y eso no se ve hasta facturar.
 */

type Props = {
  job: Job;
  quickTemplates: QuickTemplate[];
  workshopId: string;
  onCancelar: () => void;
  onGuardar: (cambios: Partial<Job>, resumen: string) => Promise<void> | void;
};

function ficheroADataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result || ""));
    lector.onerror = () => reject(new Error("No se pudo leer la imagen"));
    lector.readAsDataURL(file);
  });
}

export default function ParteDeTrabajoModal({
  job,
  quickTemplates,
  workshopId,
  onCancelar,
  onGuardar,
}: Props) {
  const [numero, setNumero] = useState(String(job.ptNumero ?? ""));
  const [parte, setParte] = useState<ParteTrabajo | null>(null);
  const [mapa, setMapa] = useState<MapaArticulos>({});
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [elegido, setElegido] = useState(-1);
  const ficheroRef = useRef<HTMLInputElement | null>(null);

  // El mapa de artículos aprendidos es el que convierte las líneas del papel
  // en tareas. Sin él se lee el parte igual, pero todo sale «sin mapear».
  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/api/partes-trabajo/articulos?workshopId=${encodeURIComponent(workshopId)}`,
          { headers: getAdminHeaders({ "Content-Type": "application/json" }) }
        );
        const body = await res.json().catch(() => null);
        if (activo && res.ok) setMapa((body as any)?.mapa ?? {});
      } catch {
        /* sin mapa se sigue: el número y el material se ven igual */
      }
    })();
    return () => { activo = false; };
  }, [workshopId]);

  const conversion = useMemo(
    () => (parte ? parteATrabajos({ parte, mapa, quickTemplates }) : null),
    [parte, mapa, quickTemplates]
  );

  const trabajos: TrabajoPropuesto[] = conversion?.trabajos ?? [];

  useEffect(() => {
    if (!conversion) return;
    setElegido(indiceSugerido(trabajos, job.plate));
    if (parte?.numero) setNumero(String(parte.numero));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversion]);

  async function leer(file: File) {
    setError("");
    setLeyendo(true);
    try {
      const dataUrl = await ficheroADataUrl(file);
      const res = await fetch(`${API_BASE}/api/partes-trabajo/leer`, {
        method: "POST",
        headers: getAdminHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ imagenes: [dataUrl] }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body as any)?.error || `Error ${res.status}`);
      setParte((body as any).parte as ParteTrabajo);
    } catch (e: any) {
      setError(e?.message || "No se pudo leer el parte.");
    } finally {
      setLeyendo(false);
    }
  }

  async function guardar() {
    setGuardando(true);
    setError("");
    try {
      const propuesto = elegido >= 0 ? trabajos[elegido] : null;

      if (propuesto) {
        await onGuardar(
          camposDeParte({ ...propuesto, ptNumero: numero.trim() || propuesto.ptNumero }),
          `parte ${numero.trim() || propuesto.ptNumero}` +
            (propuesto.materiales.length ? ` · ${propuesto.materiales.length} material(es)` : "")
        );
      } else {
        await onGuardar(camposDeNumeroDeParte(numero), numero.trim() ? `parte ${numero.trim().toUpperCase()}` : "parte quitado");
      }
      onCancelar();
    } catch (e: any) {
      setError(e?.message || "No se pudo guardar el parte.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4">
      <div className="max-h-full w-full max-w-2xl overflow-auto rounded-3xl bg-white p-6 text-slate-900 shadow-2xl">
        <h3 className="text-xl font-semibold">Parte de trabajo</h3>
        <p className="mt-1 text-sm text-slate-500">
          Engancha el parte del ERP a <b>{job.plate}</b>. Añade el número, el material y las
          tareas del parte; no cambia la operación ni el técnico propuesto.
        </p>

        {error && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <label className="mt-4 block text-xs font-medium text-slate-500">
          Número del parte
          <input
            id="parte-numero"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="EJ: 25-04567"
            className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm uppercase"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={ficheroRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void leer(f);
              e.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            disabled={leyendo}
            onClick={() => ficheroRef.current?.click()}
            className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
          >
            {leyendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {leyendo ? "Leyendo el parte…" : "Escanear el parte"}
          </button>
          <span className="text-xs text-slate-500">
            Opcional: con la foto se sacan también el material y las tareas.
          </span>
        </div>

        {conversion && (
          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <FileScan className="h-4 w-4 text-sky-600" />
              Lo que ha leído la IA — revísalo antes de guardar
            </div>

            {trabajos.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                No se ha reconocido ninguna tarea en el parte. Se guardará solo el número.
              </p>
            ) : (
              <>
                <p className="mt-2 text-xs text-slate-500">
                  {trabajos.length === 1
                    ? "Un trabajo en el parte:"
                    : `${trabajos.length} trabajos en el parte. Elige cuál es ${job.plate}:`}
                </p>
                <div className="mt-2 space-y-1">
                  {trabajos.map((t, i) => (
                    <label
                      key={`${t.ptNumero}-${i}`}
                      className={`flex cursor-pointer items-start gap-2 rounded-xl border p-2 text-sm ${
                        elegido === i ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <input
                        type="radio"
                        name="trabajo-del-parte"
                        checked={elegido === i}
                        onChange={() => setElegido(i)}
                        className="mt-1"
                      />
                      <span>
                        <b>{t.plate}</b> · {t.label}
                        {t.materiales.length > 0 && (
                          <span className="text-slate-500"> · {t.materiales.length} material(es)</span>
                        )}
                        {t.tareasIncluidas.length > 0 && (
                          <span className="text-slate-500"> · {t.tareasIncluidas.length} tarea(s) incluida(s)</span>
                        )}
                        <span className="block text-xs text-slate-500">{t.descripcionOriginal}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {elegido < 0 && trabajos.length > 1 && (
                  <p className="mt-2 text-xs text-amber-700">
                    Ninguno coincide con {job.plate}. Elige uno, o guarda solo el número.
                  </p>
                )}
              </>
            )}

            {conversion.sinMapear.length > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                {conversion.sinMapear.length} línea(s) del parte no están enseñadas todavía. Se
                enseñan desde «Partes de trabajo»; aquí no se pierden, simplemente no salen.
              </p>
            )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={guardando}
            onClick={() => void guardar()}
            className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {guardando ? "Guardando…" : "Guardar parte"}
          </button>
        </div>
      </div>
    </div>
  );
}
