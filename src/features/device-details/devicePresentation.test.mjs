import assert from "node:assert/strict";
import test from "node:test";
import { DEVICE_DETAIL_TABS, DEVICE_SUMMARY_FIELDS, DEVICE_TABLE_COLUMNS, IDENTIFICATION_FIELD_ORDER, OVERVIEW_SECTIONS, currentValuesPreview, mediumAndDevice } from "./devicePresentation.ts";
import { readFileSync } from "node:fs";

const detailsSource = readFileSync(new URL("./DeviceDetailsPage.tsx", import.meta.url), "utf8");

const record = (id, label, value, unit, functionName = "Instantaneous", supported = true) => ({ id, recordIndex: 0, label, value, unit, function: functionName, storageNumber: 0, rawValue: "00", supported });

test("device table columns follow the requested order", () => {
  assert.deepEqual(DEVICE_TABLE_COLUMNS, ["Device ID", "Address", "Medium / Device", "Current values", "Status"]);
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
  assert.deepEqual(DEVICE_SUMMARY_FIELDS, ["Device status", "Device", "Primary address", "Last read"]);
  assert.deepEqual(DEVICE_DETAIL_TABS, ["Overview", "Data records", "Raw Telegram"]);
  assert.deepEqual(OVERVIEW_SECTIONS, ["Current values", "Identification", "Communication"]);
});

test("identification exposes the required reading fields in order", () => {
  assert.deepEqual(IDENTIFICATION_FIELD_ORDER.slice(0, 7), ["Primary address", "Secondary address", "Manufacturer", "Identification number", "Version", "Medium", "Last read"]);
});

test("overview exposes M-Bus records directly with Value before Unit", () => {
  assert.match(detailsSource, /title="M-Bus Data Records"/);
  assert.match(detailsSource, /<th>Record #<\/th><th>Function<\/th><th>Storage<\/th><th>Value<\/th><th>Unit<\/th><th>Raw value<\/th>/);
  assert.match(detailsSource, /record\.recordIndex/);
  assert.match(detailsSource, />Export reading<\/button>/);
});

test("Current value pencils reuse targeted Configuration navigation", () => {
  assert.match(detailsSource, /configurationFieldIdForCurrentValue\(profile, record\)/);
  assert.match(detailsSource, /current-value-edit-button/);
  assert.match(detailsSource, /onConfigure\(configurationFieldId\)/);
});
