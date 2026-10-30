import { describe, expect, it } from "vitest";

import { rutaEnBucket } from "./fotosFirmadas.ts";

/*
 * Se prueba `rutaEnBucket`, que es la parte que decide QUÉ se firma. Firmar de
 * verdad es una llamada a Supabase y no se finge aquí: lo que puede
 * equivocarse es esto —coger mal la ruta, o firmar algo que no toca— y es
 * justo lo que se puede comprobar sin red.
 */

const PUBLICA =
  "https://abcdefgh.supabase.co/storage/v1/object/public/roadside/roadside/163/whatsapp_1760000000000.jpg";

describe("qué URL se puede firmar", () => {
  it("una pública del bucket da su ruta dentro del bucket", () => {
    expect(rutaEnBucket(PUBLICA)).toBe("roadside/163/whatsapp_1760000000000.jpg");
  });

  it("la cadena de consulta no forma parte de la ruta", () => {
    // Un «?t=» de caché, o un «#», no son parte del nombre del objeto: con
    // ellos dentro, Supabase no encuentra el fichero y no firma nada.
    expect(rutaEnBucket(`${PUBLICA}?t=12345`)).toBe("roadside/163/whatsapp_1760000000000.jpg");
    expect(rutaEnBucket(`${PUBLICA}#algo`)).toBe("roadside/163/whatsapp_1760000000000.jpg");
  });

  it("los espacios y acentos del nombre se devuelven descodificados", () => {
    // Supabase quiere la ruta real, no la de la URL.
    const url =
      "https://x.supabase.co/storage/v1/object/public/roadside/roadside/9/albar%C3%A1n%20firmado.pdf";
    expect(rutaEnBucket(url)).toBe("roadside/9/albarán firmado.pdf");
  });
});

describe("qué NO se toca", () => {
  /*
   * Devolver `null` es la señal de «déjalo como está». Importa acertar: firmar
   * lo que no toca rompería un enlace que hoy funciona.
   */
  it("la URL de Twilio, que ni es nuestra ni se puede firmar", () => {
    expect(
      rutaEnBucket("https://api.twilio.com/2010-04-01/Accounts/AC123/Messages/MM1/Media/ME1")
    ).toBeNull();
  });

  it("una de OTRO bucket del mismo proyecto", () => {
    // `avatars` es otro bucket: su objeto no está en el de asistencias, y
    // pedirle a Supabase que lo firme ahí daría un enlace que no abre nada.
    expect(
      rutaEnBucket("https://x.supabase.co/storage/v1/object/public/avatars/u/1.png")
    ).toBeNull();
  });

  it("una ya firmada, que no vuelve a firmarse", () => {
    // Las firmadas van por «/object/sign/», no por «/public/».
    expect(
      rutaEnBucket("https://x.supabase.co/storage/v1/object/sign/roadside/a.jpg?token=ey")
    ).toBeNull();
  });

  it("una subida local, de cuando no había Supabase", () => {
    expect(rutaEnBucket("/uploads/roadside/163/foto.jpg")).toBeNull();
  });

  it("vacío, nulo o basura", () => {
    expect(rutaEnBucket("")).toBeNull();
    expect(rutaEnBucket("   ")).toBeNull();
    expect(rutaEnBucket(null)).toBeNull();
    expect(rutaEnBucket(undefined)).toBeNull();
    expect(rutaEnBucket(12345)).toBeNull();
  });

  it("la marca sin nada detrás no es una ruta", () => {
    expect(rutaEnBucket("https://x.supabase.co/storage/v1/object/public/roadside/")).toBeNull();
  });
});

describe("el bucket se puede decir, porque no siempre se llama igual", () => {
  it("se respeta el nombre que se le pase", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/otro-bucket/a/b.jpg";
    expect(rutaEnBucket(url, "otro-bucket")).toBe("a/b.jpg");
    expect(rutaEnBucket(url, "roadside")).toBeNull();
  });
});
