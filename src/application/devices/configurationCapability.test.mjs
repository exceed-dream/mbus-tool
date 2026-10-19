import assert from "node:assert/strict";
import test from "node:test";
import { configurationFieldIdForDataRecord, hasConfigurableProfile } from "./configurationCapability.ts";

const profile = (installerFields) => ({ id: "profile", manufacturer: "Vendor", model: "Device", deviceType: "Meter", identification: {}, supportedBaudRates: [2400], configurationProtocol: "STANDARD_MBUS", installerFields, isMock: false });
const record = (label, overrides = {}) => ({ label, function: "Instantaneous", storageNumber: 0, supported: true, ...overrides });

test("known configurable profile exposes the table pencil", () => {
  const match = { status: "known", profile: profile([{ id: "primaryAddress", editable: true, writeSupport: "SUPPORTED" }]), matches: [] };
  assert.equal(hasConfigurableProfile(match), true);
});

test("unknown and read-only profiles do not expose the table pencil", () => {
  assert.equal(hasConfigurableProfile({ status: "unknown", matches: [] }), false);
  const readOnly = profile([{ id: "primaryAddress", editable: false, writeSupport: "UNSUPPORTED" }]);
  assert.equal(hasConfigurableProfile({ status: "known", profile: readOnly, matches: [readOnly] }), false);
});

test("Cyble exposes locally editable manufacturer capabilities", () => {
  const cyble = { ...profile([{ id: "volume", editable: true, writeSupport: "NOT_IMPLEMENTED" }]), configurationProtocol: "ITRON_CYBLE" };
  assert.equal(hasConfigurableProfile({ status: "known", profile: cyble, matches: [cyble] }), true);
});

test("configurable Data Records resolve to the active profile field", () => {
  const cyble = profile([{ id: "volume", label: "Volume", editable: true, writeSupport: "SUPPORTED" }, { id: "pulseWeight", label: "Pulse weight", editable: true, writeSupport: "SUPPORTED" }]);
  assert.equal(configurationFieldIdForDataRecord(cyble, record("Volume")), "volume");
  assert.equal(configurationFieldIdForDataRecord(cyble, record("Pulse weight")), "pulseWeight");
  const padPuls = profile([{ id: "counter", label: "Counter", editable: true, writeSupport: "SUPPORTED" }]);
  assert.equal(configurationFieldIdForDataRecord(padPuls, record("Counter")), "counter");
});

test("read-only and unsupported Data Records do not resolve to a Configuration pencil", () => {
  const readOnly = profile([{ id: "energy", label: "Energy", editable: false, writeSupport: "READ_ONLY" }, { id: "power", label: "Power", editable: true, writeSupport: "NOT_IMPLEMENTED" }]);
  assert.equal(configurationFieldIdForDataRecord(readOnly, record("Energy")), undefined);
  assert.equal(configurationFieldIdForDataRecord(readOnly, record("Power")), undefined);
  assert.equal(configurationFieldIdForDataRecord(readOnly, record("Unrelated numeric value", { value: 12 })), undefined);
});

test("historical, stored and unsupported records never expose a Configuration pencil", () => {
  const configurable = profile([{ id: "volume", label: "Volume", editable: true, writeSupport: "SUPPORTED" }]);
  assert.equal(configurationFieldIdForDataRecord(configurable, record("Volume", { function: "Maximum" })), undefined);
  assert.equal(configurationFieldIdForDataRecord(configurable, record("Volume", { storageNumber: 1 })), undefined);
  assert.equal(configurationFieldIdForDataRecord(configurable, record("Volume", { parseStatus: "Unsupported" })), undefined);
});
