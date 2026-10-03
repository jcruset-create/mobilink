import { describe, expect, it } from "vitest";
import { dentroDeHorario, evaluateAccess, puertasDelContrato, telefonosDeseados, type Actor, type HechosContrato, type HechosPuerta } from "./accesos.ts";

const AHORA = new Date("2026-10-07T10:00:00Z"); // miércoles, 12:00 en Madrid

const puerta = (extra: Partial<HechosPuerta> = {}): HechosPuerta => ({
  id: "p-main",
  centerId: "c1",
  enabled: true,
  allowApp: true,
  allowPhone: true,
  schedule: null,
  timezone: "Europe/Madrid",
  salida: { enabled: true, dispositivo: { enabled: true, status: "online" } },
  ...extra,
});
const contrato = (extra: Partial<HechosContrato> = {}): HechosContrato => ({
  id: "k1",
  status: "active",
  puertaDerivada: true,
  permiso: { validFrom: null, validUntil: null, source: "contract" },
  bloqueos: [],
  ...extra,
});
const cliente = (contratos: HechosContrato[], customerStatus = "active"): Actor => ({ tipo: "customer", customerStatus, contratos });

describe("puertas que corresponden a un contrato", () => {
  const puertas = [
    { id: "main", centerId: "c1", zoneId: null, doorType: "main" as const, enabled: true },
    { id: "z1", centerId: "c1", zoneId: "zona-1", doorType: "zone" as const, enabled: true },
    { id: "z2", centerId: "c1", zoneId: "zona-2", doorType: "zone" as const, enabled: true },
    { id: "z3", centerId: "c1", zoneId: "zona-3", doorType: "zone" as const, enabled: true },
    { id: "int", centerId: "c1", zoneId: null, doorType: "internal" as const, enabled: true },
    { id: "otro-centro", centerId: "c2", zoneId: null, doorType: "main" as const, enabled: true },
  ];
  it("contrato en Zona 2 → principal + Zona 2; ni Zona 1 ni 3, ni interiores, ni otro centro", () => {
    expect(puertasDelContrato(puertas, { centerId: "c1", unitZoneId: "zona-2" })).toEqual(["main", "z2"]);
  });
});

