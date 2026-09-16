/**
 * Subir escaneos y ver cómo se archivan solos.
 *
 * Se arrastran los ficheros, se pulsa PROCESAR y el módulo hace el resto:
 * separa las páginas, lee el número de cada hoja, busca su bloc y la archiva.
 * La persona sólo interviene en las excepciones, que aparecen en «Documentos
 * pendientes».
 *
 * ── Por qué hay que preguntar por el avance ─────────────────────────────────
 *
 * El servidor contesta a la subida en cuanto ha guardado los ficheros: un PDF
 * de 200 páginas tarda minutos y el navegador cortaría la conexión mucho antes.
 * Así que aquí se pregunta cada dos segundos por los lotes en curso, y se deja
 * de preguntar en cuanto terminan todos: un intervalo que no se para es un
 * intervalo que sigue machacando el servidor con la pestaña olvidada.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { FileUp, RefreshCw, Trash2, Upload } from "lucide-react";
import * as api from "../services/api";
import { useOrManuales } from "../contexts/OrManualesContext";
import { Aviso, Cabecera, ChipEstadoProceso, ErrorBox, btnPrimary, btnSecondary } from "../components/ui";
import type { Procesamiento } from "../types";
import { fmtFechaHora } from "../../administracion/types";

const ADMITIDOS = ".pdf,.jpg,.jpeg,.png";
const CADA_MS = 2000;

export default function Escanear() {
  const { puede, refrescarIndicadores } = useOrManuales();
  const [ficheros, setFicheros] = useState<File[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallidos, setFallidos] = useState<{ archivo: string; error: string }[]>([]);
  const [procesos, setProcesos] = useState<Procesamiento[]>([]);
  const [arrastrando, setArrastrando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await api.procesamientos();
      setProcesos(r.procesamientos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar los escaneos");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Mientras haya algo en marcha se pregunta; cuando no, se para.
  const hayEnCurso = procesos.some((p) => p.estado === "PENDIENTE" || p.estado === "EN_CURSO");
  useEffect(() => {
    if (!hayEnCurso) return;
    const t = setInterval(() => {
      void cargar();
      void refrescarIndicadores();
    }, CADA_MS);
    return () => clearInterval(t);
  }, [hayEnCurso, cargar, refrescarIndicadores]);

  function anadir(lista: FileList | null) {
    if (!lista) return;
    setFicheros((previos) => [...previos, ...Array.from(lista)]);
    setError(null);
  }

  async function procesar() {
    if (ficheros.length === 0) return;
    setSubiendo(true);
    setError(null);
    setFallidos([]);
    try {
      const r = await api.subirDocumentos(ficheros);
      setFicheros([]);
      if (entrada.current) entrada.current.value = "";
      setFallidos(r.fallidos ?? []);
      await cargar();
      await refrescarIndicadores();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido subir los documentos");
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div>
      <Cabecera titulo="Escanear documentos" descripcion="Una página, una OR. Un PDF de 25 páginas se convierte en 25 documentos.">
        <button className={`${btnSecondary} flex items-center gap-2`} onClick={() => void cargar()}>
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
      </Cabecera>

      {error && <ErrorBox>{error}</ErrorBox>}

      {puede("or-manuales.documento.subir") && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setArrastrando(true);
          }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => {
            e.preventDefault();
            setArrastrando(false);
            anadir(e.dataTransfer.files);
          }}
          className={`mb-4 rounded-2xl border-2 border-dashed p-6 text-center transition ${
            arrastrando ? "border-teal-400 bg-teal-500/10" : "border-slate-600 bg-slate-800"
          }`}
        >
          <FileUp className="mx-auto h-8 w-8 text-slate-400" />
          <p className="mt-2 text-sm font-semibold text-slate-200">Arrastra aquí los escaneos</p>
          <p className="text-[12px] text-slate-400">PDF, JPG o PNG. Se pueden soltar varios de una vez.</p>
          <input
            ref={entrada}
            type="file"
            multiple
            accept={ADMITIDOS}
            className="hidden"
            onChange={(e) => anadir(e.target.files)}
          />
          <button type="button" className={`${btnSecondary} mt-3`} onClick={() => entrada.current?.click()}>
            Seleccionar ficheros
          </button>

          {ficheros.length > 0 && (
            <div className="mt-4 text-left">
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {ficheros.length} fichero(s) por procesar
              </div>
              <ul className="mb-3 max-h-40 space-y-1 overflow-y-auto">
                {ficheros.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-900/60 px-2 py-1 text-[13px]">
                    <span className="truncate">{f.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="whitespace-nowrap text-[11px] text-slate-500">{Math.round(f.size / 1024)} KB</span>
                      <button
                        type="button"
                        aria-label={`Quitar ${f.name}`}
                        onClick={() => setFicheros((p) => p.filter((_, j) => j !== i))}
                        className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <button className={`${btnPrimary} flex items-center gap-2`} onClick={() => void procesar()} disabled={subiendo}>
                <Upload className="h-4 w-4" /> {subiendo ? "Subiendo…" : "Procesar"}
              </button>
            </div>
          )}
        </div>
      )}

      {fallidos.length > 0 && (
        <div className="mb-4">
          <Aviso tono="mal">
            <strong>No se han podido procesar {fallidos.length} fichero(s):</strong>
            <ul className="mt-1 list-inside list-disc">
              {fallidos.map((f) => (
                <li key={f.archivo}>
                  {f.archivo}: {f.error}
                </li>
              ))}
            </ul>
            Los demás siguen su curso.
          </Aviso>
        </div>
      )}

      <div className="space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Escaneos recientes</div>
        {procesos.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Todavía no se ha subido ningún escaneo.</p>}
        {procesos.map((p) => (
          <ProcesoCard key={p.id} proceso={p} />
        ))}
      </div>
    </div>
  );
}

/**
 * El resultado de un lote, con la cuenta que pide el encargo: analizados,
 * archivados, pendientes, duplicados y errores.
 */
