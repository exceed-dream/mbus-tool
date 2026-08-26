import type { MbusDataRecord } from "../../domain/mbus/MbusDataRecord";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";

export const DEVICE_TABLE_COLUMNS = ["Device ID", "Address", "Medium / Device", "Current values", "Status"] as const;
export const DEVICE_SUMMARY_FIELDS = ["Device status", "Device", "Primary address", "Last read"] as const;
export const DEVICE_DETAIL_TABS = ["Overview", "Data records", "Raw Telegram"] as const;
export const OVERVIEW_SECTIONS = ["Current values", "Identification", "Communication"] as const;
export const IDENTIFICATION_FIELD_ORDER = ["Primary address", "Secondary address", "Medium", "Manufacturer", "Manufacturer raw", "Identification number", "Version", "Fabrication number"] as const;

export interface CurrentValuesPreview {
  records: MbusDataRecord[];
  remaining: number;
}

export function supportedCurrentValues(records: MbusDataRecord[]): MbusDataRecord[] {
  const decoded = records.filter((record) => record.supported !== false && record.parseStatus !== "Unsupported" && record.parseStatus !== "Error" && record.label !== "Fabrication number");
  return [
    ...decoded.filter((record) => record.function === "Instantaneous"),
    ...decoded.filter((record) => record.function !== "Instantaneous"),
  ];
}

export function currentValuesPreview(records: MbusDataRecord[], limit = 3): CurrentValuesPreview {
  const selected = supportedCurrentValues(records);
  return { records: selected.slice(0, limit), remaining: Math.max(0, selected.length - limit) };
}

export function mediumAndDevice(device: MbusDevice): { medium: string; device: string } {
  return {
    medium: device.medium ?? "Unknown medium",
    device: deviceDisplayName(device),
  };
}

export function deviceDisplayName(device: MbusDevice): string {
  if (device.protocolHint === "RELAY_PADPULS_M1") {
    const model = device.model ?? "PadPuls M1";
    return model.toLowerCase().startsWith("relay ") ? model : `Relay ${model}`;
  }
  return device.model ?? "Standard M-Bus device";
}

export function formatLastRead(lastReadAt?: string): string {
  if (!lastReadAt) return "—";
  const parsed = new Date(lastReadAt);
  if (!Number.isNaN(parsed.getTime())) return parsed.toLocaleTimeString([], { hour12: false });
  const time = lastReadAt.match(/(?:^|\s)(\d{1,2}:\d{2}:\d{2})(?:\s|$)/)?.[1];
  return time ?? lastReadAt;
}
