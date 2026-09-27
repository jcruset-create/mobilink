/**
 * Pruebas del cliente HTTP seguro.
 *
 * Lo que se prueba de verdad aquí son los dos casos que dejaron pasar los
 * ataques reales del informe de seguridad:
 *
 *   · `https://maps.app.goo.gl.atacante.tld/x` NO es un host de mapas, aunque
 *     empiece por el mismo texto. El filtro anterior lo aceptaba porque
 *     comparaba el principio de la cadena sin cerrar el host.
 *   · `http://169.254.169.254/` (metadatos del cloud) y `localhost` no se
 *     visitan nunca, aunque alguien los declarara.
 *
 * No hacen falta pruebas con red: `esDireccionInterna` y `hostPermitido` son
 * puras, y la validación de URL solo necesita DNS para nombres que existen.
 */

import { describe, expect, it } from "vitest";
import {
  ErrorRedSegura,
  esDireccionInterna,
  hostPermitido,
  validarUrlSegura,
  HOSTS_MAPAS,
  HOSTS_TWILIO,
} from "./red.ts";

describe("hostPermitido", () => {
  it("acepta el host exacto", () => {
    expect(hostPermitido("api.twilio.com", HOSTS_TWILIO)).toBe(true);
  });

  it("acepta un subdominio del host declarado", () => {
    expect(hostPermitido("eu1.api.twilio.com", HOSTS_TWILIO)).toBe(true);
  });

  it("RECHAZA un dominio que solo empieza igual — el fallo de los enlaces de mapa", () => {
    expect(hostPermitido("maps.app.goo.gl.atacante.tld", HOSTS_MAPAS)).toBe(false);
    expect(hostPermitido("api.twilio.com.atacante.tld", HOSTS_TWILIO)).toBe(false);
  });

  it("rechaza un dominio que acaba igual sin ser subdominio", () => {
    expect(hostPermitido("notgoogle.com", ["google.com"])).toBe(false);
    expect(hostPermitido("xgoogle.com", ["google.com"])).toBe(false);
  });

  it("no distingue mayúsculas ni el punto final del FQDN", () => {
    expect(hostPermitido("API.Twilio.COM.", HOSTS_TWILIO)).toBe(true);
  });

  it("con lista vacía no permite nada", () => {
    expect(hostPermitido("api.twilio.com", [])).toBe(false);
  });
});

describe("esDireccionInterna", () => {
  it("marca como interna la dirección de metadatos del cloud", () => {
    expect(esDireccionInterna("169.254.169.254")).toBe(true);
  });

  it("marca como internas las privadas, el bucle local y CGNAT", () => {
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
    ]) {
      expect(esDireccionInterna(ip), ip).toBe(true);
    }
  });

  it("no marca como internas las públicas", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.167.1.1", "100.63.255.255"]) {
      expect(esDireccionInterna(ip), ip).toBe(false);
    }
  });

  it("cubre IPv6: bucle, enlace local, únicas locales y IPv4 empotrada", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:10.0.0.1"]) {
      expect(esDireccionInterna(ip), ip).toBe(true);
    }
    expect(esDireccionInterna("2606:4700:4700::1111")).toBe(false);
  });

  it("lo que no es una IP se trata como interno (no se visita)", () => {
    expect(esDireccionInterna("no-es-una-ip")).toBe(true);
    expect(esDireccionInterna("")).toBe(true);
  });
});

describe("validarUrlSegura", () => {
  const conLista = { hostsPermitidos: HOSTS_TWILIO };

  it("rechaza http cuando no se permite explícitamente", async () => {
    await expect(validarUrlSegura("http://api.twilio.com/x", conLista)).rejects.toMatchObject({
      motivo: "esquema_no_permitido",
    });
  });

  it("rechaza esquemas que no son HTTP", async () => {
    for (const url of ["file:///etc/passwd", "gopher://x/", "ftp://x/"]) {
      await expect(validarUrlSegura(url, conLista)).rejects.toBeInstanceOf(ErrorRedSegura);
    }
  });

  it("rechaza credenciales en la URL, que cambian el host real", async () => {
    await expect(
      validarUrlSegura("https://api.twilio.com@atacante.tld/x", conLista)
    ).rejects.toMatchObject({ motivo: "credenciales_en_url" });
  });

  it("rechaza un host fuera de la lista", async () => {
    await expect(validarUrlSegura("https://atacante.tld/x", conLista)).rejects.toMatchObject({
      motivo: "host_no_permitido",
    });
  });

  it("rechaza el dominio que imita al permitido", async () => {
    await expect(
      validarUrlSegura("https://maps.app.goo.gl.atacante.tld/x", { hostsPermitidos: HOSTS_MAPAS })
    ).rejects.toMatchObject({ motivo: "host_no_permitido" });
  });

  it("exige lista blanca: sin ella no se sale a ningún sitio", async () => {
    await expect(
      validarUrlSegura("https://api.twilio.com/x", { hostsPermitidos: [] })
    ).rejects.toMatchObject({ motivo: "sin_lista_blanca" });
  });

  it("rechaza una IP interna incluso si se declara permitida", async () => {
    await expect(
      validarUrlSegura("https://169.254.169.254/latest/meta-data/", {
        hostsPermitidos: ["169.254.169.254"],
      })
    ).rejects.toMatchObject({ motivo: "direccion_interna" });

    await expect(
      validarUrlSegura("http://127.0.0.1:4000/api/jobs", {
        hostsPermitidos: ["127.0.0.1"],
        permitirHttp: true,
      })
    ).rejects.toMatchObject({ motivo: "direccion_interna" });
  });

  it("rechaza una URL mal formada", async () => {
    await expect(validarUrlSegura("no es una url", conLista)).rejects.toMatchObject({
      motivo: "url_invalida",
    });
  });
});
