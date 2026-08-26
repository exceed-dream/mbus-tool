export interface SerialPortInfo {
  portName: string;
  portType?: string;
  manufacturer?: string;
  product?: string;
  serialNumber?: string;
}

export interface SerialConnectionSettings {
  portName: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 2;
  parity: "none" | "odd" | "even";
  timeout: number;
}

export interface MbusTransport {
  listPorts(): Promise<SerialPortInfo[]>;
  connect(options: SerialConnectionSettings): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}
