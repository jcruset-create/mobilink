/**
 * Connect Pro — pestaña de tarificación de una asistencia.
 *
 * Antes esta pestaña era "Costes" y enseñaba dos números sueltos: un coste
 * estimado y uno final, sin decir de dónde salían. Ahora enseña las tres
 * etapas del motor —lo que se estimó, lo que se comprometió al dar la orden de
 * salida y lo que se acabó cobrando— con sus líneas, la regla que se aplicó y
 * por qué.
 *
 * Dos criterios de pantalla que vienen del motor y conviene no romper:
 *
 *  - **Un importe desconocido se pinta como desconocido, no como cero.** Si el
 *    motor no ha encontrado tarifa devuelve nulo, y aquí sale "sin tarifa" en
 *    vez de "0,00 €". Un cero en una columna de dinero se lee como gratis.
 *  - **Los avisos se enseñan siempre, no solo cuando algo falla del todo.**
 *    El caso frecuente no es que no haya precio: es que hay venta y no hay
 *    compra, y entonces el margen no se puede calcular. Eso hay que verlo.
 *
 * Los importes llegan del backend ya formateados a dos decimales como texto.
 * No se convierten a número aquí a propósito: sería devolver la coma flotante
 * que el motor se ha quitado de encima.
 */

import { useCallback, useEffect, useState } from "react";
import { boFetch } from "../services/api";
import { Button, Input, Select, ErrorBanner, Badge, Th, Td } from "./ui";
import { fmtDateTime } from "../types";

type Linea = {
  lineNumber: number; kind: string; description: string;
  quantity: number | null; unit: string | null;
  saleUnitPrice: string | null; saleTotal: string | null;
  purchaseUnitPrice: string | null; purchaseTotal: string | null;
};

type Aviso = { codigo: string; lado?: string | null; detalle?: string };

type Ajuste = {
  id: number; field: string; originalValue: string | null; newValue: string; diferencia: string;
  reason: string; authorizedByName: string | null; authorizedAtMs: number;
  lineNumber: number | null; description: string | null;
};

type Permisos = {
  verVenta: boolean; verCompra: boolean; verMargen: boolean;
  ajustarImporte: boolean; limiteAjuste: string | null;
};

const CAMPOS_AJUSTABLES: [string, string][] = [
  ["saleTotal", "Venta (total de la línea)"],
  ["purchaseTotal", "Compra (total de la línea)"],
  ["saleUnitPrice", "Venta (precio unitario)"],
  ["purchaseUnitPrice", "Compra (precio unitario)"],
];

type Etapa = {
  stage: "estimate" | "locked" | "final";
  status: "ok" | "partial" | "manual_review";
  currency: string;
  saleTotal: string | null; purchaseTotal: string | null;
  grossMargin: string | null; grossMarginPct: string | null;
  computedAtMs: number | null;
  tariff: string | null; version: string | null; rule: string | null;
  context: Record<string, any> | null;
  warnings: Aviso[];
  lines: Linea[];
};

const ETAPAS: Record<string, string> = {
  estimate: "Estimación",
  locked: "Comprometido",
  final: "Cierre",
};

const ESTADOS: Record<string, { texto: string; clase: string }> = {
  ok: { texto: "Calculado", clase: "border-emerald-500/40 text-emerald-300" },
  partial: { texto: "Incompleto", clase: "border-amber-500/40 text-amber-300" },
  manual_review: { texto: "Revisión manual", clase: "border-rose-500/40 text-rose-300" },
};

/**
 * Los códigos del motor en cristiano. El que no esté aquí se enseña tal cual:
 * es preferible un código feo en pantalla a tragarse un aviso porque falta la
 * traducción.
 */
const AVISOS: Record<string, string> = {
  NO_TARIFF_PLAN: "El contrato no lleva a ninguna versión tarifaria vigente",
  NO_MATCHING_RULE: "Ninguna regla de la tarifa encaja con este servicio",
  AMBIGUOUS_RULES: "Dos reglas empatan: hay que desempatarlas en la configuración",
  TIRE_PRICE_NOT_FOUND: "Sin precio de tarifa para ese neumático",
  ZONE_NOT_RESOLVED: "No se ha podido determinar la zona",
  HOLIDAY_SCOPE_UNKNOWN: "Festivo local sin saber el municipio",
  DISTANCE_NOT_AVAILABLE: "Sin distancia: los kilómetros de más no se han podido calcular",
  DURATION_NOT_AVAILABLE: "Sin duración: el tiempo de más no se ha podido calcular",
  PURCHASE_TARIFF_NOT_FOUND: "Sin tarifa de compra: el margen queda indeterminado",
  SALE_TARIFF_NOT_FOUND: "Sin tarifa de venta: no hay precio que facturar al cliente",
  FORMULA_NOT_SUPPORTED: "La fórmula de esta regla no está soportada",
  EXTRA_AMOUNT_MISSING: "Un suplemento no tiene importe configurado",
  EXTRA_PERCENTAGE_MISSING: "Un suplemento porcentual no tiene porcentaje",
  EXTRA_BASE_MISSING: "Un suplemento porcentual no tiene base sobre la que aplicarse",
  MANUAL_OVERRIDE: "Importe ajustado a mano",
};

