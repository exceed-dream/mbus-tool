import test from "node:test";
import assert from "node:assert/strict";
import { applicableProfilesForMatch, defaultProfileForMatch } from "./DeviceProfileSelection.ts";

const cyble = profile("itron-cyble-mbus-v2", { manufacturerRaw: 0x0477 });
const alternative = profile("acw-alternative", { manufacturerRaw: 0x0477 });
const generic = profile("generic-mbus-meter", {});

test("single possible Cyble candidate is selected automatically and is immediately available to Configuration", () => {
  const match = { status: "possible", profile: cyble, matches: [cyble] };
  assert.equal(defaultProfileForMatch(match, [cyble, generic])?.id, cyble.id);
  assert.deepEqual(applicableProfilesForMatch(match, [cyble, generic]).map((item) => item.id), [cyble.id, generic.id]);
});

test("equally plausible profiles are not selected arbitrarily", () => {
  const match = { status: "ambiguous", matches: [cyble, alternative] };
  assert.equal(defaultProfileForMatch(match, [cyble, alternative, generic]), undefined);
  assert.deepEqual(applicableProfilesForMatch(match, [cyble, alternative, generic]).map((item) => item.id), [cyble.id, alternative.id, generic.id]);
});

test("unknown devices retain the generic profile", () => {
  assert.equal(defaultProfileForMatch({ status: "unknown", matches: [] }, [cyble, generic])?.id, generic.id);
});

function profile(id, identification) { return { id, manufacturer: id, model: id, deviceType: "meter", identification, supportedBaudRates: [2400], configurationProtocol: "STANDARD_MBUS", installerFields: [], isMock: false }; }
