import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CheckCircle2, FileScan, Loader2, Send, Trash2, Upload, Wand2 } from "lucide-react";
import {
  CLAVE_MATERIAL,
  claveArticulo,
  parteATrabajos,
  resumenMateriales,
  type LineaParte,
  type MapaArticulos,
  type ParteTrabajo,
  type TrabajoPropuesto,
} from "../parteTrabajoATrabajos";
import {
  autorizar,
  conApoyo,
  conResponsable,
  etiquetaDeTecnico,
  motivoNoAutorizable,
  sinApoyo,
  tecnicosParaElegir,
} from "../autorizarDesdeParte";
import { allocateJobPure } from "../assignment";
import { buildTechLoadStats, buildTechStats } from "../workshopReports";
import { getOperationKey } from "../jobHelpers";
import {
  API_BASE,
  loadJobsFromBackend,
  loadQuickTemplatesFromBackend,
  loadTechsFromBackend,
  saveJobToBackend,
  saveTechToBackend,
} from "../workshopApi";
import { getAdminHeaders } from "../adminHeaders";
import { DEFAULT_WORKSHOP_ID, normalizeWorkshopId } from "../workshops";
import type { Job, QuickTemplate, Tech, TechLoadStat } from "../workshopTypes";

/**
 * Partes de trabajo — se escanea el parte del ERP, se sube aquí, y de sus
 * líneas salen los trabajos pendientes de asignar, con técnico propuesto.
 *
 * La IA solo LEE el papel. Lo que ha leído se revisa en pantalla antes de
 * crear nada: un OCR de un escaneo se equivoca, y una matrícula mal leída
 * manda el trabajo al vehículo equivocado.
 */

type Estado = "vacio" | "leyendo" | "revisando" | "creando";

/** Una correspondencia ya enseñada, tal como la devuelve el servidor. */
type ArticuloAprendido = {
  clave: string;
  templateKey: string;
  descripcion: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: getAdminHeaders({ "Content-Type": "application/json" }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) throw new Error((body as any)?.error || `Error ${res.status}`);

  return body as T;
}

function ficheroADataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result || ""));
    lector.onerror = () => reject(new Error("No se pudo leer el fichero"));
    lector.readAsDataURL(file);
  });
}


/**
 * Por qué se propone a ese técnico. La tarjeta de «Pendientes de validar» solo
 * enseñaba el nombre, y sin el motivo o te fías a ciegas o lo cambias a ojo.
 */
export function explicaPropuesta(
  assignedNames: string[],
  job: Pick<Job, "area" | "template" | "quickEntryLabel">,
  techStats: { operation: string; fastestTech: string; bestTime: number; averageMinutes: number }[],
  techLoadStats: TechLoadStat[]
): string {
  const responsable = assignedNames[0];

  if (!responsable) return "Sin técnico libre para proponer.";

  const motivos: string[] = [];

  const stat = techStats.find((s) => s.operation === getOperationKey(job));

  if (stat && stat.fastestTech === responsable && stat.bestTime > 0) {
    motivos.push(`es el más rápido en esta operación (${Math.round(stat.bestTime)} min)`);
  }

  const carga = techLoadStats.find((c) => c.techName === responsable);

  if (carga) {
    motivos.push(
      carga.activeCount === 0
        ? "no tiene ningún trabajo abierto"
        : `lleva ${carga.activeCount} trabajo(s) y ${Math.round(carga.totalOpenMinutes)} min abiertos`
    );
  }

  const apoyo = assignedNames.slice(1);

  const cola = apoyo.length > 0 ? ` Apoyo: ${apoyo.join(", ")}.` : "";

  return motivos.length > 0
    ? `Se propone a ${responsable} porque ${motivos.join(" y ")}.${cola}`
    : `Se propone a ${responsable} por competencias y orden del área.${cola}`;
}

