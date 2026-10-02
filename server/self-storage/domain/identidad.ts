/**
 * NIF/NIE/CIF y teléfonos de los clientes de Self Storage.
 *
 * El documento se guarda NORMALIZADO (mayúsculas, sin espacios ni guiones):
 * es lo que permite que «12345678-z» y «12345678Z» sean el mismo cliente y que
 * el UNIQUE (empresa_id, tax_id) de la base los detecte como duplicado.
 *
 * Para clientes españoles se comprueba el dígito/letra de control. Para
 * extranjeros (país ≠ ES) sólo la forma: un pasaporte o un VAT de otro país no
 * tiene una regla común que se pueda verificar aquí.
 */

import { ErrorSelfStorage } from "../errors.ts";

const LETRAS_DNI = "TRWAGMYFPDXBNJZSQVHLCKE";

export function normalizarDocumento(doc: string): string {
  return String(doc ?? "")
    .toUpperCase()
    .replace(/[\s.\-_/]/g, "");
}

function dniValido(d: string): boolean {
  const m = /^(\d{8})([A-Z])$/.exec(d);
  return !!m && LETRAS_DNI[Number(m[1]) % 23] === m[2];
}

function nieValido(d: string): boolean {
  const m = /^([XYZ])(\d{7})([A-Z])$/.exec(d);
  if (!m) return false;
  const num = Number(String("XYZ".indexOf(m[1])) + m[2]);
  return LETRAS_DNI[num % 23] === m[3];
}

function cifValido(d: string): boolean {
  const m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(d);
  if (!m) return false;
  const digitos = m[2];
  let suma = 0;
  for (let i = 0; i < 7; i++) {
    let n = Number(digitos[i]);
    if (i % 2 === 0) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    suma += n;
  }
  const control = (10 - (suma % 10)) % 10;
  const letra = "JABCDEFGHI"[control];
  const tipo = m[1];
  const c = m[3];
  // Unas letras de organización exigen letra de control, otras número, y el
  // resto admite las dos.
  if ("PQRSNW".includes(tipo)) return c === letra;
  if ("ABEH".includes(tipo)) return c === String(control);
  return c === String(control) || c === letra;
}

export type TipoDocumento = "DNI" | "NIE" | "CIF" | "EXTRANJERO";

/** Valida y devuelve el documento normalizado y su tipo. */
export function validarDocumento(doc: string, pais = "ES"): { valor: string; tipo: TipoDocumento } {
  const d = normalizarDocumento(doc);
  if (!d) throw new ErrorSelfStorage("DOCUMENTO_OBLIGATORIO", "El NIF/NIE/CIF es obligatorio.", 422);

  if (pais.toUpperCase() !== "ES") {
    if (!/^[A-Z0-9]{5,20}$/.test(d)) {
      throw new ErrorSelfStorage("DOCUMENTO_NO_VALIDO", "El documento sólo puede tener letras y números (5 a 20).", 422);
    }
    return { valor: d, tipo: "EXTRANJERO" };
  }
  if (dniValido(d)) return { valor: d, tipo: "DNI" };
  if (nieValido(d)) return { valor: d, tipo: "NIE" };
  if (cifValido(d)) return { valor: d, tipo: "CIF" };
  throw new ErrorSelfStorage("DOCUMENTO_NO_VALIDO", `«${doc}» no es un DNI, NIE o CIF válido (revisa la letra de control).`, 422);
}

/**
 * Teléfono a E.164. Un número español de 9 cifras (6, 7, 8 o 9 delante) recibe
 * +34; «0034…» pasa a «+34…». Lo demás tiene que venir ya con su prefijo.
 */
export function normalizarTelefono(tel: string): string {
  let s = String(tel ?? "").replace(/[\s.\-()/]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (/^[6789]\d{8}$/.test(s)) s = "+34" + s;
  if (!/^\+[1-9]\d{6,14}$/.test(s)) {
    throw new ErrorSelfStorage("TELEFONO_NO_VALIDO", `«${tel}» no es un teléfono válido. Usa el prefijo internacional si no es español.`, 422);
  }
  if (s.startsWith("+34") && !/^\+34[6789]\d{8}$/.test(s)) {
    throw new ErrorSelfStorage("TELEFONO_NO_VALIDO", `«${tel}» no es un teléfono español válido.`, 422);
  }
  return s;
}
