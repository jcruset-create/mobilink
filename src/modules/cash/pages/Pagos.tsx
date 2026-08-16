/**
 * Pagos y salidas de efectivo.
 *
 * Misma filosofía que el cobro: no basta con "pago 127 €", hay que decir qué
 * sale físicamente del cajón. El sistema propone una composición con lo que
 * hay, pero el operador confirma o corrige, porque lo que se guarda tiene que
 * ser lo que realmente entregó.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import DenominationGrid, {
  type CantidadesPorValor,
  cantidadesDesde,
  lineasDesde,
} from "../components/DenominationGrid";
import {
  Aviso,
  AvisoCartuchos,
  BotonAccion,
  Cabecera,
  ErrorBox,
  OrigenBadge,
  inputCls,
} from "../components/ui";
import { BuscadorDocumentos } from "./Cobros";
import { euros, aCentimos, totalLineas } from "../utils/money";
import { esFallo } from "../utils/result";
import PaymentMethodPicker from "../components/PaymentMethodPicker";
import Justificantes from "../components/Justificantes";
import { type AperturaCartucho, type DocumentoExterno } from "../types";
import * as api from "../services/api";

export default function Pagos() {
  const { jornada, denominaciones, disponible, refrescar, erp, puede, formasParaPagos } = useCash();

  const [documento, setDocumento] = useState<DocumentoExterno | null>(null);
  const [importeTexto, setImporteTexto] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [concepto, setConcepto] = useState("");
  const [referencia, setReferencia] = useState("");
  const [forma, setForma] = useState<string>("");

  const [entregado, setEntregado] = useState<CantidadesPorValor>({});
  /** Lo que devuelve el proveedor cuando se paga con un billete de más. */
  const [vuelta, setVuelta] = useState<CantidadesPorValor>({});
  const [tocadoAMano, setTocadoAMano] = useState(false);
  const [avisoComposicion, setAvisoComposicion] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [ultimo, setUltimo] = useState<{ operacionId: number; numero: string } | null>(null);
  const [aperturas, setAperturas] = useState<AperturaCartucho[]>([]);

  const importe = aCentimos(importeTexto) ?? 0;

  const formaEfectivo = useMemo(
    () => formasParaPagos.find((f) => f.afectaEfectivo) ?? null,
    [formasParaPagos]
  );

  // Los pagos a proveedor de este mostrador son en efectivo, así que se
  // preselecciona. Las demás formas siguen disponibles: un pago por
  // transferencia se registra igual, solo que sin tocar el cajón.
  useEffect(() => {
    if (forma || formasParaPagos.length === 0) return;
    setForma(formaEfectivo?.codigo ?? formasParaPagos[0].codigo);
  }, [forma, formaEfectivo, formasParaPagos]);

  const formaElegida = useMemo(
    () => formasParaPagos.find((f) => f.codigo === forma) ?? null,
    [formasParaPagos, forma]
  );
  const esEfectivo = Boolean(formaElegida?.afectaEfectivo);
  const faltaReferencia = Boolean(formaElegida?.pideReferencia) && !referencia.trim();
  const totalEntregado = totalLineas(lineasDesde(entregado));
  const totalVuelta = totalLineas(lineasDesde(vuelta));
  /**
   * Lo que de verdad sale de la caja. Pagar 19,50 € con un billete de 20 € y
   * recibir 0,50 € de vuelta son DOS movimientos —sale el billete, entra la
   * moneda— y el pago es la diferencia. Registrarlo como "salen 19,50 €" sería
   * mentir sobre las piezas, que es justo lo que este módulo no puede hacer.
   */
  const netoSalida = totalEntregado - totalVuelta;

  /**
   * Propuesta de qué sacar. Se pide al mismo endpoint que el cambio porque el
   * problema es el mismo: componer un importe exacto con las piezas que hay.
   */
  const proponer = useCallback(async () => {
    if (!jornada || !esEfectivo || importe <= 0) return;
    try {
      const r = await api.proponerCambio(jornada.sesion.id, importe);
      if (esFallo(r)) {
        setEntregado({});
        setAperturas([]);
        setAvisoComposicion(r.mensaje);
      } else {
        setEntregado(cantidadesDesde(r.lineas));
        setVuelta({});
        setAperturas(r.aperturas ?? []);
        setAvisoComposicion("");
      }
    } catch (e) {
      setAvisoComposicion(e instanceof Error ? e.message : "No se ha podido proponer la composición");
    }
  }, [jornada, esEfectivo, importe]);

  useEffect(() => {
    if (!tocadoAMano) void proponer();
  }, [proponer, tocadoAMano]);

  if (!jornada) {
    return <Aviso tono="aviso">No hay ninguna jornada abierta. Ábrela desde «Jornada actual».</Aviso>;
  }

  function limpiar() {
    setDocumento(null);
    setImporteTexto("");
    setProveedor("");
    setConcepto("");
    setReferencia("");
    setEntregado({});
    setVuelta({});
    setTocadoAMano(false);
    setAvisoComposicion("");
  }

  function elegirDocumento(d: DocumentoExterno) {
    setDocumento(d);
    setImporteTexto(String(Number(d.pendiente_centimos) / 100).replace(".", ","));
    setProveedor(d.party_nombre);
    setConcepto(d.numero);
    setReferencia(d.external_reference ?? d.external_id);
    setTocadoAMano(false);
  }

  const puedeConfirmar =
    importe > 0 &&
    Boolean(forma) &&
    !faltaReferencia &&
    (!esEfectivo || netoSalida === importe) &&
    !guardando;

  async function confirmar() {
    setGuardando(true);
    setError("");
    try {
      const r = await api.registrarPago({
        sessionId: jornada!.sesion.id,
        importeCentimos: importe,
        formasPago: [{ forma, importe, referencia: referencia.trim() || null }],
        efectivoEntregado: esEfectivo ? lineasDesde(entregado) : [],
        efectivoRecibido: esEfectivo ? lineasDesde(vuelta) : [],
        partyNombre: proveedor,
        concepto,
        referencia: referencia || null,
        documentoId: documento?.id ?? null,
        externalSystem: documento?.external_system ?? null,
        externalDocumentId: documento?.external_id ?? null,
      });
      setUltimo({ operacionId: r.operacionId, numero: r.numero });
      limpiar();
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido registrar el pago");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <Cabecera titulo="Pagos" descripcion="Facturas de proveedor de la ERP y pagos manuales." />

      {ultimo && (
        <>
          <Aviso tono="bien">
            Pago <strong>{ultimo.numero}</strong> registrado.
          </Aviso>
          {/* La factura del proveedor se escanea y se cuelga aquí mismo. */}
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Justificante de {ultimo.numero}
            </div>
            <Justificantes
              operationId={ultimo.operacionId}
              puedeAdjuntar={puede("cash.document.attach")}
            />
          </div>
        </>
      )}
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-3">
          <BuscadorDocumentos tipo="PAYABLE" onElegir={elegirDocumento} erpActiva={erp?.estado === "CONECTADA"} />

          <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                {documento ? "Pago de factura" : "Pago manual"}
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
                  Quitar la factura y pagar a mano
                </button>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Importe</span>
                <input
                  value={importeTexto}
                  onChange={(e) => {
                    setImporteTexto(e.target.value);
                    setTocadoAMano(false);
                  }}
                  inputMode="decimal"
                  placeholder="127,00"
                  className={`${inputCls} text-lg font-bold tabular-nums`}
                />
              </label>
              <div className="sm:col-span-2">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Forma de pago</span>
                <PaymentMethodPicker
                  formas={formasParaPagos}
                  valor={forma}
                  onChange={(v) => {
                    setForma(v);
                    setEntregado({});
                    setVuelta({});
                    setTocadoAMano(false);
                  }}
                  permitirMixto={false}
                  deshabilitado={guardando}
                />
              </div>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Proveedor</span>
                <input value={proveedor} onChange={(e) => setProveedor(e.target.value)} className={inputCls} placeholder="Proveedor XYZ" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Referencia</span>
                <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={inputCls} />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Concepto</span>
                <input value={concepto} onChange={(e) => setConcepto(e.target.value)} className={inputCls} placeholder="Compra urgente de material" />
              </label>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          {esEfectivo ? (
            <>
              {avisoComposicion && <Aviso tono="mal">{avisoComposicion}</Aviso>}
              <AvisoCartuchos aperturas={aperturas} />
              <DenominationGrid
                titulo="Efectivo que sale de la caja"
                denominaciones={denominaciones}
                cantidades={entregado}
                onChange={(c) => {
                  setEntregado(c);
                  setTocadoAMano(true);
                }}
                disponible={disponible}
                mostrarDisponible
                objetivoCentimos={importe > 0 ? importe : null}
                deshabilitado={guardando}
              />
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    setTocadoAMano(false);
                    void proponer();
                  }}
                  className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-[12px] font-medium text-slate-200 hover:bg-slate-600"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Proponer composición
                </button>
              </div>

              {/* Vuelta del proveedor. No siempre se puede componer el importe
                  exacto con lo que hay: se paga con un billete de más y se
                  recibe el cambio, y las dos cosas se registran. */}
              <DenominationGrid
                titulo="Vuelta que devuelve el proveedor"
                denominaciones={denominaciones}
                cantidades={vuelta}
                onChange={(c) => {
                  setVuelta(c);
                  setTocadoAMano(true);
                }}
                deshabilitado={guardando}
              />

              <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="text-slate-400">Sale de la caja</span>
                  <span className="font-bold tabular-nums text-slate-100">{euros(totalEntregado)}</span>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="text-slate-400">Vuelve del proveedor</span>
                  <span className="font-bold tabular-nums text-slate-100">{euros(totalVuelta)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-700 pt-1">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    Pago neto
                  </span>
                  <span
                    className={`text-2xl font-black tabular-nums ${
                      importe > 0 && netoSalida === importe ? "text-emerald-400" : "text-amber-300"
                    }`}
                  >
                    {euros(netoSalida)}
                  </span>
                </div>
                {importe > 0 && netoSalida !== importe && (
                  <p className="mt-1 text-[12px] text-amber-300">
                    Lo que sale menos lo que vuelve son {euros(netoSalida)} y el pago es de{" "}
                    {euros(importe)}.
                  </p>
                )}
              </div>

              <p className="text-[11px] text-slate-500">
                Confirma exactamente las piezas que entregas y las que te devuelven: es lo que
                quedará registrado y lo que moverá el inventario. Si pagas 19,50 € con un billete de
                20 €, salen 20 € y entran 0,50 €.
              </p>
            </>
          ) : (
            <Aviso tono="info">
              Un pago por {formaElegida?.nombre ?? forma} se registra económicamente pero no mueve
              el efectivo de la caja.
            </Aviso>
          )}

          {faltaReferencia && (
            <p className="text-[12px] text-amber-300">
              Falta la referencia de {formaElegida?.nombre}: es lo que luego permite cuadrar con el
              banco.
            </p>
          )}

          <BotonAccion tono="pago" onClick={() => void confirmar()} disabled={!puedeConfirmar}>
            {guardando ? "Registrando…" : `Confirmar pago de ${euros(importe)}`}
          </BotonAccion>

          {!puede("cash.payment.create_manual") && !documento && (
            <Aviso tono="aviso">No tienes permiso para crear pagos manuales, solo para pagar documentos de la ERP.</Aviso>
          )}
        </div>
      </div>
    </div>
  );
}
