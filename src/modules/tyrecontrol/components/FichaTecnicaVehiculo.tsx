import { useEffect, useRef, useState } from "react";
import {
  listarDocumentosVehiculo, subirFichaTecnica, procesarOcrDocumento, aplicarFichaTecnica,
  listarCatalogoCamposFicha,
  type DocumentoVehiculo, type ResultadoFichaTecnica, type CampoFicha, type EjeFicha, type CampoCatalogoFicha,
} from "../services/data";
import type { Vehiculo } from "../types";
import { columnaDe } from "../services/fichaTecnicaCampos";
import { Modal, inputCls } from "./ui";

/** Campos de la ficha que tienen columna propia en el vehículo. */
const CAMPOS_VEHICULO: Record<string, { etiqueta: string; actual: (v: Vehiculo) => string | null }> = {
  matricula: { etiqueta: "Matrícula", actual: (v) => v.matricula ?? null },
  vin: { etiqueta: "Bastidor / VIN", actual: (v) => v.bastidor ?? null },
  bastidor: { etiqueta: "Bastidor / VIN", actual: (v) => v.bastidor ?? null },
  marca: { etiqueta: "Marca", actual: (v) => v.marca ?? null },
  modelo: { etiqueta: "Modelo", actual: (v) => v.modelo ?? null },
  fecha_primera_matriculacion: { etiqueta: "Fecha matriculación", actual: (v) => v.fecha_matriculacion ?? null },
};

type Decision = "aceptar" | "mantener";

