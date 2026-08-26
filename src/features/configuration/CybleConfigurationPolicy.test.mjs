import test from "node:test";
import assert from "node:assert/strict";
import { CYBLE_MEDIUM_CHANGE_WARNING, cybleMediumOptions, isCybleFieldVisible, withCybleMediumAndGasDefaults } from "../../domain/mbus/CybleConfigurationPolicy.ts";
import { changedFields, withRequestedValue } from "../../domain/configuration/DeviceConfiguration.ts";
import { mbusMediumOptions } from "../../domain/mbus/MbusMedium.ts";
import { mockProfiles } from "../../infrastructure/mbus/mockData.ts";

test("Cyble profile exposes exactly the manufacturer application Medium capabilities", () => {
  assert.deepEqual(cybleMediumOptions, [
    { code: 0x07, label: "Water" },
    { code: 0x03, label: "Gas" },
    { code: 0x16, label: "Cold Water" },
    { code: 0x06, label: "Hot Water" },
    { code: 0x00, label: "Other" },
  ]);
  const profile = mockProfiles.find((candidate) => candidate.id === "itron-cyble-mbus-v2");
  const medium = profile.installerFields.find((field) => field.id === "medium");
  assert.deepEqual(medium.options, cybleMediumOptions.map((option) => ({ value: option.code, label: option.label })));
  assert.equal(medium.writeSupport, "SUPPORTED");
  assert.equal(medium.verificationSupport, "SUPPORTED");
});

test("Cyble profile exposes only confirmed normal Pulse weight values as editable", () => {
  const profile = mockProfiles.find((candidate) => candidate.id === "itron-cyble-mbus-v2");
  const pulseWeight = profile.installerFields.find((field) => field.id === "pulseWeight");
  assert.equal(pulseWeight.type, "select");
  assert.equal(pulseWeight.editable, true);
  assert.equal(pulseWeight.unit, "m³/p");
  assert.deepEqual(pulseWeight.options, [
    { value: "0.000001", label: "0.000001" },
    { value: "0.00001", label: "0.00001" },
    { value: "0.0001", label: "0.0001" },
    { value: "0.001", label: "0.001" },
    { value: "0.01", label: "0.01" },
    { value: "0.1", label: "0.1" },
    { value: "1", label: "1" },
    { value: "10", label: "10" },
  ]);
  assert.equal(pulseWeight.writeSupport, "SUPPORTED");
  assert.equal(pulseWeight.verificationSupport, "SUPPORTED");
});

test("PadPuls retains the complete global M-Bus Medium options", () => {
  const profile = mockProfiles.find((candidate) => candidate.id === "relay-padpuls-m1");
  assert.deepEqual(profile.installerFields.find((field) => field.id === "medium").options, mbusMediumOptions.map((option) => ({ value: option.code, label: option.label })));
});

test("Gas exposes Cyble gas-only parameters", () => {
  assert.equal(isCybleFieldVisible("pulseWeightX10", 0x03), true);
  assert.equal(isCybleFieldVisible("correctedVolume", 0x03), true);
});

test("Gas fields are ordered Corrected Volume then Pulse weight ×10 and are not presented as readable", () => {
  const profile = mockProfiles.find((candidate) => candidate.id === "itron-cyble-mbus-v2");
  const gasFields = profile.installerFields.filter((field) => ["correctedVolume", "pulseWeightX10"].includes(field.id));
  assert.deepEqual(gasFields.map((field) => field.id), ["correctedVolume", "pulseWeightX10"]);
  for (const field of gasFields) {
    assert.equal(field.readSupport, "NOT_IMPLEMENTED");
    assert.equal(field.writeSupport, "SUPPORTED");
    assert.equal(field.verificationSupport, "NOT_IMPLEMENTED");
  }
});

test("Water and Cold Water hide Cyble gas-only parameters", () => {
  assert.equal(isCybleFieldVisible("pulseWeightX10", 0x07), false);
  assert.equal(isCybleFieldVisible("correctedVolume", 0x16), false);
});

test("selecting Gas defaults unknown flags to false without artificial pending changes", () => {
  const gas = withCybleMediumAndGasDefaults(configuration(0x16, null, null), 0x03);
  assert.deepEqual(values(gas), { medium: 0x03, pulseWeightX10: false, correctedVolume: false });
  assert.deepEqual(changedFields(gas).map((field) => field.id), ["medium"]);
  const corrected = withRequestedValue(gas, "correctedVolume", true);
  assert.deepEqual(changedFields(corrected).map((field) => field.id), ["medium", "correctedVolume"]);
  const x10 = withRequestedValue(gas, "pulseWeightX10", true);
  assert.deepEqual(changedFields(x10).map((field) => field.id), ["medium", "pulseWeightX10"]);
});

test("leaving Gas resets effective flags and normal Pulse weight remains independent", () => {
  const current = configuration(0x03, true, true);
  current.fields.push(field("pulseWeight", "0.01", "0.1"));
  const water = withCybleMediumAndGasDefaults(current, 0x16);
  assert.deepEqual(values(water), { medium: 0x16, pulseWeightX10: false, correctedVolume: false });
  assert.deepEqual(changedFields(water).map((field) => field.id), ["medium", "pulseWeight"]);
});

test("Medium warning names the observed risks", () => {
  assert.match(CYBLE_MEDIUM_CHANGE_WARNING, /reset volume/);
  assert.match(CYBLE_MEDIUM_CHANGE_WARNING, /medium-specific parameters/);
});

function field(id, currentValue, requestedValue = currentValue) {
  return { id, label: id, type: typeof currentValue === "boolean" ? "boolean" : "select", category: "MANUFACTURER_SPECIFIC", required: true, editable: true, readSupport: "SUPPORTED", writeSupport: "SUPPORTED", verificationSupport: "SUPPORTED", currentValue, requestedValue };
}

function configuration(medium, pulseWeightX10, correctedVolume) {
  return { deviceId: "cyble", profileId: "itron-cyble-mbus-v2", readAt: "now", fields: [field("medium", medium), field("pulseWeightX10", pulseWeightX10), field("correctedVolume", correctedVolume)] };
}

function values(configuration) {
  return Object.fromEntries(configuration.fields.filter((field) => ["medium", "pulseWeightX10", "correctedVolume"].includes(field.id)).map((field) => [field.id, field.requestedValue]));
}
