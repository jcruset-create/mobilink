import { beforeEach, describe, expect, it, vi } from "vitest";

const extractJson = vi.fn();
vi.mock("../db.ts", () => ({
  default: {
    query: vi.fn(async () => ({
      rows: [{ message_type: "image", media_stored_url: "https://x/placa.jpg", received_at: null }],
    })),
  },
}));
vi.mock("./ai.ts", () => ({ extractJson: (...a: unknown[]) => extractJson(...a), AI_IMAGE_RULES: "" }));

const { analyzeCaptureSession } = await import("./whatsappCapture.ts");

describe("país de la matrícula en la captura de WhatsApp", () => {
  beforeEach(() => extractJson.mockReset());

  it("se le pide a la IA, leído de la banda azul", async () => {
    extractJson.mockResolvedValue({ plate: "XA327YT", paisMatricula: "I" });
    await analyzeCaptureSession(1);
    const { system } = extractJson.mock.calls[0][0] as { system: string };
    expect(system).toContain('"paisMatricula"');
    expect(system).toContain("banda azul");
  });

  it("una placa italiana sale con la «I»", async () => {
    extractJson.mockResolvedValue({ plate: "XA327YT", paisMatricula: "i" });
    expect((await analyzeCaptureSession(1)).paisMatricula).toBe("I");
  });

  it("lo que no es una letra de país de la UE se descarta", async () => {
    extractJson.mockResolvedValue({ plate: "XA327YT", paisMatricula: "Italia" });
    expect((await analyzeCaptureSession(1)).paisMatricula).toBeNull();
  });
});
