import { describe, expect, it } from "vitest";
import {
  CADUCIDAD_HORAS,
  caducidadDesde,
  dniValido,
  esTipoDocumento,
  faltaParaEnviar,
  fechaIso,
  hashToken,
  motivoCerrado,
  movilValido,
  nuevoToken,
  textoSms,
  urlDeAlta,
  validarFicha,
  motivoDeInvitacion,
  estadoTrasInvitar,
  textoSmsActualizacion,
  resumenVerificacion,
  certificacionesDeLectura,
  fichaDeLectura,
} from "./altaOperario";

describe("dniValido", () => {
  it("acepta un DNI con su letra", () => {
    expect(dniValido("39882775Q")).toBe(true);
    expect(dniValido("49653420P")).toBe(true);
  });

  it("acepta un NIE y le aplica el prefijo", () => {
    expect(dniValido("X7054885A")).toBe(true);
    expect(dniValido("Z2492594C")).toBe(true);
  });

  it("rechaza la letra que no toca, que es el error que no se ve", () => {
    expect(dniValido("39882775A")).toBe(false);
  });

  it("rechaza lo que ni siquiera tiene forma de DNI", () => {
    expect(dniValido("")).toBe(false);
    expect(dniValido("123")).toBe(false);
    expect(dniValido("ABCDEFGHI")).toBe(false);
  });
});

describe("movilValido", () => {
  it("devuelve el número en E.164 lo escriba como lo escriba", () => {
    expect(movilValido("610473077")).toBe("+34610473077");
    expect(movilValido("+34 610 47 30 77")).toBe("+34610473077");
    expect(movilValido("0034610473077")).toBe("+34610473077");
  });

  it("un fijo no es un móvil: el SMS no llegaría", () => {
    expect(movilValido("977123456")).toBeNull();
  });

  it("rechaza lo que no son nueve cifras", () => {
    expect(movilValido("61047307")).toBeNull();
    expect(movilValido("")).toBeNull();
  });
});

describe("fechaIso", () => {
  it("entiende los dos órdenes que ofrece el teclado del móvil", () => {
    expect(fechaIso("14/03/1994")).toBe("1994-03-14");
    expect(fechaIso("1994-03-14")).toBe("1994-03-14");
    expect(fechaIso("2/9/2031")).toBe("2031-09-02");
  });

  it("no inventa una fecha que no existe", () => {
    expect(fechaIso("31/02/2026")).toBeNull();
    expect(fechaIso("14/13/1994")).toBeNull();
    expect(fechaIso("mañana")).toBeNull();
  });
});

describe("validarFicha", () => {
  it("solo guarda los campos de la lista blanca", () => {
    const { ficha } = validarFicha({
      nombre: "Maria Germy",
      rol: "admin",
      activo: false,
      codigo_operario: "1",
    });
    expect(ficha.empleado).toEqual({ nombre: "Maria Germy" });
    expect(ficha.empleado).not.toHaveProperty("rol");
    expect(ficha.empleado).not.toHaveProperty("codigo_operario");
  });

  it("un borrador con un error se guarda igual: solo no deja enviar", () => {
    const { ficha, errores } = validarFicha({ nombre: "Maria", dni_nie: "39882775A" });
    expect(ficha.empleado.nombre).toBe("Maria");
    expect(errores).toHaveLength(1);
    expect(errores[0]).toContain("DNI");
  });

  it("normaliza el móvil al guardarlo", () => {
    const { ficha, errores } = validarFicha({ telefono: "610 473 077" });
    expect(ficha.empleado.telefono).toBe("+34610473077");
    expect(errores).toEqual([]);
  });

  it("al enviar exige lo que no puede faltar en una ficha", () => {
    const { errores } = validarFicha({ nombre: "Maria" }, true);
    expect(errores.join(" ")).toContain("los apellidos");
    expect(errores.join(" ")).toContain("el DNI");
  });

  it("las tallas van aparte, a su tabla", () => {
    const { ficha } = validarFicha({ tallas: { calzado: "39", inventada: "XL" } });
    expect(ficha.tallas).toEqual({ calzado: "39" });
  });

  it("un campo vacío se guarda como nulo, no como cadena vacía", () => {
    const { ficha } = validarFicha({ email: "   " });
    expect(ficha.empleado.email).toBeNull();
  });
});

