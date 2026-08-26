import test from "node:test";
import assert from "node:assert/strict";
import { deriveCybleVolumeEncoding, sameCyblePhysicalVolume } from "../../domain/mbus/CybleVolumeEncoding.ts";
import { buildLongFrame, toHex } from "../../domain/mbus/MbusFrame.ts";
import { ConfigureDeviceService } from "../../application/configuration/ConfigureDeviceService.ts";
import { ItronCybleMbusV2Adapter } from "./ItronCybleMbusV2Adapter.ts";

test("derives the observed 0.01 m³ Cyble encoding", () => {
  assert.deepEqual(deriveCybleVolumeEncoding("6"), { normalized: "6", raw: 600, resolution: "0.01", vif: 0x14, pulseWeightLitres: 10 });
});

test("accepts comma and preserves the observed high precision encoding", () => {
  assert.deepEqual(deriveCybleVolumeEncoding("12345,678"), { normalized: "12345.678", raw: 12_345_678, resolution: "0.001", vif: 0x13, pulseWeightLitres: 1 });
});

test("rejects more than eight total digits", () => {
  assert.throws(() => deriveCybleVolumeEncoding("123456.789"), /at most 8 digits/);
});

test("accepts all eight-digit Field Tool examples without floating-point scaling", () => {
  assert.deepEqual(deriveCybleVolumeEncoding("12345678"), { normalized: "12345678", raw: 12_345_678, resolution: "1", vif: 0x16, pulseWeightLitres: 1000 });
  assert.deepEqual(deriveCybleVolumeEncoding("1234567.8"), { normalized: "1234567.8", raw: 12_345_678, resolution: "0.1", vif: 0x15, pulseWeightLitres: 100 });
  assert.deepEqual(deriveCybleVolumeEncoding("1234.5678"), { normalized: "1234.5678", raw: 12_345_678, resolution: "0.0001", vif: 0x12, pulseWeightLitres: 0.1 });
  assert.deepEqual(deriveCybleVolumeEncoding("12.345678"), { normalized: "12.345678", raw: 12_345_678, resolution: "0.000001", vif: 0x10, pulseWeightLitres: 0.001 });
});

test("rejects more than six decimal places", () => {
  assert.throws(() => deriveCybleVolumeEncoding("1.2345678"), /at most 6 decimal places/);
});

test("normalizes leading zeroes and equivalent physical volumes", () => {
  assert.deepEqual(deriveCybleVolumeEncoding("000400.00"), { normalized: "000400.00", raw: 40000, resolution: "0.01", vif: 0x14, pulseWeightLitres: 10 });
  assert.equal(sameCyblePhysicalVolume("400", "400.00"), true);
  assert.equal(sameCyblePhysicalVolume("400.0", "400.00"), true);
  assert.equal(sameCyblePhysicalVolume("400.01", "400.00"), false);
});

test("valid A6 challenge unlocks once with TOTAL CRC before the Medium command", async () => {
  const writer = fakeWriter();
  const adapter = new ItronCybleMbusV2Adapter({}, writer);
  const result = await adapter.writeConfiguration(device(), mediumConfiguration(0x07, 0x16));
  assert.equal(result.status, "Success");
  assert.deepEqual(writer.calls.map((request) => request.frame[6]), [0xa6, 0xa5, 0xa9]);
  assert.equal(writer.calls[1].frame[9], 0x48);
  assert.equal(writer.calls[1].frame[10], 0xf6);
  assert.match(result.telegrams.find((telegram) => telegram.operation === "Cyble info challenge" && telegram.direction === "RX").parsedResult, /seed = 00 01 02 03 04 05/);
  assert.match(result.telegrams.find((telegram) => telegram.operation === "Cyble unlock" && telegram.direction === "TX").parsedResult, /CRC total = 0xF648/);
});

