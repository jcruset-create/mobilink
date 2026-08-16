/**
 * Cobros.
 *
 * Una sola pantalla para los dos orígenes, que es justo lo que pedía el
 * encargo: se puede partir de una factura de la ERP o crear un cobro manual, y
 * a partir de ahí el flujo es idéntico porque detrás hay un único motor.
 *
 * El corazón es el cálculo del cambio: se registra exactamente lo que entrega
 * el cliente, el sistema propone qué devolver con las piezas que hay, y el
 * operador puede cambiar la propuesta. Nunca se confirma un cambio que no
 * cuadre.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import DenominationGrid, {
  type CantidadesPorValor,
  cantidadesDesde,
  lineasDesde,
} from "../components/DenominationGrid";
import {
  Aviso,
  BotonAccion,
  Cabecera,
  ErrorBox,
  OrigenBadge,
  AvisoCartuchos,
  TableWrap,
  thCls,
  tdCls,
  EmptyRow,
  inputCls,
} from "../components/ui";
import { euros, aCentimos, totalLineas } from "../utils/money";
import { esFallo } from "../utils/result";
import PaymentMethodPicker, { MIXTO } from "../components/PaymentMethodPicker";
import { type AperturaCartucho, type DocumentoExterno } from "../types";
import * as api from "../services/api";

export default function Cobros() {
  const { jornada, denominaciones, disponible, refrescar, erp, puede, formasParaCobros } = useCash();

  const [documento, setDocumento] = useState<DocumentoExterno | null>(null);
  const [importeTexto, setImporteTexto] = useState("");
  const [concepto, setConcepto] = useState("");
  const [cliente, setCliente] = useState("");
  const [referencia, setReferencia] = useState("");

  // Qué botón está pulsado: el código de una forma, o MIXTO. Arranca en
  // efectivo, que es el 90 % de los cobros del mostrador.
  const [modo, setModo] = useState<string>("");
  const [reparto, setReparto] = useState<Record<string, string>>({});
  /** Referencia por forma, para las que la exigen (autorización del TPV…). */
  const [referenciasReparto, setReferenciasReparto] = useState<Record<string, string>>({});
  const [recibido, setRecibido] = useState<CantidadesPorValor>({});
  const [cambioManual, setCambioManual] = useState<CantidadesPorValor | null>(null);

  const [cambioPropuesto, setCambioPropuesto] = useState<CantidadesPorValor>({});
  const [avisoCambio, setAvisoCambio] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [ultimo, setUltimo] = useState<{ numero: string; cambio: number; aperturas: AperturaCartucho[] } | null>(null);
  const [aperturas, setAperturas] = useState<AperturaCartucho[]>([]);

  const importe = aCentimos(importeTexto) ?? 0;

  const formaEfectivo = useMemo(
    () => formasParaCobros.find((f) => f.afectaEfectivo) ?? null,
    [formasParaCobros]
  );

  // El modo por defecto es el efectivo. Si la empresa lo tuviera desactivado
  // —hoy no se puede, pero el catálogo es suyo— se cae a la primera forma.
  useEffect(() => {
    if (modo || formasParaCobros.length === 0) return;
    setModo(formaEfectivo?.codigo ?? formasParaCobros[0].codigo);
  }, [modo, formaEfectivo, formasParaCobros]);

  const esMixto = modo === MIXTO;
  const formaElegida = useMemo(
    () => formasParaCobros.find((f) => f.codigo === modo) ?? null,
    [formasParaCobros, modo]
  );

  // Reparto del cobro mixto: solo las líneas con importe.
  const formasUsadas = useMemo(
    () =>
      Object.entries(reparto)
        .map(([forma, texto]) => ({ forma, importe: aCentimos(texto) ?? 0 }))
        .filter((f) => f.importe > 0),
    [reparto]
  );

  /**
   * Cuánto del cobro es efectivo, que es lo que decide si hay que contar
   * piezas. En modo simple es todo o nada según el botón pulsado; en mixto, la
   * suma de las líneas de la forma que mueve el cajón.
   */
  const efectivo = esMixto
    ? formasUsadas
        .filter((f) => f.forma === formaEfectivo?.codigo)
        .reduce((a, f) => a + f.importe, 0)
    : formaElegida?.afectaEfectivo
      ? importe
      : 0;

  const totalRepartido = esMixto ? formasUsadas.reduce((a, f) => a + f.importe, 0) : importe;

  /** Las líneas que se mandan al servidor, con la referencia de cada forma. */
  const lineasFormasPago = () =>
    esMixto
      ? formasUsadas.map((f) => ({
          forma: f.forma,
          importe: f.importe,
          referencia: referenciasReparto[f.forma]?.trim() || null,
        }))
      : [{ forma: modo, importe, referencia: referencia.trim() || null }];

  /** Formas del reparto a las que les falta la referencia que exigen. */
  const referenciasQueFaltan = esMixto
    ? formasUsadas
        .map((f) => formasParaCobros.find((x) => x.codigo === f.forma))
        .filter((f) => f?.pideReferencia && !referenciasReparto[f.codigo]?.trim())
        .map((f) => f!.nombre)
    : formaElegida?.pideReferencia && !referencia.trim()
      ? [formaElegida.nombre]
      : [];

  const totalRecibido = totalLineas(lineasDesde(recibido));
  const cambioRequerido = Math.max(0, totalRecibido - efectivo);
  const cambioEnUso = cambioManual ?? cambioPropuesto;
  const totalCambio = totalLineas(lineasDesde(cambioEnUso));

  // Existencias con las que se puede componer el cambio: las de la caja MÁS lo
  // que el cliente acaba de entregar. Devolver un billete que acaba de dar es
  // legítimo, y no contarlo dejaría cambios imposibles que en realidad sí lo son.
  const disponibleParaCambio = useMemo(() => {
    const m = { ...disponible };
    for (const l of lineasDesde(recibido)) m[l.valor] = (m[l.valor] ?? 0) + l.cantidad;
    return m;
  }, [disponible, recibido]);

  const pedirPropuesta = useCallback(async () => {
    if (!jornada || cambioRequerido <= 0) {
      setCambioPropuesto({});
      setAperturas([]);
      setAvisoCambio("");
      return;
    }
    try {
      const r = await api.proponerCambio(jornada.sesion.id, cambioRequerido);
      if (esFallo(r)) {
        setCambioPropuesto({});
        setAperturas([]);
        setAvisoCambio(r.mensaje);
      } else {
        setCambioPropuesto(cantidadesDesde(r.lineas));
        setAperturas(r.aperturas ?? []);
        setAvisoCambio("");
      }
    } catch (e) {
      setAvisoCambio(e instanceof Error ? e.message : "No se ha podido calcular el cambio");
    }
  }, [jornada, cambioRequerido]);

  useEffect(() => {
    if (cambioManual === null) void pedirPropuesta();
  }, [pedirPropuesta, cambioManual]);

  if (!jornada) {
    return <Aviso tono="aviso">No hay ninguna jornada abierta. Ábrela desde «Jornada actual».</Aviso>;
  }

  function limpiar() {
    setDocumento(null);
    setImporteTexto("");
    setConcepto("");
    setCliente("");
    setReferencia("");
    setReparto({});
    setReferenciasReparto({});
    setRecibido({});
    setCambioManual(null);
    setCambioPropuesto({});
    setAvisoCambio("");
  }

  function elegirDocumento(d: DocumentoExterno) {
    setDocumento(d);
    setImporteTexto(String(Number(d.pendiente_centimos) / 100).replace(".", ","));
    setCliente(d.party_nombre);
    setConcepto(d.numero);
    setReferencia(d.external_reference ?? d.external_id);
  }

  const puedeConfirmar =
    importe > 0 &&
    Boolean(modo) &&
    totalRepartido === importe &&
    referenciasQueFaltan.length === 0 &&
    (efectivo === 0 || totalRecibido >= efectivo) &&
    (cambioRequerido === 0 || totalCambio === cambioRequerido) &&
    !guardando;

  async function confirmar() {
    setGuardando(true);
    setError("");
    try {
      const r = await api.registrarCobro({
        sessionId: jornada!.sesion.id,
        importeCentimos: importe,
        formasPago: lineasFormasPago(),
        efectivoRecibido: efectivo > 0 ? lineasDesde(recibido) : [],
        // Se manda siempre la composición que el operador tiene delante, sea la
        // propuesta o la que ha retocado: es la que ha contado con la mano.
        cambioManual: cambioRequerido > 0 ? lineasDesde(cambioEnUso) : undefined,
        partyNombre: cliente,
        concepto,
        referencia: referencia || null,
        documentoId: documento?.id ?? null,
        externalSystem: documento?.external_system ?? null,
        externalDocumentId: documento?.external_id ?? null,
        externalDocumentReference: documento?.external_reference ?? null,
      });
      setUltimo({ numero: r.numero, cambio: cambioRequerido, aperturas: r.aperturas ?? [] });
      limpiar();
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido registrar el cobro");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <Cabecera titulo="Cobros" descripcion="Facturas de la ERP y cobros manuales, con el mismo motor de caja." />

      {ultimo && (
        <>
          <Aviso tono="bien">
            Cobro <strong>{ultimo.numero}</strong> registrado.
            {ultimo.cambio > 0 && <> Cambio entregado: <strong>{euros(ultimo.cambio)}</strong>.</>}
          </Aviso>
          <AvisoCartuchos aperturas={ultimo.aperturas} />
        </>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <BuscadorDocumentos tipo="RECEIVABLE" onElegir={elegirDocumento} erpActiva={erp?.estado === "CONECTADA"} />

          <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {documento ? "Cobro de factura" : "Cobro manual"}
              </span>
              {documento && <OrigenBadge origen="ERP" />}
            </div>

            {documento && (
              <div className="mb-2 rounded-lg bg-slate-900/60 p-2 text-sm">
                <div className="font-bold text-slate-100">{documento.party_nombre}</div>
                <div className="text-slate-400">
                  {documento.numero} · pendiente {euros(Number(documento.pendiente_centimos))}
                </div>
                <button onClick={limpiar} className="mt-1 text-[11px] text-sky-400 hover:underline">
                  Quitar la factura y cobrar a mano
                </button>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Importe a cobrar</span>
                <input
                  value={importeTexto}
                  onChange={(e) => setImporteTexto(e.target.value)}
                  inputMode="decimal"
                  placeholder="187,00"
                  className={`${inputCls} text-lg font-bold tabular-nums`}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Cliente</span>
                <input value={cliente} onChange={(e) => setCliente(e.target.value)} className={inputCls} placeholder="Nombre o texto libre" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Concepto</span>
                <input value={concepto} onChange={(e) => setConcepto(e.target.value)} className={inputCls} placeholder="Venta mostrador" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Referencia</span>
                <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={inputCls} placeholder="T-1234" />
              </label>
            </div>

            {/* Cómo paga el cliente. Es lo que decide qué se abre debajo. */}
            <div className="mt-3">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                Forma de cobro
              </span>
              <PaymentMethodPicker
                formas={formasParaCobros}
                valor={modo}
                onChange={(v) => {
                  setModo(v);
                  // Cambiar de forma vacía lo que se hubiera contado o repartido
                  // del modo anterior: dejarlo colgando sería lo que acabaría en
                  // un cobro con piezas de una tarjeta.
                  setReparto({});
                  setReferenciasReparto({});
                  setRecibido({});
                  setCambioManual(null);
                  setCambioPropuesto({});
                }}
                deshabilitado={guardando}
              />
            </div>

            {esMixto && (
              <div className="mt-2 rounded-lg bg-slate-900/40 p-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Reparto entre formas
                </span>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {formasParaCobros.map((f) => (
                    <div key={f.codigo} className="space-y-1">
                      <label className="block">
                        <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                          {f.nombre}
                        </span>
                        <input
                          value={reparto[f.codigo] ?? ""}
                          onChange={(e) => setReparto({ ...reparto, [f.codigo]: e.target.value })}
                          inputMode="decimal"
                          placeholder="0,00"
                          className={`${inputCls} tabular-nums`}
                        />
                      </label>
                      {/* La referencia solo aparece cuando esa forma se usa: sin
                          importe, pedirla sería ruido. */}
                      {f.pideReferencia && (aCentimos(reparto[f.codigo] ?? "") ?? 0) > 0 && (
                        <input
                          value={referenciasReparto[f.codigo] ?? ""}
                          onChange={(e) =>
                            setReferenciasReparto({
                              ...referenciasReparto,
                              [f.codigo]: e.target.value,
                            })
                          }
                          placeholder={`Referencia de ${f.nombre}`}
                          className={inputCls}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div
                  className={`mt-2 text-[12px] ${
                    totalRepartido === importe ? "text-emerald-300" : "text-amber-300"
                  }`}
                >
                  Repartido {euros(totalRepartido)} de {euros(importe)}
                  {efectivo > 0 && <> · en efectivo {euros(efectivo)}</>}
                </div>
              </div>
            )}

            {referenciasQueFaltan.length > 0 && (
              <p className="mt-2 text-[12px] text-amber-300">
                Falta la referencia de {referenciasQueFaltan.join(", ")}: es lo que luego permite
                cuadrar con el banco.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {efectivo > 0 && (
            <>
              <DenominationGrid
                titulo="Dinero recibido del cliente"
                denominaciones={denominaciones}
                cantidades={recibido}
                onChange={(c) => {
                  setRecibido(c);
                  setCambioManual(null); // vuelve a proponerse el cambio
                }}
                deshabilitado={guardando}
              />

              <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="text-slate-400">Entregado</span>
                  <span className="font-bold tabular-nums text-slate-100">{euros(totalRecibido)}</span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="text-slate-400">A cobrar en efectivo</span>
                  <span className="font-bold tabular-nums text-slate-100">{euros(efectivo)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-700 pt-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Cambio</span>
                  <span className="text-2xl font-black tabular-nums text-sky-300">{euros(cambioRequerido)}</span>
                </div>
              </div>
            </>
          )}

          {cambioRequerido > 0 && (
            <>
              {avisoCambio && <Aviso tono="mal">{avisoCambio}</Aviso>}
              <AvisoCartuchos aperturas={aperturas} />
              <DenominationGrid
                titulo={cambioManual ? "Cambio (modificado a mano)" : "Cambio propuesto"}
                denominaciones={denominaciones}
                cantidades={cambioEnUso}
                onChange={setCambioManual}
                disponible={disponibleParaCambio}
                mostrarDisponible
                objetivoCentimos={cambioRequerido}
                deshabilitado={guardando}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setCambioManual(null);
                    void pedirPropuesta();
                  }}
                  className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-600"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Volver a la propuesta
                </button>
                {totalCambio !== cambioRequerido && (
                  <span className="self-center text-[12px] text-amber-300">
                    El cambio indicado suma {euros(totalCambio)} y tienen que ser {euros(cambioRequerido)}.
                  </span>
                )}
              </div>
            </>
          )}

          <BotonAccion tono="cobro" onClick={() => void confirmar()} disabled={!puedeConfirmar}>
            {guardando ? "Registrando…" : `Confirmar cobro de ${euros(importe)}`}
          </BotonAccion>

          {!puede("cash.collection.create_manual") && !documento && (
            <Aviso tono="aviso">No tienes permiso para crear cobros manuales, solo para cobrar facturas de la ERP.</Aviso>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Buscador de documentos pendientes. Si no hay ERP conectada no estorba: se
 * queda plegado y el cobro manual sigue siendo el camino normal.
 */
export function BuscadorDocumentos({
  tipo,
  onElegir,
  erpActiva,
}: {
  tipo: "RECEIVABLE" | "PAYABLE";
  onElegir: (d: DocumentoExterno) => void;
  erpActiva: boolean;
}) {
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<DocumentoExterno[]>([]);
  const [cargando, setCargando] = useState(false);

  const buscar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api.documentos(tipo, q);
      setDocs(r.documentos);
    } catch {
      setDocs([]);
    } finally {
      setCargando(false);
    }
  }, [tipo, q]);

  useEffect(() => {
    void buscar();
    // Solo al montar: después se busca al pulsar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Documentos pendientes de la ERP
        </span>
        {!erpActiva && <span className="text-[10px] text-slate-500">ERP no conectada</span>}
      </div>

      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void buscar()}
          placeholder="Nº de factura, cliente o referencia"
          className={inputCls}
        />
        <button
          onClick={() => void buscar()}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-700 px-3 text-[12px] font-medium text-slate-200 hover:bg-slate-600"
        >
          <Search className="h-4 w-4" /> Buscar
        </button>
      </div>

      <div className="mt-2 max-h-56 overflow-y-auto">
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Documento</th>
              <th className={thCls}>{tipo === "RECEIVABLE" ? "Cliente" : "Proveedor"}</th>
              <th className={`${thCls} text-right`}>Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <EmptyRow
                cols={3}
                text={cargando ? "Buscando…" : "No hay documentos pendientes. Puedes registrar la operación a mano."}
              />
            )}
            {docs.map((d) => (
              <tr key={d.id} onClick={() => onElegir(d)} className="cursor-pointer border-t border-slate-700 hover:bg-slate-700/40">
                <td className={tdCls}>
                  <div className="font-medium text-slate-100">{d.numero}</div>
                  <div className="text-[10px] text-slate-500">{d.external_system}</div>
                </td>
                <td className={tdCls}>{d.party_nombre}</td>
                <td className={`${tdCls} text-right font-bold tabular-nums`}>
                  {euros(Number(d.pendiente_centimos))}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </div>
    </div>
  );
}
