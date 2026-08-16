/**
 * Entregas de dinero a personas.
 *
 * Le doy 50 € a Juan para que compre agua. Ese billete ya no está en el cajón,
 * y si no se registra, el descuadre aparece en el arqueo del turno siguiente
 * sin que nadie recuerde a quién se le dio. Eso es exactamente lo que esta
 * pantalla evita.
 *
 * Cuando vuelve, se cierra desde aquí mismo, y hay dos finales:
 *
 *  · Compró: trae la factura y la vuelta. Se registra un **pago normal** por lo
 *    que dice la factura —40 € si entregó 50 y devuelve 10— y ese pago aparece
 *    en el listado como cualquier otro. Lo único que entra en el cajón es la
 *    vuelta: las piezas ya salieron al entregar el dinero.
 *  · No compró: devuelve los 50 € y no hay pago ninguno.
 *
 * Si las cuentas no cuadran —factura de 40 € y solo devuelve 8— no se bloquea:
 * el dinero ya no está y negarse a registrarlo solo esconde el problema. Se
 * exige un motivo y queda auditado con el nombre de quien lo tenía.
 */

import { useCallback, useEffect, useState } from "react";
import { UserRoundCheck } from "lucide-react";
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
  EmptyRow,
  ErrorBox,
  TableWrap,
  thCls,
  tdCls,
  inputCls,
} from "../components/ui";
import { euros, aCentimos, totalLineas } from "../utils/money";
import { esFallo } from "../utils/result";
import type { EntregaDinero } from "../types";
import * as api from "../services/api";

