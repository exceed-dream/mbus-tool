import assert from "node:assert/strict";
import test from "node:test";
import { buildMbusReadingWorkbook } from "./MbusReadingExcelExportService.ts";

const device = {
  id: "device-1",
  primaryAddress: 4,
  secondaryAddress: { identificationNumber: "17017649", manufacturerRaw: 0x0477, version: 20, medium: 7 },
  manufacturer: "ACW",
  identificationNumber: "17017649",
  version: "20",
  medium: "Water",
  baudRate: 2400,
  status: "online",
  lastReadAt: "2026-10-15T09:30:00Z",
};

const records = [
  { id: "record-0", recordIndex: 0, label: "Volume", function: "Instantaneous", storageNumber: 0, value: "6", unit: "m³", rawValue: "58 02 00 00", dif: "04", dife: [], vif: "14", vife: [] },
  { id: "record-1", recordIndex: 1, label: "Unsupported", function: "Instantaneous", storageNumber: 0, value: "Unsupported", unit: "", rawValue: "0F 10 04 1F", dif: "0F", dife: [], vif: "00", vife: [] },
];

test("Excel export creates one sheet with independent side-by-side blocks", () => {
  const workbook = buildMbusReadingWorkbook({ device, records, readingTimestamp: device.lastReadAt });
  const workbookXml = readStoredEntry(workbook, "xl/workbook.xml");
  const sheet = readStoredEntry(workbook, "xl/worksheets/sheet1.xml");

  assert.match(workbookXml, /<sheet name="M-Bus Reading"/);
  assert.match(sheet, /<mergeCell ref="A1:B1"\/>/);
  assert.match(sheet, /<mergeCell ref="D1:M1"\/>/);
  assert.match(sheet, /Device information/);
  assert.match(sheet, /M-Bus Data Records/);
  assert.match(sheet, /Primary address/);
  assert.match(sheet, /Secondary address/);
  assert.match(sheet, /17017649/);
});

test("Excel export preserves record order and keeps Value before Unit", () => {
  const workbook = buildMbusReadingWorkbook({ device, records });
  const sheet = readStoredEntry(workbook, "xl/worksheets/sheet1.xml");
  const headers = ["Record #", "Function", "Storage", "Value", "Unit", "Raw value", "DIF", "DIFE", "VIF", "VIFE"];
  let previous = -1;
  for (const header of headers) {
    const position = sheet.indexOf(`>${header}</t>`);
    assert.ok(position > previous, `${header} must follow the preceding column`);
    previous = position;
  }
  assert.ok(sheet.indexOf('r="D3" s="5"><v>0</v>') < sheet.indexOf('r="D4" s="5"><v>1</v>'));
  assert.ok(sheet.indexOf("58 02 00 00") < sheet.indexOf("0F 10 04 1F"));
});

function readStoredEntry(zip, expectedName) {
  const decoder = new TextDecoder();
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let offset = 0;
  while (offset + 30 <= zip.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(zip.subarray(nameStart, nameStart + nameLength));
    if (name === expectedName) return decoder.decode(zip.subarray(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  throw new Error(`Missing ZIP entry: ${expectedName}`);
}