test("one A6/A5 preparation covers the complete Cyble configuration batch", async () => {
  const writer = fakeWriter();
  const adapter = new ItronCybleMbusV2Adapter({}, writer);
  const configuration = mediumConfiguration(0x07, 0x16);
  configuration.fields.push(field("volume", "6", "400.00"));
  const result = await adapter.writeConfiguration(device(), configuration);
  assert.equal(result.status, "Success");
  assert.deepEqual(writer.calls.map((request) => request.frame[6]), [0xa6, 0xa5, 0xa9, 0xa9]);
});

test("Pulse weight only uses the existing unlock then the normal A9 01 00 write", async () => {
  const writer = fakeWriter();
  const adapter = new ItronCybleMbusV2Adapter({}, writer);
  const result = await adapter.writeConfiguration(device(), pulseWeightConfiguration("0.01", "0.1"));
  assert.equal(result.status, "Success");
  assert.deepEqual(writer.calls.map((request) => request.frame[6]), [0xa6, 0xa5, 0xa9]);
  assert.deepEqual(writer.calls[2].frame.slice(7, 10), [0x01, 0x00, 0x15]);
  assert.equal(writer.calls[2].operation, "pulseWeight");
});

test("all eight confirmed Pulse weight values pass validation", () => {
  const adapter = new ItronCybleMbusV2Adapter({}, fakeWriter());
  for (const requested of ["0.000001", "0.00001", "0.0001", "0.001", "0.01", "0.1", "1", "10"]) {
    const current = requested === "0.01" ? "0.1" : "0.01";
    assert.equal(adapter.validateConfiguration(pulseWeightConfiguration(current, requested)).valid, true, requested);
  }
  assert.equal(adapter.validateConfiguration(pulseWeightConfiguration("0.01", "0.5")).valid, false);
});

test("incoherent Volume and Pulse weight validation sends no TX", async () => {
  const writer = fakeWriter();
  const adapter = new ItronCybleMbusV2Adapter({}, writer);
  const configuration = pulseWeightConfiguration("0.01", "0.1");
  configuration.fields.push(field("volume", "6", "12345.678"));
  const validation = adapter.validateConfiguration(configuration);
  assert.equal(validation.valid, false);
  assert.match(validation.issues.find((issue) => issue.fieldId === "pulseWeight").message, /inconsistent/);
  const result = await adapter.writeConfiguration(device(), configuration);
  assert.equal(result.status, "Unsupported");
  assert.equal(writer.calls.length, 0);
});

test("A6 timeout sends neither A5 nor Medium", async () => {
  const writer = fakeWriter({ info: "timeout" });
  const result = await new ItronCybleMbusV2Adapter({}, writer).writeConfiguration(device(), mediumConfiguration(0x07, 0x16));
  assert.equal(result.status, "Timeout");
  assert.deepEqual(writer.calls.map((request) => request.frame[6]), [0xa6]);
});

test("malformed A6 response aborts before unlock", async () => {
  const writer = fakeWriter({ info: "malformed" });
  const result = await new ItronCybleMbusV2Adapter({}, writer).writeConfiguration(device(), mediumConfiguration(0x07, 0x16));
  assert.equal(result.status, "ProtocolError");
  assert.deepEqual(writer.calls.map((request) => request.frame[6]), [0xa6]);
});

test("A5 non-E5 response prevents the Medium configuration command", async () => {
  const writer = fakeWriter({ unlock: "no-ack" });
  const result = await new ItronCybleMbusV2Adapter({}, writer).writeConfiguration(device(), mediumConfiguration(0x07, 0x16));
  assert.equal(result.status, "NoAck");
  assert.deepEqual(writer.calls.map((request) => request.frame[6]), [0xa6, 0xa5]);
});

test("Medium verification succeeds only when read-back matches", () => {
  const adapter = new ItronCybleMbusV2Adapter({}, fakeWriter());
  assert.equal(adapter.verifyConfiguration(mediumConfiguration(0x07, 0x16), mediumConfiguration(0x16, 0x16)).status, "Verified");
  assert.equal(adapter.verifyConfiguration(mediumConfiguration(0x07, 0x16), mediumConfiguration(0x07, 0x07)).status, "VerificationFailed");
});

