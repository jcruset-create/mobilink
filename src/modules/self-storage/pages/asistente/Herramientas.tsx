/**
 * Asistente IA → Herramientas: lo único con lo que la IA lee o toca Mobilink.
 * Lectura: activas por defecto. Escritura segura: sólo si se activan aquí.
 * Sensibles: bloqueadas siempre en esta versión (se registran los intentos).
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../../services/api";
import type { HerramientaIA } from "../../types";
import { Cabecera, ErrorBox, TableWrap, btnMini, msgError, tdCls, thCls } from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { ChipRiesgo, ConEstadoAsistente } from "./comun";

function Contenido() {
  const { puede } = useSelfStorage();
  const gestiona = puede("ss.ai.tools.manage");
  const [lista, setLista] = useState<HerramientaIA[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(() => {
    api.herramientasIA().then(
      (x) => (setLista(x), setError(null)),
      (e) => setError(msgError(e))
    );
  }, []);
  useEffect(() => {
    cargar();
  }, [cargar]);
  const cambiar = (h: HerramientaIA, d: { active?: boolean; requiresConfirmation?: boolean }) => void api.editarHerramientaIA(h.nombre, d).then(cargar, (e) => setError(msgError(e)));
  return (
    <div className="space-y-3">
      <Cabecera titulo="Herramientas" descripcion="Todas pasan por los servicios de Mobilink, con sus reglas y permisos, y quedan registradas. La IA nunca accede a la base de datos." />
      {error && <ErrorBox>{error}</ErrorBox>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Herramienta</th>
            <th className={thCls}>Riesgo</th>
            <th className={thCls}>Permiso</th>
            <th className={thCls}>Estado</th>
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {lista?.map((h) => (
            <tr key={h.nombre} className="border-t border-slate-700 align-top">
              <td className={tdCls}>
                <div className="font-mono text-[12px] font-semibold">{h.nombre}</div>
                <div className="text-[12px] text-slate-400">{h.descripcion}</div>
                <div className="font-mono text-[11px] text-slate-500">{h.parametros}</div>
              </td>
              <td className={tdCls}>
                <ChipRiesgo r={h.riesgo} />
              </td>
              <td className={`${tdCls} font-mono text-[11px] text-slate-400`}>{h.permiso ?? "—"}</td>
              <td className={`${tdCls} text-[12px]`}>
                {h.riesgo === "SENSITIVE" ? "Bloqueada siempre" : h.active ? (h.requiresConfirmation ? "Activa · pide confirmación (se bloquea y escala)" : "Activa") : "Desactivada"}
              </td>
              <td className={`${tdCls} space-x-1 text-right`}>
                {gestiona && h.riesgo !== "SENSITIVE" && (
                  <>
                    <button className={btnMini} onClick={() => cambiar(h, { active: !h.active })}>
                      {h.active ? "Desactivar" : "Activar"}
                    </button>
                    <button className={btnMini} onClick={() => cambiar(h, { requiresConfirmation: !h.requiresConfirmation })}>
                      {h.requiresConfirmation ? "Sin confirmación" : "Pedir confirmación"}
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

export default function Herramientas() {
  return <ConEstadoAsistente>{() => <Contenido />}</ConEstadoAsistente>;
}
