/**
 * Pagos y salidas de efectivo.
 *
 * Misma filosofía que el cobro: no basta con "pago 127 €", hay que decir qué
 * sale físicamente del cajón. El sistema propone una composición con lo que
 * hay, pero el operador confirma o corrige, porque lo que se guarda tiene que
 * ser lo que realmente entregó.
 */

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import DenominationGrid, {
  type CantidadesPorValor,
  cantidadesDesde,
  lineasDesde,
} from "../components/DenominationGrid";
import { Aviso, BotonAccion, Cabecera, ErrorBox, OrigenBadge, inputCls } from "../components/ui";
import { BuscadorDocumentos } from "./Cobros";
import { euros, aCentimos, totalLineas } from "../utils/money";
import { esFallo } from "../utils/result";
import { ETIQUETA_FORMA_PAGO, type DocumentoExterno, type FormaPago } from "../types";
import * as api from "../services/api";

const FORMAS: FormaPago[] = ["CASH", "BANK_TRANSFER", "BBVA_CARD", "CAIXABANK_CARD", "OTHER"];

export default function Pagos() {
  const { jornada, denominaciones, disponible, refrescar, erp, puede } = useCash();

  const [documento, setDocumento] = useState<DocumentoExterno | null>(null);
  const [importeTexto, setImporteTexto] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [concepto, setConcepto] = useState("");
  const [referencia, setReferencia] = useState("");
  const [forma, setForma] = useState<FormaPago>("CASH");

  const [entregado, setEntregado] = useState<CantidadesPorValor>({});
  const [tocadoAMano, setTocadoAMano] = useState(false);
  const [avisoComposicion, setAvisoComposicion] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [ultimo, setUltimo] = useState<string | null>(null);

  const importe = aCentimos(importeTexto) ?? 0;
  const esEfectivo = forma === "CASH";
  const totalEntregado = totalLineas(lineasDesde(entregado));

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
        setAvisoComposicion(r.mensaje);
      } else {
        setEntregado(cantidadesDesde(r.lineas));
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
    importe > 0 && (!esEfectivo || totalEntregado === importe) && !guardando;

  async function confirmar() {
    setGuardando(true);
    setError("");
    try {
      const r = await api.registrarPago({
        sessionId: jornada!.sesion.id,
        importeCentimos: importe,
        formasPago: [{ forma, importe }],
        efectivoEntregado: esEfectivo ? lineasDesde(entregado) : [],
        partyNombre: proveedor,
        concepto,
        referencia: referencia || null,
        documentoId: documento?.id ?? null,
        externalSystem: documento?.external_system ?? null,
        externalDocumentId: documento?.external_id ?? null,
      });
      setUltimo(r.numero);
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

      {ultimo && <Aviso tono="bien">Pago <strong>{ultimo}</strong> registrado.</Aviso>}
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
              <label className="block">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">Forma de pago</span>
                <select value={forma} onChange={(e) => setForma(e.target.value as FormaPago)} className={inputCls}>
                  {FORMAS.map((f) => (
                    <option key={f} value={f}>
                      {ETIQUETA_FORMA_PAGO[f]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] fontetsemibold uppercase text-slate-400">Proveedor</span>
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
                {importe > 0 && totalEntregado !== importe && (
                  <span className="self-center text-[12px] text-amber-300">
                    Las piezas suman {euros(totalEntregado)} y el pago es de {euros(importe)}.
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Confirma exactamente las piezas que entregas: es lo que quedará registrado y lo que
                se descontará del inventario.
              </p>
            </>
          ) : (
            <Aviso tono="info">
              Un pago por {ETIQUETA_FORMA_PAGO[forma]} se registra económicamente pero no mueve el
              efectivo de la caja.
            </Aviso>
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
