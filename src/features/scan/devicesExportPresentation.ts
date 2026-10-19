import type { MbusDevicesExportFormat } from "../../application/export/MbusDevicesExportService.ts";

export const DEVICE_EXPORT_OPTIONS: ReadonlyArray<{ format: MbusDevicesExportFormat; label: string; extension: string }> = [
  { format: "csv", label: "CSV", extension: ".csv" },
  { format: "xlsx", label: "Excel", extension: ".xlsx" },
  { format: "pdf", label: "PDF", extension: ".pdf" },
];

export function canExportDevices(deviceCount: number): boolean {
  return deviceCount > 0;
}
