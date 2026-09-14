/**
 * Alta de un expediente a mano.
 *
 * En cuanto entre la ingesta de correo, éste será el camino excepcional: la
 * incidencia que llega por teléfono o la que alguien detecta antes de que
 * Therefore la mande. Existe desde el principio porque sin él la bandeja no se
 * puede ni ver funcionando.
 *
 * El importe se escribe en euros y se manda en céntimos: la conversión la hace
 * `aCentimos`, que tiene pruebas, y no el servidor, que rechaza cualquier cosa
 * que no sean céntimos enteros. Un `45.63` colado como céntimos serían 45
 * céntimos.
 */

import { useState } from "react";
import * as api from "../services/api";
import { useTherefore } from "../contexts/ThereforeContext";
import {
  Aviso,
  CheckField,
  ErrorBox,
  Modal,
  SelectField,
  TextAreaField,
  TextField,
  btnPrimary,
  btnSecondary,
} from "./ui";
import { ETIQUETA_TIPO } from "../types";
import { aCentimos } from "../../cash/utils/money";

export default function NuevoExpediente({
  onCerrar,
  onCreado,
}: {
  onCerrar: () => void;
  onCreado: (id: string) => void;
}) {
  const { vocabulario } = useTherefore();

  const [tipo, setTipo] = useState("INCIDENCIA_ALBARAN");
  const [empresaCodigo, setEmpresaCodigo] = useState("");
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [proveedorCodigo, setProveedorCodigo] = useState("");
  const [proveedorNombre, setProveedorNombre] = useState("");
  const [cuentaContable, setCuentaContable] = useState("");
  const [facturaNumero, setFacturaNumero] = useState("");
  const [facturaFecha, setFacturaFecha] = useState("");
  const [importe, setImporte] = useState("");
  const [casoReferencia, setCasoReferencia] = useState("");
  const [urgente, setUrgente] = useState(false);
  const [observaciones, setObservaciones] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const importeCentimos = importe.trim() ? aCentimos(importe) : null;
  const importeMal = importe.trim().length > 0 && importeCentimos === null;

  async function guardar() {
    if (importeMal) {
      setError("El importe no se entiende. Escríbelo como -45,63.");
      return;
    }
    setGuardando(true);
    try {
      const ficha = await api.crearExpediente({
        tipo,
        empresaCodigo,
        empresaNombre,
        proveedorCodigo,
        proveedorNombre,
        cuentaContable,
        facturaNumero,
        facturaFecha: facturaFecha || null,
        importeCentimos,
        casoReferencia,
        urgente,
        observaciones,
      });
      onCreado(ficha.expediente.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se ha podido crear el expediente");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      title="Nuevo expediente"
      onClose={onCerrar}
      wide
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onCerrar} className={btnSecondary}>
            Cancelar
          </button>
          <button onClick={() => void guardar()} className={btnPrimary} disabled={guardando}>
            {guardando ? "Creando…" : "Crear expediente"}
          </button>
        </div>
      }
    >
      {error && <ErrorBox>{error}</ErrorBox>}

      <div className="mb-3">
        <Aviso tono="info">
          Las actuaciones —qué albarán hay que grabar o modificar— se añaden después, desde el
          expediente.
        </Aviso>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Tipo" value={tipo} onChange={setTipo}>
          {(vocabulario?.tipos ?? ["INCIDENCIA_ALBARAN"]).map((t) => (
            <option key={t} value={t}>
              {ETIQUETA_TIPO[t] ?? t}
            </option>
          ))}
        </SelectField>
        <TextField
          label="Empresa (código del ERP)"
          value={empresaCodigo}
          onChange={setEmpresaCodigo}
          placeholder="007"
        />
        <TextField label="Nombre de la empresa" value={empresaNombre} onChange={setEmpresaNombre} />
        <TextField label="Código de proveedor" value={proveedorCodigo} onChange={setProveedorCodigo} />
        <TextField label="Razón social" value={proveedorNombre} onChange={setProveedorNombre} />
        <TextField label="Cuenta contable" value={cuentaContable} onChange={setCuentaContable} />
        <TextField label="Número de factura" value={facturaNumero} onChange={setFacturaNumero} />
        <TextField
          label="Fecha de factura"
          value={facturaFecha}
          onChange={setFacturaFecha}
          type="date"
        />
        <TextField
          label="Importe (€, negativo si es abono)"
          value={importe}
          onChange={setImporte}
          placeholder="-45,63"
        />
        <TextField label="Caso de Therefore" value={casoReferencia} onChange={setCasoReferencia} />
      </div>

      {importeMal && (
        <p className="mt-1 text-[12px] text-rose-300">
          No se entiende el importe. Escríbelo como -45,63.
        </p>
      )}

      <div className="mt-3 space-y-3">
        <CheckField label="Marcado como urgente" checked={urgente} onChange={setUrgente} />
        <TextAreaField
          label="Observaciones"
          value={observaciones}
          onChange={setObservaciones}
          rows={3}
        />
      </div>
    </Modal>
  );
}
