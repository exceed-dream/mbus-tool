import test from "node:test";
import assert from "node:assert/strict";
import { buildLongFrame, toHex } from "./MbusFrame.ts";
import { CYBLE_PRODUCT_CRC_INITIAL, CYBLE_PRODUCT_CRC_POLYNOMIAL, computeCybleProductCrc, extractCybleUnlockSeed, reorderCybleUnlockSeed } from "./CybleUnlock.ts";

test("Cyble unlock seed uses the confirmed 2,3,4,5,0,1 order", () => {
  assert.deepEqual(reorderCybleUnlockSeed([0, 1, 2, 3, 4, 5]), [2, 3, 4, 5, 0, 1]);
});

test("Cyble product CRC starts at FFFF and uses the confirmed TOTAL and PARTIAL polynomials", () => {
  assert.equal(CYBLE_PRODUCT_CRC_INITIAL, 0xffff);
  assert.deepEqual(CYBLE_PRODUCT_CRC_POLYNOMIAL, { PARTIAL: 0x4e87, TOTAL: 0x78e4 });
  assert.equal(computeCybleProductCrc([0, 1, 2, 3, 4, 5], "TOTAL"), 0xf648);
  assert.equal(computeCybleProductCrc([0, 1, 2, 3, 4, 5], "PARTIAL"), 0x3dee);
});

test("Cyble seed extraction maps raw full-frame indices 26 through 31", () => {
  const data = new Array(25).fill(0);
  data.splice(19, 6, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff);
  const frame = buildLongFrame({ control: 0x08, address: 6, ci: 0x72, data });
  assert.equal(toHex(frame).split(" ").slice(26, 32).join(" "), "AA BB CC DD EE FF");
  assert.deepEqual(extractCybleUnlockSeed(frame, 6), [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
});

test("Cyble seed extraction rejects malformed or too-short A6 responses", () => {
  assert.throws(() => extractCybleUnlockSeed([0x68, 0x03], 6), /Malformed/);
  assert.throws(() => extractCybleUnlockSeed(buildLongFrame({ control: 0x08, address: 6, ci: 0x72 }), 6), /six-byte/);
});