describe("evaluateAccess", () => {
  it("contrato activo con permiso: abre", () => {
    expect(evaluateAccess(puerta(), cliente([contrato()]), AHORA, "app")).toEqual({ granted: true, reason: "GRANTED", contractId: "k1" });
  });

  it("puerta de otra zona: no", () => {
    expect(evaluateAccess(puerta(), cliente([contrato({ puertaDerivada: false, permiso: null })]), AHORA, "app").reason).toBe("DOOR_NOT_ALLOWED");
  });

  it("un permiso guardado no basta si la puerta ya no corresponde al contrato", () => {
    expect(evaluateAccess(puerta(), cliente([contrato({ puertaDerivada: false })]), AHORA, "app").reason).toBe("DOOR_NOT_ALLOWED");
    // …salvo que sea un permiso manual.
    expect(evaluateAccess(puerta(), cliente([contrato({ puertaDerivada: false, permiso: { validFrom: null, validUntil: null, source: "manual" } })]), AHORA, "app").granted).toBe(true);
  });

  it("bloqueos: cada uno tiene su motivo y se enseña el más grave", () => {
    const r = (b: HechosContrato["bloqueos"], status: HechosContrato["status"] = "suspended") => evaluateAccess(puerta(), cliente([contrato({ status, bloqueos: b })]), AHORA, "app").reason;
    expect(r(["payment"])).toBe("PAYMENT_BLOCK");
    expect(r(["security"])).toBe("SECURITY_BLOCK");
    expect(r(["payment", "security"])).toBe("SECURITY_BLOCK");
    expect(r(["manual"])).toBe("MANUAL_BLOCK");
    expect(r(["terminated"], "terminated")).toBe("CONTRACT_TERMINATED");
    // Un bloqueo abierto manda aunque el contrato siga «active».
    expect(r(["security"], "active")).toBe("SECURITY_BLOCK");
  });

  it("contrato pendiente de pago o cliente bloqueado: no", () => {
    expect(evaluateAccess(puerta(), cliente([contrato({ status: "pending_payment", permiso: null })]), AHORA, "app").reason).toBe("CONTRACT_NOT_ACTIVE");
    expect(evaluateAccess(puerta(), cliente([contrato()], "blocked"), AHORA, "app").reason).toBe("CUSTOMER_BLOCKED");
  });

  it("dos contratos: abre si CUALQUIERA lo permite", () => {
    const bloqueado = contrato({ id: "k1", status: "suspended", bloqueos: ["payment"] });
    const bueno = contrato({ id: "k2" });
    expect(evaluateAccess(puerta(), cliente([bloqueado, bueno]), AHORA, "app")).toMatchObject({ granted: true, contractId: "k2" });
  });

  it("horario: fuera, no (la apertura administrativa sí)", () => {
    const p = puerta({ schedule: { rules: [{ days: [1, 2, 3, 4, 5], from: "07:00", to: "11:00" }] } });
    expect(evaluateAccess(p, cliente([contrato()]), AHORA, "app").reason).toBe("OUTSIDE_SCHEDULE");
    expect(evaluateAccess(p, { tipo: "staff" }, AHORA, "admin").granted).toBe(true);
  });

  it("método: puerta sin app o persona sin llamada", () => {
    expect(evaluateAccess(puerta({ allowApp: false }), cliente([contrato()]), AHORA, "app").reason).toBe("METHOD_NOT_ALLOWED");
    const maria: Actor = { tipo: "member", memberStatus: "active", allowApp: true, allowPhone: false, customerStatus: "active", contratos: [contrato()] };
    expect(evaluateAccess(puerta(), maria, AHORA, "phone").reason).toBe("METHOD_NOT_ALLOWED");
    expect(evaluateAccess(puerta(), maria, AHORA, "app").granted).toBe(true);
    expect(evaluateAccess(puerta(), { ...maria, memberStatus: "revoked" } as Actor, AHORA, "app").reason).toBe("MEMBER_NOT_ACTIVE");
  });

  it("accesos temporales: fechas, usos, puertas y contrato del que dependen", () => {
    const base = { tipo: "temporary" as const, status: "active", startsAt: new Date("2026-10-07T00:00:00Z"), endsAt: new Date("2026-10-08T00:00:00Z"), maxUses: 1, usesCount: 0, doorIds: ["p-main"], customerStatus: "active", contratos: [contrato()], dependeDeContrato: true };
    expect(evaluateAccess(puerta(), base, AHORA, "temporary_link").granted).toBe(true);
    expect(evaluateAccess(puerta(), { ...base, usesCount: 1 }, AHORA, "temporary_link").reason).toBe("TEMPORARY_ACCESS_EXHAUSTED");
    expect(evaluateAccess(puerta(), { ...base, endsAt: new Date("2026-10-07T09:00:00Z") }, AHORA, "temporary_link").reason).toBe("TEMPORARY_ACCESS_EXPIRED");
    expect(evaluateAccess(puerta(), { ...base, startsAt: new Date("2026-10-07T11:00:00Z") }, AHORA, "temporary_link").reason).toBe("TEMPORARY_ACCESS_NOT_STARTED");
    expect(evaluateAccess(puerta(), { ...base, status: "revoked" }, AHORA, "temporary_link").reason).toBe("TEMPORARY_ACCESS_REVOKED");
    expect(evaluateAccess(puerta({ id: "otra" }), base, AHORA, "temporary_link").reason).toBe("DOOR_NOT_ALLOWED");
    // El contrato principal bloqueado arrastra al temporal.
    expect(evaluateAccess(puerta(), { ...base, contratos: [contrato({ status: "suspended", bloqueos: ["payment"] })] }, AHORA, "temporary_link").reason).toBe("PAYMENT_BLOCK");
  });

  it("dispositivo: sin salida, deshabilitado u offline → no abre (sin falsos positivos)", () => {
    expect(evaluateAccess(puerta({ salida: null }), cliente([contrato()]), AHORA, "app").reason).toBe("DEVICE_NOT_CONFIGURED");
    expect(evaluateAccess(puerta({ salida: { enabled: true, dispositivo: { enabled: false, status: "online" } } }), cliente([contrato()]), AHORA, "app").reason).toBe("DEVICE_DISABLED");
    expect(evaluateAccess(puerta({ salida: { enabled: true, dispositivo: { enabled: true, status: "offline" } } }), cliente([contrato()]), AHORA, "app").reason).toBe("DEVICE_OFFLINE");
    // Un bloqueo se enseña antes que el estado del dispositivo.
    expect(evaluateAccess(puerta({ salida: null }), cliente([contrato({ bloqueos: ["security"] })]), AHORA, "app").reason).toBe("SECURITY_BLOCK");
  });
});

describe("horario", () => {
  it("tramo que cruza la medianoche y zona horaria del centro", () => {
    const h = { rules: [{ days: [3], from: "22:00", to: "02:00" }] };
    expect(dentroDeHorario(h, new Date("2026-10-07T21:30:00Z"), "Europe/Madrid")).toBe(true); // mié 23:30
    expect(dentroDeHorario(h, new Date("2026-10-07T23:30:00Z"), "Europe/Madrid")).toBe(true); // jue 01:30 (de la regla del miércoles)
    expect(dentroDeHorario(h, new Date("2026-10-08T01:30:00Z"), "Europe/Madrid")).toBe(false); // jue 03:30
  });
});

describe("teléfonos deseados de un dispositivo", () => {
  it("un número compartido sigue mientras otro contrato lo justifique; ordenado y sin repetidos", () => {
    const p = puerta();
    const lista = telefonosDeseados(
      [p],
      [
        { phone: "+34600000002", actor: cliente([contrato({ id: "k-fin", status: "terminated", bloqueos: ["terminated"] })]), origen: "a" },
        { phone: "+34600000002", actor: cliente([contrato({ id: "k-vivo" })]), origen: "b" },
        { phone: "+34600000001", actor: cliente([contrato({ status: "suspended", bloqueos: ["payment"] })]), origen: "c" },
        { phone: "+34600000003", actor: cliente([contrato()]), origen: "d" },
      ],
      AHORA
    );
    expect(lista).toEqual(["+34600000002", "+34600000003"]);
  });

  it("puerta sin llamada no aporta números; el estado del dispositivo no cuenta", () => {
    expect(telefonosDeseados([puerta({ allowPhone: false })], [{ phone: "+34600000001", actor: cliente([contrato()]), origen: "x" }], AHORA)).toEqual([]);
    const offline = puerta({ salida: { enabled: true, dispositivo: { enabled: true, status: "offline" } } });
    expect(telefonosDeseados([offline], [{ phone: "+34600000001", actor: cliente([contrato()]), origen: "x" }], AHORA)).toEqual(["+34600000001"]);
  });
});
