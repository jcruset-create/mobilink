/**
 * Diálogos que se repiten: pedir un motivo (queda en la auditoría) y registrar
 * una aceptación simple de un documento.
 */

import { useState, type ReactNode } from "react";
import { CheckField, ErrorBox, Modal, TextAreaField, TextField, btnDanger, btnPrimary, btnSecondary, msgError } from "./ui";

/**
 * Pide un motivo y ejecuta la acción. El error se queda en el diálogo: así no
 * se pierde lo escrito si el servidor dice que no.
 */
export function ModalMotivo({
  titulo,
  etiqueta = "Motivo (obligatorio, queda en la auditoría)",
  boton,
  peligro,
  children,
  onCerrar,
  onAceptar,
}: {
  titulo: string;
  etiqueta?: string;
  boton: string;
  peligro?: boolean;
  children?: ReactNode;
  onCerrar: () => void;
  onAceptar: (motivo: string) => Promise<void>;
}) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const aceptar = async () => {
    setEnviando(true);
    setError(null);
    try {
      await onAceptar(motivo.trim());
    } catch (e) {
      setError(msgError(e));
      setEnviando(false);
    }
  };
  return (
    <Modal
      title={titulo}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Volver
          </button>
          <button className={peligro ? btnDanger : btnPrimary} disabled={!motivo.trim() || enviando} onClick={() => void aceptar()}>
            {enviando ? "…" : boton}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {children}
        <TextAreaField label={etiqueta} value={motivo} onChange={setMotivo} rows={3} />
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}

/**
 * Aceptación simple: nombre de quien acepta y confirmación expresa. Fecha, IP,
 * navegador, hash del documento y versión de condiciones los guarda el servidor.
 */
export function ModalFirma({
  titulo,
  documento,
  nombreInicial,
  presencial,
  onVerPdf,
  onCerrar,
  onFirmar,
}: {
  titulo: string;
  documento: { version: number; termsVersion: string | null; sha256: string; documentType: string };
  nombreInicial: string;
  presencial: boolean;
  onVerPdf: () => void;
  onCerrar: () => void;
  onFirmar: (nombre: string) => Promise<void>;
}) {
  const [nombre, setNombre] = useState(nombreInicial);
  const [acepto, setAcepto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const firmar = async () => {
    setEnviando(true);
    setError(null);
    try {
      await onFirmar(nombre.trim());
    } catch (e) {
      setError(msgError(e));
      setEnviando(false);
    }
  };
  return (
    <Modal
      title={titulo}
      onClose={onCerrar}
      footer={
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onCerrar}>
            Volver
          </button>
          <button className={btnPrimary} disabled={!acepto || !nombre.trim() || enviando} onClick={() => void firmar()}>
            {enviando ? "Registrando…" : "Aceptar y firmar"}
          </button>
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-300">
          {documento.documentType === "annex" ? "Anexo" : "Contrato"} v{documento.version} · condiciones {documento.termsVersion ?? "—"}
        </p>
        <button className="text-[12px] text-sky-300 underline" onClick={onVerPdf}>
          Leer el documento (PDF)
        </button>
        <p className="break-all text-[11px] text-slate-500">Huella SHA-256: {documento.sha256}</p>
        <TextField label={presencial ? "Nombre de quien firma (el cliente, en presencia)" : "Tu nombre completo"} value={nombre} onChange={setNombre} />
        <CheckField
          label={presencial ? "El cliente ha leído el documento y acepta sus condiciones" : "He leído el documento y acepto sus condiciones"}
          checked={acepto}
          onChange={setAcepto}
        />
        <p className="text-[11px] text-slate-500">
          Se guardan la fecha, {presencial ? "el empleado que lo registra" : "tu usuario"}, la IP, el navegador, la huella del documento y la
          versión de las condiciones. Una vez firmado, el documento no se puede cambiar.
        </p>
        {error && <ErrorBox>{error}</ErrorBox>}
      </div>
    </Modal>
  );
}
