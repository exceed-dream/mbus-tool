import type { MbusDataRecord } from "../../domain/mbus/MbusDataRecord";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";

export interface MbusReadingExportInput {
  device: MbusDevice;
  records: readonly MbusDataRecord[];
  readingTimestamp?: string;
}

const MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function buildMbusReadingWorkbook(input: MbusReadingExportInput): Uint8Array {
  const createdAt = new Date().toISOString();
  const files: ZipEntry[] = [
    { name: "[Content_Types].xml", data: xml(contentTypesXml()) },
    { name: "_rels/.rels", data: xml(rootRelationshipsXml()) },
    { name: "docProps/app.xml", data: xml(appPropertiesXml()) },
    { name: "docProps/core.xml", data: xml(corePropertiesXml(createdAt)) },
    { name: "xl/workbook.xml", data: xml(workbookXml()) },
    { name: "xl/_rels/workbook.xml.rels", data: xml(workbookRelationshipsXml()) },
    { name: "xl/styles.xml", data: xml(stylesXml()) },
    { name: "xl/worksheets/sheet1.xml", data: xml(worksheetXml(input)) },
  ];
  return buildStoredZip(files);
}

export function exportMbusReadingToExcel(input: MbusReadingExportInput): void {
  const workbook = buildMbusReadingWorkbook(input);
  const blob = new Blob([workbook], { type: MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exportFilename(input.device, input.readingTimestamp);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function worksheetXml({ device, records, readingTimestamp }: MbusReadingExportInput): string {
  const deviceRows: Array<[string, string | number]> = [
    ["Primary address", device.primaryAddress ?? "—"],
    ["Secondary address", device.secondaryAddress?.identificationNumber ?? "—"],
    ["Manufacturer", device.manufacturer ?? "—"],
    ["Identification number", device.identificationNumber ?? "—"],
    ["Version", device.version ?? "—"],
    ["Medium", device.medium ?? "—"],
    ["Reading date and time", readingTimestamp ?? device.lastReadAt ?? "—"],
  ];
  const recordHeaders = ["Record #", "Function", "Storage", "Value", "Unit", "Raw value", "DIF", "DIFE", "VIF", "VIFE"];
  const rows = [
    row(1, [textCell("A1", "Device information", 1), textCell("D1", "M-Bus Data Records", 1)]),
    row(2, [
      textCell("A2", deviceRows[0][0], 3), valueCell("B2", deviceRows[0][1], 4),
      ...recordHeaders.map((value, index) => textCell(`${columnName(index + 4)}2`, value, 2)),
    ]),
  ];

  const rowCount = Math.max(deviceRows.length, records.length + 1);
  for (let offset = 1; offset < rowCount; offset += 1) {
    const rowNumber = offset + 2;
    const cells: string[] = [];
    const deviceRow = deviceRows[offset];
    if (deviceRow) {
      cells.push(textCell(`A${rowNumber}`, deviceRow[0], 3), valueCell(`B${rowNumber}`, deviceRow[1], 4));
    }
    const record = records[offset - 1];
    if (record) {
      const values: Array<string | number> = [
        record.recordIndex,
        record.function,
        record.storageNumber,
        record.value,
        record.unit,
        record.rawValue,
        record.dif ?? "",
        record.dife?.join(" ") ?? "",
        record.vif ?? "",
        record.vife?.join(" ") ?? "",
      ];
      values.forEach((value, index) => cells.push(valueCell(`${columnName(index + 4)}${rowNumber}`, value, typeof value === "number" ? 5 : 4)));
    }
    rows.push(row(rowNumber, cells));
  }

  const lastRow = Math.max(2, records.length + 2, deviceRows.length + 1);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:M${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="24" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/>
    <col min="3" max="3" width="3" customWidth="1"/><col min="4" max="4" width="11" customWidth="1"/>
    <col min="5" max="5" width="17" customWidth="1"/><col min="6" max="6" width="10" customWidth="1"/>
    <col min="7" max="7" width="18" customWidth="1"/><col min="8" max="8" width="12" customWidth="1"/>
    <col min="9" max="9" width="24" customWidth="1"/><col min="10" max="13" width="13" customWidth="1"/>
  </cols>
  <sheetData>${rows.join("")}</sheetData>
  <autoFilter ref="D2:M${Math.max(2, records.length + 2)}"/>
  <mergeCells count="2"><mergeCell ref="A1:B1"/><mergeCell ref="D1:M1"/></mergeCells>
  <pageMargins left="0.5" right="0.5" top="0.65" bottom="0.65" header="0.3" footer="0.3"/>
</worksheet>`;
}

function row(index: number, cells: string[]): string {
  return `<row r="${index}">${cells.join("")}</row>`;
}

function valueCell(reference: string, value: string | number, style: number): string {
  return typeof value === "number"
    ? `<c r="${reference}" s="${style}"><v>${value}</v></c>`
    : textCell(reference, value, style);
}

function textCell(reference: string, value: string, style: number): string {
  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="3"><font><sz val="10"/><name val="Aptos"/></font><font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts>
  <fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF315A75"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4C7189"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><left style="thin"><color rgb="FFD9E1E6"/></left><right style="thin"><color rgb="FFD9E1E6"/></right><top style="thin"><color rgb="FFD9E1E6"/></top><bottom style="thin"><color rgb="FFD9E1E6"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function rootRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function workbookXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="M-Bus Reading" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

function workbookRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function appPropertiesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>mbus-tool</Application></Properties>`;
}

function corePropertiesXml(createdAt: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>mbus-tool</dc:creator><cp:lastModifiedBy>mbus-tool</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified></cp:coreProperties>`;
}

function exportFilename(device: MbusDevice, timestamp?: string): string {
  const identity = device.identificationNumber ?? device.secondaryAddress?.identificationNumber ?? `primary-${device.primaryAddress ?? "unknown"}`;
  const date = timestamp ? new Date(timestamp) : new Date();
  const stamp = Number.isNaN(date.getTime()) ? "reading" : date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
  return `mbus-reading-${sanitizeFilename(identity)}-${stamp}.xlsx`;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "device";
}

function columnName(column: number): string {
  let value = column;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function xml(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

interface ZipEntry { name: string; data: Uint8Array; }

function buildStoredZip(entries: ZipEntry[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const checksum = crc32(entry.data);
    const local = new Uint8Array(30 + name.length + entry.data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0x0021, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, entry.data.length, true);
    localView.setUint32(22, entry.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(entry.data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0x0021, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, entry.data.length, true);
    centralView.setUint32(24, entry.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centralParts.push(central);
    offset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return concatenate([...localParts, ...centralParts, end]);
}

function concatenate(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