describe("faltaParaEnviar", () => {
  const completo = {
    foto: true,
    documentos: ["dni_anverso", "dni_reverso"],
    consentimientos: { normativa: true, datos: true },
    firma: true,
  };

  it("con el DNI, los dos permisos y la firma, se puede enviar", () => {
    expect(faltaParaEnviar(completo)).toEqual([]);
  });

  it("el carnet no se exige: hay puestos que no conducen", () => {
    expect(faltaParaEnviar({ ...completo, documentos: ["dni_anverso", "dni_reverso"] })).toEqual([]);
  });

  it("sin las dos caras del DNI no se envía", () => {
    expect(faltaParaEnviar({ ...completo, documentos: ["dni_anverso"] })).toHaveLength(1);
  });

  it("el permiso de WhatsApp es opcional; los otros dos no", () => {
    expect(faltaParaEnviar({ ...completo, consentimientos: { normativa: true, datos: true, whatsapp: false } })).toEqual([]);
    expect(faltaParaEnviar({ ...completo, consentimientos: { normativa: true } })).toHaveLength(1);
  });

  it("sin firma no se envía", () => {
    expect(faltaParaEnviar({ ...completo, firma: false })).toHaveLength(1);
  });

  it("sin la foto de la persona no se envía, y es lo primero que se pide", () => {
    expect(faltaParaEnviar({ ...completo, foto: false })).toEqual(["Falta tu foto."]);
    expect(faltaParaEnviar({ ...completo, foto: false, firma: false })[0]).toBe("Falta tu foto.");
  });
});

describe("el enlace", () => {
  it("cada token es distinto y del hash no se vuelve", () => {
    const a = nuevoToken();
    const b = nuevoToken();
    expect(a).not.toBe(b);
    expect(hashToken(a)).toHaveLength(64);
    expect(hashToken(a)).not.toContain(a);
    expect(hashToken(a)).toBe(hashToken(a));
  });

  it("caduca a las 72 horas", () => {
    const ahora = Date.UTC(2026, 10, 16, 12, 0, 0);
    expect(caducidadDesde(ahora).getTime() - ahora).toBe(CADUCIDAD_HORAS * 3600_000);
  });

  it("la URL no duplica la barra del dominio", () => {
    expect(urlDeAlta("https://mobilink-solutions.com/", "abc")).toBe(
      "https://mobilink-solutions.com/alta/abc"
    );
  });

  it("el SMS dice de parte de quién va y cuánto dura", () => {
    const sms = textoSms({ empresa: "COMERCIAL SEA", nombre: "Maria", url: "https://x.es/alta/t" });
    expect(sms.startsWith("COMERCIAL SEA:")).toBe(true);
    expect(sms).toContain("https://x.es/alta/t");
    expect(sms).toContain("72 h");
  });
});

describe("motivoCerrado", () => {
  const ahora = Date.UTC(2026, 10, 16, 12, 0, 0);
  const viva = { estado: "enviado" as const, caduca_at: new Date(ahora + 3600_000).toISOString() };

  it("una invitación viva se puede abrir", () => {
    expect(motivoCerrado(viva, ahora)).toBeNull();
  });

  it("un token que no existe no dice por qué", () => {
    expect(motivoCerrado(null, ahora)).toBe("no_existe");
  });

  it("caducada, anulada y ya enviada se distinguen para poder explicarlas", () => {
    expect(motivoCerrado({ ...viva, caduca_at: new Date(ahora - 1).toISOString() }, ahora)).toBe("caducada");
    expect(motivoCerrado({ ...viva, estado: "anulada" }, ahora)).toBe("anulada");
    expect(motivoCerrado({ ...viva, estado: "recibida" }, ahora)).toBe("ya_enviada");
  });
});

describe("esTipoDocumento", () => {
  it("solo las cuatro fotos que se piden", () => {
    expect(esTipoDocumento("dni_anverso")).toBe(true);
    expect(esTipoDocumento("carnet_reverso")).toBe(true);
    expect(esTipoDocumento("nomina")).toBe(false);
    expect(esTipoDocumento(null)).toBe(false);
  });
});

