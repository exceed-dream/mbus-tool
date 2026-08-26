import type { ConfigurationWriteResult, TechnicalTelegram } from "../configuration/DeviceConfiguration.ts";
import type { MbusWriteClient, ScanObserver } from "./MbusClient.ts";
import { mbusChecksum, toHex } from "./MbusFrame.ts";

export type CybleProductCrcMode = "PARTIAL" | "TOTAL";

export const CYBLE_PRODUCT_CRC_POLYNOMIAL = {
  PARTIAL: 0x4e87,
  TOTAL: 0x78e4,
} as const;
export const CYBLE_PRODUCT_CRC_INITIAL = 0xffff;

const CYBLE_UNLOCK_SEED_RAW_START = 26;
const CYBLE_UNLOCK_SEED_LENGTH = 6;

export function extractCybleUnlockSeed(infoFrame: readonly number[], expectedAddress?: number): number[] {
  validateFullLongFrame(infoFrame);
  if (expectedAddress !== undefined && infoFrame[5] !== expectedAddress) throw new Error("Cyble A6 response address does not match the requested device.");
  const contentEnd = 4 + infoFrame[1];
  const seedEnd = CYBLE_UNLOCK_SEED_RAW_START + CYBLE_UNLOCK_SEED_LENGTH;
  if (seedEnd > contentEnd) throw new Error("Cyble A6 response does not contain the six-byte unlock seed.");
  // Itron's DecryptedFrame is the complete plaintext M-Bus long frame retained
  // by mbus-tool. Raw indices 26..31 map to long-frame data offsets 19..24.
  return infoFrame.slice(CYBLE_UNLOCK_SEED_RAW_START, seedEnd);
}

export function reorderCybleUnlockSeed(seed: readonly number[]): number[] {
  if (seed.length !== CYBLE_UNLOCK_SEED_LENGTH || seed.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)) throw new Error("Cyble unlock seed must contain exactly six bytes.");
  return [seed[2], seed[3], seed[4], seed[5], seed[0], seed[1]];
}

export function computeCybleProductCrc(seed: readonly number[], mode: CybleProductCrcMode): number {
  const polynomial = CYBLE_PRODUCT_CRC_POLYNOMIAL[mode];
  let crc = CYBLE_PRODUCT_CRC_INITIAL;
  for (const byte of reorderCybleUnlockSeed(seed)) {
    let shifted = (byte << 8) & 0xffff;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (((shifted ^ crc) & 0x8000) === 0 ? crc << 1 : (crc << 1) ^ polynomial) & 0xffff;
      shifted = (shifted << 1) & 0xffff;
    }
  }
  return crc;
}

export async function prepareCybleForWrite(writer: MbusWriteClient, primaryAddress: number, infoFrame: number[], unlockFrame: (crc: number) => number[], observer?: ScanObserver): Promise<ConfigurationWriteResult> {
  const info = await writer.sendFrameAndWaitForAck({ targetAddress: primaryAddress, operation: "Cyble info challenge", frame: infoFrame }, observer);
  const infoRx = info.telegrams.find((telegram) => telegram.direction === "RX" && telegram.rawTelegram.trim().toUpperCase() !== "E5");
  if (!infoRx) return preparationFailure(info.status === "Timeout" ? "Timeout" : "ProtocolError", info.status === "Timeout" ? "Timeout waiting for Cyble A6 information response." : "Cyble A6 information response is missing.", info.telegrams);

  let seed: number[];
  try { seed = extractCybleUnlockSeed(parseHexTelegram(infoRx.rawTelegram), primaryAddress); }
  catch (error) { return preparationFailure("ProtocolError", error instanceof Error ? error.message : String(error), info.telegrams); }

  const crc = computeCybleProductCrc(seed, "TOTAL");
  const seedText = toHex(seed);
  const crcText = `0x${crc.toString(16).toUpperCase().padStart(4, "0")}`;
  const infoTelegrams = info.telegrams.map((telegram) => telegram === infoRx ? { ...telegram, parsedResult: `seed = ${seedText}` } : telegram);
  observer?.onLog?.({ timestamp: new Date().toISOString(), level: "INFO", message: `Cyble unlock seed = ${seedText} · CRC total = ${crcText}`, address: primaryAddress });

  const unlock = await writer.sendFrameAndWaitForAck({ targetAddress: primaryAddress, operation: "Cyble unlock", frame: unlockFrame(crc) }, observer);
  const unlockTelegrams = unlock.telegrams.map((telegram) => telegram.direction === "TX" ? { ...telegram, parsedResult: `seed = ${seedText} · CRC total = ${crcText}` } : telegram);
  const unlockResponses = unlock.telegrams.filter((telegram) => telegram.direction === "RX");
  if (unlock.status !== "Success" || unlockResponses.length !== 1 || unlockResponses[0].rawTelegram.trim().toUpperCase() !== "E5") {
    const status = unlock.status === "Timeout" ? "Timeout" : unlock.status === "ProtocolError" ? "ProtocolError" : "NoAck";
    return preparationFailure(status, "Cyble A5 unlock did not receive the exact E5 ACK.", [...infoTelegrams, ...unlockTelegrams]);
  }
  return { status: "Success", message: `Cyble TOTAL unlock accepted (${crcText}).`, telegrams: [...infoTelegrams, ...unlockTelegrams] };
}

function validateFullLongFrame(frame: readonly number[]): void {
  if (frame.length < 9 || frame[0] !== 0x68 || frame[3] !== 0x68 || frame[1] !== frame[2]) throw new Error("Malformed Cyble A6 M-Bus long frame.");
  const length = frame[1];
  if (frame.length !== length + 6 || frame[frame.length - 1] !== 0x16) throw new Error("Malformed Cyble A6 frame length or stop byte.");
  if (mbusChecksum(frame.slice(4, 4 + length)) !== frame[4 + length]) throw new Error("Cyble A6 response checksum mismatch.");
}

function parseHexTelegram(value: string): number[] {
  const tokens = value.trim().split(/\s+/);
  if (!tokens.length || tokens.some((token) => !/^[0-9a-f]{2}$/i.test(token))) throw new Error("Cyble A6 response is not a raw hexadecimal frame.");
  return tokens.map((token) => Number.parseInt(token, 16));
}

function preparationFailure(status: "Timeout" | "ProtocolError" | "NoAck", message: string, telegrams: TechnicalTelegram[]): ConfigurationWriteResult {
  return { status, message, telegrams };
}
