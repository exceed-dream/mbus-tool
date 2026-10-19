import { displayLastRead, type MbusDevicesExportData, type MbusExportDevice } from "./MbusDevicesExportModel.ts";

export const MBUS_CSV_HEADERS = [
  "Primary address", "Secondary address", "Manufacturer", "Identification", "Version", "Medium",
  "Last read", "Record", "Value", "Unit", "Storage", "Raw value",
] as const;

export function buildMbusDevicesCsv(data: MbusDevicesExportData): string {
  const rows: Array<Array<string | number>> = [Array.from(MBUS_CSV_HEADERS)];
  for (const device of data.devices) {
    if (!device.records.length) {
      rows.push([...deviceColumns(device), "", "", "", "", ""]);
      continue;
    }
    for (const record of device.records) {
      rows.push([
        ...deviceColumns(device), record.recordIndex, record.value, record.unit, record.storageNumber, record.rawValue,
      ]);
    }
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}

function deviceColumns(device: MbusExportDevice): Array<string | number> {
  return [
    device.primaryAddress ?? "", device.secondaryAddress, device.manufacturer, device.identification,
    device.version, device.medium, displayLastRead(device),
  ];
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