function ProcesoCard({ proceso: p }: { proceso: Procesamiento }) {
  const enCurso = p.estado === "PENDIENTE" || p.estado === "EN_CURSO";
  const pct = p.paginas === 0 ? 0 : Math.round((p.paginasProcesadas / p.paginas) * 100);

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[14px] font-bold text-slate-100">{p.archivoOriginal}</div>
          <div className="text-[11px] text-slate-500">
            {fmtFechaHora(p.fechaInicio)} · {p.usuarioNombre ?? "—"}
          </div>
        </div>
        <ChipEstadoProceso estado={p.estado} />
      </div>

      {enCurso && (
        <div className="mt-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
            <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 text-[12px] text-sky-300">{p.etapa ?? "Procesando…"}</div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px]">
        <Cuenta rotulo="Analizados" valor={p.paginas} />
        <Cuenta rotulo="Archivados" valor={p.documentosCorrectos} tono="text-emerald-400" />
        <Cuenta rotulo="A revisar" valor={p.documentosRevision} tono="text-orange-300" />
        <Cuenta rotulo="Sin identificar" valor={p.noIdentificados} tono="text-rose-400" />
        <Cuenta rotulo="Duplicados" valor={p.duplicados} tono="text-orange-300" />
        <Cuenta rotulo="Errores" valor={p.errores} tono="text-rose-400" />
      </div>

      {p.errorMensaje && <p className="mt-2 text-[12px] text-rose-300">{p.errorMensaje}</p>}

      {!enCurso && (p.noIdentificados > 0 || p.documentosRevision > 0 || p.duplicados > 0 || p.errores > 0) && (
        <Link to="/or-manuales/pendientes" className="mt-2 inline-block text-[12px] font-semibold text-teal-400 hover:underline">
          Revisar lo que ha quedado pendiente
        </Link>
      )}
    </div>
  );
}

function Cuenta({ rotulo, valor, tono = "text-slate-200" }: { rotulo: string; valor: number; tono?: string }) {
  return (
    <span className="text-slate-500">
      {rotulo}: <b className={`tabular-nums ${valor > 0 ? tono : "text-slate-500"}`}>{valor}</b>
    </span>
  );
}
