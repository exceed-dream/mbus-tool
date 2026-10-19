import assert from "node:assert/strict";
import test from "node:test";
import { DEVICE_DETAIL_TABS, DEVICE_SUMMARY_FIELDS, DEVICE_TABLE_COLUMNS, IDENTIFICATION_FIELD_ORDER, OVERVIEW_SECTIONS, currentValuesPreview, deviceWarningReasons, mediumAndDevice, primaryAddressLabel, secondaryAddressLabel } from "./devicePresentation.ts";
import { readFileSync } from "node:fs";

const detailsSource = readFileSync(new URL("./DeviceDetailsPage.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../../App.tsx", import.meta.url), "utf8");
const configurationSource = readFileSync(new URL("../configuration/ConfigurationPage.tsx", import.meta.url), "utf8");

const record = (id, label, value, unit, functionName = "Instantaneous", supported = true) => ({ id, recordIndex: 0, label, value, unit, function: functionName, storageNumber: 0, rawValue: "00", supported });
const relDevice = (primaryAddress) => ({ id: "rel", primaryAddress, secondaryAddress: { identificationNumber: "22075482", manufacturerRaw: 0x48ac, version: 9, medium: 1 }, baudRate: 2400, status: "online" });

test("device table columns follow the requested order", () => {
  assert.deepEqual(DEVICE_TABLE_COLUMNS, ["Primary address", "Secondary address", "Medium / Device", "Current values", "Status"]);
});

test("device table address labels reject the selected-slave transport address", () => {
  assert.equal(primaryAddressLabel(relDevice(0xfd)), "—");
  assert.equal(primaryAddressLabel(relDevice(12)), "12");
  assert.equal(secondaryAddressLabel(relDevice(undefined)), "22075482");
});

test("medium is presented before the device description", () => {
  assert.deepEqual(mediumAndDevice({ id: "rel", medium: "Oil", model: "PadPuls M1", protocolHint: "RELAY_PADPULS_M1", baudRate: 2400, status: "online" }), { medium: "Oil", device: "Relay PadPuls M1" });
});

test("current values exclude unsupported records, prioritize instantaneous values and remain limited", () => {
  const preview = currentValuesPreview([
    record("maximum", "Power", 4, "W", "Maximum"),
    record("volume", "Volume", 0.015, "m³"),
    record("unsupported", "Unsupported", "—", "", "Instantaneous", false),
    record("energy", "Energy", 0.512, "Wh"),
    record("time", "On time", 2020, "s"),
  ]);
  assert.deepEqual(preview.records.map((item) => item.id), ["volume", "energy", "time"]);
  assert.equal(preview.remaining, 1);
});

test("device details summary, tabs and overview sections have the requested structure", () => {
  assert.deepEqual(DEVICE_SUMMARY_FIELDS, ["Device", "Primary address", "Last read", "Device status"]);
  assert.deepEqual(DEVICE_DETAIL_TABS, ["Overview", "Data records", "Raw Telegram"]);
  assert.deepEqual(OVERVIEW_SECTIONS, ["Identification", "Communication"]);
});

test("device details header orders summary fields before Configure, Export and Read", () => {
  const summary = detailsSource.indexOf('className="device-summary"');
  const actions = detailsSource.indexOf('className="device-details-actions"');
  const configure = detailsSource.indexOf('>Configure</button>', actions);
  const exportReading = detailsSource.indexOf('>Export reading</button>', actions);
  const read = detailsSource.indexOf('"Read device"', actions);
  assert.ok(summary >= 0 && summary < actions);
  assert.ok(actions < configure && configure < exportReading && exportReading < read);
});

