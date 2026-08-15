/**
 * Jornada actual: el panel de mando del mostrador.
 *
 * Cuando no hay jornada abierta, esta pantalla ES la apertura. Y la apertura no
 * pide un importe: pide (o hereda) la composición exacta de piezas, que es de
 * lo que va todo el módulo.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { HandCoins, Banknote, ArrowLeftRight, ClipboardCheck, Lock, PlayCircle } from "lucide-react";
import { useCash } from "../contexts/CashContext";
import DenominationGrid, { type CantidadesPorValor, lineasDesde } from "../components/DenominationGrid";
import { Aviso, BotonAccion, Cabecera, Card, ErrorBox } from "../components/ui";
import { euros, totalLineas } from "../utils/money";
import { ETIQUETA_ESTADO_SESION, ETIQUETA_FORMA_PAGO } from "../types";
import * as api from "../services/api";

export default function JornadaActual() {
  const { jornada, cajaId, refrescar, puede, cajas } = useCash();
  const navigate = useNavigate();

  if (!cajaId) {
    return (
      <Aviso tono="aviso">
        No hay ninguna caja dada de alta, y sin caja no se puede abrir jornada.{" "}
        {puede("cash.configure") ? (
          <button onClick={() => navigate("/cash/configuracion")} className="underline">
            Crea la primera en Configuración.
          </button>
        ) : (
          "Pídele a un responsable que dé de alta una en Configuración."
        )}
      </Aviso>
    );
  }

  if (!jornada) return <Apertura cajaId={cajaId} />;

  const s = jornada.sesion;
  const caja = cajas.find((c) => c.id === s.registerId);

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Jornada actual"
        descripcion={`${caja ? `${caja.centro ? `${caja.centro} · ` : ""}${caja.nombre} · ` : ""}${s.fecha} · ${ETIQUETA_ESTADO_SESION[s.estado]}`}
      />

      {/* Accesos rápidos: lo que se pulsa cien veces al día, arriba y grande. */}
      <div className="flex flex-wrap gap-2">
        {puede("cash.collection.create_manual") && (
          <BotonAccion tono="cobro" icono={<HandCoins className="h-5 w-5" />} onClick={() => navigate("/cash/cobros")}>
            Cobrar
          </BotonAccion>
        )}
        {puede("cash.payment.create") && (
          <BotonAccion tono="pago" icono={<Banknote className="h-5 w-5" />} onClick={() => navigate("/cash/pagos")}>
            Pago / salida
          </BotonAccion>
        )}
        {puede("cash.movement.create") && (
          <BotonAccion icono={<ArrowLeftRight className="h-5 w-5" />} onClick={() => navigate("/cash/movimientos")}>
            Movimiento
          </BotonAccion>
        )}
        {puede("cash.count.create") && (
          <BotonAccion icono={<ClipboardCheck className="h-5 w-5" />} onClick={() => navigate("/cash/arqueo")}>
            Arqueo
          </BotonAccion>
        )}
        {puede("cash.close_session") && (
          <BotonAccion tono="cierre" icono={<Lock className="h-5 w-5" />} onClick={() => navigate("/cash/cierre")}>
            Cerrar caja
          </BotonAccion>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card title="Efectivo teórico" value={euros(jornada.totalStockCentimos)} hint={`${jornada.piezas} piezas`} accent="text-emerald-400" />
        <Card title="Fondo inicial" value={euros(s.fondoInicialCentimos)} hint={s.fondoInicialHeredado ? "Heredado del cierre anterior" : "Introducido a mano"} />
        <Card title="Cobros" value={euros(jornada.cobros.totalCentimos)} hint={`ERP ${euros(jornada.cobros.erpCentimos)} · manual ${euros(jornada.cobros.manualCentimos)}`} />
        <Card title="Pagos" value={euros(jornada.pagos.totalCentimos)} hint={`ERP ${euros(jornada.pagos.erpCentimos)} · manual ${euros(jornada.pagos.manualCentimos)}`} accent="text-amber-300" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Por forma de pago
          </div>
          {jornada.porFormaPago.length === 0 ? (
            <p className="text-sm text-slate-500">Todavía no hay cobros ni pagos registrados.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {jornada.porFormaPago.map((f) => (
                <div key={f.forma} className="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-1.5">
                  <span className="text-sm text-slate-300">{ETIQUETA_FORMA_PAGO[f.forma] ?? f.forma}</span>
                  <span className="text-sm font-bold tabular-nums text-slate-100">{euros(f.importeCentimos)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-500">
            Solo el efectivo mueve el inventario físico; las tarjetas se registran económicamente.
          </p>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Otros movimientos</span>
            <button onClick={() => void refrescar()} className="text-[11px] text-slate-400 hover:text-white">
              ↺ Actualizar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Card title="Salidas" value={euros(jornada.salidasCentimos)} />
            <Card title="Entregas" value={euros(jornada.entregasCentimos)} />
            <Card title="Operaciones" value={String(jornada.operaciones)} />
            <Card
              title="Pendientes de ERP"
              value={String(jornada.pendientesErp)}
              accent={jornada.pendientesErp > 0 ? "text-amber-300" : undefined}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Apertura ───────────────────────────────────────────────────────────────

function Apertura({ cajaId }: { cajaId: number }) {
  const { denominaciones, refrescar, puede } = useCash();
  const [cantidades, setCantidades] = useState<CantidadesPorValor>({});
  const [cartuchos, setCartuchos] = useState<CantidadesPorValor>({});
  const [notas, setNotas] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const lineas = lineasDesde(cantidades);
  const lineasCartuchos = lineasDesde(cartuchos);
  // Un tubo de 1 € son 25 monedas: el fondo inicial no cuadraría si se contara
  // como una pieza suelta.
  const piezasPorCartucho = new Map(
    denominaciones.filter((d) => d.piezasPorCartucho).map((d) => [d.valor, d.piezasPorCartucho as number])
  );
  const totalCartuchos = lineasCartuchos.reduce(
    (a, l) => a + l.cantidad * (piezasPorCartucho.get(l.valor) ?? 0) * l.valor,
    0
  );
  const total = totalLineas(lineas) + totalCartuchos;

  if (!puede("cash.open_session")) {
    return <Aviso tono="aviso">La caja está cerrada y no tienes permiso para abrirla.</Aviso>;
  }

  async function abrir(heredar: boolean) {
    setGuardando(true);
    setError("");
    try {
      // Sin composición manual, el servidor hereda la del cierre anterior. Con
      // composición, se toma la indicada y queda auditado como corrección.
      await api.abrirJornada({
        registerId: cajaId,
        fondoManual: heredar ? [] : lineas,
        fondoCartuchos: heredar ? [] : lineasCartuchos,
        notas: notas || undefined,
      });
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido abrir la caja");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Abrir caja"
        descripcion="El fondo inicial no es un importe: es la composición exacta de billetes y monedas."
      />

      {error && <ErrorBox>{error}</ErrorBox>}

      <Aviso tono="info">
        Si la caja se cerró antes, puedes heredar el cambio final del día anterior con su
        composición exacta. Indica las piezas a mano solo si es la primera jornada o si hay que
        corregir el fondo: esa corrección queda auditada.
      </Aviso>

      <div className="flex flex-wrap gap-2">
        <BotonAccion tono="cierre" icono={<PlayCircle className="h-5 w-5" />} onClick={() => void abrir(true)} disabled={guardando}>
          {guardando ? "Abriendo…" : "Abrir heredando el cambio anterior"}
        </BotonAccion>
        <BotonAccion onClick={() => void abrir(false)} disabled={guardando || total === 0}>
          Abrir con el fondo indicado ({euros(total)})
        </BotonAccion>
      </div>

      <DenominationGrid
        titulo="Fondo inicial contado a mano"
        denominaciones={denominaciones}
        cantidades={cantidades}
        onChange={setCantidades}
        cartuchos={cartuchos}
        onCartuchosChange={setCartuchos}
        deshabilitado={guardando}
      />

      <label className="block">
        <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
          Notas de apertura
        </span>
        <input
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Opcional"
          className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-slate-100 outline-none focus:ring-2 focus:ring-sky-500"
        />
      </label>
    </div>
  );
}
