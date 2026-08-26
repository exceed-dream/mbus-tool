import type { MbusTransport, SerialConnectionSettings, SerialPortInfo } from "../../domain/mbus/MbusTransport";

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export class MockMbusTransport implements MbusTransport {
  private connected = false;

  listPorts(): Promise<SerialPortInfo[]> { return Promise.resolve([{ portName: "MOCK", portType: "Simulated" }]); }

  async connect(_options: SerialConnectionSettings): Promise<void> {
    await wait(450);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await wait(150);
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
