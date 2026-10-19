import type { DeviceReadResult, MbusReadClient, PrimaryScanOptions, RawTelegram, ScanObserver } from "../../domain/mbus/MbusClient";
import type { MbusDataRecord } from "../../domain/mbus/MbusDataRecord";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";
import type { MbusTransport, SerialConnectionSettings, SerialPortInfo } from "../../domain/mbus/MbusTransport";

export class MbusService {
  constructor(private readonly transport: MbusTransport, private readonly client: MbusReadClient) {}

  listPorts(): Promise<SerialPortInfo[]> {
    return this.transport.listPorts();
  }

  connect(settings: SerialConnectionSettings): Promise<void> {
    return this.transport.connect(settings);
  }

  disconnect(): Promise<void> {
    return this.transport.disconnect();
  }

  scanPrimary(options: PrimaryScanOptions, observer?: ScanObserver): Promise<MbusDevice[]> {
    return this.client.scanPrimary(options, observer);
  }

  scanSecondary(observer?: ScanObserver): Promise<MbusDevice[]> {
    return this.client.scanSecondary(observer);
  }

  completeMissingPrimaryAddresses(devices: MbusDevice[], observer?: ScanObserver): Promise<MbusDevice[]> {
    return this.client.completeMissingPrimaryAddresses(devices, observer);
  }

  readBySecondaryId(identificationNumber: string, observer?: ScanObserver): Promise<DeviceReadResult> {
    return this.client.readBySecondaryId(identificationNumber, observer);
  }

  stopScan(): Promise<void> {
    return this.client.stopScan();
  }

  readDevice(device: MbusDevice, observer?: ScanObserver): Promise<DeviceReadResult> {
    return this.client.readDevice(device, observer);
  }

  getCachedRecords(deviceId: string): MbusDataRecord[] {
    return this.client.getCachedRecords(deviceId);
  }

  getRawTelegram(deviceId: string): RawTelegram | undefined {
    return this.client.getRawTelegram(deviceId);
  }
}
