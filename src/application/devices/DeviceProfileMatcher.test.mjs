import test from "node:test";
import assert from "node:assert/strict";
import { matchDeviceProfile } from "./DeviceProfileMatcher.ts";

const cyble = { id: "itron-cyble-mbus-v2", manufacturer: "Itron", model: "Cyble M-Bus V2", deviceType: "Pulse M-Bus module", identification: { manufacturerCode: "ACW", manufacturerRaw: 0x0477, version: "20", telegramSignature: "ITRON_CYBLE_MBUS_V2" }, supportedBaudRates: [2400], configurationProtocol: "ITRON_CYBLE", installerFields: [], isMock: false };
const device = { id: "cyble", manufacturer: "ACW", manufacturerRaw: 0x0477, version: "20", baudRate: 2400, status: "online" };

test("exact ACW/version/telegram structure identifies Itron Cyble M-Bus V2", () => {
  const match = matchDeviceProfile({ ...device, protocolHint: "ITRON_CYBLE_MBUS_V2" }, [cyble]);
  assert.equal(match.status, "known");
  assert.equal(match.profile?.id, "itron-cyble-mbus-v2");
});

test("ACW manufacturer alone yields one possible Cyble candidate for automatic selection", () => {
  assert.equal(matchDeviceProfile(device, [cyble]).status, "possible");
  assert.equal(matchDeviceProfile({ ...device, manufacturerRaw: 0x1234 }, [cyble]).status, "unknown");
});

test("equally plausible manufacturer candidates remain ambiguous", () => {
  const alternative = { ...cyble, id: "acw-alternative", model: "Alternative" };
  const match = matchDeviceProfile(device, [cyble, alternative]);
  assert.equal(match.status, "ambiguous");
  assert.equal(match.matches.length, 2);
});
