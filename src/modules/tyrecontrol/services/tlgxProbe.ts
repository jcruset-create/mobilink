// Comunicación con la sonda Translogik TLGX (TLGX2/3/4) por Web Bluetooth.
// Protocolo: G 13632 Q — UART transparente BLE, comandos ASCII terminados
// en Line Feed (0x0A). Funciona en Chrome/Edge de escritorio y Chrome Android;
// NO en iOS Safari (sin Web Bluetooth).

const SERVICE_UUID = "49535343-fe7d-4ae5-8fa9-9fafd205e455";
const TX_UUID = "49535343-1e4d-4bd9-ba61-23c647249616"; // sonda → app (notify)
const RX_UUID = "49535343-8841-43f4-a8d4-ecbe34729bb3"; // app → sonda (write)

export function webBluetoothDisponible(): boolean {
  return typeof navigator !== "undefined" && !!(navigator as any).bluetooth;
}

type LineListener = (line: string) => void;
type StateListener = (conectada: boolean) => void;

export class TlgxProbe {
  private device: any = null;
  private rx: any = null;
  private buffer = "";
  private onLine: LineListener;
  private onState: StateListener;

  constructor(onLine: LineListener, onState: StateListener) {
    this.onLine = onLine;
    this.onState = onState;
  }

  get nombre(): string {
    return this.device?.name ?? "";
  }

  async conectar(): Promise<void> {
    if (!webBluetoothDisponible()) {
      throw new Error("Este navegador no soporta Bluetooth. Usa Chrome o Edge en ordenador o Android.");
    }
    const bt = (navigator as any).bluetooth;
    // Los nombres van cambiando por versión: TLGX#, TL-GX#, Trans-Logik, Translogik, TLGI#
    this.device = await bt.requestDevice({
      filters: [{ namePrefix: "TL" }, { namePrefix: "Trans" }],
      optionalServices: [SERVICE_UUID],
    });

    this.device.addEventListener("gattserverdisconnected", () => {
      this.rx = null;
      this.onState(false);
    });

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const txChar = await service.getCharacteristic(TX_UUID);
    this.rx = await service.getCharacteristic(RX_UUID);

    await txChar.startNotifications();
    txChar.addEventListener("characteristicvaluechanged", (e: any) => {
      const value: DataView = e.target.value;
      let chunk = "";
      for (let i = 0; i < value.byteLength; i++) chunk += String.fromCharCode(value.getUint8(i));
      this.recibir(chunk);
    });

    this.onState(true);
  }

  private recibir(chunk: string) {
    this.buffer += chunk;
    // Las respuestas terminan en LF (10) o CR (13)
    let idx: number;
    while ((idx = this.buffer.search(/[\r\n]/)) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (line) this.onLine(line);
    }
  }

  async enviar(cmd: string): Promise<void> {
    if (!this.rx) throw new Error("Sonda no conectada");
    const data = new TextEncoder().encode(cmd + "\n");
    if (this.rx.writeValueWithoutResponse) await this.rx.writeValueWithoutResponse(data);
    else await this.rx.writeValue(data);
  }

  async desconectar(): Promise<void> {
    try { await this.device?.gatt?.disconnect(); } catch { /* ya desconectada */ }
    this.rx = null;
    this.onState(false);
  }
}

// ── Parseo de respuestas ─────────────────────────────────────
export type LecturaSonda =
  | { tipo: "profundidad"; mm: number; raw: string }
  | { tipo: "presion"; valor: number; raw: string }
  | { tipo: "rfid"; epc: string; raw: string }
  | { tipo: "info"; clave: string; valor: string; raw: string }
  | { tipo: "timeout"; raw: string }
  | { tipo: "otro"; raw: string };

export function parsearLinea(line: string): LecturaSonda {
  const l = line.trim();

  // Timeout RFID / sin tag
  if (/^GST/i.test(l)) return { tipo: "timeout", raw: l };

  // RFID: GC<epc> (continuo) o GR<data>
  const rfid = l.match(/^G[CR]([0-9A-Fa-f]{4,})$/);
  if (rfid) return { tipo: "rfid", epc: rfid[1].toUpperCase(), raw: l };

  // Profundidad: T seguido de número (mm mode → T30.00)
  const t = l.match(/^T(\d+(?:\.\d+)?)$/i);
  if (t) return { tipo: "profundidad", mm: parseFloat(t[1]), raw: l };

  // Presión: P seguido de número (psi/bar/kpa)
  const p = l.match(/^P(\d+(?:\.\d+)?)$/i);
  if (p) return { tipo: "presion", valor: parseFloat(p[1]), raw: l };

  // Info: MODSTR..., V..., D..., BV...
  const bv = l.match(/^BV(\d+(?:\.\d+)?)/i);
  if (bv) return { tipo: "info", clave: "bateria", valor: bv[1], raw: l };
  if (/^MODSTR/i.test(l)) return { tipo: "info", clave: "modelo", valor: l.replace(/^MODSTR/i, ""), raw: l };
  if (/^V\d/i.test(l)) return { tipo: "info", clave: "version", valor: l.replace(/^V/i, ""), raw: l };

  return { tipo: "otro", raw: l };
}
