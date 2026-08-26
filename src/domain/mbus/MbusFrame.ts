export interface LongFrameInput {
  control: number;
  address: number;
  ci: number;
  data?: readonly number[];
}

export function mbusChecksum(bytes: readonly number[]): number {
  return bytes.reduce((sum, byte) => (sum + assertByte(byte)) & 0xff, 0);
}

export function buildLongFrame({ control, address, ci, data = [] }: LongFrameInput): number[] {
  const body = [assertByte(control), assertByte(address), assertByte(ci), ...data.map(assertByte)];
  if (body.length > 255) throw new Error("M-Bus long frame body exceeds 255 bytes.");
  return [0x68, body.length, body.length, 0x68, ...body, mbusChecksum(body), 0x16];
}

export function toHex(bytes: readonly number[]): string {
  return bytes.map((byte) => assertByte(byte).toString(16).toUpperCase().padStart(2, "0")).join(" ");
}

function assertByte(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xff) throw new Error(`Invalid byte: ${value}`);
  return value;
}
