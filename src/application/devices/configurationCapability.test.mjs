import assert from "node:assert/strict";
import test from "node:test";
import { configurationFieldIdForCurrentValue, hasConfigurableProfile } from "./configurationCapability.ts";

const profile = (installerFields) => ({ id: "profile", manufacturer: "Vendor", model: "Device", deviceType: "Meter", identification: {}, supportedBaudRates: [2400], configurationProtocol: "STANDARD_MBUS", installerFields, isMock: false });

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

test("configurable Current values resolve to the active profile field", () => {
  const cyble = profile([{ id: "volume", label: "Volume", editable: true, writeSupport: "SUPPORTED" }, { id: "pulseWeight", label: "Pulse weight", editable: true, writeSupport: "SUPPORTED" }]);
  assert.equal(configurationFieldIdForCurrentValue(cyble, { label: "Volume" }), "volume");
  assert.equal(configurationFieldIdForCurrentValue(cyble, { label: "Pulse weight" }), "pulseWeight");
});

test("read-only Current values do not resolve to a Configuration pencil", () => {
  const readOnly = profile([{ id: "energy", label: "Energy", editable: false, writeSupport: "READ_ONLY" }, { id: "power", label: "Power", editable: true, writeSupport: "NOT_IMPLEMENTED" }]);
  assert.equal(configurationFieldIdForCurrentValue(readOnly, { label: "Energy" }), undefined);
  assert.equal(configurationFieldIdForCurrentValue(readOnly, { label: "Power" }), undefined);
});
