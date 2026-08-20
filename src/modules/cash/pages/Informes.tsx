/**
 * Informes: el papeleo del día, en un solo sitio.
 *
 * Todo esto existía, pero repartido y escondido: el PDF de cierre solo salía
 * en la pantalla de confirmación justo después de cerrar y en el detalle del
 * histórico, así que quien cerraba la caja y cerraba la pestaña ya no sabía
 * dónde encontrarlo. Aquí se listan las jornadas y cada una trae lo suyo.
 *
 * Y lo que no existía: subir el taco de facturas escaneado del día —varios
 * ficheros, porque en el mostrador no sale todo en un PDF— y la hoja del
 * ingreso bancario para llevar al banco.
 */

import { useCallback, useEffect, useState } from "react";
import { FileDown, Paperclip, Printer, Upload } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import {
  Cabecera,
  EmptyRow,
  ErrorBox,
  TableWrap,
  thCls,
  tdCls,
  inputCls,
} from "../components/ui";
import { euros } from "../utils/money";
import { ETIQUETA_ESTADO_SESION, type DocumentoOperacion, type EstadoSesion } from "../types";
import * as api from "../services/api";

type FilaSesion = {
  id: number;
  fecha: string;
  estado: EstadoSesion;
  caja_nombre: string;
  caja_centro: string;
  contado_centimos: string | null;
  cambio_final_centimos: string | null;
  ingreso_bancario_centimos: string | null;
};

/** El servidor corta en 15 MB; avisar aquí ahorra subir el escaneo para nada. */
const MAXIMO_DOCUMENTO = 15 * 1024 * 1024;

export default function Informes() {
  const { cajas, puede } = useCash();

  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [registerId, setRegisterId] = useState<number | "">("");
  const [sesiones, setSesiones] = useState<FilaSesion[]>([]);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  /** Jornada cuyo panel de escaneos está abierto. */
  const [abierta, setAbierta] = useState<number | null>(null);
  /** Jornada cuya hoja de ingreso se está imprimiendo. */
  const [hoja, setHoja] = useState<FilaSesion | null>(null);

  const buscar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const r = await api.historico({
        desde: desde || undefined,
        hasta: hasta || undefined,
        registerId: registerId === "" ? undefined : registerId,
      });
      setSesiones(r.sesiones as unknown as FilaSesion[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error consultando las jornadas");
    } finally {
      setCargando(false);
    }
  }, [desde, hasta, registerId]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Informes"
        descripcion="El papeleo de cada jornada: el informe de cierre, la hoja del ingreso y los escaneos del día."
      />

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Desde</span>
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Hasta</span>
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className={inputCls} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Caja</span>
          <select
            value={registerId}
            onChange={(e) => setRegisterId(e.target.value === "" ? "" : Number(e.target.value))}
            className={inputCls}
          >
            <option value="">Todas</option>
            {cajas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.centro ? `${c.centro} · ` : ""}
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Jornada</th>
            <th className={thCls}>Caja</th>
            <th className={thCls}>Estado</th>
            <th className={`${thCls} text-right`}>Contado</th>
            <th className={`${thCls} text-right`}>Al banco</th>
            <th className={thCls}></th>
          </tr>
        </thead>
        <tbody>
          {sesiones.length === 0 && (
            <EmptyRow cols={6} text={cargando ? "Buscando…" : "No hay jornadas en ese periodo."} />
          )}
          {sesiones.map((s) => {
            const alBanco = Number(s.ingreso_bancario_centimos ?? 0);
            return (
              <FragmentoJornada
                key={s.id}
                sesion={s}
                alBanco={alBanco}
                abierta={abierta === s.id}
                puedeAdjuntar={puede("cash.document.attach")}
                onAlternar={() => setAbierta(abierta === s.id ? null : s.id)}
                onImprimirHoja={() => setHoja(s)}
              />
            );
          })}
        </tbody>
      </TableWrap>

      <p className="text-[11px] text-slate-500">
        El informe de cierre lleva dentro el desglose de la jornada y todos los justificantes
        escaneados, los de cada cobro y los que se suban aquí. Solo existe en las jornadas cerradas:
        antes de cerrar no hay cierre que informar.
      </p>

      {hoja && <HojaIngreso sesion={hoja} onCerrar={() => setHoja(null)} />}
    </div>
  );
}

