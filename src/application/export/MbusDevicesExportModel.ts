import type { MbusDataRecord } from "../../domain/mbus/MbusDataRecord";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";

export interface MbusDeviceExportSource {
  device: MbusDevice;
  records: readonly MbusDataRecord[];
  readingTimestamp?: string;
  readingAvailable: boolean;
}

export interface MbusExportRecord {
  recordIndex: number;
  value: string | number;
  unit: string;
  storageNumber: number;
  rawValue: string;
}

export interface MbusExportDevice {
  primaryAddress?: number;
  secondaryAddress: string;
  manufacturer: string;
  identification: string;
  version: string;
  medium: string;
  lastRead?: string;
  readingAvailable: boolean;
  records: MbusExportRecord[];
}

export interface MbusDevicesExportData {
  generatedAt: string;
  devices: MbusExportDevice[];
}

export function prepareMbusDevicesExport(sources: readonly MbusDeviceExportSource[], generatedAt = new Date()): MbusDevicesExportData {
  return {
    generatedAt: generatedAt.toISOString(),
    devices: sources.map(({ device, records, readingTimestamp, readingAvailable }) => ({
      primaryAddress: device.primaryAddress,
      secondaryAddress: device.secondaryAddress?.identificationNumber ?? device.identificationNumber ?? "",
      manufacturer: device.manufacturer ?? "",
      identification: device.identificationNumber ?? device.secondaryAddress?.identificationNumber ?? "",
      version: device.version ?? "",
      medium: device.medium ?? "",
      lastRead: normalizeTimestamp(readingTimestamp ?? device.lastReadAt),
      readingAvailable,
      records: readingAvailable ? records.map((record) => ({
        recordIndex: record.recordIndex,
        value: record.value,
        unit: record.unit,
        storageNumber: record.storageNumber,
        rawValue: record.rawValue,
      })) : [],
    })),
  };
}

export function displayLastRead(device: MbusExportDevice): string {
  return device.readingAvailable && device.lastRead ? device.lastRead : "Not read";
}

function normalizeTimestamp(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}
