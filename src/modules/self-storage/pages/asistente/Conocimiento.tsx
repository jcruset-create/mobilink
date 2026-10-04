/**
 * Asistente IA → Base de conocimiento: CONOCIMIENTO ESTÁTICO (cómo funciona el
 * servicio, contratación online, calculadora, visitas, modelo low cost,
 * preguntas frecuentes). Nunca precios, disponibilidad, horarios ni datos de
 * clientes: eso lo consulta el asistente en Mobilink con herramientas.
 */

import { useCallback, useEffect, useState } from "react";
import * as api from "../../services/api";
import type { EntradaConocimiento } from "../../types";
import { Aviso, Cabecera, CheckField, EmptyRow, ErrorBox, Modal, Pill, SelectField, TableWrap, TextAreaField, TextField, btnDanger, btnMini, btnPrimary, btnSecondary, msgError, tdCls, thCls } from "../../components/ui";
import { useSelfStorage } from "../../contexts/SelfStorageContext";
import { IDIOMAS, etqIdioma } from "../callcenter/formato";
import { ConEstadoAsistente } from "./comun";

function Contenido() {
  const { puede, centros } = useSelfStorage();
  const gestiona = puede("ss.ai.knowledge.manage");
  const [f, setF] = useState({ language: "es", q: "", centerId: "" });
  const [lista, setLista] = useState<EntradaConocimiento[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [editar, setEditar] = useState<EntradaConocimiento | "nueva" | null>(null);
  const [centroCarga, setCentroCarga] = useState("");

  const cargar = useCallback(() => {
    api.conocimientoIA({ language: f.language || undefined, q: f.q || undefined, centerId: f.centerId || undefined }).then(
      (x) => (setLista(x), setError(null)),
      (e) => setError(msgError(e))
    );
  }, [f]);
  useEffect(() => {
    cargar();
  }, [cargar]);

  const cargarInicial = async () => {
    setOk(null);
    try {
      const r = await api.cargarConocimientoInicial({ pack: "tlc", centerId: centroCarga || null });
      setOk(r.nuevas ? `Cargadas ${r.nuevas} entradas (castellano y catalán).${r.yaExistian ? ` ${r.yaExistian} ya existían y no se han tocado.` : ""}` : "Ya estaba cargado: no se ha duplicado ni modificado nada.");
      cargar();
    } catch (e) {
      setError(msgError(e));
    }
  };

  return (
    <div className="space-y-3">
      <Cabecera titulo="Base de conocimiento" descripcion="Sólo conocimiento estático. Los datos dinámicos (disponibilidad, clientes, contratos, centro, incidencias) los consulta el asistente en Mobilink.">
        {gestiona && (
          <button className={btnPrimary} onClick={() => setEditar("nueva")}>
            Nueva entrada
          </button>
        )}
      </Cabecera>
      {gestiona && (
        <section className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-700 bg-slate-800 p-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold">Cargar conocimiento inicial TLC</div>
            <p className="text-[12px] text-slate-400">Castellano y catalán. Usa el nombre comercial y la web de la configuración del Call Center. Se puede repetir: no duplica ni pisa lo que hayáis editado.</p>
          </div>
          <div className="w-56">
            <SelectField label="Para" value={centroCarga} onChange={setCentroCarga}>
              <option value="">Toda la empresa</option>
              {centros.map((c) => (
                <option key={c.id} value={c.id}>
                  Sólo {c.name}
                </option>
              ))}
            </SelectField>
          </div>
          <button className={btnSecondary} onClick={() => void cargarInicial()}>
            Cargar conocimiento inicial TLC
          </button>
        </section>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <SelectField label="Idioma" value={f.language} onChange={(v) => setF((x) => ({ ...x, language: v }))}>
          <option value="">Todos</option>
          {IDIOMAS.map((i) => (
            <option key={i.code} value={i.code}>
              {i.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Ámbito" value={f.centerId} onChange={(v) => setF((x) => ({ ...x, centerId: v }))}>
          <option value="">Todo</option>
          {centros.map((c) => (
            <option key={c.id} value={c.id}>
              Sólo {c.name}
            </option>
          ))}
        </SelectField>
        <TextField label="Buscar" value={f.q} onChange={(v) => setF((x) => ({ ...x, q: v }))} />
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {ok && <Aviso tono="bien">{ok}</Aviso>}
      <TableWrap>
        <thead>
          <tr>
            <th className={thCls}>Categoría</th>
            <th className={thCls}>Pregunta · respuesta</th>
            <th className={thCls}>Idioma</th>
            <th className={thCls}>Prioridad</th>
            <th className={thCls} />
          </tr>
        </thead>
        <tbody>
          {!lista && <EmptyRow cols={5} text="Cargando…" />}
          {lista?.length === 0 && <EmptyRow cols={5} text="Sin entradas. Carga el conocimiento inicial o crea una." />}
          {lista?.map((k) => (
            <tr key={k.id} className={`border-t border-slate-700 align-top ${k.active ? "" : "opacity-50"}`}>
              <td className={`${tdCls} font-mono text-[12px]`}>
                {k.category}
                {k.centerId && <div className="text-[11px] text-slate-400">{centros.find((c) => c.id === k.centerId)?.name ?? "centro"}</div>}
              </td>
              <td className={tdCls}>
                <div className="font-semibold">{k.question}</div>
                <div className="text-[12px] text-slate-300">{k.answer}</div>
                {k.seedKey && <Pill className="mt-1 bg-slate-700 text-slate-300">inicial</Pill>}
              </td>
              <td className={tdCls}>{etqIdioma(k.language)}</td>
              <td className={tdCls}>{k.priority}</td>
              <td className={`${tdCls} text-right`}>
                {gestiona && (
                  <button className={btnMini} onClick={() => setEditar(k)}>
                    Editar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
      {editar && (
        <FormConocimiento
          k={editar === "nueva" ? null : editar}
          onCerrar={() => setEditar(null)}
          onHecho={() => {
            setEditar(null);
            cargar();
          }}
        />
      )}
    </div>
  );
}

function FormConocimiento({ k, onCerrar, onHecho }: { k: EntradaConocimiento | null; onCerrar: () => void; onHecho: () => void }) {
  const { centros } = useSelfStorage();
  const [d, setD] = useState({
    category: k?.category ?? "faq",
    question: k?.question ?? "",
    answer: k?.answer ?? "",
    language: k?.language ?? "es",
    priority: String(k?.priority ?? 0),
    active: k?.active ?? true,
    centerId: k?.centerId ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof d>(c: K, v: (typeof d)[K]) => setD((x) => ({ ...x, [c]: v }));
  const guardar = async () => {
    const cuerpo = { category: d.category.trim(), question: d.question.trim(), answer: d.answer.trim(), language: d.language, priority: Number(d.priority) || 0, active: d.active, centerId: d.centerId || null };
    try {
      if (k) await api.editarConocimiento(k.id, cuerpo);
      else await api.crearConocimiento(cuerpo);
      onHecho();
    } catch (e) {
      setError(msgError(e));
    }
  };
  const borrar = async () => {
    if (!k || !window.confirm("¿Borrar esta entrada?")) return;
    try {
      await api.borrarConocimiento(k.id);
      onHecho();
    } catch (e) {
      setError(msgError(e));
    }
  };
  return (
    <Modal
      title={k ? "Editar conocimiento" : "Nuevo conocimiento"}
      onClose={onCerrar}
      footer={
        <div className="flex justify-between gap-2">
          <span>
            {k && (
              <button className={btnDanger} onClick={() => void borrar()}>
                Borrar
              </button>
            )}
          </span>
          <span className="flex gap-2">
            <button className={btnSecondary} onClick={onCerrar}>
              Cancelar
            </button>
            <button className={btnPrimary} disabled={!d.question.trim() || !d.answer.trim()} onClick={() => void guardar()}>
              Guardar
            </button>
          </span>
        </div>
      }
    >
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <TextField label="Categoría" value={d.category} onChange={(v) => set("category", v.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
          <SelectField label="Idioma" value={d.language} onChange={(v) => set("language", v)}>
            {IDIOMAS.map((i) => (
              <option key={i.code} value={i.code}>
                {i.label}
              </option>
            ))}
          </SelectField>
          <TextField label="Prioridad (0–100)" type="number" value={d.priority} onChange={(v) => set("priority", v)} />
          <SelectField label="Ámbito" value={d.centerId} onChange={(v) => set("centerId", v)}>
            <option value="">Toda la empresa</option>
            {centros.map((c) => (
              <option key={c.id} value={c.id}>
                Sólo {c.name}
              </option>
            ))}
          </SelectField>
        </div>
        <TextField label="Pregunta" value={d.question} onChange={(v) => set("question", v)} />
        <TextAreaField label="Respuesta" value={d.answer} onChange={(v) => set("answer", v)} rows={4} />
        <CheckField label="Activa" checked={d.active} onChange={(v) => set("active", v)} />
        <p className="text-[12px] text-slate-400">No pongas precios, disponibilidad, horarios ni datos de clientes: cambian, y el asistente los consulta en Mobilink.</p>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}

export default function Conocimiento() {
  return <ConEstadoAsistente>{() => <Contenido />}</ConEstadoAsistente>;
}
