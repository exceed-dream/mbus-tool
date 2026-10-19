import { buildMbusDevicesCsv } from "./MbusDevicesCsvExport.ts";
import { buildMbusDevicesWorkbook } from "./MbusDevicesExcelExport.ts";
import { prepareMbusDevicesExport, type MbusDeviceExportSource } from "./MbusDevicesExportModel.ts";
import { buildMbusDevicesPdf } from "./MbusDevicesPdfExport.ts";

export type MbusDevicesExportFormat = "csv" | "xlsx" | "pdf";

export interface MbusDevicesExportArtifact {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
}

export function buildMbusDevicesExport(
  sources: readonly MbusDeviceExportSource[],
  format: MbusDevicesExportFormat,
  generatedAt = new Date(),
): MbusDevicesExportArtifact {
  const data = prepareMbusDevicesExport(sources, generatedAt);
  const filename = `${exportBaseName(generatedAt)}.${format}`;
  if (format === "csv") {
    return { filename, mimeType: "text/csv;charset=utf-8", bytes: new TextEncoder().encode(buildMbusDevicesCsv(data)) };
  }
  if (format === "xlsx") {
    return { filename, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: buildMbusDevicesWorkbook(data) };
  }
  return { filename, mimeType: "application/pdf", bytes: buildMbusDevicesPdf(data) };
}

export function exportMbusDevices(sources: readonly MbusDeviceExportSource[], format: MbusDevicesExportFormat): void {
  downloadMbusDevicesExport(buildMbusDevicesExport(sources, format));
}

export function downloadMbusDevicesExport(artifact: MbusDevicesExportArtifact): void {
  const blob = new Blob([artifact.bytes], { type: artifact.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportBaseName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `Mbus_Devices_${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`;
}
