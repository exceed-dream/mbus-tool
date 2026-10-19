import { displayLastRead, type MbusDevicesExportData, type MbusExportDevice } from "./MbusDevicesExportModel.ts";

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN = 36;
const BOTTOM = 34;
const TABLE_WIDTHS = [48, 160, 72, 64, 421.89];
const TABLE_HEADERS = ["Record", "Value", "Unit", "Storage", "Raw value"];

interface PdfPage { commands: string[]; }

export function buildMbusDevicesPdf(data: MbusDevicesExportData): Uint8Array {
  const pages: PdfPage[] = [];
  let page = newPage(pages);
  let y = PAGE_HEIGHT - MARGIN;
  const readCount = data.devices.filter((device) => device.readingAvailable).length;

  text(page, MARGIN, y, "M-Bus Devices — Reading Report", 17, true); y -= 25;
  text(page, MARGIN, y, `Generated: ${formatTimestamp(data.generatedAt)}`, 9); y -= 14;
  text(page, MARGIN, y, `Devices: ${data.devices.length}    With reading: ${readCount}`, 9); y -= 22;
  line(page, MARGIN, y, PAGE_WIDTH - MARGIN, y, 0.55); y -= 18;

  for (const [deviceIndex, device] of data.devices.entries()) {
    if (y < 170) ({ page, y } = nextPage(pages));
    text(page, MARGIN, y, `Device ${deviceIndex + 1}`, 12, true); y -= 17;
    const info = deviceInfoLines(device);
    for (const infoLine of info) {
      for (const wrapped of wrapText(infoLine, 120)) {
        text(page, MARGIN, y, wrapped, 9);
        y -= 12;
      }
    }
    y -= 5;
    text(page, MARGIN, y, "M-Bus Data Records", 10, true); y -= 14;
    if (!device.readingAvailable) {
      text(page, MARGIN, y, "No reading available", 9); y -= 24;
      continue;
    }
    if (!device.records.length) {
      text(page, MARGIN, y, "Reading available; no Data Records returned.", 9); y -= 24;
      continue;
    }

    ({ page, y } = tableHeader(pages, page, y, deviceIndex));
    for (const record of device.records) {
      const cells = [String(record.recordIndex), String(record.value), record.unit, String(record.storageNumber), record.rawValue];
      const wrapped = cells.map((cell, index) => wrapText(cell, Math.max(4, Math.floor(TABLE_WIDTHS[index] / 5.2))));
      const rowHeight = Math.max(1, ...wrapped.map((lines) => lines.length)) * 10 + 8;
      if (y - rowHeight < BOTTOM + 18) {
        ({ page, y } = nextPage(pages));
        text(page, MARGIN, y, `Device ${deviceIndex + 1} — continued`, 10, true); y -= 16;
        ({ page, y } = tableHeader(pages, page, y, deviceIndex));
      }
      rowBox(page, y, rowHeight, wrapped, false);
      y -= rowHeight;
    }
    y -= 20;
  }

  pages.forEach((current, index) => text(current, PAGE_WIDTH - MARGIN - 55, 17, `Page ${index + 1} / ${pages.length}`, 8));
  return assemblePdf(pages);
}

function deviceInfoLines(device: MbusExportDevice): string[] {
  return [
    `Primary address: ${device.primaryAddress ?? "—"}    Secondary address: ${device.secondaryAddress || "—"}`,
    `Manufacturer: ${device.manufacturer || "—"}    Identification: ${device.identification || "—"}    Version: ${device.version || "—"}`,
    `Medium: ${device.medium || "—"}    Last read: ${displayLastRead(device)}`,
  ];
}

function tableHeader(pages: PdfPage[], current: PdfPage, currentY: number, deviceIndex: number): { page: PdfPage; y: number } {
  let page = current;
  let y = currentY;
  if (y - 24 < BOTTOM) {
    ({ page, y } = nextPage(pages));
    text(page, MARGIN, y, `Device ${deviceIndex + 1} — continued`, 10, true); y -= 16;
  }
  rowBox(page, y, 22, TABLE_HEADERS.map((value) => [value]), true);
  return { page, y: y - 22 };
}