const norm = (s?: string | null) => (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

export default function FichaTecnicaVehiculo({ vehiculo, puedeEditar, onAplicado }: {
  vehiculo: Vehiculo; puedeEditar: boolean; onAplicado: () => void;
}) {
  const [docs, setDocs] = useState<DocumentoVehiculo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [procesando, setProcesando] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Revisión
  const [revision, setRevision] = useState<null | { docId: string; datos: ResultadoFichaTecnica }>(null);
  const [decisiones, setDecisiones] = useState<Record<string, Decision>>({});
  const [editados, setEditados] = useState<Record<string, string>>({});
  const [aplicando, setAplicando] = useState(false);
  const [catalogo, setCatalogo] = useState<Map<string, CampoCatalogoFicha>>(new Map());

  async function cargar() {
    setCargando(true);
    try { setDocs(await listarDocumentosVehiculo(vehiculo.id)); }
    catch (e: any) { setError(e?.message ?? "Error"); }
    finally { setCargando(false); }
  }
  useEffect(() => { void cargar(); /* eslint-disable-next-line */ }, [vehiculo.id]);
  useEffect(() => {
    listarCatalogoCamposFicha()
      .then((filas) => setCatalogo(new Map(filas.map((f) => [f.clave, f]))))
      .catch(() => setCatalogo(new Map()));
  }, []);

  async function onArchivos(files: FileList | null) {
    if (!files?.length) return;
    setSubiendo(true); setError(""); setMsg("Subiendo documento…");
    try {
      const r = await subirFichaTecnica(vehiculo.id, Array.from(files));
      setMsg("Documento guardado. Procesando OCR…");
      await cargar();
      await procesar(r.documento.id);
    } catch (e: any) { setError(e?.message ?? "Error"); setMsg(""); }
    finally { setSubiendo(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function procesar(docId: string) {
    setProcesando(docId); setError(""); setMsg("Interpretando campos…");
    try {
      const datos = await procesarOcrDocumento(docId);
      setDecisiones({}); setEditados({});
      setRevision({ docId, datos });
      setMsg("");
    } catch (e: any) { setError(e?.message ?? "Error procesando"); setMsg(""); }
    finally { setProcesando(null); await cargar(); }
  }

  // ── Revisión: comparación campo a campo ──────────────────────
  const filas = (revision?.datos.campos ?? []).map((c, i) => {
    const conocido = c.clave ? CAMPOS_VEHICULO[c.clave] : undefined;
    const actual = conocido ? conocido.actual(vehiculo) : null;
    const detectado = c.valor ?? "";
    const id = `${c.clave ?? c.codigo_origen ?? "x"}-${i}`;
    let estado: "nuevo" | "coincide" | "vacio" | "conflicto";
    if (!conocido) estado = "nuevo";
    else if (!actual) estado = "vacio";
    else if (norm(actual) === norm(detectado)) estado = "coincide";
    else estado = "conflicto";
    return { id, campo: c, conocido, actual, detectado, estado };
  });

  const decisionDe = (f: typeof filas[number]): Decision =>
    decisiones[f.id] ?? (f.estado === "conflicto" ? "mantener" : "aceptar");

  const conflictos = filas.filter((f) => f.estado === "conflicto").length;
  const bloqueado = (revision?.datos.bloqueos.length ?? 0) > 0;

  const COLOR: Record<string, string> = {
    coincide: "text-emerald-300", vacio: "text-emerald-300",
    conflicto: "text-rose-300", nuevo: "text-sky-300",
  };
  const ETIQUETA: Record<string, string> = {
    coincide: "Coincide", vacio: "Campo vacío", conflicto: "Conflicto", nuevo: "Campo nuevo",
  };

  async function aplicar() {
    if (!revision) return;
    setAplicando(true); setError("");
    try {
      const campos: Record<string, string> = {};
      const atributos: CampoFicha[] = [];
      for (const f of filas) {
        const valor = editados[f.id] ?? f.detectado;
        if (decisionDe(f) !== "aceptar" || !valor.trim()) continue;
        // Todo lo que tenga columna propia en el vehículo va a `campos` (el
        // servidor lo escribe en su columna tipada); solo lo que quede fuera
        // del catálogo se guarda como atributo técnico.
        if (f.campo.clave && columnaDe(f.campo.clave)) campos[f.campo.clave] = valor;
        else atributos.push({ ...f.campo, valor });
      }
      const r = await aplicarFichaTecnica(revision.docId, {
        campos,
        ejes: revision.datos.ejes,
        configuracion: revision.datos.configuracion,
        configuracionConvencional: revision.datos.configuracionConvencional,
        atributos,
      });
      setMsg(`Aplicado: ${r.aplicado.join(", ")}`);
      setRevision(null);
      onAplicado();
      await cargar();
    } catch (e: any) { setError(e?.message ?? "Error aplicando"); }
    finally { setAplicando(false); }
  }

  const kb = (n?: number | null) => (n ? `${Math.round(n / 1024)} KB` : "—");

  return (
    <div className="mt-3 rounded-lg bg-slate-800 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex-1 text-[11px] font-bold uppercase text-slate-400">Ficha técnica</div>
        {puedeEditar && (
          <>
            <input ref={inputRef} type="file" accept="image/*,application/pdf" multiple className="hidden"
              onChange={(e) => void onArchivos(e.target.files)} />
            <button onClick={() => inputRef.current?.click()} disabled={subiendo}
              className="rounded-lg bg-sky-600 px-3 py-1.5 text-[12px] font-bold text-white disabled:opacity-50">
              {subiendo ? "Subiendo…" : "📎 Adjuntar / escanear ficha"}
            </button>
          </>
        )}
      </div>

      <div className="mb-2 text-[11px] text-slate-500">
        Adjunta el PDF o fotografía las páginas: se leen los datos y se comparan con la ficha del vehículo
        antes de guardar nada. La configuración de ejes se calcula contando los neumáticos de cada eje.
      </div>

      {msg && <div className="mb-2 text-[12px] text-sky-300">{msg}</div>}
      {error && <div className="mb-2 text-[12px] text-rose-300">{error}</div>}

      {cargando ? (
        <div className="text-[12px] text-slate-500">Cargando documentos…</div>
      ) : docs.length === 0 ? (
        <div className="text-[12px] text-slate-500">Este vehículo no tiene ficha técnica adjunta.</div>
      ) : (
        <div className="space-y-1">
          {docs.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-2 rounded bg-slate-900 px-3 py-2 text-[12px]">
              <span className={d.vigente ? "font-bold text-slate-100" : "text-slate-400"}>
                {d.vigente ? "Vigente" : `v${d.version}`}
              </span>
              <span className="text-slate-300">{d.nombre_original ?? "documento"}</span>
              <span className="text-slate-500">{d.paginas ?? 1} pág · {kb(d.tamano_bytes)}</span>
              <span className="text-slate-500">{new Date(d.created_at).toLocaleDateString("es-ES")}</span>
              <span className={
                d.ocr_estado === "ok" ? "text-emerald-300"
                : d.ocr_estado === "error" ? "text-rose-300" : "text-amber-300"}>
                OCR: {d.ocr_estado}{d.ocr_confianza != null ? ` (${Math.round(d.ocr_confianza * 100)}%)` : ""}
              </span>
              <span className="flex-1" />
              {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">Ver</a>}
              {puedeEditar && (
                <button onClick={() => void procesar(d.id)} disabled={procesando === d.id}
                  className="text-sky-300 hover:underline disabled:opacity-50">
                  {procesando === d.id ? "Procesando…" : d.ocr_estado === "ok" ? "Revisar datos" : "Procesar OCR"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {revision && (
        <Modal title="Revisar datos de la ficha técnica" size="xl" onClose={() => setRevision(null)}
          footer={
            <>
              <button onClick={() => setRevision(null)} className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200">Cancelar</button>
              <button onClick={() => void aplicar()} disabled={aplicando || bloqueado}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
                {aplicando ? "Aplicando…" : "Aplicar cambios"}
              </button>
            </>
          }>

          {bloqueado && (
            <div className="mb-3 rounded-lg border border-rose-500/50 bg-rose-950/40 p-3 text-[13px] text-rose-200">
              <div className="font-bold">Este documento no parece de este vehículo</div>
              {revision.datos.bloqueos.map((b) => <div key={b}>· {b}</div>)}
              <div className="mt-1 text-[12px]">No se puede aplicar. Revisa que la ficha corresponda a la matrícula correcta.</div>
            </div>
          )}

          {revision.datos.avisos.map((a) => (
            <div key={a} className="mb-2 text-[12px] font-semibold text-amber-300">⚠ {a}</div>
          ))}

          {/* Configuración: lo más delicado, arriba y bien separado */}
          <div className="mb-3 rounded-lg bg-slate-900 p-3">
            <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Configuración</div>
            {revision.datos.configuracion ? (
              <>
                <div className="text-[14px] font-bold text-emerald-300">
                  TyreControl: {revision.datos.configuracion}
                  {!revision.datos.configuracionExisteEnCatalogo && (
                    <span className="ml-2 text-[11px] font-normal text-amber-300">(se creará en el catálogo)</span>
                  )}
                </div>
                <div className="text-[12px] text-slate-400">
                  Convencional del fabricante: {revision.datos.configuracionConvencional ?? "No informada"}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Nomenclatura informativa del fabricante. La configuración operativa se define por el número de
                  neumáticos de cada eje, de delante hacia atrás.
                </div>
              </>
            ) : (
              <div className="text-[13px] text-amber-300">
                Configuración pendiente de validar. {revision.datos.configuracionPendiente}
              </div>
            )}
            {revision.datos.ejes.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {revision.datos.ejes.map((e: EjeFicha) => (
                  <div key={e.posicion} className="text-[12px] text-slate-300">
                    Eje {e.posicion}: {e.ruedas} neumáticos
                    {e.directriz ? " · directriz" : ""}{e.motriz ? " · motriz" : ""}{e.elevable ? " · elevable" : ""}
                    {e.medida ? ` · ${e.medida}` : ""}{e.indice_carga ? ` ${e.indice_carga}${e.codigo_velocidad ?? ""}` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-3 text-[12px]">
            <span className="text-slate-400">
              {filas.length} campo(s) · {conflictos} conflicto(s)
              {revision.datos.confianza != null ? ` · confianza ${Math.round(revision.datos.confianza * 100)}%` : ""}
            </span>
            <button onClick={() => {
              const d: Record<string, Decision> = {};
              for (const f of filas) if (f.estado !== "conflicto") d[f.id] = "aceptar";
              setDecisiones((prev) => ({ ...prev, ...d }));
            }} className="rounded border border-slate-600 px-2 py-1 text-slate-300">
              Aceptar todo lo que no tiene conflicto
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-[12px]" style={{ tableLayout: "fixed" }}>
              <thead className="sticky top-0 bg-slate-800">
                <tr className="text-left text-slate-400">
                  <th className="w-1/5 py-1">Campo</th>
                  <th className="w-1/12 py-1">Código</th>
                  <th className="w-1/5 py-1">Actual</th>
                  <th className="w-1/4 py-1">Detectado</th>
                  <th className="w-1/6 py-1">Estado</th>
                  <th className="w-1/6 py-1">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} className="border-t border-slate-700/60 align-top">
                    <td className="py-1 pr-2 text-slate-200">
                      {f.conocido?.etiqueta ?? (f.campo.clave ? catalogo.get(f.campo.clave)?.descripcion : null)
                        ?? f.campo.etiqueta_origen ?? f.campo.clave ?? "—"}
                    </td>
                    <td className="py-1 pr-2 text-slate-500">
                      {(f.campo.clave ? catalogo.get(f.campo.clave)?.codigo : null) ?? f.campo.codigo_origen ?? "—"}
                    </td>
                    <td className="py-1 pr-2 text-slate-400 break-words">{f.actual ?? "—"}</td>
                    <td className="py-1 pr-2">
                      <input className={`${inputCls} text-[12px]`} value={editados[f.id] ?? f.detectado}
                        onChange={(e) => setEditados((p) => ({ ...p, [f.id]: e.target.value }))} />
                    </td>
                    <td className={`py-1 pr-2 font-semibold ${COLOR[f.estado]}`}>
                      {ETIQUETA[f.estado]}
                      {f.campo.confianza != null && f.campo.confianza < 0.8 && (
                        <div className="text-[10px] font-normal text-amber-300">
                          confianza {Math.round(f.campo.confianza * 100)}%
                        </div>
                      )}
                    </td>
                    <td className="py-1">
                      <select className={`${inputCls} text-[11px]`} value={decisionDe(f)}
                        onChange={(e) => setDecisiones((p) => ({ ...p, [f.id]: e.target.value as Decision }))}>
                        <option value="aceptar">Aceptar</option>
                        <option value="mantener">{f.conocido ? "Mantener actual" : "Descartar"}</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {revision.datos.observaciones && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-bold uppercase text-slate-400">Observaciones del documento</div>
              <div className="max-h-24 overflow-y-auto rounded bg-slate-900 p-2 text-[12px] text-slate-300">
                {revision.datos.observaciones}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