export default function Entregas() {
  const { jornada, cajaId, refrescar, puede } = useCash();

  const [entregas, setEntregas] = useState<EntregaDinero[]>([]);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const gestiona = puede("cash.treasury.manage");

  const cargar = useCallback(async () => {
    if (!cajaId) return;
    try {
      const r = await api.tesoreria(cajaId);
      setEntregas(r.entregas);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando las entregas");
    }
  }, [cajaId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function accion(fn: () => Promise<unknown>) {
    setOcupado(true);
    setError("");
    try {
      await fn();
      await cargar();
      await refrescar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "La acción ha fallado");
    } finally {
      setOcupado(false);
    }
  }

  if (!jornada) {
    return <Aviso tono="aviso">No hay ninguna jornada abierta. Ábrela desde «Jornada actual».</Aviso>;
  }

  const abiertas = entregas.filter((e) => e.estado === "ABIERTA");
  const cerradas = entregas.filter((e) => e.estado !== "ABIERTA");

  return (
    <div className="space-y-3">
      <Cabecera
        titulo="Entregas de dinero"
        descripcion="Dinero que sale de la caja en manos de alguien y vuelve con la factura y el cambio."
      />

      {error && <ErrorBox>{error}</ErrorBox>}

      {abiertas.length > 0 && (
        <Aviso tono="aviso">
          <strong>
            {abiertas.length === 1 ? "Hay una entrega abierta" : `Hay ${abiertas.length} entregas abiertas`}
          </strong>{" "}
          por {euros(abiertas.reduce((a, e) => a + e.importeCentimos, 0))}. Ese dinero es de la
          empresa y no está en el cajón.
        </Aviso>
      )}

      {abiertas.map((e) => (
        <EntregaAbierta
          key={e.id}
          entrega={e}
          sessionId={jornada.sesion.id}
          gestiona={gestiona}
          ocupado={ocupado}
          onAccion={accion}
        />
      ))}

      {gestiona && <NuevaEntrega sessionId={jornada.sesion.id} ocupado={ocupado} onAccion={accion} />}

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          Entregas cerradas
        </h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={thCls}>Número</th>
              <th className={thCls}>Persona</th>
              <th className={thCls}>Motivo</th>
              <th className={`${thCls} text-right`}>Entregado</th>
              <th className={`${thCls} text-right`}>Gastado</th>
              <th className={`${thCls} text-right`}>Devuelto</th>
              <th className={thCls}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {cerradas.length === 0 && <EmptyRow cols={7} text="Todavía no hay entregas cerradas." />}
            {cerradas.map((e) => (
              <tr key={e.id}>
                <td className={`${tdCls} font-mono text-[11px] text-slate-300`}>{e.numero}</td>
                <td className={`${tdCls} font-medium text-slate-100`}>{e.persona}</td>
                <td className={`${tdCls} text-slate-400`}>{e.motivo}</td>
                <td className={`${tdCls} text-right tabular-nums`}>{euros(e.importeCentimos)}</td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  {e.gastoCentimos == null ? "—" : euros(e.gastoCentimos)}
                </td>
                <td className={`${tdCls} text-right tabular-nums`}>
                  {e.devueltoCentimos == null ? "—" : euros(e.devueltoCentimos)}
                </td>
                <td className={tdCls}>
                  {e.diferenciaCentimos ? (
                    <span
                      className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-300"
                      title={e.diferenciaMotivo ?? ""}
                    >
                      Faltaron {euros(Math.abs(e.diferenciaCentimos))}
                    </span>
                  ) : e.estado === "DEVUELTA" ? (
                    <span className="text-[11px] text-slate-400">Devuelta entera</span>
                  ) : (
                    <span className="text-[11px] text-emerald-300">Cuadrada</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </section>
    </div>
  );
}

// ── Entregar dinero ────────────────────────────────────────────────────────

function NuevaEntrega({
  sessionId,
  ocupado,
  onAccion,
}: {
  sessionId: number;
  ocupado: boolean;
  onAccion: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { denominaciones, disponible } = useCash();
  const [persona, setPersona] = useState("");
  const [motivo, setMotivo] = useState("");
  const [importeTexto, setImporteTexto] = useState("");
  const [piezas, setPiezas] = useState<CantidadesPorValor>({});
  const [aviso, setAviso] = useState("");

  const importe = aCentimos(importeTexto) ?? 0;
  const total = totalLineas(lineasDesde(piezas));

  /** Propone qué billetes darle, para no tener que componerlos a mano. */
  async function proponer() {
    if (importe <= 0) return;
    setAviso("");
    try {
      const r = await api.proponerCambio(sessionId, importe);
      if (esFallo(r)) setAviso(r.mensaje);
      else setPiezas(cantidadesDesde(r.lineas));
    } catch (e) {
      setAviso(e instanceof Error ? e.message : "No se ha podido proponer la composición");
    }
  }

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-3">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        Entregar dinero a alguien
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
            Quién se lo lleva
          </span>
          <input
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            placeholder="Juan"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
            Para qué
          </span>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Comprar agua"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
            Importe
          </span>
          <input
            value={importeTexto}
            onChange={(e) => {
              setImporteTexto(e.target.value);
              setPiezas({});
            }}
            onBlur={() => void proponer()}
            inputMode="decimal"
            placeholder="50,00"
            className={`${inputCls} text-lg font-bold tabular-nums`}
          />
        </label>
      </div>

      {aviso && (
        <div className="mt-2">
          <Aviso tono="mal">{aviso}</Aviso>
        </div>
      )}

      {importe > 0 && (
        <div className="mt-2 space-y-2">
          <DenominationGrid
            titulo="Billetes y monedas que se le dan"
            denominaciones={denominaciones}
            cantidades={piezas}
            onChange={setPiezas}
            disponible={disponible}
            mostrarDisponible
            objetivoCentimos={importe}
            deshabilitado={ocupado}
          />

          <BotonAccion
            tono="pago"
            icono={<UserRoundCheck className="h-5 w-5" />}
            onClick={() =>
              void onAccion(async () => {
                await api.entregarDinero({
                  sessionId,
                  persona,
                  motivo,
                  importeCentimos: importe,
                  entregado: lineasDesde(piezas),
                });
                setPersona("");
                setMotivo("");
                setImporteTexto("");
                setPiezas({});
              })
            }
            disabled={ocupado || !persona.trim() || !motivo.trim() || total !== importe}
          >
            {total === importe
              ? `Entregar ${euros(importe)} a ${persona || "…"}`
              : `Las piezas suman ${euros(total)} y la entrega es de ${euros(importe)}`}
          </BotonAccion>
        </div>
      )}
    </div>
  );
}

// ── Liquidar una entrega abierta ───────────────────────────────────────────

function EntregaAbierta({
  entrega,
  sessionId,
  gestiona,
  ocupado,
  onAccion,
}: {
  entrega: EntregaDinero;
  sessionId: number;
  gestiona: boolean;
  ocupado: boolean;
  onAccion: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const { denominaciones } = useCash();
  const [gastoTexto, setGastoTexto] = useState("");
  const [devuelto, setDevuelto] = useState<CantidadesPorValor>({});
  const [proveedor, setProveedor] = useState("");
  const [factura, setFactura] = useState("");
  const [motivoDiferencia, setMotivoDiferencia] = useState("");

  const gasto = aCentimos(gastoTexto) ?? 0;
  const totalDevuelto = totalLineas(lineasDesde(devuelto));
  const diferencia = entrega.importeCentimos - gasto - totalDevuelto;

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-mono text-[11px] text-slate-400">{entrega.numero}</span>
          <div className="text-lg font-black text-amber-200">
            {entrega.persona} tiene {euros(entrega.importeCentimos)}
          </div>
          <div className="text-[12px] text-slate-400">{entrega.motivo}</div>
        </div>
      </div>

      {gestiona && (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                Importe de la factura
              </span>
              <input
                value={gastoTexto}
                onChange={(e) => setGastoTexto(e.target.value)}
                inputMode="decimal"
                placeholder="40,00"
                className={`${inputCls} text-lg font-bold tabular-nums`}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                Proveedor
              </span>
              <input
                value={proveedor}
                onChange={(e) => setProveedor(e.target.value)}
                placeholder="Supermercado"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-slate-400">
                Nº de factura
              </span>
              <input
                value={factura}
                onChange={(e) => setFactura(e.target.value)}
                className={inputCls}
              />
            </label>
          </div>

          <div className="mt-2">
            <DenominationGrid
              titulo="Lo que devuelve"
              denominaciones={denominaciones}
              cantidades={devuelto}
              onChange={setDevuelto}
              deshabilitado={ocupado}
            />
          </div>

          <div className="mt-2 rounded-lg border border-slate-700 bg-slate-800 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-slate-400">Se le entregaron</span>
              <span className="font-bold tabular-nums text-slate-100">
                {euros(entrega.importeCentimos)}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-slate-400">Factura</span>
              <span className="font-bold tabular-nums text-slate-100">{euros(gasto)}</span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-slate-400">Devuelve</span>
              <span className="font-bold tabular-nums text-slate-100">{euros(totalDevuelto)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-700 pt-1">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Sin explicar
              </span>
              <span
                className={`text-2xl font-black tabular-nums ${
                  diferencia === 0 ? "text-emerald-400" : "text-red-300"
                }`}
              >
                {euros(diferencia)}
              </span>
            </div>
          </div>

          {diferencia !== 0 && (
            <label className="mt-2 block">
              <span className="mb-1 block text-[10px] font-semibold uppercase text-red-300">
                Faltan {euros(Math.abs(diferencia))}: hay que explicarlo antes de cerrar
              </span>
              <input
                value={motivoDiferencia}
                onChange={(e) => setMotivoDiferencia(e.target.value)}
                placeholder="Dice que perdió el cambio"
                className={inputCls}
              />
            </label>
          )}

          <div className="mt-2 flex flex-wrap gap-2">
            <BotonAccion
              tono="cobro"
              onClick={() =>
                void onAccion(() =>
                  api.liquidarEntrega(entrega.id, {
                    sessionId,
                    gastoCentimos: gasto,
                    devuelto: lineasDesde(devuelto),
                    proveedor: proveedor || undefined,
                    facturaReferencia: factura || undefined,
                    diferenciaMotivo: motivoDiferencia || undefined,
                  })
                )
              }
              disabled={ocupado || (diferencia !== 0 && !motivoDiferencia.trim())}
            >
              {gasto > 0
                ? `Registrar el pago de ${euros(gasto)} y cerrar`
                : "Cerrar sin gasto: lo devuelve todo"}
            </BotonAccion>
          </div>

          <p className="mt-2 text-[11px] text-slate-500">
            El pago que queda registrado es el de la factura, y aparece en el listado como cualquier
            otro. No vuelve a mover billetes: salieron cuando se le dio el dinero. Aquí solo entra
            lo que devuelve.
          </p>
        </>
      )}
    </div>
  );
}