function rowBox(page: PdfPage, top: number, height: number, cells: string[][], header: boolean): void {
  if (header) page.commands.push(`0.22 0.35 0.46 rg ${MARGIN} ${number(top - height)} ${number(TABLE_WIDTHS.reduce((sum, width) => sum + width, 0))} ${height} re f`);
  page.commands.push(`0.78 G 0.5 w ${MARGIN} ${number(top)} m ${number(PAGE_WIDTH - MARGIN)} ${number(top)} l S`);
  let x = MARGIN;
  for (let index = 0; index < TABLE_WIDTHS.length; index += 1) {
    page.commands.push(`0.85 G 0.35 w ${number(x)} ${number(top)} m ${number(x)} ${number(top - height)} l S`);
    const color = header ? "1 1 1" : "0.15 0.22 0.28";
    cells[index].forEach((value, lineIndex) => text(page, x + 4, top - 13 - lineIndex * 10, value, 8, header, color));
    x += TABLE_WIDTHS[index];
  }
  page.commands.push(`0.85 G 0.35 w ${number(x)} ${number(top)} m ${number(x)} ${number(top - height)} l S`);
  page.commands.push(`0.78 G 0.5 w ${MARGIN} ${number(top - height)} m ${number(PAGE_WIDTH - MARGIN)} ${number(top - height)} l S`);
}

function newPage(pages: PdfPage[]): PdfPage {
  const page = { commands: [] };
  pages.push(page);
  return page;
}

function nextPage(pages: PdfPage[]): { page: PdfPage; y: number } {
  return { page: newPage(pages), y: PAGE_HEIGHT - MARGIN };
}

function text(page: PdfPage, x: number, y: number, value: string, size: number, bold = false, color = "0.15 0.22 0.28"): void {
  page.commands.push(`${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf ${number(x)} ${number(y)} Td (${pdfString(value)}) Tj ET`);
}

function line(page: PdfPage, x1: number, y1: number, x2: number, y2: number, gray: number): void {
  page.commands.push(`${gray} G 0.6 w ${number(x1)} ${number(y1)} m ${number(x2)} ${number(y2)} l S`);
}

function wrapText(value: string, maxCharacters: number): string[] {
  if (!value) return [""];
  const lines: string[] = [];
  let remaining = value;
  while (remaining.length > maxCharacters) {
    let split = remaining.lastIndexOf(" ", maxCharacters);
    if (split < Math.floor(maxCharacters * 0.4)) split = maxCharacters;
    lines.push(remaining.slice(0, split));
    remaining = remaining.slice(split).trimStart();
  }
  lines.push(remaining);
  return lines;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function pdfString(value: string): string {
  const winAnsi: Record<string, number> = { "—": 0x97, "–": 0x96, "€": 0x80, "³": 0xb3, "²": 0xb2, "°": 0xb0, "µ": 0xb5 };
  let result = "";
  for (const character of value) {
    const code = winAnsi[character] ?? character.codePointAt(0) ?? 0x3f;
    if (character === "\\" || character === "(" || character === ")") result += `\\${character}`;
    else if (code >= 32 && code <= 126) result += String.fromCharCode(code);
    else if (code <= 255) result += `\\${code.toString(8).padStart(3, "0")}`;
    else result += "?";
  }
  return result;
}

function number(value: number): string {
  return value.toFixed(2).replace(/\.00$/, "");
}

function assemblePdf(pages: readonly PdfPage[]): Uint8Array {
  const objects: string[] = [];
  const pageRefs = pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ");
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((page, index) => {
    const pageNumber = 4 + index * 2;
    const contentNumber = pageNumber + 1;
    const stream = page.commands.join("\n");
    objects[pageNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >> >> >> /Contents ${contentNumber} 0 R >>`;
    objects[contentNumber] = `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`;
  });

  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encoder.encode("%PDF-1.4\n%mbus-tool\n")];
  const offsets = [0];
  let offset = parts[0].length;
  for (let index = 1; index < objects.length; index += 1) {
    const part = encoder.encode(`${index} 0 obj\n${objects[index]}\nendobj\n`);
    offsets[index] = offset;
    parts.push(part);
    offset += part.length;
  }
  const xrefOffset = offset;
  const xref = [`xref\n0 ${objects.length}\n`, "0000000000 65535 f \n", ...offsets.slice(1).map((item) => `${String(item).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(encoder.encode(`${xref}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return concatenate(parts);
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