describe("alta o actualizacion", () => {
  it("a quien ya esta completo se le pide una actualizacion, no un alta", () => {
    expect(motivoDeInvitacion("completa")).toBe("actualizacion");
  });

  it("a quien esta a medias se le sigue pidiendo el alta", () => {
    expect(motivoDeInvitacion("pendiente")).toBe("alta");
    expect(motivoDeInvitacion("recibida")).toBe("alta");
    expect(motivoDeInvitacion(null)).toBe("alta");
  });

  it("la ficha no vuelve a «enviado» cuando es una actualizacion", () => {
    expect(estadoTrasInvitar("actualizacion")).toBe("actualizando");
    expect(estadoTrasInvitar("alta")).toBe("enviado");
  });

  it("el SMS de actualizacion dice que la ficha ya esta empezada", () => {
    const sms = textoSmsActualizacion({ empresa: "COMERCIAL SEA", nombre: "Albert", url: "https://x.es/alta/t" });
    expect(sms).toContain("repasa y actualiza");
    expect(sms).toContain("Ya tienes la ficha empezada");
    expect(sms).not.toContain("terminar tu alta");
  });

  it("la nota del encargado viaja en el SMS", () => {
    const sms = textoSmsActualizacion({
      empresa: "COMERCIAL SEA", nombre: "Albert", url: "https://x.es/alta/t",
      nota: "La foto del DNI sale movida.",
    });
    expect(sms).toContain("La foto del DNI sale movida.");
  });
});

describe("resumenVerificacion", () => {
  const campo = (veredicto: "coincide" | "no_coincide" | "ilegible") => ({
    campo: "dni_nie", tecleado: "x", leido: "y", veredicto, nota: "",
  });

  it("sin verificacion no hay problemas que enseñar", () => {
    expect(resumenVerificacion(null)).toEqual({ coinciden: 0, noCoinciden: 0, ilegibles: 0, hayProblemas: false });
  });

  it("cuenta cada veredicto por separado", () => {
    const r = resumenVerificacion({
      campos: [campo("coincide"), campo("coincide"), campo("ilegible"), campo("no_coincide")],
      resumen: "",
    });
    expect(r).toEqual({ coinciden: 2, noCoinciden: 1, ilegibles: 1, hayProblemas: true });
  });

  it("lo ilegible no es un problema: es una foto mala, no un dato falso", () => {
    const r = resumenVerificacion({ campos: [campo("ilegible"), campo("coincide")], resumen: "" });
    expect(r.hayProblemas).toBe(false);
  });
});

describe("lo que dice la documentacion", () => {
  const lectura = {
    identidad: { numero: "39882775Q", caducidad: "02/09/2031", nota: "" },
    carnet: {
      numero: "39882775Q",
      caducidad: "14/03/2029",
      clases: [
        { clase: "b", caducidad: "14/03/2029" },
        { clase: "C+E", caducidad: "14/03/2027" },
        { clase: "AM", caducidad: null },
      ],
      capNumero: "123456",
      capCaducidad: "01/06/2028",
      nota: "",
    },
  };

  it("una certificacion por clase CON fecha, mas el CAP", () => {
    const c = certificacionesDeLectura(lectura);
    expect(c).toEqual([
      { nombre: "Carnet de conducir B", caducidad: "2029-03-14", numero: "39882775Q" },
      { nombre: "Carnet de conducir C+E", caducidad: "2027-03-14", numero: "39882775Q" },
      { nombre: "CAP", caducidad: "2028-06-01", numero: "123456" },
    ]);
  });

  it("una clase sin fecha no se anota: no habria nada que avisar", () => {
    expect(certificacionesDeLectura(lectura).some((c) => c.nombre.includes("AM"))).toBe(false);
  });

  it("sin lectura no hay nada que proponer", () => {
    expect(certificacionesDeLectura(null)).toEqual([]);
  });

  it("la ficha se rellena con lo leido, con las fechas en formato base", () => {
    expect(fichaDeLectura(lectura)).toEqual({
      dni_caducidad: "2031-09-02",
      carnet_numero: "39882775Q",
      carnet_caducidad: "2029-03-14",
      carnet_clases: "B, C+E, AM",
      cap_numero: "123456",
      cap_caducidad: "2028-06-01",
    });
  });

  it("lo que no se ha leido no se escribe: no borra lo que ya hubiera", () => {
    const vacia = {
      identidad: { numero: null, caducidad: null, nota: "ilegible" },
      carnet: { numero: null, caducidad: null, clases: [], capNumero: null, capCaducidad: null, nota: "" },
    };
    expect(fichaDeLectura(vacia)).toEqual({});
  });

  it("una fecha que no se entiende no pasa a la ficha", () => {
    const rara = {
      ...lectura,
      identidad: { numero: "X", caducidad: "el mes que viene", nota: "" },
    };
    expect(fichaDeLectura(rara).dni_caducidad).toBeUndefined();
  });
});

