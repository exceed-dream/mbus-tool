import assert from "node:assert/strict";
import test from "node:test";
import { AutomaticConfigurationReadGate, SingleConfigurationWriteGate, appendOperationCommunicationEntry, beginOperationCommunicationLog, editableTargetAfterRead, isApplyConfigurationEnabled, profileChangeRequiresConfirmation, rebuildConfigurationForProfile, refreshRequiresDiscard, retainVerifiedSnapshot, selectValueLabel, showApplyConfirmation, statusAfterRead } from "./ConfigurationUiPolicy.ts";

test("automatic configuration read runs once for the same render key", () => {
  const gate = new AutomaticConfigurationReadGate();
  assert.equal(gate.shouldRead("device-2", "padpuls-m1"), true);
  assert.equal(gate.shouldRead("device-2", "padpuls-m1"), false);
});

test("changing the target device permits a new automatic read", () => {
  const gate = new AutomaticConfigurationReadGate();
  gate.shouldRead("device-2", "padpuls-m1");
  assert.equal(gate.shouldRead("device-3", "padpuls-m1"), true);
});

test("verified response snapshot suppresses a redundant automatic reread", () => {
  const gate = new AutomaticConfigurationReadGate();
  retainVerifiedSnapshot(gate, "verified-device", "itron-cyble-mbus-v2");
  assert.equal(gate.shouldRead("verified-device", "itron-cyble-mbus-v2"), false);
});

test("starting a new configuration operation clears the previous contextual log", () => {
  let log = beginOperationCommunicationLog(0, "READ_CONFIGURATION");
  log = appendOperationCommunicationEntry(log, log.operationId, entry("TX", "REQ_UD2", "10 5B 06 61 16"));
  log = appendOperationCommunicationEntry(log, log.operationId, entry("RX", "M-Bus response", "68 03 03 68"));
  assert.deepEqual(log.entries.map((item) => item.level), ["TX", "RX"]);
  const next = beginOperationCommunicationLog(log.operationId, "READ_CONFIGURATION");
  assert.equal(next.entries.length, 0);
});

test("Apply contextual log retains only current apply events and filters scan noise", () => {
  let log = beginOperationCommunicationLog(4, "APPLY_CONFIGURATION");
  const oldOperationId = log.operationId - 1;
  log = appendOperationCommunicationEntry(log, oldOperationId, entry("TX", "Old write", "68"));
  log = appendOperationCommunicationEntry(log, log.operationId, entry("SECONDARY", "Quick scan branch"));
  for (const item of [entry("TX", "Cyble info challenge", "68 A6"), entry("RX", "Cyble info challenge", "68 1D"), entry("INFO", "seed = 3D 48 · CRC total = 0x897C"), entry("TX", "Cyble unlock", "68 A5"), entry("RX", "Cyble unlock", "E5"), entry("TX", "Pulse weight", "68 06 06 68 53 06 A9 01 00 15 18 16"), entry("RX", "Pulse weight", "E5"), entry("VERIFY", "Reading configuration after write"), entry("TX", "REQ_UD2", "10 5B 06 61 16"), entry("RX", "M-Bus response", "68 56"), entry("VERIFY", "Pulse weight verified")]) log = appendOperationCommunicationEntry(log, log.operationId, item);
  assert.deepEqual(log.entries.map((item) => item.message), ["Cyble info challenge", "Cyble info challenge", "seed = 3D 48 · CRC total = 0x897C", "Cyble unlock", "Cyble unlock", "Pulse weight", "Pulse weight", "Reading configuration after write", "REQ_UD2", "M-Bus response", "Pulse weight verified"]);
});

test("Apply error remains until the next operation begins", () => {
  let log = beginOperationCommunicationLog(8, "APPLY_CONFIGURATION");
  log = appendOperationCommunicationEntry(log, log.operationId, entry("ERROR", "A5 timeout"));
  assert.equal(log.entries.at(-1).message, "A5 timeout");
});

test("read completion maps to Ready or Error", () => {
  assert.equal(statusAfterRead(true), "Ready");
  assert.equal(statusAfterRead(false), "Error");
});

test("pending confirmation follows dirty state and reset hides it", () => {
  assert.equal(showApplyConfirmation(1), true);
  assert.equal(showApplyConfirmation(0), false);
});

test("refresh protects dirty state before reload", () => {
  assert.equal(refreshRequiresDiscard(1), true);
  assert.equal(refreshRequiresDiscard(0), false);
});

test("manual profile change requires confirmation only with dirty state", () => {
  assert.equal(profileChangeRequiresConfirmation(1), true);
  assert.equal(profileChangeRequiresConfirmation(0), false);
});

test("manual profile change rebuilds from snapshot without M-Bus TX", () => {
  let writes = 0;
  const snapshot = { id: "device", baudRate: 2400, status: "online" };
  const profile = { id: "generic", installerFields: [] };
  const expected = { deviceId: "device", profileId: "generic", readAt: "now", fields: [{ id: "primaryAddress", currentValue: 5, requestedValue: 5 }] };
  const reader = { currentConfigurationFromSnapshot(device, selectedProfile) { assert.equal(device, snapshot); assert.equal(selectedProfile, profile); return expected; }, writeConfiguration() { writes += 1; } };
  const rebuilt = rebuildConfigurationForProfile(reader, snapshot, profile);
  assert.equal(rebuilt, expected);
  assert.equal(rebuilt.fields[0].requestedValue, rebuilt.fields[0].currentValue);
  assert.equal(writes, 0);
});

test("an unlisted current Medium remains safely displayable", () => {
  const field = { id: "medium", type: "select", options: [{ value: 0x07, label: "Water" }] };
  assert.equal(selectValueLabel(field, 0x01), "Unsupported (0x01)");
});

test("Apply changes starts only one write while one is in flight", () => {
  const gate = new SingleConfigurationWriteGate();
  assert.equal(gate.tryStart(), true);
  assert.equal(gate.tryStart(), false);
  gate.finish();
  assert.equal(gate.tryStart(), true);
});

test("Apply requires connection, changes and valid supported configuration", () => {
  const ready = { connected: true, changeCount: 1, validationValid: true, busy: false, writeProtected: false };
  assert.equal(isApplyConfigurationEnabled(ready), true);
  assert.equal(isApplyConfigurationEnabled({ ...ready, connected: false }), false);
  assert.equal(isApplyConfigurationEnabled({ ...ready, changeCount: 0 }), false);
  assert.equal(isApplyConfigurationEnabled({ ...ready, validationValid: false }), false);
});

test("pencil target is selected only from the freshly read configuration", () => {
  const configuration = {
    writeProtected: false,
    fields: [
      { id: "primaryAddress", editable: true, writeSupport: "SUPPORTED" },
      { id: "fabricationNumber", editable: false, writeSupport: "UNSUPPORTED" },
    ],
  };
  assert.equal(editableTargetAfterRead(configuration, "primaryAddress"), "primaryAddress");
  assert.equal(editableTargetAfterRead(configuration, "fabricationNumber"), undefined);
  assert.equal(editableTargetAfterRead({ ...configuration, writeProtected: true }, "primaryAddress"), undefined);
});

function entry(level, message, hex) { return { timestamp: "2026-01-01T14:29:52.000Z", level, message, address: 6, hex }; }
