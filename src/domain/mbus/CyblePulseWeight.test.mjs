import test from "node:test";
import assert from "node:assert/strict";
import {
  cyblePulseWeightOptions,
  deriveCyblePulseWeightFromResolutionCode,
  deriveCybleResolutionCodeFromPulseWeight,
} from "./CyblePulseWeight.ts";

test("confirmed Cyble Pulse weight values map bidirectionally to their resolution codes", () => {
  assert.deepEqual(cyblePulseWeightOptions, [
    { value: "0.000001", resolutionCode: 0x10 },
    { value: "0.00001", resolutionCode: 0x11 },
    { value: "0.0001", resolutionCode: 0x12 },
    { value: "0.001", resolutionCode: 0x13 },
    { value: "0.01", resolutionCode: 0x14 },
    { value: "0.1", resolutionCode: 0x15 },
    { value: "1", resolutionCode: 0x16 },
    { value: "10", resolutionCode: 0x17 },
  ]);
  for (const option of cyblePulseWeightOptions) {
    assert.equal(deriveCybleResolutionCodeFromPulseWeight(option.value), option.resolutionCode);
    assert.equal(deriveCyblePulseWeightFromResolutionCode(option.resolutionCode), option.value);
  }
});

test("unconfirmed Cyble Pulse weight values and resolution codes are rejected", () => {
  for (const value of ["", "0.0000001", "0.010", "0.5", "100", "unknown"]) {
    assert.throws(() => deriveCybleResolutionCodeFromPulseWeight(value), /must be one of/);
  }
  assert.throws(() => deriveCyblePulseWeightFromResolutionCode(0x0f), /Unsupported/);
  assert.throws(() => deriveCyblePulseWeightFromResolutionCode(0x18), /Unsupported/);
});
