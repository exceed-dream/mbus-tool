import type { MbusDataRecord } from "../../domain/mbus/MbusDataRecord";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";

export const DEVICE_TABLE_COLUMNS = ["Primary address", "Secondary address", "Medium / Device", "Current values", "Status"] as const;
export const DEVICE_SUMMARY_FIELDS = ["Device", "Primary address", "Last read", "Device status"] as const;
export const DEVICE_DETAIL_TABS = ["Overview", "Data records", "Raw Telegram"] as const;
export const OVERVIEW_SECTIONS = ["Identification", "Communication"] as const;
export const IDENTIFICATION_FIELD_ORDER = ["Primary address", "Secondary address", "Manufacturer", "Identification number", "Version", "Medium", "Last read", "Manufacturer raw", "Fabrication number"] as const;

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

export function primaryAddressLabel(device: MbusDevice): string {
  return Number.isInteger(device.primaryAddress) && device.primaryAddress! >= 0 && device.primaryAddress! <= 250
    ? String(device.primaryAddress)
    : "—";
}

export function secondaryAddressLabel(device: MbusDevice): string {
  return device.secondaryAddress?.identificationNumber ?? device.identificationNumber ?? "—";
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

export function deviceWarningReasons(device: MbusDevice): string[] {
  if (device.status !== "warning") return [];
  const decodedFlags = [...new Set(device.statusFlags?.map((reason) => reason.trim()).filter(Boolean) ?? [])];
  if (device.statusByte === undefined) {
    return decodedFlags.length
      ? [...decodedFlags, "Raw M-Bus status byte unavailable; decoded indicators were supplied by the upstream status source."]
      : ["Warning status is present without an M-Bus status byte or diagnostic indicators; its source cannot be verified."];
  }

  const statusByte = `0x${device.statusByte.toString(16).toUpperCase().padStart(2, "0")}`;
  if (device.statusByte === 0) {
    return [`M-Bus status byte: ${statusByte}`, "Warning status conflicts with status byte 0x00, which reports no M-Bus status anomaly."];
  }
  return decodedFlags.length
    ? [`M-Bus status byte: ${statusByte}`, ...decodedFlags]
    : [`M-Bus status byte: ${statusByte}`, "This non-zero byte triggered Warning, but no decoded status indicators were received."];
}