/** Fila de la jornada y, debajo, su panel de escaneos cuando está abierto. */
function FragmentoJornada({
  sesion,
  alBanco,
  abierta,
  puedeAdjuntar,
  onAlternar,
  onImprimirHoja,
}: {
  sesion: FilaSesion;
  alBanco: number;
  abierta: boolean;
  puedeAdjuntar: boolean;
  onAlternar: () => void;
  onImprimirHoja: () => void;
}) {
  const cerrada = sesion.estado === "CLOSED";

  return (
    <>
      <tr className="border-t border-slate-700">
        <td className={`${tdCls} font-medium text-slate-100`}>{sesion.fecha}</td>
        <td className={`${tdCls} text-[11px] text-slate-400`}>
          {sesion.caja_centro ? `${sesion.caja_centro} · ` : ""}
          {sesion.caja_nombre}
        </td>
        <td className={`${tdCls} text-[11px] text-slate-400`}>
          {ETIQUETA_ESTADO_SESION[sesion.estado]}
        </td>
        <td className={`${tdCls} text-right tabular-nums text-slate-300`}>
          {sesion.contado_centimos == null ? "—" : euros(Number(sesion.contado_centimos))}
        </td>
        <td className={`${tdCls} text-right tabular-nums text-sky-300`}>
          {alBanco > 0 ? euros(alBanco) : "—"}
        </td>
        <td className={tdCls}>
          <div className="flex flex-wrap justify-end gap-1">
            <button onClick={onAlternar} className={botonCls} title="Escaneos de la jornada">
              <Paperclip className="h-3.5 w-3.5" /> Escaneos
            </button>
            {alBanco > 0 && (
              <button onClick={onImprimirHoja} className={botonCls} title="Hoja para el banco">
                <Printer className="h-3.5 w-3.5" /> Hoja del ingreso
              </button>
            )}
            {cerrada ? (
              <a
                href={api.urlInformeCierre(sesion.id)}
                target="_blank"
                rel="noreferrer"
                className={botonCls}
              >
                <FileDown className="h-3.5 w-3.5" /> Informe
              </a>
            ) : (
              <span className="px-2 py-1 text-[11px] text-slate-600">Sin cerrar</span>
            )}
          </div>
        </td>
      </tr>

      {abierta && (
        <tr className="border-t border-slate-800 bg-slate-900/40">
          <td colSpan={6} className="px-3 py-2">
            <EscaneosDeJornada sessionId={sesion.id} puedeAdjuntar={puedeAdjuntar} />
          </td>
        </tr>
      )}
    </>
  );
}

const botonCls =
  "flex items-center gap-1 rounded-lg bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 hover:bg-slate-600";

/**
 * Escaneos que cuelgan de la jornada entera.
 *
 * Son varios a propósito: el taco de facturas rara vez sale en un solo PDF, y
 * el resguardo del banco llega aparte y más tarde.
 */
