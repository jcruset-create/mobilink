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
import EscanerFactura from "../components/EscanerFactura";
import BandejaAutoScan from "../components/BandejaAutoScan";
import {
  type AperturaCartucho,
  type ConceptoGasto,
  type DestinoGasto,
  type DocumentoAutoScan,
  type DocumentoExterno,
  type PropuestaEscaneo,
} from "../types";
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
  /** PDF elegido antes de confirmar; se sube en cuanto el pago existe. */
  const [justificante, setJustificante] = useState<File | null>(null);
  /** Excluyente con el anterior: o lo trae el escáner o lo adjunta alguien. */
  const [inboxId, setInboxId] = useState<number | null>(null);
  const [aperturas, setAperturas] = useState<AperturaCartucho[]>([]);

  /*
   * Lo que ha leído el escáner, y qué ha tocado la persona después.
   *
   * `tocados` es lo que impide que un segundo escaneo pise un campo corregido
   * a mano: se vacía justo al aplicar una propuesta, así que lo escrito a
   * partir de ahí queda marcado como decisión de la persona.
   */
  const [escaneo, setEscaneo] = useState<PropuestaEscaneo | null>(null);
  const [tocados, setTocados] = useState<Set<string>>(new Set());
  const marcarTocado = (campo: string) =>
    setTocados((t) => (t.has(campo) ? t : new Set(t).add(campo)));

  /** Clasificación del gasto. Los dos opcionales: no bloquean el pago. */
  const [conceptos, setConceptos] = useState<ConceptoGasto[]>([]);
  const [destinos, setDestinos] = useState<DestinoGasto[]>([]);
  const [conceptoId, setConceptoId] = useState<number | "">("");
  const [destinoId, setDestinoId] = useState<number | "">("");

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

  /*
   * El catálogo se pide UNA vez al entrar. Los desplegables tienen que estar
   * llenos antes de que alguien elija concepto, porque el segundo depende del
   * primero y pedirlo entonces metería una espera en mitad del gesto.
   */
  useEffect(() => {
    void api
      .conceptosDeGasto()
      .then((r) => {
        setConceptos(r.conceptos.filter((c) => c.activo));
        setDestinos(r.destinos.filter((d) => d.activo));
      })
      /*
       * En silencio: que el catálogo no cargue no puede impedir pagar. Se queda
       * sin clasificar, que es exactamente lo que pasa hoy con todos los pagos.
       */
      .catch(() => {});
  }, []);

  const conceptoElegido = useMemo(
    () => conceptos.find((c) => c.id === conceptoId) ?? null,
    [conceptos, conceptoId]
  );

  /** Los destinos que pide ESTE concepto. Vacío = no sale el desplegable. */
  const destinosDelConcepto = useMemo(() => {
    if (!conceptoElegido || conceptoElegido.tipoDestino === "NINGUNO") return [];
    return destinos.filter((d) => d.tipo === conceptoElegido.tipoDestino);
  }, [conceptoElegido, destinos]);

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
    setJustificante(null);
    setInboxId(null);
    setEscaneo(null);
    setTocados(new Set());
    setConceptoId("");
    setDestinoId("");
  }

  /**
   * Aplica lo que ha leído el escáner del ticket.
   *
   * Solo rellena lo que viene con confianza —lo que llega en estado VACIO no se
   * toca— y NUNCA pisa lo que la persona haya escrito después. Un campo en
   * blanco se rellena en diez segundos; uno mal relleno hay que descubrirlo
   * primero.
   *
   * El proveedor sale de `proveedor`, que es el EMISOR del documento. En un
   * ticket de compra el emisor es la tienda; usar `cliente` habría puesto aquí
   * el nombre de nuestro propio taller.
   */
  function aplicarEscaneo(p: PropuestaEscaneo) {
    setEscaneo(p);
    if (p.referencia.estado !== "VACIO" && p.referencia.valor && !tocados.has("referencia")) {
      setReferencia(p.referencia.valor);
    }
    if (
      p.importeCentimos.estado !== "VACIO" &&
      p.importeCentimos.valor != null &&
      !tocados.has("importe")
    ) {
      setImporteTexto(euros(p.importeCentimos.valor).replace(" €", ""));
    }
    if (p.proveedor.estado !== "VACIO" && p.proveedor.valor && !tocados.has("proveedor")) {
      setProveedor(p.proveedor.valor);
    }
    if (p.concepto.estado !== "VACIO" && p.concepto.valor && !tocados.has("concepto")) {
      setConcepto(p.concepto.valor);
    }
    setTocados(new Set());
  }

  /** Una factura de la bandeja: mismo análisis, hecho antes. */
  function elegirDeBandeja(d: DocumentoAutoScan, p: PropuestaEscaneo) {
    setInboxId(d.id);
    setJustificante(null);
    aplicarEscaneo(p);
  }

  /*
   * El pago anterior de esta misma factura de proveedor, si lo dijo el escáner
   * y sigue siendo de ESTA referencia. Si alguien corrige el número, el aviso
   * de la otra factura deja de aplicar.
   */
  const yaPagada =
    escaneo?.cobroPrevio &&
    escaneo.referencia.valor &&
    escaneo.referencia.valor.trim().toUpperCase() === referencia.trim().toUpperCase()
      ? escaneo.cobroPrevio
      : null;

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
        expenseConceptId: conceptoId === "" ? null : conceptoId,
        expenseTargetId: destinoId === "" ? null : destinoId,
      });
      setUltimo({ operacionId: r.operacionId, numero: r.numero });

      // Después y aparte: si el almacenamiento falla, el pago ya está hecho y
      // el dinero ha salido del cajón. Decir otra cosa sería mentira.
      if (justificante) {
        try {
          await api.adjuntarDocumento(r.operacionId, justificante);
        } catch (e) {
          setError(
            `El pago ${r.numero} ha quedado registrado, pero el justificante no se ha podido subir` +
              `${e instanceof Error ? `: ${e.message}` : "."} Vuelve a adjuntarlo aquí abajo.`
          );
        }
      }

      /*
       * El ticket de la bandeja pasa a ser el justificante de ESTE pago.
       * Después y aparte, como la subida manual: si falla, el dinero ya ha
       * salido y lo único que queda es volver a adjuntar.
       */
      if (inboxId != null) {
        try {
          await api.promoverAutoScan(inboxId, r.operacionId);
        } catch (e) {
          setError(
            `El pago ${r.numero} ha quedado registrado, pero el ticket escaneado no se ha podido` +
              ` colgar de él${e instanceof Error ? `: ${e.message}` : "."} Adjúntalo aquí abajo.`
          );
        }
      }

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
                <input
                  value={concepto}
                  onChange={(e) => {
                    setConcepto(e.target.value);
                    marcarTocado("concepto");
                  }}
                  className={inputCls}
                  placeholder="Compra urgente de material"
                />
              </label>

              {/*
                En qué se ha gastado, y a quién se imputa.

                Solo salen si hay catálogo: una instalación que no ha creado
                ningún concepto no gana nada con dos desplegables vacíos.
                Ninguno es obligatorio — obligar a clasificar pararía el
                mostrador el día que falte una entrada, y lo que se rellenaría
                entonces sería lo primero que hubiera a mano.
              */}
              {conceptos.length > 0 && (
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                    Concepto de gasto{" "}
                    <span className="font-normal normal-case text-slate-500">(opcional)</span>
                  </span>
                  <select
                    value={conceptoId}
                    onChange={(e) => {
                      const v = e.target.value === "" ? "" : Number(e.target.value);
                      setConceptoId(v);
                      // El destino cuelga del concepto: cambiarlo lo invalida.
                      setDestinoId("");
                    }}
                    className={inputCls}
                  >
                    <option value="">Sin clasificar</option>
                    {conceptos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {destinosDelConcepto.length > 0 && (
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                    {conceptoElegido?.tipoDestino === "PERSONA" ? "Operario" : "Se imputa a"}{" "}
                    <span className="font-normal normal-case text-slate-500">(opcional)</span>
                  </span>
                  <select
                    value={destinoId}
                    onChange={(e) => setDestinoId(e.target.value === "" ? "" : Number(e.target.value))}
                    className={inputCls}
                  >
                    <option value="">Sin especificar</option>
                    {destinosDelConcepto.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.nombre}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {/*
              Esta factura ya se pagó.

              No bloquea —puede ser un pago fraccionado, o un número repetido
              por el proveedor— pero pagar dos veces el mismo papel es dinero
              que sale del cajón dos veces, y eso se dice fuerte y antes de
              pulsar.
            */}
            {yaPagada && (
              <div className="mt-3 rounded-lg border border-amber-600/60 bg-amber-950/30 px-3 py-2 text-[13px] text-amber-200">
                <strong>Esta factura ya está pagada.</strong> Consta en{" "}
                <strong>{yaPagada.numero}</strong>
                {yaPagada.partyNombre ? ` (${yaPagada.partyNombre})` : ""} por{" "}
                {euros(yaPagada.importeCentimos)}, el {yaPagada.fecha}. Compruébalo antes de volver
                a pagarla.
              </div>
            )}

            {/* Lo que ya ha llegado del escáner del mostrador, antes de
                ofrecer adjuntar nada a mano. */}
            <BandejaAutoScan
              elegido={inboxId}
              onElegir={elegirDeBandeja}
              onSoltar={() => {
                setInboxId(null);
                setEscaneo(null);
              }}
              puedeGestionar={puede("cash.autoscan.manage")}
              sentido="PAGO"
              deshabilitado={guardando}
              onError={setError}
            />

            {/* El ticket del proveedor: se lee y rellena la pantalla, y se
                cuelga del pago en cuanto el pago existe. */}
            <EscanerFactura
              fichero={justificante}
              onChange={(f) => {
                setJustificante(f);
                // Adjuntar a mano suelta el de la bandeja: son excluyentes.
                if (f) setInboxId(null);
              }}
              onPropuesta={aplicarEscaneo}
              onOlvidar={() => setEscaneo(null)}
              puedeAdjuntar={puede("cash.document.attach")}
              sessionId={jornada?.sesion.id ?? null}
              sentido="PAGO"
              deshabilitado={guardando}
              onError={setError}
            />
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