test("warning reasons reflect decoded M-Bus status flags with a precise fallback", () => {
  assert.deepEqual(deviceWarningReasons({ ...relDevice(2), status: "warning", statusByte: 0x04, statusFlags: ["Power low"] }), ["M-Bus status byte: 0x04", "Power low"]);
  assert.deepEqual(deviceWarningReasons({ ...relDevice(2), status: "warning", statusByte: 0x14, statusFlags: ["Power low", "Temporary error"] }), ["M-Bus status byte: 0x14", "Power low", "Temporary error"]);
  assert.deepEqual(deviceWarningReasons({ ...relDevice(2), status: "warning", statusByte: 0x20, statusFlags: ["Manufacturer-specific M-Bus status flag (bit 5, status byte 0x20); interpretation requires manufacturer documentation"] }), ["M-Bus status byte: 0x20", "Manufacturer-specific M-Bus status flag (bit 5, status byte 0x20); interpretation requires manufacturer documentation"]);
  assert.deepEqual(deviceWarningReasons({ ...relDevice(2), status: "warning", statusByte: 0x00 }), ["M-Bus status byte: 0x00", "Warning status conflicts with status byte 0x00, which reports no M-Bus status anomaly."]);
  assert.deepEqual(deviceWarningReasons({ ...relDevice(2), status: "warning" }), ["Warning status is present without an M-Bus status byte or diagnostic indicators; its source cannot be verified."]);
  assert.deepEqual(deviceWarningReasons({ ...relDevice(2), status: "warning", statusFlags: ["Upstream diagnostic"] }), ["Upstream diagnostic", "Raw M-Bus status byte unavailable; decoded indicators were supplied by the upstream status source."]);
  assert.deepEqual(deviceWarningReasons({ ...relDevice(2), status: "online", statusFlags: ["Power low"] }), []);
  assert.match(detailsSource, /device\.status === "warning" && <InfoTooltip/);
  assert.match(detailsSource, /warningReasons\.length > 1/);
});

test("identification exposes the required reading fields in order", () => {
  assert.deepEqual(IDENTIFICATION_FIELD_ORDER.slice(0, 7), ["Primary address", "Secondary address", "Manufacturer", "Identification number", "Version", "Medium", "Last read"]);
});

test("overview exposes the editable M-Bus record table in the requested order", () => {
  const overviewStart = detailsSource.indexOf('{tab === "overview"');
  const recordsPanel = detailsSource.indexOf('title="M-Bus Data Records"', overviewStart);
  const identificationPanel = detailsSource.indexOf("title={OVERVIEW_SECTIONS[0]}", overviewStart);
  assert.ok(recordsPanel > overviewStart && recordsPanel < identificationPanel);
  assert.match(detailsSource, /title="M-Bus Data Records"/);
  assert.match(detailsSource, /<table className="device-reading-table mbus-records-table"><thead><tr><th>Record<\/th><th className="record-edit-column" aria-label="Edit parameter"\/><th>Value<\/th><th>Unit<\/th><th>Storage<\/th><th>Raw value<\/th>/);
  assert.match(detailsSource, /record\.recordIndex/);
  const tableStart = detailsSource.indexOf('className="device-reading-table mbus-records-table"');
  const tableEnd = detailsSource.indexOf("</table>", tableStart);
  assert.doesNotMatch(detailsSource.slice(tableStart, tableEnd), /<th>Function<\/th>/);
  assert.match(detailsSource, />Export reading<\/button>/);
});

test("Current Values section is removed without changing the Discovered devices preview", () => {
  assert.doesNotMatch(detailsSource, /current-values-table|supportedRecords|No supported values decoded yet/);
  assert.match(detailsSource, /record\.unit \|\| "—"/);
});

test("Data Record pencils reuse targeted Configuration navigation without writing", () => {
  assert.match(detailsSource, /configurationFieldIdForDataRecord\(profile, record\)/);
  assert.match(detailsSource, /data-record-edit-button/);
  assert.match(detailsSource, /onConfigure\(configurationFieldId\)/);
  assert.doesNotMatch(detailsSource, /writeConfiguration|applyConfiguration/);
  assert.match(appSource, /setConfigurationTargetFieldId\(fieldId\)/);
  assert.match(appSource, /initialEditFieldId=\{configurationTargetFieldId\}/);
  assert.match(configurationSource, /editableTargetAfterRead\(current, editFieldId\)/);
});
