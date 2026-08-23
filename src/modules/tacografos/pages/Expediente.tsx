/**
 * Formulario del expediente: el equivalente a la hoja `DATOS` del libro.
 *
 * Mismas secciones, mismos campos y mismas reglas. Los avisos de obligatorio
 * los calcula el servidor y llegan en `camposQueFaltan`, para que no haya dos
 * versiones de la regla —una aquí y otra allí— que puedan divergir.
 *
 * El expediente se guarda aunque falten campos: el técnico apunta matrícula y
 * nº de serie con el vehículo delante y termina el resto en el mostrador.
 */

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Ban, FileSpreadsheet, PackageCheck, Save } from "lucide-react";
import * as api from "../services/api";
import { useTacografos } from "../contexts/TacografosContext";
import DocumentosExpediente from "./DocumentosExpediente";
import FirmasExpediente from "./FirmasExpediente";
import BuscarIntervencion from "../components/BuscarIntervencion";
import {
  MODALIDADES,
  expedienteVacio,
  type CampoQueFalta,
  type DatosExpediente,
  type Modalidad,
} from "../types";

type Props = { nuevo?: boolean };

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-slate-800">
      <h2 className="bg-slate-800/70 px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-slate-200">
        {titulo}
      </h2>
      <div className="grid gap-3 p-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Campo({
  etiqueta,
  campo,
  faltan,
  children,
}: {
  etiqueta: string;
  campo?: string;
  faltan: CampoQueFalta[];
  children: React.ReactNode;
}) {
  const falta = campo ? faltan.some((f) => f.campo === campo) : false;
  return (
    <label className="block text-[12px]">
      <span className={`mb-1 block ${falta ? "text-amber-300" : "text-slate-400"}`}>
        {etiqueta}
        {falta && " ⚠"}
      </span>
      {children}
    </label>
  );
}

const CLASE_ENTRADA =
  "w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-[13px] text-slate-100 outline-none focus:ring-2 focus:ring-sky-500";

