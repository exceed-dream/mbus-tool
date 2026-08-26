import { invoke } from "@tauri-apps/api/core";
import type { MbusTransport, SerialConnectionSettings, SerialPortInfo } from "../../domain/mbus/MbusTransport";

export class SerialMbusTransport implements MbusTransport {
  private connected = false;

  listPorts(): Promise<SerialPortInfo[]> { return invoke<SerialPortInfo[]>("list_serial_ports"); }

  async connect(settings: SerialConnectionSettings): Promise<void> {
    await invoke("connect_serial", { settings });
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await invoke("disconnect_serial");
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
