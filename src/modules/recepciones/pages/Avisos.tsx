/**
 * El aviso por WhatsApp a quien espera la mercancía.
 *
 * Aquí se enciende y aquí se comprueba. Las dos cosas van juntas a propósito:
 * el interruptor empieza a escribir a teléfonos de verdad, y lo primero que se
 * pregunta después es «¿le llegó?». La tabla contesta eso, y contesta también
 * lo contrario —por qué NO se mandó—, que es el caso frecuente: la mayoría de
 * los albaranes no traen móvil en sus observaciones.
 *
 * Apagado de fábrica. Se enciende cuando la plantilla está aprobada en Twilio
 * y se ha visto que el móvil se lee bien del PDF del albarán.
 */

import { useCallback, useEffect, useState } from "react";
import { Copy, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import * as api from "../services/api";
import { useRecepciones } from "../contexts/RecepcionesContext";
import { Aviso, EmptyRow, ErrorBox, Pill, TableWrap, btnMini, tdCls, thCls } from "../components/ui";
import { COLOR_ESTADO_AVISO, ETIQUETA_ESTADO_AVISO, type EstadoAvisos } from "../types";
import { fmtFechaHora } from "../../administracion/types";

export default function Avisos() {
  const { puede } = useRecepciones();
  const [estado, setEstado] = useState<EstadoAvisos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const puedeGestionar = puede("recepciones.avisos.manage");

  const cargar = useCallback(async () => {
    try {
      setEstado(await api.estadoAvisos());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cargar el estado de los avisos");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function alternar(activado: boolean) {
    setGuardando(true);
    try {
      await api.guardarConfigAvisos(activado);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido cambiar el aviso");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-xl font-black text-slate-100">Avisos por WhatsApp</h1>
        <p className="text-[12px] text-slate-400">
          Al cerrar una recepción OK se avisa a quien la espera, si el albarán traía su móvil en las observaciones.
        </p>
      </div>

      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="mb-3 grid gap-2 md:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">Estado</div>
          <label className={`mt-2 flex items-center gap-2 text-sm ${puedeGestionar ? "cursor-pointer" : ""}`}>
            <input
              type="checkbox"
              className="h-4 w-4 accent-emerald-500"
              checked={estado?.activado ?? false}
              disabled={!puedeGestionar || guardando || estado === null}
              onChange={(e) => void alternar(e.target.checked)}
            />
            <span className="font-bold">{estado?.activado ? "Encendido" : "Apagado"}</span>
          </label>
          <p className="mt-1 text-[11px] text-slate-500">
            Con incidencia no se manda nada: eso se cuenta por teléfono, no por WhatsApp.
          </p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">Twilio</div>
          <div className="mt-1 text-sm">
            {estado?.credenciales ? "Credenciales puestas" : <span className="text-amber-300">Sin credenciales en el servidor</span>}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">Las mismas por las que salen los avisos de asistencia.</p>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">Plantilla aprobada</div>
          <div className="mt-1 text-sm">
            {estado?.plantilla ? "Configurada" : <span className="text-amber-300">Sin plantilla: sólo texto plano</span>}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            WhatsApp exige plantilla aprobada para escribir primero. Va en RECEPCIONES_WHATSAPP_CONTENT_SID.
          </p>
        </div>
      </div>

      {/* El cuerpo de la plantilla, para copiarlo tal cual en Twilio. Se sirve
          desde el servidor a propósito: es el mismo texto con el que se manda,
          y transcribirlo a mano es la forma de que Twilio diga otra cosa. */}
      {estado && (
        <div className="mb-3 rounded-xl border border-slate-700 bg-slate-800 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-bold uppercase text-slate-400">El texto que hay que dar de alta en Twilio</div>
            <button
              className={`${btnMini} flex items-center gap-1`}
              onClick={() => {
                void navigator.clipboard?.writeText(estado.cuerpoPlantilla).then(
                  () => setCopiado(true),
                  () => setCopiado(false)
                );
              }}
            >
              <Copy className="h-3.5 w-3.5" /> {copiado ? "Copiado" : "Copiar"}
            </button>
          </div>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-900 p-2 font-mono text-[12px] text-slate-200">{estado.cuerpoPlantilla}</pre>
          <p className="mt-1 text-[11px] text-slate-500">
            Categoría <b>Utility</b>, idioma español. <b>{"{{1}}"}</b> es el saludo («Hola JORGE PLANA»), <b>{"{{2}}"}</b> el centro y <b>{"{{3}}"}</b> el
            material con sus unidades («245/70 R17.5 HANKOOK AH35 136M (2 uds.)»). Cuando la aprueben, su Content SID va en
            RECEPCIONES_WHATSAPP_CONTENT_SID.
          </p>
        </div>
      )}

      {estado && !estado.activado && (
        <div className="mb-3">
          <Aviso tono="info">
            El aviso está apagado: las recepciones se cierran igual y cada una deja aquí su línea explicando que no se mandó. Enciéndelo cuando la plantilla
            esté aprobada.
          </Aviso>
        </div>
      )}

      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Cuándo</th>
            <th className={thCls}>Recepción</th>
            <th className={thCls}>Albarán</th>
            <th className={thCls}>Para</th>
            <th className={thCls}>Móvil</th>
            <th className={thCls}>Resultado</th>
          </tr>
        </thead>
        <tbody>
          {(estado?.avisos.length ?? 0) === 0 && <EmptyRow cols={6} text="Todavía no se ha intentado ningún aviso." />}
          {estado?.avisos.map((a) => (
            <tr key={a.id} className="border-t border-slate-700/60">
              <td className={`${tdCls} whitespace-nowrap text-[12px] text-slate-400`}>{fmtFechaHora(a.createdAt)}</td>
              <td className={tdCls}>
                <Link className="font-bold text-sky-300 hover:underline" to={`/recepciones/recepciones/${a.recepcionId}`}>
                  {a.recepcionNumero || "—"}
                </Link>
              </td>
              <td className={`${tdCls} text-[12px]`}>{a.albaranNumero || "—"}</td>
              <td className={tdCls}>
                <span className="flex items-center gap-2">
                  <MessageCircle className="h-4 w-4 text-slate-500" /> {a.destinatario || <span className="text-slate-500">sin nombre</span>}
                </span>
              </td>
              <td className={`${tdCls} font-mono text-[12px]`}>{a.telefono ?? "—"}</td>
              <td className={tdCls}>
                <Pill className={COLOR_ESTADO_AVISO[a.estado] ?? "bg-slate-700 text-slate-400"}>{ETIQUETA_ESTADO_AVISO[a.estado] ?? a.estado}</Pill>
                {a.motivo && <div className="mt-1 text-[11px] text-slate-400">{a.motivo}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