test("Gas flags default to false but remain explicitly unavailable from read-back", () => {
  const adapter = new ItronCybleMbusV2Adapter({}, fakeWriter());
  for (const mediumRaw of [0x07, 0x03]) {
    const configuration = adapter.configurationFromSnapshot({ ...device(), mediumRaw }, gasProfile());
    for (const id of ["pulseWeightX10", "correctedVolume"]) {
      const gasField = configuration.fields.find((field) => field.id === id);
      assert.equal(gasField.currentValue, false);
      assert.equal(gasField.requestedValue, false);
      assert.equal(gasField.readSupport, "NOT_IMPLEMENTED");
      assert.equal(gasField.verificationSupport, "NOT_IMPLEMENTED");
    }
  }
});

test("Gas transition verifies Medium but reports both default flags as read-back unavailable", () => {
  const adapter = new ItronCybleMbusV2Adapter({}, fakeWriter());
  const expected = gasConfiguration(0x16, 0x03, false, false);
  const actual = gasConfiguration(0x03, 0x03, false, false);
  const verification = adapter.verifyConfiguration(expected, actual);
  assert.equal(verification.status, "VerificationFailed");
  assert.equal(verification.fields.find((field) => field.fieldId === "medium").verified, true);
  for (const id of ["pulseWeightX10", "correctedVolume"]) {
    const result = verification.fields.find((field) => field.fieldId === id);
    assert.equal(result.readBackValue, null);
    assert.equal(result.verified, false);
  }
});

test("Cold Water to Gas defaults write through the existing secure two-command workflow", async () => {
  const writer = fakeWriter();
  const adapter = new ItronCybleMbusV2Adapter({}, writer);
  const result = await adapter.writeConfiguration(device(), gasConfiguration(0x16, 0x03, null, null));
  assert.equal(result.status, "Success");
  assert.deepEqual(writer.calls.map((request) => request.frame[6]), [0xa6, 0xa5, 0xa9, 0xa9]);
  assert.deepEqual(writer.calls[2].frame.slice(7, 10), [0x01, 0x0a, 0x03]);
  assert.deepEqual(writer.calls[3].frame.slice(7, 12), [0x02, 0x00, 0x0e, 0x14, 0x03]);
});

test("Customer ID write read-back verification keeps ASCII transmission order", () => {
  const adapter = new ItronCybleMbusV2Adapter({}, fakeWriter());
  const expected = customerIdConfiguration("334799", "654323");
  assert.equal(adapter.verifyConfiguration(expected, customerIdConfiguration("    654323", "    654323")).status, "Verified");
  assert.equal(adapter.verifyConfiguration(expected, customerIdConfiguration("323456", "323456")).status, "VerificationFailed");
});

test("Customer ID 654323 workflow writes ASCII, rereads 654323 and succeeds", async () => {
  const writer = fakeWriter();
  let reads = 0;
  const reader = {
    readDevice() {
      reads += 1;
      return Promise.resolve({ device: { ...device(), cybleConfiguration: { primaryAddress: 6, secondaryId: "17017543", customerId: "654323", medium: 0x07, volume: "6", volumeRaw: 600, volumeVif: 0x14, volumeResolution: "0.01", pulseWeightLitres: 10 } } });
    },
  };
  const adapter = new ItronCybleMbusV2Adapter(reader, writer);
  const result = await new ConfigureDeviceService(adapter).configure(device(), customerIdProfile(), customerIdConfiguration("334799", "654323"));
  assert.equal(result.status, "Success");
  assert.equal(reads, 1);
  assert.deepEqual(writer.calls.map((request) => request.frame[6]), [0xa6, 0xa5, 0xa9]);
  assert.deepEqual(writer.calls[2].frame.slice(13, 19), [0x36, 0x35, 0x34, 0x33, 0x32, 0x33]);
});

