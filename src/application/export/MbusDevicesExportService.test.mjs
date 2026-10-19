import assert from "node:assert/strict";
import test from "node:test";
import { buildMbusDevicesExport } from "./MbusDevicesExportService.ts";

const readDevice = {
  device: {
    id: "device-1", primaryAddress: 4,
    secondaryAddress: { identificationNumber: "00123456", manufacturerRaw: 0x0477, version: 20, medium: 7 },
    manufacturer: "ACW", identificationNumber: "00123456", version: "20", medium: "Water",
    baudRate: 2400, status: "online", lastReadAt: "2026-10-19T08:15:30Z",
  },
  readingTimestamp: "2026-10-19T08:15:30Z",
  readingAvailable: true,
  records: [
    { id: "r0", recordIndex: 0, label: "Volume", function: "Instantaneous", storageNumber: 0, value: "0.015", unit: "m³", rawValue: "06 13 0F 00 00 00" },
    { id: "r1", recordIndex: 1, label: "Unsupported", function: "Instantaneous", storageNumber: 0, value: "Unsupported", unit: "", rawValue: "0F 01 01 0A" },
  ],
};

const unreadDevice = {
  device: { id: "device-2", manufacturer: "REL", identificationNumber: "22075482", version: "9", medium: "Oil", baudRate: 2400, status: "offline" },
  readingAvailable: false,
  records: [],
};

const generatedAt = new Date(2026, 9, 19, 10, 42, 0);

test("CSV export consolidates devices, preserves identifiers and marks unread devices", () => {
  const artifact = buildMbusDevicesExport([readDevice, unreadDevice], "csv", generatedAt);
  const csv = new TextDecoder().decode(artifact.bytes);
  assert.deepEqual(Array.from(artifact.bytes.subarray(0, 3)), [0xef, 0xbb, 0xbf]);
  assert.match(csv, /Primary address,Secondary address,Manufacturer,Identification/);
  assert.match(csv, /4,00123456,ACW,00123456,20,Water,2026-10-19T08:15:30.000Z,0,0.015,m³,0,06 13 0F 00 00 00/);
  assert.match(csv, /,22075482,REL,22075482,9,Oil,Not read,,,,,/);
  assert.ok(csv.indexOf(",0,0.015,") < csv.indexOf(",1,Unsupported,"));
  assert.equal(artifact.filename, "Mbus_Devices_2026-10-19_10-42.csv");
});

test("Excel export creates Devices and M-Bus Data Records sheets with filters and frozen headers", () => {
  const artifact = buildMbusDevicesExport([readDevice, unreadDevice], "xlsx", generatedAt);
  const workbook = readStoredEntry(artifact.bytes, "xl/workbook.xml");
  const devices = readStoredEntry(artifact.bytes, "xl/worksheets/sheet1.xml");
  const records = readStoredEntry(artifact.bytes, "xl/worksheets/sheet2.xml");
  assert.match(workbook, /sheet name="Devices"/);
  assert.match(workbook, /sheet name="M-Bus Data Records"/);
  assert.match(devices, /Number of Data Records/);
  assert.match(devices, /Not read/);
  assert.match(devices, /<autoFilter ref="A1:H3"/);
  assert.match(records, /<pane ySplit="1"/);
  assert.match(records, /00123456/);
  assert.ok(records.indexOf(">0<\/v>") < records.indexOf(">1<\/v>"));
});

test("PDF export includes report metadata, device sections and unread state", () => {
  const artifact = buildMbusDevicesExport([readDevice, unreadDevice], "pdf", generatedAt);
  const pdf = new TextDecoder().decode(artifact.bytes);
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.match(pdf, /M-Bus Devices \\227 Reading Report/);
  assert.match(pdf, /Devices: 2    With reading: 1/);
  assert.match(pdf, /Primary address: 4/);
  assert.match(pdf, /Secondary address: 00123456/);
  assert.match(pdf, /No reading available/);
  assert.match(pdf, /0F 01 01 0A/);
  assert.match(pdf, /%%EOF$/);
});

test("PDF repeats table headers and retains the last raw record across pages", () => {
  const manyRecords = Array.from({ length: 90 }, (_, index) => ({ ...readDevice.records[0], id: `r${index}`, recordIndex: index, rawValue: `RAW-${index}-` + "AB ".repeat(50) }));
  const artifact = buildMbusDevicesExport([{ ...readDevice, records: manyRecords }], "pdf", generatedAt);
  const pdf = new TextDecoder().decode(artifact.bytes);
  assert.match(pdf, /\/Count ([2-9]|[1-9][0-9]+)/);
  assert.ok((pdf.match(/Raw value/g) ?? []).length > 1);
  assert.match(pdf, /RAW-89-/);
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
