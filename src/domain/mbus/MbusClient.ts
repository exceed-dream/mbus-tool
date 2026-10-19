import type { MbusDataRecord } from "./MbusDataRecord";
import type { MbusDevice } from "./MbusDevice";
import type { ConfigurationWriteResult, TechnicalTelegram } from "../configuration/DeviceConfiguration";

export interface PrimaryScanOptions { startAddress: number; endAddress: number; }
export interface PrimaryScanProgress { kind: "primary"; currentAddress: number; startAddress: number; endAddress: number; devicesFound: number; state: "scanning" | "stopped" | "completed"; }
export interface SecondaryScanProgress { kind: "secondary"; mask: string; devicesFound: number; state: "searching" | "stopped" | "completed"; }
export type ScanProgress = PrimaryScanProgress | SecondaryScanProgress;
export interface CommunicationLogEntry { timestamp: string; level: "PRIMARY" | "SECONDARY" | "CONFIG" | "VERIFY" | "TX" | "RX" | "INFO" | "COLLISION" | "ERROR"; message: string; address?: number; hex?: string; }
export interface RawTelegram { direction: "TX" | "RX"; timestamp: string; length: number; hex: string; }
export interface DeviceReadResult { device: MbusDevice; records: MbusDataRecord[]; rawTelegram: RawTelegram; }
export interface ScanObserver { onProgress?: (progress: ScanProgress) => void; onDevice?: (result: DeviceReadResult) => void; onLog?: (entry: CommunicationLogEntry) => void; }

export interface MbusReadClient {
  scanPrimary(options: PrimaryScanOptions, observer?: ScanObserver): Promise<MbusDevice[]>;
  scanSecondary(observer?: ScanObserver): Promise<MbusDevice[]>;
  completeMissingPrimaryAddresses(devices: MbusDevice[], observer?: ScanObserver): Promise<MbusDevice[]>;
  readBySecondaryId(identificationNumber: string, observer?: ScanObserver): Promise<DeviceReadResult>;
  stopScan(): Promise<void>;
  readDevice(device: MbusDevice, observer?: ScanObserver): Promise<DeviceReadResult>;
  getCachedRecords(deviceId: string): MbusDataRecord[];
  getRawTelegram(deviceId: string): RawTelegram | undefined;
}

export interface PrimaryAddressWriteRequest {
  currentAddress: number;
  newAddress: number;
  secondaryAddress: {
    identificationNumber: string;
    manufacturerRaw: number;
    version: number;
    medium: number;
  };
}

export interface MbusWriteClient {
  writePrimaryAddress(request: PrimaryAddressWriteRequest, observer?: ScanObserver): Promise<ConfigurationWriteResult>;
  sendFrameAndWaitForAck(request: ManufacturerFrameWriteRequest, observer?: ScanObserver): Promise<ConfigurationWriteResult>;
  previewPadPulsConfiguration(request: PadPulsWriteRequest): Promise<TechnicalTelegram | undefined>;
  writePadPulsConfiguration(request: PadPulsWriteRequest, observer?: ScanObserver): Promise<ConfigurationWriteResult>;
  getTechnicalTelegrams(): TechnicalTelegram[];
}

export interface ManufacturerFrameWriteRequest {
  targetAddress: number;
  operation: string;
  frame: number[];
}

export interface PadPulsWriteRequest {
  currentAddress: number; primaryAddress: number; secondaryId: string; manufacturerRaw: number;
  generation: number; medium: number; vif: number; counter: number; numerator: number;
  denominator: number; writeProtected: boolean;
}

export interface MbusClient extends MbusReadClient, MbusWriteClient {}
