import { buildStoredZip, xml, type ZipEntry } from "./StoredZip.ts";
import { displayLastRead, type MbusDevicesExportData } from "./MbusDevicesExportModel.ts";
import { MBUS_CSV_HEADERS } from "./MbusDevicesCsvExport.ts";

const DEVICE_HEADERS = [
  "Primary address", "Secondary address", "Manufacturer", "Identification", "Version", "Medium",
  "Last read", "Number of Data Records",
] as const;

export function buildMbusDevicesWorkbook(data: MbusDevicesExportData): Uint8Array {
  const deviceRows = data.devices.map((device) => [
    device.primaryAddress ?? "", device.secondaryAddress, device.manufacturer, device.identification,
    device.version, device.medium, displayLastRead(device), device.records.length,
  ]);
  const recordRows = data.devices.flatMap((device) => device.records.map((record) => [
    device.primaryAddress ?? "", device.secondaryAddress, device.manufacturer, device.identification,
    device.version, device.medium, displayLastRead(device), record.recordIndex, record.value, record.unit,
    record.storageNumber, record.rawValue,
  ]));
  const files: ZipEntry[] = [
    { name: "[Content_Types].xml", data: xml(contentTypesXml()) },
    { name: "_rels/.rels", data: xml(rootRelationshipsXml()) },
    { name: "docProps/app.xml", data: xml(appPropertiesXml()) },
    { name: "docProps/core.xml", data: xml(corePropertiesXml(data.generatedAt)) },
    { name: "xl/workbook.xml", data: xml(workbookXml()) },
    { name: "xl/_rels/workbook.xml.rels", data: xml(workbookRelationshipsXml()) },
    { name: "xl/styles.xml", data: xml(stylesXml()) },
    { name: "xl/worksheets/sheet1.xml", data: xml(worksheetXml(DEVICE_HEADERS, deviceRows, [15, 20, 16, 18, 10, 18, 24, 22])) },
    { name: "xl/worksheets/sheet2.xml", data: xml(worksheetXml(MBUS_CSV_HEADERS, recordRows, [15, 20, 16, 18, 10, 18, 24, 10, 18, 12, 10, 34])) },
  ];
  return buildStoredZip(files);
}

function worksheetXml(headers: readonly string[], values: ReadonlyArray<ReadonlyArray<string | number>>, widths: readonly number[]): string {
  const rows = [rowXml(1, headers, true), ...values.map((row, index) => rowXml(index + 2, row, false))];
  const lastColumn = columnName(headers.length);
  const lastRow = Math.max(1, values.length + 1);
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/><cols>${columns}</cols>
  <sheetData>${rows.join("")}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
  <pageMargins left="0.5" right="0.5" top="0.65" bottom="0.65" header="0.3" footer="0.3"/>
</worksheet>`;
}

function rowXml(index: number, values: readonly (string | number)[], header: boolean): string {
  const cells = values.map((value, column) => cellXml(`${columnName(column + 1)}${index}`, value, header ? 1 : typeof value === "number" ? 3 : 2));
  return `<row r="${index}"${header ? ' ht="24" customHeight="1"' : ""}>${cells.join("")}</row>`;
}

function cellXml(reference: string, value: string | number, style: number): string {
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="10"/><name val="Aptos"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF315A75"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border/><border><bottom style="thin"><color rgb="FFD9E1E6"/></bottom></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function rootRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function workbookXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Devices" sheetId="1" r:id="rId1"/><sheet name="M-Bus Data Records" sheetId="2" r:id="rId2"/></sheets></workbook>`;
}

function workbookRelationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

function appPropertiesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>mbus-tool</Application></Properties>`;
}

function corePropertiesXml(createdAt: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>mbus-tool</dc:creator><cp:lastModifiedBy>mbus-tool</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(createdAt)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${escapeXml(createdAt)}</dcterms:modified></cp:coreProperties>`;
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