function EscaneosDeJornada({
  sessionId,
  puedeAdjuntar,
}: {
  sessionId: number;
  puedeAdjuntar: boolean;
}) {
  const [docs, setDocs] = useState<DocumentoOperacion[]>([]);
  const [error, setError] = useState("");
  const [subiendo, setSubiendo] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setDocs((await api.documentosDeJornada(sessionId)).documentos);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando los escaneos");
    }
  }, [sessionId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function subir(ficheros: FileList | null) {
    if (!ficheros || ficheros.length === 0) return;
    setSubiendo(true);
    setError("");
    try {
      // De uno en uno: si el tercero falla, los dos primeros ya están subidos y
      // no hay que volver a escanearlos.
      for (const f of Array.from(ficheros)) {
        if (f.size > MAXIMO_DOCUMENTO) {
          setError(`«${f.name}» pesa ${(f.size / 1024 / 1024).toFixed(1)} MB y el máximo son 15 MB.`);
          continue;
        }
        await api.adjuntarDocumentoAJornada(sessionId, f);
      }
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido subir el escaneo");
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div className="space-y-2">
      {error && <ErrorBox>{error}</ErrorBox>}

      {docs.length === 0 ? (
        <p className="text-[11px] text-slate-500">
          Todavía no hay escaneos colgados de esta jornada.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {docs.map((d) => (
            <li key={d.id}>
              <a
                href={d.url ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 rounded-lg bg-slate-800 px-2 py-1 text-[11px] text-sky-300 hover:bg-slate-700"
              >
                <Paperclip className="h-3 w-3" /> {d.nombre}
                <span className="text-slate-500">
                  {(d.tamanoBytes / 1024).toFixed(0)} KB
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {puedeAdjuntar && (
        <label className={`${botonCls} inline-flex cursor-pointer`}>
          <Upload className="h-3.5 w-3.5" />
          {subiendo ? "Subiendo…" : "Subir escaneos"}
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            multiple
            className="hidden"
            disabled={subiendo}
            onChange={(e) => {
              const ficheros = e.target.files;
              e.target.value = "";
              void subir(ficheros);
            }}
          />
        </label>
      )}

      <p className="text-[11px] text-slate-500">
        Se pueden subir varios: el taco de facturas del día, el resguardo del banco, lo que haga
        falta. Van dentro del informe de cierre.
      </p>
    </div>
  );
}

/**
 * Hoja del ingreso para llevar al banco.
 *
 * Solo el total y la referencia, que es lo que pide la ventanilla cuando el
 * dinero va en sobre cerrado. El desglose pieza a pieza ya está en el informe
 * de cierre, y repetirlo aquí solo daría dos papeles que se contradicen si uno
 * se reimprime más tarde.
 */
function HojaIngreso({ sesion, onCerrar }: { sesion: FilaSesion; onCerrar: () => void }) {
  const importe = Number(sesion.ingreso_bancario_centimos ?? 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 p-4 print:static print:bg-white print:p-0">
      <div className="w-full max-w-md rounded-xl bg-white p-6 text-slate-900 print:max-w-none print:rounded-none">
        <div className="mb-4 flex items-start justify-between print:hidden">
          <h2 className="text-lg font-black">Hoja del ingreso</h2>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[12px] font-medium text-white"
            >
              <Printer className="h-3.5 w-3.5" /> Imprimir
            </button>
            <button
              onClick={onCerrar}
              className="rounded-lg bg-slate-200 px-3 py-1.5 text-[12px] font-medium text-slate-700"
            >
              Cerrar
            </button>
          </div>
        </div>

        <div className="text-xs uppercase tracking-wide text-slate-500">Ingreso en efectivo</div>
        <div className="mb-4 text-sm text-slate-600">
          {sesion.caja_centro ? `${sesion.caja_centro} · ` : ""}
          {sesion.caja_nombre}
        </div>

        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr className="border-b border-slate-200">
              <td className="py-2 text-slate-500">Jornada</td>
              <td className="py-2 text-right font-mono">{sesion.fecha}</td>
            </tr>
            <tr className="border-b border-slate-200">
              <td className="py-2 text-slate-500">Referencia</td>
              <td className="py-2 text-right font-mono">MC-{sesion.fecha}-{sesion.id}</td>
            </tr>
            <tr>
              <td className="py-3 font-bold">Importe a ingresar</td>
              <td className="py-3 text-right text-2xl font-black tabular-nums">{euros(importe)}</td>
            </tr>
          </tbody>
        </table>

        <div className="mt-8 grid grid-cols-2 gap-6 text-xs text-slate-500">
          <div className="border-t border-slate-400 pt-1">Entregado por</div>
          <div className="border-t border-slate-400 pt-1">Recibido por</div>
        </div>
      </div>
    </div>
  );
}