test("Pulse weight verification compares the resolution read back after ACK", () => {
  const adapter = new ItronCybleMbusV2Adapter({}, fakeWriter());
  assert.equal(adapter.verifyConfiguration(pulseWeightConfiguration("0.01", "0.1"), pulseWeightConfiguration("0.1", "0.1")).status, "Verified");
  assert.equal(adapter.verifyConfiguration(pulseWeightConfiguration("0.01", "0.1"), pulseWeightConfiguration("0.01", "0.01")).status, "VerificationFailed");
});

test("extreme Pulse weight workflows unlock, receive E5 and require the requested reread resolution", async () => {
  for (const [requested, readResolution, expectedStatus, expectedCode] of [
    ["0.000001", "0.000001", "Success", 0x10],
    ["10", "10", "Success", 0x17],
    ["10", "1", "VerificationFailed", 0x17],
  ]) {
    const writer = fakeWriter();
    let reads = 0;
    const reader = {
      readDevice() {
        reads += 1;
        const readCode = readResolution === "0.000001" ? 0x10 : readResolution === "10" ? 0x17 : 0x16;
        return Promise.resolve({ device: { ...device(), cybleConfiguration: { primaryAddress: 6, secondaryId: "17017543", customerId: "997321", medium: 0x07, volume: "6", volumeRaw: 600, volumeVif: readCode, volumeResolution: readResolution, pulseWeightLitres: 1 } } });
      },
    };
    const adapter = new ItronCybleMbusV2Adapter(reader, writer);
    const result = await new ConfigureDeviceService(adapter).configure(device(), pulseWeightProfile(), pulseWeightConfiguration("0.01", requested));
    assert.equal(result.status, expectedStatus);
    assert.equal(reads, 1);
    assert.deepEqual(writer.calls.map((request) => request.frame[6]), [0xa6, 0xa5, 0xa9]);
    assert.equal(writer.calls[2].frame[9], expectedCode);
  }
});

test("Volume-only verification also checks its derived Pulse weight", () => {
  const adapter = new ItronCybleMbusV2Adapter({}, fakeWriter());
  const expected = mediumConfiguration(0x07, 0x07);
  expected.fields.push(field("volume", "6", "400.00"), field("pulseWeight", "0.001", "0.001"));
  const matching = mediumConfiguration(0x07, 0x07);
  matching.fields.push(field("volume", "400.00", "400.00"), field("pulseWeight", "0.01", "0.01"));
  const wrongResolution = mediumConfiguration(0x07, 0x07);
  wrongResolution.fields.push(field("volume", "400.00", "400.00"), field("pulseWeight", "0.1", "0.1"));
  assert.equal(adapter.verifyConfiguration(expected, matching).status, "Verified");
  assert.equal(adapter.verifyConfiguration(expected, wrongResolution).status, "VerificationFailed");
});

function fakeWriter(options = {}) {
  return {
    calls: [],
    sendFrameAndWaitForAck(request) {
      this.calls.push(request);
      const tx = { timestamp: "1", direction: "TX", operation: request.operation, primaryAddress: request.targetAddress, rawTelegram: toHex(request.frame) };
      if (request.frame[6] === 0xa6) {
        if (options.info === "timeout") return Promise.resolve({ status: "Timeout", message: "Timeout", telegrams: [tx] });
        const response = options.info === "malformed" ? "68 03" : toHex(infoResponse(request.targetAddress));
        return Promise.resolve({ status: "NoAck", message: "Information response", telegrams: [tx, { timestamp: "2", direction: "RX", operation: request.operation, primaryAddress: request.targetAddress, rawTelegram: response }] });
      }
      if (request.frame[6] === 0xa5 && options.unlock === "no-ack") return Promise.resolve({ status: "NoAck", message: "No ACK", telegrams: [tx, { timestamp: "2", direction: "RX", operation: request.operation, rawTelegram: "00" }] });
      return Promise.resolve({ status: "Success", message: "ACK", telegrams: [tx, { timestamp: "2", direction: "RX", operation: request.operation, primaryAddress: request.targetAddress, rawTelegram: "E5" }] });
    },
  };
}

