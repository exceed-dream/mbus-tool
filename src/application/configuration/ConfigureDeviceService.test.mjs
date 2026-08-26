import test from "node:test";
import assert from "node:assert/strict";
import { ConfigureDeviceService, CYBLE_PRIMARY_MAX_VERIFICATION_ATTEMPTS, CYBLE_PRIMARY_STABILIZATION_DELAY_MS, CYBLE_PRIMARY_VERIFICATION_RETRY_DELAY_MS } from "./ConfigureDeviceService.ts";

test("Secondary-address verification rereads with the new identity and never repeats the write", async () => {
  const adapter = fakeAdapter();
  const result = await service(adapter).configure(device(), undefined, configuration([
    field("primaryAddress", 5, 5), field("secondaryId", "17017649", "17017543"),
  ]));
  assert.equal(adapter.writes, 1);
  assert.equal(adapter.reads, 1);
  assert.equal(adapter.lastReadDevice.identificationNumber, "17017543");
  assert.equal(result.status, "Success");
});

test("Primary write ACK, first timeout and second valid read at the new address succeeds", async () => {
  const adapter = fakeAdapter({ readOutcomes: ["timeout", "valid"] });
  const delays = [];
  const logs = [];
  const result = await service(adapter, delays).configure(device(), undefined, primaryChange(), { onLog: (entry) => logs.push(entry.message) });
  assert.equal(adapter.writes, 1);
  assert.equal(adapter.reads, 2);
  assert.equal(adapter.lastReadDevice.primaryAddress, 6);
  assert.deepEqual(delays, [CYBLE_PRIMARY_STABILIZATION_DELAY_MS, CYBLE_PRIMARY_VERIFICATION_RETRY_DELAY_MS]);
  assert.ok(logs.includes(`Verification attempt 1/${CYBLE_PRIMARY_MAX_VERIFICATION_ATTEMPTS}`));
  assert.ok(logs.some((message) => message.includes("attempt 1/3 timeout")));
  assert.ok(logs.includes(`Verification attempt 2/${CYBLE_PRIMARY_MAX_VERIFICATION_ATTEMPTS}`));
  assert.equal(result.status, "Success");
});

test("three Primary verification timeouts return VerificationFailed without rewriting", async () => {
  const adapter = fakeAdapter({ readOutcomes: ["timeout", "timeout", "timeout"] });
  const delays = [];
  const result = await service(adapter, delays).configure(device(), undefined, primaryChange());
  assert.equal(adapter.writes, 1);
  assert.equal(adapter.reads, 3);
  assert.deepEqual(delays, [CYBLE_PRIMARY_STABILIZATION_DELAY_MS, CYBLE_PRIMARY_VERIFICATION_RETRY_DELAY_MS, CYBLE_PRIMARY_VERIFICATION_RETRY_DELAY_MS]);
  assert.equal(result.status, "VerificationFailed");
  assert.equal(result.rereadSuccessful, false);
});

test("readable Cyble at the new Primary Address with another Secondary ID fails identity verification", async () => {
  const adapter = fakeAdapter({ readOutcomes: ["wrong-secondary"] });
  const result = await service(adapter).configure(device(), undefined, primaryChange());
  assert.equal(adapter.writes, 1);
  assert.equal(adapter.reads, 1);
  assert.equal(result.status, "VerificationFailed");
  assert.match(result.verification.message, /Secondary ID/);
});

test("E5 ACK followed by an unchanged Medium reread remains VerificationFailed", async () => {
  const adapter = fakeAdapter({ mismatch: true });
  const result = await service(adapter).configure(device(), undefined, configuration([
    field("primaryAddress", 5, 5), field("medium", 0x03, 0x16),
  ]));
  assert.equal(result.commandsAcknowledged, 1);
  assert.equal(result.status, "VerificationFailed");
});

test("Medium E5 followed by matching read-back returns Success", async () => {
  const adapter = fakeAdapter();
  const result = await service(adapter).configure(device(), undefined, configuration([
    field("primaryAddress", 5, 5), field("medium", 0x03, 0x16),
  ]));
  assert.equal(adapter.writes, 1);
  assert.equal(adapter.reads, 1);
  assert.equal(result.status, "Success");
});

test("missing E5 stops before reread", async () => {
  const adapter = fakeAdapter({ noAck: true });
  const result = await service(adapter).configure(device(), undefined, primaryChange());
  assert.equal(adapter.reads, 0);
  assert.equal(result.status, "NoAck");
});

function service(adapter, delays = []) { return new ConfigureDeviceService(adapter, async (milliseconds) => { delays.push(milliseconds); }); }

function fakeAdapter(options = {}) {
  return {
    writes: 0, reads: 0, lastReadDevice: undefined,
    validateConfiguration: () => ({ valid: true, issues: [] }),
    writeConfiguration() {
      this.writes += 1;
      return Promise.resolve(options.noAck
        ? { status: "NoAck", message: "Missing E5", telegrams: [{ timestamp: "1", direction: "TX", operation: "write", rawTelegram: "68" }] }
        : { status: "Success", message: "ACK", telegrams: [{ timestamp: "1", direction: "TX", operation: "write", rawTelegram: "68" }, { timestamp: "2", direction: "RX", operation: "write", rawTelegram: "E5" }] });
    },
    readConfiguration(readDevice) {
      this.lastReadDevice = readDevice;
      const outcome = options.readOutcomes?.[this.reads] ?? "valid";
      this.reads += 1;
      if (outcome === "timeout") return Promise.reject(new Error("Timeout"));
      const secondaryId = outcome === "wrong-secondary" ? "99999999" : readDevice.identificationNumber;
      const actualDevice = { ...readDevice, manufacturer: "ACW", version: "20", identificationNumber: secondaryId, secondaryAddress: { ...readDevice.secondaryAddress, identificationNumber: secondaryId } };
      return Promise.resolve(configuration([
        field("primaryAddress", actualDevice.primaryAddress, actualDevice.primaryAddress),
        field("secondaryId", secondaryId, secondaryId),
      ], actualDevice));
    },
    verifyConfiguration() { return options.mismatch ? { status: "VerificationFailed", message: "Mismatch", fields: [] } : { status: "Verified", message: "Verified", fields: [] }; },
  };
}

function primaryChange() { return configuration([field("primaryAddress", 5, 6), field("secondaryId", "17017543", "17017543")]); }
function device() { return { id: "old-id", primaryAddress: 5, identificationNumber: "17017543", secondaryAddress: { identificationNumber: "17017543", manufacturerRaw: 0x0477, version: 20, medium: 7 }, manufacturer: "ACW", version: "20", protocolHint: "ITRON_CYBLE_MBUS_V2", baudRate: 2400, status: "online" }; }
function field(id, currentValue, requestedValue) { return { id, label: id, type: "text", category: "STANDARD_MBUS", required: true, editable: true, readSupport: "SUPPORTED", writeSupport: "SUPPORTED", verificationSupport: "SUPPORTED", currentValue, requestedValue }; }
function configuration(fields, actualDevice) { return { deviceId: "old-id", profileId: "itron-cyble-mbus-v2", readAt: "now", fields, device: actualDevice }; }