export default function PartesTrabajoPage() {
  const [estado, setEstado] = useState<Estado>("vacio");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  const [parte, setParte] = useState<ParteTrabajo | null>(null);
  const [mapa, setMapa] = useState<MapaArticulos>({});
  const [aprendidos, setAprendidos] = useState<ArticuloAprendido[]>([]);
  const [aprendidosAbiertos, setAprendidosAbiertos] = useState(false);
  const [plantillas, setPlantillas] = useState<QuickTemplate[]>([]);
  const [techs, setTechs] = useState<Tech[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const workshopId = useMemo(
    () =>
      normalizeWorkshopId(
        window.localStorage.getItem("sea-selected-workshop") || DEFAULT_WORKSHOP_ID
      ),
    []
  );

  const cargarBase = useCallback(async () => {
    try {
      const [tpl, tec, trabajos, articulos] = await Promise.all([
        loadQuickTemplatesFromBackend().catch(() => []),
        loadTechsFromBackend().catch(() => []),
        loadJobsFromBackend().catch(() => []),
        api<{ mapa: MapaArticulos; filas: ArticuloAprendido[] }>(
          `/api/partes-trabajo/articulos?workshopId=${encodeURIComponent(workshopId)}`
        ).catch(() => ({ mapa: {}, filas: [] as ArticuloAprendido[] })),
      ]);

      setPlantillas(tpl as QuickTemplate[]);
      setTechs((tec as Tech[]).filter((t) => t?.name));
      setJobs(trabajos as Job[]);
      setMapa(articulos.mapa ?? {});
      setAprendidos(
        [...(articulos.filas ?? [])].sort((a, b) =>
          a.descripcion.localeCompare(b.descripcion, "es")
        )
      );
    } catch (e: any) {
      setError(e?.message || "Error cargando los datos del taller.");
    }
  }, [workshopId]);

  useEffect(() => { void cargarBase(); }, [cargarBase]);

  const plantillasDelTaller = useMemo(
    () =>
      plantillas.filter(
        (p) => !p.workshopId || normalizeWorkshopId(p.workshopId) === workshopId
      ),
    [plantillas, workshopId]
  );

  // Las mismas estadísticas que usa el panel para proponer: quién es más
  // rápido en cada operación y quién lleva más carga abierta. Pasarlas vacías
  // dejaba la propuesta en poco más que el orden del área.
  const techStats = useMemo(
    () => buildTechStats(jobs.filter((j) => j.status === "cerrado")),
    [jobs]
  );

  const techLoadStats = useMemo<TechLoadStat[]>(
    () => buildTechLoadStats(jobs, techs),
    [jobs, techs]
  );

  const conversion = useMemo(
    () =>
      parte
        ? parteATrabajos({ parte, mapa, quickTemplates: plantillasDelTaller })
        : null,
    [parte, mapa, plantillasDelTaller]
  );

  /**
   * Pegar la captura del ERP (Impr Pant + Ctrl+V) hace lo mismo que subir el
   * parte escaneado: es más rápido que imprimir y escanear, y la rejilla del
   * ERP trae los mismos datos.
   */
  useEffect(() => {
    function alPegar(e: ClipboardEvent) {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imagen = items.find((i) => i.type.startsWith("image/"));

      if (!imagen) return;

      const file = imagen.getAsFile();

      if (!file) return;

      e.preventDefault();
      void subirParte(file);
    }

    window.addEventListener("paste", alPegar);

    return () => window.removeEventListener("paste", alPegar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function subirParte(file: File) {
    setError("");
    setAviso("");
    setEstado("leyendo");

    try {
      const dataUrl = await ficheroADataUrl(file);

      const r = await api<{ parte: ParteTrabajo }>("/api/partes-trabajo/leer", {
        method: "POST",
        body: JSON.stringify({ imagenes: [dataUrl] }),
      });

      setParte(r.parte);
      setEstado("revisando");
    } catch (e: any) {
      setError(e?.message || "No se pudo leer el parte.");
      setEstado("vacio");
    }
  }

  /** Enseña qué es un artículo y lo recuerda para la próxima vez. */
  async function enseñarArticulo(linea: LineaParte, templateKey: string) {
    const clave = claveArticulo(linea);

    setMapa((prev) => ({ ...prev, [clave]: templateKey }));

    setAprendidos((prev) => {
      const sin = prev.filter((a) => a.clave !== clave);

      return [...sin, { clave, templateKey, descripcion: linea.descripcion }].sort(
        (a, b) => a.descripcion.localeCompare(b.descripcion, "es")
      );
    });

    try {
      await api("/api/partes-trabajo/articulos", {
        method: "PUT",
        body: JSON.stringify({
          workshopId,
          articulos: [{ clave, templateKey, descripcion: linea.descripcion }],
        }),
      });
    } catch (e: any) {
      setError(
        `Se ha aplicado en pantalla, pero no se ha podido recordar "${linea.descripcion}": ${e?.message}`
      );
    }
  }

  /** Corrige una correspondencia ya enseñada. */
  async function cambiarAprendido(articulo: ArticuloAprendido, templateKey: string) {
    setMapa((prev) => ({ ...prev, [articulo.clave]: templateKey }));

    setAprendidos((prev) =>
      prev.map((a) => (a.clave === articulo.clave ? { ...a, templateKey } : a))
    );

    try {
      await api("/api/partes-trabajo/articulos", {
        method: "PUT",
        body: JSON.stringify({
          workshopId,
          articulos: [
            { clave: articulo.clave, templateKey, descripcion: articulo.descripcion },
          ],
        }),
      });
    } catch (e: any) {
      setError(`No se pudo guardar el cambio: ${e?.message}`);
      await cargarBase();
    }
  }

  /** Olvida una correspondencia: el artículo volverá a preguntarse. */
  async function olvidarAprendido(articulo: ArticuloAprendido) {
    const ok = window.confirm(
      `¿Olvidar "${articulo.descripcion}"?\n\n` +
        "La próxima vez que aparezca en un parte se volverá a preguntar qué es."
    );

    if (!ok) return;

    setMapa((prev) => {
      const siguiente = { ...prev };
      delete siguiente[articulo.clave];
      return siguiente;
    });

    setAprendidos((prev) => prev.filter((a) => a.clave !== articulo.clave));

    try {
      await api(
        `/api/partes-trabajo/articulos?workshopId=${encodeURIComponent(
          workshopId
        )}&clave=${encodeURIComponent(articulo.clave)}`,
        { method: "DELETE" }
      );
    } catch (e: any) {
      setError(`No se pudo olvidar la correspondencia: ${e?.message}`);
      await cargarBase();
    }
  }

  /**
   * La propuesta de técnicos de cada trabajo, calculada ya al leer el parte
   * con el motor de asignación de siempre, y editable: el responsable y los
   * apoyos se cambian aquí mismo (src/modules/autorizarDesdeParte.ts).
   */
  const propuestas = useMemo(() => {
    const out = new Map<number, { asignados: string[]; porQue: string }>();
    if (!conversion) return out;
    let jobsAcumulados = [...jobs];
    let techsAcumulados = [...techs];
    let idLocal = -1;
    for (const propuesto of conversion.trabajos) {
      const base = trabajoBase(propuesto, idLocal);
      const resultado = allocateJobPure(
        base,
        techsAcumulados,
        [base, ...jobsAcumulados],
        plantillasDelTaller,
        techStats,
        techLoadStats
      );
      const conPropuesta = resultado.jobs.find((j) => j.id === base.id) ?? base;
      const asignados = conPropuesta.assignedNames ?? [];
      out.set(propuesto.indiceLinea, {
        asignados,
        porQue: explicaPropuesta(asignados, base, techStats, techLoadStats),
      });
      jobsAcumulados = [conPropuesta, ...jobsAcumulados];
      techsAcumulados = resultado.techs;
      idLocal -= 1;
    }
    return out;
  }, [conversion, jobs, techs, plantillasDelTaller, techStats, techLoadStats]);

  /** Lo que ha tocado la persona; si no ha tocado nada, manda la propuesta. */
  const [elegidos, setElegidos] = useState<Record<number, string[]>>({});
  useEffect(() => { setElegidos({}); }, [parte]);

  function asignadosDe(indiceLinea: number): string[] {
    return elegidos[indiceLinea] ?? propuestas.get(indiceLinea)?.asignados ?? [];
  }

  function trabajoBase(propuesto: TrabajoPropuesto, id: number): Job {
    return {
      id,
      workshopId,
      area: propuesto.area,
      plate: propuesto.plate,
      urgent: false,
      status: "validacion",
      assignedNames: [],
      reason: `Parte ${propuesto.ptNumero}: ${propuesto.descripcionOriginal}.`,
      customerName: propuesto.customerName,
      customerPhone: propuesto.customerPhone,
      createdAtMs: Date.now(),
      startedAtMs: null,
      template: null,
      quickEntryLabel: propuesto.label,
      quickEntryMode: "team",
      includedTasks: propuesto.tareasIncluidas,
      materiales: propuesto.materiales,
      quantity: propuesto.quantity,
      unitMinutes: propuesto.unitMinutes,
      ptNumero: propuesto.ptNumero,
      // La hora del parte, no la de volcarlo: es cuando entró el vehículo.
      ptEntradaMs: propuesto.arrivedAtMs,
    };
  }

  /**
   * Crea los trabajos del parte. En modo «proponer» entran en «Pendientes de
   * validar» de Operativo 2 con los técnicos elegidos; en modo «autorizar»
   * arrancan ya, con los técnicos ocupados, igual que el ✓ Autorizar del
   * operativo.
   */
  async function crearTrabajos(modo: "proponer" | "autorizar") {
    if (!conversion || conversion.trabajos.length === 0) return;

    // Una línea sin clasificar no viaja al trabajo: ni como tarea ni como
    // material. Antes se perdía en silencio, y el técnico se encontraba la
    // tarjeta sin el material que tenía que montar.
    if (conversion.sinMapear.length > 0) {
      const ok = window.confirm(
        `Quedan ${conversion.sinMapear.length} línea(s) sin clasificar:\n\n` +
          conversion.sinMapear.map((l) => `· ${l.descripcion}`).join("\n") +
          `\n\nSi creas el trabajo ahora NO aparecerán en la tarjeta del técnico.\n` +
          `Cancela y di qué es cada una: se recuerda para los próximos partes.`
      );

      if (!ok) return;
    }

    if (modo === "autorizar") {
      // Un mismo técnico no puede empezar dos trabajos del mismo parte.
      const vistos = new Set<string>();
      for (const propuesto of conversion.trabajos) {
        const asignados = asignadosDe(propuesto.indiceLinea);
        const motivo = motivoNoAutorizable(asignados, techs, propuesto.area);
        if (motivo) {
          setError(`${propuesto.plate} · ${propuesto.label}: ${motivo}`);
          return;
        }
        for (const n of asignados) {
          if (vistos.has(n)) {
            setError(`${n} está elegido en dos trabajos del parte: solo puede empezar uno.`);
            return;
          }
          vistos.add(n);
        }
      }
    }

    setEstado("creando");
    setError("");

    try {
      const material = resumenMateriales(conversion.materiales);
      const creados: string[] = [];
      let techsActuales = [...techs];

      for (const propuesto of conversion.trabajos) {
        const asignados = asignadosDe(propuesto.indiceLinea);
        const porQue = elegidos[propuesto.indiceLinea]
          ? `Técnicos elegidos a mano en Partes de trabajo: ${asignados.join(" + ") || "ninguno"}.`
          : propuestas.get(propuesto.indiceLinea)?.porQue ?? "";

        // Con id 0 el servidor asigna el siguiente libre de la tabla.
        const propuestoJob: Job = {
          ...trabajoBase(propuesto, 0),
          assignedNames: asignados,
          reason: [
            `Parte ${propuesto.ptNumero}: ${propuesto.descripcionOriginal}.`,
            porQue,
            material ? `Material: ${material}.` : "",
          ]
            .filter(Boolean)
            .join(" "),
        };

        const guardado = (await saveJobToBackend(propuestoJob)) as Job | null;
        const idReal = Number(guardado?.id);
        if (!Number.isFinite(idReal) || idReal <= 0) {
          throw new Error(`El servidor no ha devuelto el número del trabajo ${propuesto.plate}.`);
        }

        if (modo === "autorizar") {
          const r = autorizar({ ...propuestoJob, id: idReal }, asignados, techsActuales, Date.now());
          await saveJobToBackend(r.job);
          for (const t of r.techs) await saveTechToBackend(t);
          techsActuales = techsActuales.map((t) => r.techs.find((x) => x.name === t.name) ?? t);
        }

        creados.push(
          `${propuesto.plate} · ${propuesto.label} ×${propuesto.quantity}` +
            (asignados.length ? ` → ${asignados.join(" + ")}` : " → sin técnico libre")
        );
      }

      const titulo =
        modo === "autorizar"
          ? creados.length === 1
            ? "Trabajo autorizado y en marcha:"
            : `${creados.length} trabajos autorizados y en marcha:`
          : creados.length === 1
            ? "Trabajo creado y pendiente de validar:"
            : `${creados.length} trabajos creados y pendientes de validar:`;
      setAviso(`${titulo}\n${creados.join("\n")}`);

      setParte(null);
      setEstado("vacio");
      await cargarBase();
    } catch (e: any) {
      setError(e?.message || "No se pudieron crear los trabajos.");
      setEstado("revisando");
      await cargarBase();
    }
  }

  return (
    <div className="min-h-full bg-slate-900 p-4 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Partes de trabajo</h1>
            <p className="text-xs text-slate-400">
              Sube el parte escaneado (PDF o foto) o pega aquí una captura del ERP
              con Ctrl+V. De sus líneas salen los trabajos, con técnico propuesto.
              Revísalo antes de crear nada.
            </p>
          </div>

          <div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void subirParte(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => setAprendidosAbiertos((v) => !v)}
              className="mr-2 inline-flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold hover:bg-slate-700"
            >
              <BookOpen className="h-4 w-4" />
              Artículos aprendidos ({aprendidos.length})
            </button>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={estado === "leyendo" || estado === "creando"}
              className="flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {estado === "leyendo" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {estado === "leyendo" ? "Leyendo el parte…" : "Subir parte escaneado"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 whitespace-pre-line rounded-lg border border-rose-800 bg-rose-950/40 px-4 py-2 text-sm text-rose-300">
            {error}
          </div>
        )}

        {aviso && (
          <div className="mb-4 whitespace-pre-line rounded-lg border border-emerald-800 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300">
            {aviso}
          </div>
        )}

        {aprendidosAbiertos && (
          <div className="mb-4 rounded-2xl border border-slate-700 bg-slate-800 p-4">
            <h2 className="mb-1 text-sm font-black uppercase tracking-wide text-slate-300">
              Artículos aprendidos
            </h2>
            <p className="mb-3 text-xs text-slate-400">
              Lo que la aplicación ya sabe de cada artículo del ERP. Cámbialo si se
              enseñó mal, u olvídalo para que vuelva a preguntar.
            </p>

            {aprendidos.length === 0 ? (
              <p className="text-xs text-slate-500">
                Todavía no se ha enseñado ningún artículo.
              </p>
            ) : (
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {aprendidos.map((a) => {
                  const plantilla = plantillasDelTaller.find((p) => p.key === a.templateKey);

                  const huerfano =
                    a.templateKey !== CLAVE_MATERIAL && !plantilla;

                  return (
                    <div
                      key={a.clave}
                      className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm"
                    >
                      <span className="flex-1 truncate" title={a.clave}>
                        {a.descripcion || <span className="text-slate-500">(sin descripción)</span>}
                      </span>

                      {huerfano && (
                        <span
                          className="rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-bold text-amber-200"
                          title={`La entrada rápida "${a.templateKey}" ya no existe`}
                        >
                          plantilla borrada
                        </span>
                      )}

                      <select
                        value={huerfano ? "" : a.templateKey}
                        onChange={(e) => {
                          if (e.target.value) void cambiarAprendido(a, e.target.value);
                        }}
                        className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
                      >
                        {huerfano && <option value="">Elige una entrada rápida…</option>}
                        <option value={CLAVE_MATERIAL}>Material (no genera trabajo)</option>
                        {plantillasDelTaller.map((p) => (
                          <option key={p.key} value={p.key}>{p.label}</option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => void olvidarAprendido(a)}
                        title="Olvidar: volverá a preguntar la próxima vez"
                        className="rounded border border-rose-700 bg-rose-950/40 p-1.5 text-rose-300 hover:bg-rose-900/40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {!parte && estado !== "leyendo" && (
          <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center">
            <FileScan className="mx-auto h-8 w-8 text-slate-600" />
            <p className="mt-2 text-sm text-slate-400">
              Escanea el parte y súbelo, o pega una captura del ERP con{" "}
              <kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">Ctrl</kbd>
              {" + "}
              <kbd className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">V</kbd>.
              Se leen la matrícula, el cliente y las líneas de productos y servicios.
            </p>
          </div>
        )}

        {parte && conversion && (
          <div className="space-y-4">
            {/* Cabecera leída, editable: el OCR se equivoca */}
            <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
              <h2 className="mb-2 text-sm font-black uppercase tracking-wide text-slate-300">
                Datos leídos del parte
              </h2>

              <div className="grid gap-3 md:grid-cols-4">
                <Campo
                  etiqueta="PT Nº"
                  valor={parte.numero}
                  onChange={(v) => setParte({ ...parte, numero: v })}
                />
                <Campo
                  etiqueta="Matrícula"
                  valor={parte.matricula}
                  onChange={(v) => setParte({ ...parte, matricula: v })}
                />
                <Campo
                  etiqueta="Fecha"
                  valor={parte.fecha ?? ""}
                  onChange={(v) => setParte({ ...parte, fecha: v })}
                />
                <Campo
                  etiqueta="Entrada"
                  valor={parte.horaEntrada ?? ""}
                  onChange={(v) => setParte({ ...parte, horaEntrada: v })}
                />
                <div className="md:col-span-3">
                  <Campo
                    etiqueta="Cliente"
                    valor={parte.clienteNombre ?? ""}
                    onChange={(v) => setParte({ ...parte, clienteNombre: v })}
                  />
                </div>
                <Campo
                  etiqueta="Teléfono"
                  valor={parte.clienteTelefono ?? ""}
                  onChange={(v) => setParte({ ...parte, clienteTelefono: v })}
                />
              </div>
            </div>

            {conversion.avisos.length > 0 && (
              <div className="rounded-2xl border border-amber-700/60 bg-amber-950/30 p-3 text-xs text-amber-200">
                {conversion.avisos.map((a, i) => <div key={i}>· {a}</div>)}
              </div>
            )}

            {/* Líneas por enseñar */}
            {conversion.sinMapear.length > 0 && (
              <div className="rounded-2xl border border-amber-600/70 bg-amber-950/30 p-4">
                <h2 className="mb-1 text-sm font-black uppercase tracking-wide text-amber-300">
                  ⚠ Líneas por clasificar ({conversion.sinMapear.length})
                </h2>
                <p className="mb-3 text-xs text-amber-200/90">
                  Di qué es cada una: se recuerda para los próximos partes.
                  <b> Lo que quede sin clasificar no llega a la tarjeta del
                  técnico</b>, ni como tarea ni como material.
                </p>

                <div className="space-y-2">
                  {conversion.sinMapear.map((linea) => (
                    <div
                      key={linea.clave}
                      className="flex flex-wrap items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm"
                    >
                      <span className="flex-1 truncate">
                        {linea.descripcion}
                        <span className="ml-2 text-slate-500">×{linea.unidades}</span>
                      </span>

                      <select
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) void enseñarArticulo(linea, e.target.value);
                        }}
                        className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs"
                      >
                        <option value="">¿Qué es?</option>
                        <option value={CLAVE_MATERIAL}>Material (no genera trabajo)</option>
                        {plantillasDelTaller.map((p) => (
                          <option key={p.key} value={p.key}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Trabajos que se van a crear */}
            <div className="rounded-2xl border border-slate-700 bg-slate-800 p-4">
              <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-300">
                {conversion.trabajos.length === 1
                  ? "Trabajo a crear"
                  : `Trabajos a crear (${conversion.trabajos.length})`}
              </h2>

              {conversion.trabajos.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Ninguna línea de servicio reconocida todavía.
                </p>
              ) : (
                <div className="space-y-1 text-sm">
                  {conversion.trabajos.map((t) => {
                    const asignados = asignadosDe(t.indiceLinea);
                    const responsable = asignados[0] ?? "";
                    const apoyos = asignados.slice(1);
                    const elegibles = tecnicosParaElegir(techs);
                    const motivo = motivoNoAutorizable(asignados, techs, t.area);
                    const porQue = elegidos[t.indiceLinea]
                      ? "Técnicos elegidos a mano."
                      : propuestas.get(t.indiceLinea)?.porQue ?? "";
                    return (
                      <div key={t.indiceLinea} className="rounded-lg bg-slate-900 px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold">{t.plate}</span>
                          <span className="flex-1 truncate">{t.label}</span>
                          <span className="text-slate-400">×{t.quantity}</span>
                          <span className="text-slate-500">{t.estimatedMinutes} min</span>
                        </div>

                        {t.tareasIncluidas.length > 0 && (
                          <div className="mt-1 text-xs text-slate-400">
                            + {t.tareasIncluidas
                              .map((tarea) => `${tarea.label} ×${tarea.quantity ?? 1}`)
                              .join(" · ")}
                          </div>
                        )}

                        {/* Técnicos: la propuesta del motor, editable aquí mismo */}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select
                            value={responsable}
                            onChange={(e) =>
                              setElegidos((prev) => ({
                                ...prev,
                                [t.indiceLinea]: conResponsable(asignados, e.target.value),
                              }))
                            }
                            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs font-semibold"
                            title="Responsable del trabajo"
                          >
                            <option value="">Resp: sin técnico</option>
                            {elegibles.map((tech) => (
                              <option key={tech.name} value={tech.name}>
                                Resp: {etiquetaDeTecnico(tech)}
                              </option>
                            ))}
                          </select>
                          {apoyos.map((n) => (
                            <span
                              key={n}
                              className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300"
                            >
                              {n}
                              <button
                                type="button"
                                onClick={() =>
                                  setElegidos((prev) => ({ ...prev, [t.indiceLinea]: sinApoyo(asignados, n) }))
                                }
                                className="font-bold"
                                title="Quitar apoyo"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                          <select
                            value=""
                            onChange={(e) => {
                              if (!e.target.value) return;
                              setElegidos((prev) => ({ ...prev, [t.indiceLinea]: conApoyo(asignados, e.target.value) }));
                            }}
                            className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-1 text-[11px] text-amber-300"
                            title="Añadir apoyo"
                          >
                            <option value="">+ Apoyo…</option>
                            {elegibles
                              .filter((tech) => !asignados.includes(tech.name))
                              .map((tech) => (
                                <option key={tech.name} value={tech.name}>{etiquetaDeTecnico(tech)}</option>
                              ))}
                          </select>
                          {motivo ? (
                            <span className="text-[11px] text-amber-400">{motivo}</span>
                          ) : (
                            <span className="text-[11px] text-emerald-400">Se puede autorizar ya.</span>
                          )}
                        </div>
                        {porQue && <div className="mt-1 text-[11px] text-slate-500">{porQue}</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {conversion.materiales.length > 0 && (
                <p className="mt-3 text-xs text-slate-400">
                  <b>Material:</b> {resumenMateriales(conversion.materiales)}
                </p>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void crearTrabajos("autorizar")}
                  disabled={
                    estado === "creando" ||
                    conversion.trabajos.length === 0 ||
                    conversion.trabajos.some((t) => motivoNoAutorizable(asignadosDe(t.indiceLinea), techs, t.area))
                  }
                  title="Los técnicos elegidos empiezan ya, como el ✓ Autorizar de Operativo 2"
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {estado === "creando" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  ✓ Autorizar y empezar
                </button>

                <button
                  type="button"
                  onClick={() => void crearTrabajos("proponer")}
                  disabled={estado === "creando" || conversion.trabajos.length === 0}
                  title="Entra en «Pendientes de validar» de Operativo 2 con estos técnicos"
                  className="flex items-center gap-2 rounded-lg border border-emerald-600/60 bg-emerald-600/10 px-4 py-2 text-sm font-semibold text-emerald-300 hover:bg-emerald-600/20 disabled:opacity-50"
                >
                  <Send className="h-4 w-4" />
                  Crear y dejar pendiente de validar
                </button>

                <button
                  type="button"
                  onClick={() => { setParte(null); setEstado("vacio"); }}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700"
                >
                  Descartar
                </button>

                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <Wand2 className="h-3.5 w-3.5" />
                  Autorizar arranca el trabajo ya con esos técnicos; dejarlo pendiente lo manda a Operativo 2.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Campo({
  etiqueta,
  valor,
  onChange,
}: {
  etiqueta: string;
  valor: string;
  onChange: (valor: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-slate-400">{etiqueta}</label>
      <input
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm"
      />
    </div>
  );
}