function infoResponse(address) {
  const data = new Array(25).fill(0);
  data.splice(19, 6, 0, 1, 2, 3, 4, 5);
  return buildLongFrame({ control: 0x08, address, ci: 0x72, data });
}

function mediumConfiguration(currentValue, requestedValue) {
  return { deviceId: "cyble", profileId: "itron-cyble-mbus-v2", readAt: "now", fields: [field("primaryAddress", 6, 6), field("medium", currentValue, requestedValue)] };
}

function pulseWeightConfiguration(currentValue, requestedValue) {
  return { deviceId: "cyble", profileId: "itron-cyble-mbus-v2", readAt: "now", fields: [field("primaryAddress", 6, 6), field("pulseWeight", currentValue, requestedValue)] };
}

function customerIdConfiguration(currentValue, requestedValue) {
  return { deviceId: "cyble", profileId: "itron-cyble-mbus-v2", readAt: "now", fields: [field("primaryAddress", 6, 6), field("customerId", currentValue, requestedValue)] };
}

function gasConfiguration(currentMedium, requestedMedium, pulseWeightX10, correctedVolume) {
  return { deviceId: "cyble", profileId: "itron-cyble-mbus-v2", readAt: "now", fields: [field("primaryAddress", 6, 6), field("medium", currentMedium, requestedMedium), gasField("pulseWeightX10", pulseWeightX10, pulseWeightX10), gasField("correctedVolume", correctedVolume, correctedVolume)] };
}

function gasField(id, currentValue, requestedValue) {
  return { ...field(id, currentValue, requestedValue), readSupport: "NOT_IMPLEMENTED", verificationSupport: "NOT_IMPLEMENTED" };
}

function gasProfile() {
  return { id: "itron-cyble-mbus-v2", manufacturer: "Itron", model: "Cyble M-Bus V2", installerFields: [field("medium", null, null), gasField("pulseWeightX10", null, null), gasField("correctedVolume", null, null)] };
}

function customerIdProfile() {
  return { id: "itron-cyble-mbus-v2", manufacturer: "Itron", model: "Cyble M-Bus V2", installerFields: [field("primaryAddress", null, null), field("customerId", null, null)] };
}

function pulseWeightProfile() {
  return { id: "itron-cyble-mbus-v2", manufacturer: "Itron", model: "Cyble M-Bus V2", installerFields: [field("primaryAddress", null, null), field("pulseWeight", null, null)] };
}

function field(id, currentValue, requestedValue) {
  const options = id === "medium" ? [{ value: 0x07, label: "Water" }, { value: 0x16, label: "Cold Water" }] : id === "pulseWeight" ? ["0.000001", "0.00001", "0.0001", "0.001", "0.01", "0.1", "1", "10"].map((value) => ({ value, label: value })) : undefined;
  return { id, label: id, type: options ? "select" : id === "volume" ? "text" : "integer", category: "STANDARD_MBUS", required: true, editable: true, options, readSupport: "SUPPORTED", writeSupport: "SUPPORTED", verificationSupport: "SUPPORTED", currentValue, requestedValue };
}

function device() {
  return { id: "cyble", primaryAddress: 6, identificationNumber: "17017543", secondaryAddress: { identificationNumber: "17017543", manufacturerRaw: 0x0477, version: 20, medium: 0x07 }, manufacturer: "ACW", manufacturerRaw: 0x0477, version: "20", baudRate: 2400, status: "online", protocolHint: "ITRON_CYBLE_MBUS_V2" };
}