const LADOS: Record<string, string> = { sale: "venta", purchase: "compra" };

const TIPOS_LINEA: Record<string, string> = {
  FORFAIT: "Forfait", EXTRA_KM: "Km de más", EXTRA_TIME: "Tiempo de más",
  TIRE: "Neumático", ADDITIONAL_TIRE: "Neumático adicional", MATERIAL: "Material",
  CANCELLATION: "Anulación", ADMIN_FEE: "Gestión", TOLL: "Peajes", OTHER: "Otros",
};

/** Importe o "sin tarifa": nunca un cero que se lea como gratis. */
function Importe({ v, moneda }: { v: string | null; moneda: string }) {
  if (v == null) return <span className="text-slate-600" title="El motor no ha encontrado tarifa para esto">sin tarifa</span>;
  return <span className="tabular-nums">{v} {moneda}</span>;
}

export default function TarificacionTab({
  assistanceId, canOperate, status, onChanged,
}: {
  assistanceId: number;
  canOperate: boolean;
  status: string;
  onChanged: () => void;
}) {
  const [etapas, setEtapas] = useState<Etapa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [estimacion, setEstimacion] = useState<Etapa | null>(null);
  const [ajustes, setAjustes] = useState<Ajuste[]>([]);
  const [permisos, setPermisos] = useState<Permisos | null>(null);
  const [ajustando, setAjustando] = useState(false);

  const cargar = useCallback(() => {
    boFetch<{ data: Etapa[] }>(`/pricing/${assistanceId}`)
      .then((r) => setEtapas(r.data))
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
    boFetch<{ data: Ajuste[] }>(`/pricing/${assistanceId}/overrides`)
      .then((r) => setAjustes(r.data)).catch(() => {});
  }, [assistanceId]);

  useEffect(cargar, [cargar]);

  // Se pregunta qué puede este usuario para no ofrecerle lo que el backend va
  // a rechazar. La comprobación de verdad la hace el servidor, no esto.
  useEffect(() => {
    boFetch<Permisos>("/pricing/permissions").then(setPermisos).catch(() => {});
  }, []);

  const bloqueada = etapas.find((e) => e.stage === "locked");
  const cerrada = etapas.find((e) => e.stage === "final");

  const accion = async (ruta: string, etiqueta: string) => {
    setBusy(true); setError(null); setAviso(null);
    try {
      await boFetch(`/pricing/${assistanceId}/${ruta}`, { method: "POST", body: {} });
      setAviso(`${etiqueta} hecho.`);
      cargar();
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const estimar = async () => {
    setBusy(true); setError(null); setAviso(null);
    try {
      // La estimación no se guarda: se pinta aparte y se va al recargar
      const r = await boFetch<any>(`/pricing/${assistanceId}/estimate`, { method: "POST", body: {} });
      setEstimacion({
        stage: "estimate", status: r.estado, currency: r.currency,
        saleTotal: r.saleTotal, purchaseTotal: r.purchaseTotal,
        grossMargin: r.grossMargin, grossMarginPct: r.grossMarginPct,
        computedAtMs: Date.now(), tariff: r.tariff, version: r.version, rule: r.rule,
        context: r.explanation ?? null, warnings: r.warnings ?? [], lines: r.lines ?? [],
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (cargando) return <p className="text-sm text-slate-500">Cargando tarificación…</p>;

  const visibles = estimacion && !etapas.some((e) => e.stage === "estimate")
    ? [estimacion, ...etapas] : etapas;

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {aviso && <p className="text-[13px] text-emerald-300">{aviso}</p>}

      {canOperate && (
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={estimar} disabled={busy}>
            Estimar ahora
          </Button>
          <Button
            onClick={() => accion("lock", "Forfait comprometido")}
            disabled={busy || !!bloqueada}
            title={bloqueada ? "El forfait ya está comprometido y no se puede recalcular" : undefined}
          >
            Comprometer forfait
          </Button>
          <Button
            onClick={() => accion("finalize", "Cierre")}
            disabled={busy || !!cerrada || !["finished", "returning_to_workshop", "at_workshop", "cancelled"].includes(status)}
            title={cerrada ? "Ya está cerrada" : "Solo cuando el servicio ha terminado"}
          >
            Cerrar tarifa
          </Button>
        </div>
      )}

      {visibles.length === 0 ? (
        <p className="text-sm text-slate-500">
          Esta asistencia todavía no tiene tarifa calculada. El forfait se
          compromete solo al dar la orden de salida al taller.
        </p>
      ) : (
        visibles.map((e) => <FichaEtapa key={e.stage} e={e} provisional={e === estimacion} />)
      )}

      {ajustes.length > 0 && <Ajustes ajustes={ajustes} />}

      {permisos?.ajustarImporte && (cerrada || bloqueada) && (
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
          {ajustando ? (
            <FormularioAjuste
              assistanceId={assistanceId}
              etapa={cerrada ? "final" : "locked"}
              limite={permisos.limiteAjuste}
              onHecho={() => { setAjustando(false); cargar(); onChanged(); }}
              onCancelar={() => setAjustando(false)}
            />
          ) : (
            <>
              <Button variant="ghost" onClick={() => setAjustando(true)}>Ajustar un importe a mano</Button>
              <p className="mt-2 text-xs text-slate-500">
                Queda registrado con el motivo y con quién lo autoriza, y la tarifa
                pasa a revisión manual.
                {permisos.limiteAjuste && ` Tu límite por ajuste es de ${permisos.limiteAjuste} €.`}
              </p>
            </>
          )}
        </div>
      )}

      <ConsultaNeumatico assistanceId={assistanceId} canOperate={canOperate} />
    </div>
  );
}

/**
 * Lo que una persona ha decidido, junto a lo que calculó la tarifa.
 *
 * Se enseña aparte y no fundido en el importe porque la diferencia ES la
 * información: seis meses después, la pregunta no es cuánto costó sino por qué
 * costó eso y no lo que decía el tarifario.
 */
function Ajustes({ ajustes }: { ajustes: Ajuste[] }) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5">
      <p className="border-b border-slate-700 px-3 py-2 text-[13px] font-medium text-amber-300">
        Importes ajustados a mano ({ajustes.length})
      </p>
      <ul className="divide-y divide-slate-700/40">
        {ajustes.map((a) => (
          <li key={a.id} className="px-3 py-2 text-[13px]">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-slate-400">{a.description ?? "Servicio"}</span>
              <span className="tabular-nums text-slate-500">{a.originalValue ?? "—"}</span>
              <span className="text-slate-600">→</span>
              <span className="tabular-nums font-semibold text-slate-100">{a.newValue}</span>
              <span className={`tabular-nums ${Number(a.diferencia) < 0 ? "text-rose-300" : "text-emerald-300"}`}>
                ({Number(a.diferencia) > 0 ? "+" : ""}{a.diferencia})
              </span>
              <span className="ml-auto text-[12px] text-slate-500">
                {a.authorizedByName ?? "—"} · {fmtDateTime(a.authorizedAtMs)}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-slate-400">{a.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FormularioAjuste({
  assistanceId, etapa, limite, onHecho, onCancelar,
}: {
  assistanceId: number;
  etapa: "locked" | "final";
  limite: string | null;
  onHecho: () => void;
  onCancelar: () => void;
}) {
  const [campo, setCampo] = useState("saleTotal");
  const [linea, setLinea] = useState("");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guardar = async () => {
    setBusy(true); setError(null);
    try {
      await boFetch(`/pricing/${assistanceId}/override`, {
        method: "POST",
        body: {
          etapa, campo, valorNuevo: valor, motivo,
          lineNumber: linea.trim() === "" ? null : Number(linea),
        },
      });
      onHecho();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mb-2 text-[13px] font-medium text-slate-200">
        Ajustar un importe de la etapa {etapa === "final" ? "de cierre" : "comprometida"}
      </p>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="grid gap-2 sm:grid-cols-3">
        <Select value={campo} onChange={(e) => setCampo(e.target.value)}>
          {CAMPOS_AJUSTABLES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </Select>
        <Input value={linea} onChange={(e) => setLinea(e.target.value)}
               placeholder="Nº de línea (vacío = forfait)" />
        <Input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Importe nuevo" />
      </div>
      <div className="mt-2">
        <Input value={motivo} onChange={(e) => setMotivo(e.target.value)}
               placeholder="Motivo del ajuste (obligatorio)" />
      </div>

      <div className="mt-3 flex gap-2">
        <Button onClick={guardar} disabled={busy || !valor.trim() || motivo.trim().length < 5}>
          Guardar el ajuste
        </Button>
        <Button variant="ghost" onClick={onCancelar} disabled={busy}>Cancelar</Button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        El motivo es obligatorio y se guarda con tu nombre: es lo único que
        responderá la pregunta dentro de seis meses.
        {limite && ` No puedes mover más de ${limite} € por ajuste.`}
      </p>
    </div>
  );
}

function FichaEtapa({ e, provisional }: { e: Etapa; provisional: boolean }) {
  const estado = ESTADOS[e.status] ?? { texto: e.status, clase: "border-slate-600 text-slate-400" };
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-700 px-3 py-2">
        <span className="text-[13px] font-medium text-slate-200">{ETAPAS[e.stage] ?? e.stage}</span>
        <Badge className={estado.clase}>{estado.texto}</Badge>
        {provisional && (
          <Badge className="border-slate-600 text-slate-400" title="No se guarda: es un cálculo de ahora mismo">
            no guardada
          </Badge>
        )}
        <span className="ml-auto text-[12px] text-slate-500">{fmtDateTime(e.computedAtMs)}</span>
      </div>

      <div className="grid gap-2 px-3 py-2 sm:grid-cols-4">
        <Cifra label="Venta" v={e.saleTotal} moneda={e.currency} />
        <Cifra label="Compra" v={e.purchaseTotal} moneda={e.currency} />
        <Cifra label="Margen" v={e.grossMargin} moneda={e.currency} />
        <div>
          <span className="block text-[11px] uppercase tracking-wide text-slate-500">% margen</span>
          <span className="text-[15px] text-slate-100">
            {e.grossMarginPct == null
              ? <span className="text-slate-600" title="Falta una de las dos patas">indeterminado</span>
              : <span className="tabular-nums">{e.grossMarginPct} %</span>}
          </span>
        </div>
      </div>

      {e.lines.length > 0 && (
        <div className="overflow-x-auto px-3 pb-2">
          <table className="w-full text-[13px]">
            <thead><tr>
              <Th>Concepto</Th><Th>Cant.</Th><Th>Venta ud.</Th><Th>Venta</Th>
              <Th>Compra ud.</Th><Th>Compra</Th>
            </tr></thead>
            <tbody>
              {e.lines.map((l) => (
                <tr key={l.lineNumber}>
                  <Td>
                    <span className="text-slate-200">{l.description}</span>
                    <span className="ml-2 text-[11px] text-slate-500">{TIPOS_LINEA[l.kind] ?? l.kind}</span>
                  </Td>
                  <Td>{l.quantity == null ? "—" : `${l.quantity}${l.unit ? ` ${l.unit}` : ""}`}</Td>
                  <Td><Importe v={l.saleUnitPrice} moneda={e.currency} /></Td>
                  <Td><Importe v={l.saleTotal} moneda={e.currency} /></Td>
                  <Td><Importe v={l.purchaseUnitPrice} moneda={e.currency} /></Td>
                  <Td><Importe v={l.purchaseTotal} moneda={e.currency} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Explicacion e={e} />

      {e.warnings.length > 0 && (
        <ul className="border-t border-slate-700 px-3 py-2 text-[12px] text-amber-300">
          {e.warnings.map((w, i) => (
            <li key={i}>
              {AVISOS[w.codigo] ?? w.codigo}
              {w.lado && LADOS[w.lado] ? ` (${LADOS[w.lado]})` : ""}
              {w.detalle ? ` — ${w.detalle}` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Cifra({ label, v, moneda }: { label: string; v: string | null; moneda: string }) {
  return (
    <div>
      <span className="block text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-[15px] text-slate-100"><Importe v={v} moneda={moneda} /></span>
    </div>
  );
}

/**
 * Por qué costó eso. Sale del snapshot que se guardó con la asistencia, no del
 * tarifario de hoy: si mañana se sube el nocturno, esta asistencia se sigue
 * explicando con lo que se le aplicó entonces.
 */
function Explicacion({ e }: { e: Etapa }) {
  const [abierto, setAbierto] = useState(false);
  const c = e.context ?? {};
  const partes: [string, any][] = [
    ["Tarifario", [e.tariff, e.version].filter(Boolean).join(" ") || null],
    ["Regla aplicada", e.rule],
    ["Fecha y hora local", [c.fechaLocal, c.horaLocal].filter(Boolean).join(" ") || null],
    ["Zona horaria", c.timezone ?? c.zonaHoraria],
    ["Franja", c.franja],
    ["Tipo de día", c.tipoDia],
    ["Zona", c.zona],
    ["Distancia", c.distanciaKm != null ? `${c.distanciaKm} km${c.origenDistancia ? ` (${c.origenDistancia === "routed" ? "ruta real" : "estimada"})` : ""}` : null],
    ["Km incluidos", c.distanciaIncluidaKm != null ? `${c.distanciaIncluidaKm} km` : null],
    ["Tiempo incluido", c.tiempoIncluidoMin != null ? `${c.tiempoIncluidoMin} min` : null],
  ];
  const utiles = partes.filter(([, v]) => v != null && v !== "");
  if (utiles.length === 0) return null;

  return (
    <div className="border-t border-slate-700 px-3 py-2">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="text-[12px] text-cyan-300 hover:underline"
      >
        {abierto ? "Ocultar el porqué" : "Por qué costó esto"}
      </button>
      {abierto && (
        <dl className="mt-2 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
          {utiles.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="w-36 shrink-0 text-slate-500">{k}</dt>
              <dd className="text-slate-300">{String(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * Consulta del precio de un neumático contra la tarifa de esta asistencia.
 *
 * Se pregunta desde aquí cuando el taller comunica qué ha montado. Se valora
 * con la versión que estaba vigente en la orden de salida, no con la de hoy:
 * un neumático añadido tres días después se cobra a lo que se pactó.
 */
function ConsultaNeumatico({ assistanceId, canOperate }: { assistanceId: number; canOperate: boolean }) {
  const [medida, setMedida] = useState("");
  const [marca, setMarca] = useState("");
  const [posicion, setPosicion] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [r, setR] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canOperate) return null;

  const consultar = async () => {
    setBusy(true); setError(null); setR(null);
    try {
      setR(await boFetch<any>(`/pricing/${assistanceId}/tire`, {
        method: "POST",
        body: { medida, marca: marca || null, posicion: posicion || null, cantidad: Number(cantidad) || 1 },
      }));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
      <p className="mb-2 text-[13px] font-medium text-slate-200">Precio de un neumático</p>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      <div className="grid gap-2 sm:grid-cols-4">
        <Input value={medida} onChange={(ev) => setMedida(ev.target.value)} placeholder="315/80R22.5" />
        <Input value={marca} onChange={(ev) => setMarca(ev.target.value)} placeholder="Marca (opcional)" />
        <Select value={posicion} onChange={(ev) => setPosicion(ev.target.value)}>
          <option value="">Cualquier posición</option>
          <option value="STEER">Dirección</option>
          <option value="DRIVE">Tracción</option>
          <option value="TRAILER">Remolque</option>
        </Select>
        <Input value={cantidad} onChange={(ev) => setCantidad(ev.target.value)} placeholder="Unidades" />
      </div>
      <div className="mt-2">
        <Button variant="ghost" onClick={consultar} disabled={busy || !medida.trim()}>Consultar precio</Button>
      </div>

      {r && (
        <div className="mt-3 border-t border-slate-700 pt-2 text-[13px]">
          {r.manualReview && (
            <p className="mb-2 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-rose-300">
              Sin precio de tarifa para esta combinación. Hay que fijarlo a mano
              antes de facturar: aquí un cero se cobraría.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-4">
            <Cifra label="Venta (ud.)" v={r.sale?.unitPrice ?? null} moneda={r.currency} />
            <Cifra label="Venta (total)" v={r.sale?.total ?? null} moneda={r.currency} />
            <Cifra label="Compra (total)" v={r.purchase?.total ?? null} moneda={r.currency} />
            <Cifra label="Margen" v={r.grossMargin ?? null} moneda={r.currency} />
          </div>
          {(r.sale?.explanation || r.purchase?.explanation) && (
            <p className="mt-2 text-[12px] text-slate-400">
              Venta: {r.sale?.explanation ?? "sin tarifa"}. Compra: {r.purchase?.explanation ?? "sin tarifa"}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
