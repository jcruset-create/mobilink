/**
 * La bandeja de trabajo.
 *
 * No es un listado de correos: cada fila es un problema que alguien tiene que
 * resolver, con lo que le pasa escrito al lado. Es el mismo criterio que la
 * bandeja de excepciones de Assist, y por eso las pestañas son FILTROS con
 * contador y no estados: «reclamado» no es un estado, es un expediente normal
 * al que han vuelto a reclamar tres veces.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import * as api from "../services/api";
import {
  avisosDeFila,
  pestanas as calcularPestanas,
  resumenActuaciones,
  textoActuacion,
  textoAntiguedad,
} from "../services/bandeja";
import { useTherefore } from "../contexts/ThereforeContext";
import {
  ChipEstado,
  EmptyRow,
  ErrorBox,
  Modal,
  PuntoPrioridad,
  TableWrap,
  btnMini,
  btnPrimary,
  btnSecondary,
  inputCls,
  tdCls,
  thCls,
} from "../components/ui";
import { ETIQUETA_TIPO } from "../types";
import type { FilaBandeja } from "../types";
import { fmtFecha } from "../../administracion/types";
import { eurosConSigno } from "../../cash/utils/money";
import NuevoExpediente from "../components/NuevoExpediente";

const TODAS = "";

export default function Bandeja() {
  const { contadores, fijarContadores, puede, vocabulario } = useTherefore();

  const [pestana, setPestana] = useState("pendientes");
  const [exportando, setExportando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [avisoImportacion, setAvisoImportacion] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [prioridad, setPrioridad] = useState(TODAS);
  const [accion, setAccion] = useState(TODAS);
  const [proveedor, setProveedor] = useState("");

  const [filas, setFilas] = useState<FilaBandeja[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [eliminando, setEliminando] = useState<FilaBandeja | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.listarExpedientes({
        pestana,
        texto: texto || undefined,
        prioridad: prioridad || undefined,
        accion: accion || undefined,
        proveedor: proveedor || undefined,
      });
      setFilas(r.expedientes);
      setTotal(r.total);
      // Los contadores vienen con la lista: pedir el bootstrap otra vez sólo
      // para refrescarlos sería una petición de más en cada tecla.
      fijarContadores(r.contadores);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se han podido cargar los expedientes");
    } finally {
      setCargando(false);
    }
  }, [pestana, texto, prioridad, accion, proveedor, fijarContadores]);

  // Se espera a que deje de teclear: una petición por letra contra una base con
  // meses de expedientes no aporta nada.
  useEffect(() => {
    const t = setTimeout(() => void cargar(), 250);
    return () => clearTimeout(t);
  }, [cargar]);

  const pestanasVisibles = useMemo(() => calcularPestanas(contadores), [contadores]);


  /** El filtro tal y como se está aplicando: es lo que se exporta. */
  function filtroActual(): api.FiltroBandeja {
    return {
      pestana,
      texto: texto || undefined,
      prioridad: prioridad || undefined,
      accion: accion || undefined,
      proveedor: proveedor || undefined,
    };
  }

  async function exportar() {
    setExportando(true);
    try {
      const blob = await api.exportarExcel(filtroActual());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `therefore-expedientes-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido exportar");
    } finally {
      setExportando(false);
    }
  }

  async function importarEml(archivo: File | undefined) {
    if (!archivo) return;
    setImportando(true);
    setAvisoImportacion(null);
    try {
      const r = await api.importarEml(archivo);
      setAvisoImportacion(
        r.resultado === "procesado"
          ? `Importado: expediente ${r.expedienteNumero ?? ""}.`
          : r.resultado === "duplicado"
            ? `Ese correo ya estaba: expediente ${r.expedienteNumero ?? ""}.`
            : `No se ha importado: ${r.error ?? r.resultado}.`
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido importar el correo");
    } finally {
      setImportando(false);
    }
  }
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-black">Therefore</h1>
        <button onClick={() => void exportar()} className={btnSecondary} disabled={exportando}>
          <Download className="mr-1 inline h-3 w-3" />
          {exportando ? "Exportando…" : "Exportar Excel"}
        </button>
        {puede("therefore.correo.importar") && (
          <label className={`${btnSecondary} cursor-pointer`}>
            <Upload className="mr-1 inline h-3 w-3" />
            {importando ? "Importando…" : "Importar .eml"}
            <input
              type="file"
              accept=".eml,message/rfc822"
              className="hidden"
              disabled={importando}
              onChange={(ev) => void importarEml(ev.target.files?.[0])}
            />
          </label>
        )}
        <button onClick={() => void cargar()} className={btnSecondary} disabled={cargando}>
          <RefreshCw className={`mr-1 inline h-4 w-4 ${cargando ? "animate-spin" : ""}`} />
          Actualizar
        </button>
        {puede("therefore.expediente.create") && (
          <button onClick={() => setCreando(true)} className={btnPrimary}>
            <Plus className="mr-1 inline h-4 w-4" />
            Nuevo expediente
          </button>
        )}
      </div>

      {/* Pestañas: son filtros con contador, no estados. */}
      <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-800">
        {pestanasVisibles.map((p) => (
          <button
            key={p.clave}
            onClick={() => setPestana(p.clave)}
            className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-[13px] ${
              pestana === p.clave
                ? "border-sky-500 font-semibold text-sky-300"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {p.etiqueta}
            {p.cuenta !== undefined && (
              <span
                className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${
                  p.alerta ? "bg-rose-500/20 text-rose-300" : "bg-slate-800 text-slate-400"
                }`}
              >
                {p.cuenta}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <input
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Expediente, factura, albarán o proveedor"
          className={`${inputCls} min-w-[16rem] flex-1`}
        />
        <select
          value={prioridad}
          onChange={(e) => setPrioridad(e.target.value)}
          aria-label="Prioridad"
          className={`${inputCls} w-auto`}
        >
          <option value={TODAS}>Toda prioridad</option>
          {(vocabulario?.prioridades ?? []).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={accion}
          onChange={(e) => setAccion(e.target.value)}
          aria-label="Acción"
          className={`${inputCls} w-auto`}
        >
          <option value={TODAS}>Toda acción</option>
          {(vocabulario?.acciones ?? []).map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <input
          value={proveedor}
          onChange={(e) => setProveedor(e.target.value)}
          placeholder="Proveedor"
          className={`${inputCls} w-auto`}
        />
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      {avisoImportacion && <p className="mb-2 text-[12px] text-emerald-300">{avisoImportacion}</p>}

      <TableWrap>
        <thead className="bg-slate-800/60">
          <tr>
            <th className={thCls} aria-label="Prioridad" />
            <th className={thCls}>Expediente</th>
            <th className={thCls}>Fecha</th>
            <th className={thCls}>Empresa</th>
            <th className={thCls}>Tipo</th>
            <th className={thCls}>Proveedor</th>
            <th className={thCls}>Factura</th>
            <th className={thCls}>Actuaciones</th>
            <th className={thCls}>Recl.</th>
            <th className={thCls}>Antigüedad</th>
            <th className={thCls}>Estado</th>
            <th className={thCls} aria-label="Eliminar" />
          </tr>
        </thead>
        <tbody>
          {cargando && filas.length === 0 ? (
            <EmptyRow cols={12} text="Cargando…" />
          ) : filas.length === 0 ? (
            /*
             * Una bandeja vacía es una buena noticia: se dice con palabras, no
             * con una tabla en blanco. Mismo criterio que la bandeja de Assist.
             */
            <EmptyRow cols={12} text="Nada pendiente por aquí. Buena señal." />
          ) : (
            filas.map((f) => (
              <Fila
                key={f.id}
                fila={f}
                puedeEliminar={puede("therefore.expediente.edit")}
                onEliminar={() => setEliminando(f)}
              />
            ))
          )}
        </tbody>
      </TableWrap>

      {total > filas.length && (
        <p className="mt-2 text-[12px] text-slate-500">
          Se enseñan {filas.length} de {total}. Afina el filtro para ver el resto.
        </p>
      )}

      {eliminando && (
        <ConfirmarEliminar
          fila={eliminando}
          onCerrar={() => setEliminando(null)}
          onEliminado={() => {
            setEliminando(null);
            void cargar();
          }}
          onError={setError}
        />
      )}

      {creando && (
        <NuevoExpediente
          onCerrar={() => setCreando(false)}
          onCreado={() => {
            setCreando(false);
            void cargar();
          }}
        />
      )}
    </div>
  );
}

function Fila({
  fila,
  puedeEliminar,
  onEliminar,
}: {
  fila: FilaBandeja;
  puedeEliminar: boolean;
  onEliminar: () => void;
}) {
  const { visibles, restantes } = resumenActuaciones(fila.actuaciones);
  const avisos = avisosDeFila(fila);

  return (
    <tr className="border-t border-slate-700/50 hover:bg-slate-700/30">
      <td className={`${tdCls} w-6`}>
        <PuntoPrioridad prioridad={fila.prioridad} />
      </td>
      <td className={tdCls}>
        <Link to={`/therefore/expedientes/${fila.id}`} className="font-medium text-sky-400 hover:underline">
          {fila.numero}
        </Link>
        {avisos.length > 0 && (
          <div className="text-[11px] text-amber-300">{avisos.join(" · ")}</div>
        )}
      </td>
      <td className={`${tdCls} whitespace-nowrap text-slate-400`}>
        {fmtFecha(fila.fechaUltimaNotificacion)}
      </td>
      <td className={tdCls}>{fila.empresaCodigo || "—"}</td>
      <td className={tdCls}>{ETIQUETA_TIPO[fila.tipo] ?? fila.tipo}</td>
      <td className={tdCls}>{fila.proveedorNombre ?? "—"}</td>
      <td className={tdCls}>
        {fila.facturaNumero ?? "—"}
        {fila.importeCentimos !== null && (
          <div className="text-[11px] tabular-nums text-slate-400">
            {eurosConSigno(fila.importeCentimos)}
          </div>
        )}
      </td>
      <td className={tdCls}>
        {visibles.length === 0 ? (
          <span className="text-slate-500">—</span>
        ) : (
          <div className="text-[12px]">
            {visibles.map((a) => (
              <div key={a.id} className="whitespace-nowrap">
                {textoActuacion(a)}
              </div>
            ))}
            {restantes > 0 && <div className="text-slate-500">+{restantes}</div>}
          </div>
        )}
      </td>
      <td className={`${tdCls} tabular-nums`}>
        {fila.numeroReclamaciones > 0 ? fila.numeroReclamaciones : "—"}
      </td>
      <td className={`${tdCls} whitespace-nowrap`}>{textoAntiguedad(fila.diasAbierto)}</td>
      <td className={tdCls}>
        <ChipEstado estado={fila.estado} />
      </td>
      <td className={`${tdCls} w-8 text-right`}>
        {puedeEliminar && (
          <button
            onClick={onEliminar}
            className={`${btnMini} text-slate-400 hover:text-rose-300`}
            title="Eliminar de la bandeja"
            aria-label={`Eliminar ${fila.numero}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
    </tr>
  );
}

/**
 * Eliminar es sacarlo de la bandeja, no borrarlo de la base.
 *
 * Se dice con estas palabras porque es lo que pasa: el correo que lo abrió,
 * sus adjuntos y su histórico se quedan donde están. Lo que desaparece es la
 * fila, que es lo que estorba. Y se pregunta antes: deshacerlo obliga a ir a
 * buscar el expediente por su número.
 */
function ConfirmarEliminar({
  fila,
  onCerrar,
  onEliminado,
  onError,
}: {
  fila: FilaBandeja;
  onCerrar: () => void;
  onEliminado: () => void;
  onError: (mensaje: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [borrando, setBorrando] = useState(false);

  async function eliminar() {
    setBorrando(true);
    try {
      await api.cambiarEstado(fila.id, "DESCARTADO", motivo);
      onEliminado();
    } catch (e) {
      onError(e instanceof Error ? e.message : "No se ha podido eliminar");
      onCerrar();
    } finally {
      setBorrando(false);
    }
  }

  return (
    <Modal
      title={`Eliminar ${fila.numero}`}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onCerrar} className={btnSecondary}>
            Cancelar
          </button>
          <button onClick={() => void eliminar()} className={btnPrimary} disabled={borrando}>
            {borrando ? "Eliminando…" : "Eliminar"}
          </button>
        </div>
      }
    >
      <p className="mb-3 text-[13px] text-slate-300">
        Sale de la bandeja y deja de contar. El correo que lo abrió, sus documentos y su histórico
        se conservan: se puede volver a poner en la cola buscándolo por su número.
      </p>
      <label className="block text-[12px] text-slate-400">
        Por qué (opcional)
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          className={`${inputCls} mt-1`}
          placeholder="Duplicado, prueba, no era para nosotros…"
        />
      </label>
    </Modal>
  );
}