export default function Expediente({ nuevo }: Props) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { puede, autorrelleno } = useTacografos();

  const [d, setD] = useState<DatosExpediente>(expedienteVacio());
  const [faltan, setFaltan] = useState<CampoQueFalta[]>([]);
  const [estado, setEstado] = useState<string>("borrador");
  const [limite, setLimite] = useState<string | null>(null);
  // Se incrementa al firmar o emitir: es lo que hace que la lista de documentos
  // y la de firmas se vuelvan a pedir sin subir su estado a este componente.
  const [revision, setRevision] = useState(0);
  const [cargando, setCargando] = useState(!nuevo);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (nuevo || !id) return;
    void (async () => {
      try {
        const { expediente } = await api.obtenerExpediente(id);
        const { camposQueFaltan, fechaLimiteDestruccion, estado: est, ...datos } = expediente;
        setD(datos);
        setFaltan(camposQueFaltan);
        setLimite(fechaLimiteDestruccion);
        setEstado(est);
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se ha podido cargar el expediente");
      } finally {
        setCargando(false);
      }
    })();
  }, [id, nuevo]);

  function set<K extends keyof DatosExpediente>(k: K, v: DatosExpediente[K]) {
    setD((x) => ({ ...x, [k]: v }));
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const r = nuevo ? await api.crearExpediente(d) : await api.actualizarExpediente(id!, d);
      setFaltan(r.expediente.camposQueFaltan);
      setLimite(r.expediente.fechaLimiteDestruccion);
      if (nuevo) navigate(`/tacografos/expedientes/${r.expediente.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido guardar");
    } finally {
      setGuardando(false);
    }
  }

  /**
   * Da por entregado el certificado. Exige nombre y DNI de quien lo recibe:
   * sin eso el acuse no acredita nada.
   */
  async function entregar() {
    if (!id) return;
    const hoy = new Date().toISOString().slice(0, 10);
    const fechaEntrega = prompt("Fecha de entrega (aaaa-mm-dd):", d.fechaEntrega ?? hoy)?.trim();
    if (!fechaEntrega) return;
    const receptorNombre = prompt("Nombre de quien recibe:", d.receptorNombre)?.trim();
    if (!receptorNombre) return;
    const receptorDni = prompt("DNI de quien recibe:", d.receptorDni)?.trim();
    if (!receptorDni) return;
    setError(null);
    try {
      const r = await api.registrarEntrega(id, { fechaEntrega, receptorNombre, receptorDni });
      const { camposQueFaltan, fechaLimiteDestruccion, estado: est, ...datos } = r.expediente;
      setD(datos);
      setFaltan(camposQueFaltan);
      setLimite(fechaLimiteDestruccion);
      setEstado(est);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido registrar la entrega");
    }
  }

  async function anular() {
    if (!id) return;
    // Se pregunta porque no tiene vuelta: un expediente anulado ya no se edita,
    // se emite otro. Es documentación legal.
    if (!confirm("¿Anular este expediente? No podrá volver a editarse.")) return;
    try {
      const r = await api.anularExpediente(id);
      setEstado(r.expediente.estado);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido anular");
    }
  }

  if (cargando) return <p className="text-[13px] text-slate-400">Cargando…</p>;

  const anulado = estado === "anulado";
  const editable = !anulado && puede(nuevo ? "tacografos.expediente.create" : "tacografos.expediente.edit");
  const esTransferencia = d.tipo === "transferencia";

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => navigate("/tacografos/expedientes")}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-slate-300 hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" /> Expedientes
        </button>
        <h1 className="mr-auto text-lg font-bold">
          {nuevo ? "Nuevo expediente" : d.numInforme || "Expediente"}
        </h1>
        {!nuevo && puede("tacografos.expediente.annul") && !anulado && (
          <button
            onClick={() => void anular()}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-2 text-[13px] text-red-300 hover:bg-red-500/10"
          >
            <Ban className="h-4 w-4" /> Anular
          </button>
        )}
        {!nuevo && id && (
          <a
            href={api.urlExportar(id)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2 text-[13px] text-slate-300 hover:bg-slate-800"
          >
            <FileSpreadsheet className="h-4 w-4" /> Exportar
          </a>
        )}
        {!nuevo && puede("tacografos.entrega.register") && estado === "emitido" && (
          <button
            onClick={() => void entregar()}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/50 px-3 py-2 text-[13px] text-emerald-300 hover:bg-emerald-500/10"
          >
            <PackageCheck className="h-4 w-4" /> Registrar entrega
          </button>
        )}
        {editable && (
          <button
            onClick={() => void guardar()}
            disabled={guardando}
            className="flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {guardando ? "Guardando…" : "Guardar"}
          </button>
        )}
      </div>

      {d.intervencionId && (
        <p className="mb-3 rounded-lg border border-slate-700 bg-slate-800/50 p-2 text-[12px] text-slate-400">
          Enlazado con una intervención de taller.
        </p>
      )}
      {estado === "entregado" && (
        <p className="mb-3 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-[13px] text-emerald-200">
          Certificado entregado a {d.receptorNombre} ({d.receptorDni}) el{" "}
          {(d.fechaEntrega ?? "").split("-").reverse().join("/")}.
        </p>
      )}
      {anulado && (
        <p className="mb-3 rounded-lg border border-slate-600 bg-slate-800/60 p-3 text-[13px] text-slate-300">
          Expediente anulado. Ya no puede editarse: si hay que corregir algo, se emite uno nuevo.
        </p>
      )}
      {error && (
        <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-[13px] text-red-200">
          {error}
        </p>
      )}
      {faltan.length > 0 && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Faltan {faltan.length} campo(s) obligatorio(s): {faltan.map((f) => f.etiqueta).join(", ")}.
            El expediente se guarda igual, pero no podrá emitir documentos hasta completarlo.
          </span>
        </p>
      )}

      {nuevo && autorrelleno && (
        <BuscarIntervencion
          onElegir={(s) =>
            setD((x) => ({
              ...x,
              empresaCliente: s.empresaCliente || x.empresaCliente,
              matricula: s.matricula || x.matricula,
              bastidor: s.bastidor || x.bastidor,
              fechaInforme: s.fecha ?? x.fechaInforme,
              tecnico: s.tecnico || x.tecnico,
              intervencionId: s.intervencionId,
            }))
          }
        />
      )}

      <fieldset disabled={!editable} className="contents">
        <Seccion titulo="Cliente / empresa de transportes">
          <Campo etiqueta="Empresa" campo="empresaCliente" faltan={faltan}>
            <input className={CLASE_ENTRADA} value={d.empresaCliente}
              onChange={(e) => set("empresaCliente", e.target.value)} />
          </Campo>
          <Campo etiqueta="Nombre de quien autoriza" campo="autorizaNombre" faltan={faltan}>
            <input className={CLASE_ENTRADA} value={d.autorizaNombre}
              onChange={(e) => set("autorizaNombre", e.target.value)} />
          </Campo>
          <Campo etiqueta="DNI / NIF de quien autoriza" campo="autorizaNif" faltan={faltan}>
            <input className={CLASE_ENTRADA} value={d.autorizaNif}
              onChange={(e) => set("autorizaNif", e.target.value)} />
          </Campo>
          <Campo etiqueta="Documento de titularidad aportado" faltan={faltan}>
            <select className={CLASE_ENTRADA} value={d.docTitularidad ? "si" : "no"}
              onChange={(e) => set("docTitularidad", e.target.value === "si")}>
              <option value="si">Sí</option>
              <option value="no">No</option>
            </select>
          </Campo>
        </Seccion>

        <Seccion titulo="Vehículo">
          <Campo etiqueta="Matrícula" campo="matricula" faltan={faltan}>
            <input className={`${CLASE_ENTRADA} uppercase`} value={d.matricula}
              onChange={(e) => set("matricula", e.target.value)} />
          </Campo>
          <Campo etiqueta="Nº de bastidor" faltan={faltan}>
            <input className={CLASE_ENTRADA} value={d.bastidor}
              onChange={(e) => set("bastidor", e.target.value)} />
          </Campo>
        </Seccion>

        <Seccion titulo="Tacógrafo sustituido">
          <Campo etiqueta="Marca / fabricante" campo="tacMarca" faltan={faltan}>
            <input className={CLASE_ENTRADA} value={d.tacMarca}
              onChange={(e) => set("tacMarca", e.target.value)} />
          </Campo>
          <Campo etiqueta="Modelo de la unidad" campo="tacModelo" faltan={faltan}>
            <input className={CLASE_ENTRADA} value={d.tacModelo}
              onChange={(e) => set("tacModelo", e.target.value)} />
          </Campo>
          <Campo etiqueta="Nº de serie" campo="tacSerie" faltan={faltan}>
            <input className={CLASE_ENTRADA} value={d.tacSerie}
              onChange={(e) => set("tacSerie", e.target.value)} />
          </Campo>
        </Seccion>

        <Seccion titulo="Intervención">
          <Campo etiqueta="Nº informe / certificado (lo asigna la extranet)" campo="numInforme" faltan={faltan}>
            <input className={CLASE_ENTRADA} value={d.numInforme}
              onChange={(e) => set("numInforme", e.target.value)} />
          </Campo>
          <Campo etiqueta="Tipo de operación" campo="tipo" faltan={faltan}>
            <select className={CLASE_ENTRADA} value={d.tipo}
              onChange={(e) => set("tipo", e.target.value as DatosExpediente["tipo"])}>
              <option value="transferencia">Transferencia correcta</option>
              <option value="intransferibilidad">Intransferibilidad</option>
            </select>
          </Campo>
          <Campo etiqueta="Fecha informe" campo="fechaInforme" faltan={faltan}>
            <input type="date" className={CLASE_ENTRADA} value={d.fechaInforme ?? ""}
              onChange={(e) => set("fechaInforme", e.target.value || null)} />
          </Campo>
          <Campo etiqueta="Técnico que interviene" campo="tecnico" faltan={faltan}>
            <input className={CLASE_ENTRADA} value={d.tecnico}
              onChange={(e) => set("tecnico", e.target.value)} />
          </Campo>
        </Seccion>

        {esTransferencia ? (
          <Seccion titulo="Transferencia y entrega de los datos">
            <Campo etiqueta="Fecha de transferencia" campo="fechaTransferencia" faltan={faltan}>
              <input type="date" className={CLASE_ENTRADA} value={d.fechaTransferencia ?? ""}
                onChange={(e) => set("fechaTransferencia", e.target.value || null)} />
            </Campo>
            <Campo etiqueta="Fecha de envío" faltan={faltan}>
              <input type="date" className={CLASE_ENTRADA} value={d.fechaEnvio ?? ""}
                onChange={(e) => set("fechaEnvio", e.target.value || null)} />
            </Campo>
            <Campo etiqueta="Modalidad de entrega" campo="modalidadEntrega" faltan={faltan}>
              <select className={CLASE_ENTRADA} value={d.modalidadEntrega ?? ""}
                onChange={(e) => set("modalidadEntrega", (e.target.value || null) as Modalidad | null)}>
                <option value="">— Elegir —</option>
                {MODALIDADES.map((m) => (
                  <option key={m.valor} value={m.valor}>{m.etiqueta}</option>
                ))}
              </select>
            </Campo>
            {limite && (
              <p className="col-span-full text-[12px] text-slate-400">
                Archivos en custodia: destruir a partir del {limite.split("-").reverse().join("/")}
                {" "}(nota F del anexo II del Real decreto 125/2017).
              </p>
            )}
          </Seccion>
        ) : (
          <>
            <Seccion titulo="Persona que recibe el certificado">
              <Campo etiqueta="Nombre de la persona receptora" campo="receptorNombre" faltan={faltan}>
                <input className={CLASE_ENTRADA} value={d.receptorNombre}
                  onChange={(e) => set("receptorNombre", e.target.value)} />
              </Campo>
              <Campo etiqueta="DNI de la persona receptora" campo="receptorDni" faltan={faltan}>
                <input className={CLASE_ENTRADA} value={d.receptorDni}
                  onChange={(e) => set("receptorDni", e.target.value)} />
              </Campo>
              <Campo etiqueta="Fecha entrega al cliente" campo="fechaEntrega" faltan={faltan}>
                <input type="date" className={CLASE_ENTRADA} value={d.fechaEntrega ?? ""}
                  onChange={(e) => set("fechaEntrega", e.target.value || null)} />
              </Campo>
            </Seccion>

            <Seccion titulo="Tacógrafo averiado">
              <Campo etiqueta="Se entrega al cliente" faltan={faltan}>
                <select className={CLASE_ENTRADA} value={d.entregaAparato ? "si" : "no"}
                  onChange={(e) => set("entregaAparato", e.target.value === "si")}>
                  <option value="si">Sí</option>
                  <option value="no">No</option>
                </select>
              </Campo>
              {/*
                No es un campo: es lo contrario del anterior, igual que en el
                libro original. Se enseña para que se vea, no para elegirlo.
              */}
              <Campo etiqueta="Se achatarrará (excluyente)" faltan={faltan}>
                <input readOnly className={`${CLASE_ENTRADA} opacity-60`}
                  value={d.entregaAparato ? "No" : "Sí"} />
              </Campo>
            </Seccion>
          </>
        )}
      </fieldset>

      {/*
        Sólo con expediente guardado: emitir un documento de algo que todavía no
        existe en la base no tendría a qué apuntar.
      */}
      {!nuevo && id && (
        <>
          <FirmasExpediente
            key={`firmas-${revision}`}
            expedienteId={id}
            tipo={d.tipo}
            nombres={{
              autoriza: d.autorizaNombre,
              receptor: d.receptorNombre,
              tecnico: d.tecnico,
            }}
            onCambio={() => setRevision((v) => v + 1)}
          />
          <DocumentosExpediente
            key={`docs-${revision}`}
            expedienteId={id}
            onCambio={() => setRevision((v) => v + 1)}
          />
        </>
      )}
    </div>
  );
}
