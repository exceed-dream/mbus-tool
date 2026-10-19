import { invoke } from "@tauri-apps/api/core";
import type { DeviceReadResult, ManufacturerFrameWriteRequest, MbusClient, PadPulsWriteRequest, PrimaryAddressWriteRequest, PrimaryScanOptions, RawTelegram, ScanObserver } from "../../domain/mbus/MbusClient";
import type { ConfigurationWriteResult, TechnicalTelegram } from "../../domain/configuration/DeviceConfiguration";
import type { MbusDataRecord } from "../../domain/mbus/MbusDataRecord";
import { completeSecondaryIdentityKey, type MbusDevice } from "../../domain/mbus/MbusDevice";
import type { MbusTransport } from "../../domain/mbus/MbusTransport";
import { mockDevices, mockRecords } from "./mockData";
import { mediumLabel } from "../../domain/mbus/MbusMedium";
import { buildLongFrame, toHex } from "../../domain/mbus/MbusFrame";

const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export class MockMbusClient implements MbusClient {
  private cancelled = false;
  private technicalTelegrams: TechnicalTelegram[] = [];
  constructor(private readonly transport: MbusTransport) {}

  async scanPrimary(options: PrimaryScanOptions, observer?: ScanObserver): Promise<MbusDevice[]> {
    this.assertConnected();
    this.cancelled = false;
    const devices: MbusDevice[] = [];
    observer?.onLog?.({ timestamp: new Date().toISOString(), level: "INFO", message: "Mock primary scan started" });
    for (let address = options.startAddress; address <= options.endAddress; address += 1) {
      if (this.cancelled) {
        observer?.onProgress?.({ kind: "primary", currentAddress: address, ...options, devicesFound: devices.length, state: "stopped" });
        observer?.onLog?.({ timestamp: new Date().toISOString(), level: "INFO", message: "Scan stopped" });
        return devices;
      }
      observer?.onProgress?.({ kind: "primary", currentAddress: address, ...options, devicesFound: devices.length, state: "scanning" });
      await wait(4);
      const device = mockDevices.find((candidate) => candidate.primaryAddress === address);
      if (device) {
        const result = this.makeResult(device);
        devices.push({ ...device });
        observer?.onLog?.({ timestamp: new Date().toISOString(), level: "TX", message: "REQ_UD2", address });
        observer?.onLog?.({ timestamp: new Date().toISOString(), level: "RX", message: "Mock M-Bus response", address, hex: result.rawTelegram.hex });
        observer?.onDevice?.(result);
      }
    }
    observer?.onProgress?.({ kind: "primary", currentAddress: options.endAddress, ...options, devicesFound: devices.length, state: "completed" });
    return devices;
  }

  async scanSecondary(observer?: ScanObserver): Promise<MbusDevice[]> {
    this.assertConnected();
    this.cancelled = false;
    const devices: MbusDevice[] = [];
    for (const device of mockDevices) {
      const mask = `${device.identificationNumber?.[0] ?? "F"}FFFFFFF`;
      observer?.onProgress?.({ kind: "secondary", mask, devicesFound: devices.length, state: "searching" });
      observer?.onLog?.({ timestamp: new Date().toISOString(), level: "SECONDARY", message: `Searching ${mask}` });
      await wait(120);
      if (this.cancelled) {
        observer?.onProgress?.({ kind: "secondary", mask, devicesFound: devices.length, state: "stopped" });
        return devices;
      }
      const secondaryDevice = device.protocolHint === "RELAY_PADPULS_M1"
        ? { ...device, primaryAddress: undefined }
        : { ...device };
      const result = this.makeResult(secondaryDevice);
      devices.push(secondaryDevice);
      observer?.onLog?.({ timestamp: new Date().toISOString(), level: "RX", message: secondaryDevice.primaryAddress === undefined ? "Mock secondary response (A=0xFD)" : `Mock secondary response (A=0x${secondaryDevice.primaryAddress.toString(16).padStart(2, "0").toUpperCase()})`, address: secondaryDevice.primaryAddress ?? 0xfd, hex: result.rawTelegram.hex });
      observer?.onLog?.({ timestamp: new Date().toISOString(), level: "VERIFY", message: secondaryDevice.primaryAddress === undefined ? "Primary address remains unknown" : "Primary address confirmed by complete secondary identity", address: secondaryDevice.primaryAddress });
      observer?.onDevice?.(result);
    }
    observer?.onProgress?.({ kind: "secondary", mask: "", devicesFound: devices.length, state: "completed" });
    return devices;
  }

  async completeMissingPrimaryAddresses(devices: MbusDevice[], observer?: ScanObserver): Promise<MbusDevice[]> {
    this.assertConnected();
    this.cancelled = false;
    const remaining = new Set(devices.map(completeSecondaryIdentityKey).filter((key): key is string => Boolean(key)));
    const matches: MbusDevice[] = [];
    observer?.onLog?.({ timestamp: new Date().toISOString(), level: "PRIMARY", message: "Completing missing primary addresses" });
    for (let address = 0; address <= 250; address += 1) {
      observer?.onProgress?.({ kind: "primary", currentAddress: address, startAddress: 0, endAddress: 250, devicesFound: matches.length, state: "scanning" });
      if (this.cancelled) {
        observer?.onProgress?.({ kind: "primary", currentAddress: address, startAddress: 0, endAddress: 250, devicesFound: matches.length, state: "stopped" });
        return matches;
      }
      await wait(4);
      const device = mockDevices.find((candidate) => candidate.primaryAddress === address);
      const key = device ? completeSecondaryIdentityKey(device) : undefined;
      if (!device || !key || !remaining.has(key)) continue;
      remaining.delete(key);
      matches.push({ ...device });
      const result = this.makeResult(device);
      observer?.onLog?.({ timestamp: new Date().toISOString(), level: "VERIFY", message: "Missing primary address resolved", address });
      observer?.onDevice?.(result);
      if (!remaining.size) {
        observer?.onProgress?.({ kind: "primary", currentAddress: address, startAddress: 0, endAddress: 250, devicesFound: matches.length, state: "completed" });
        return matches;
      }
    }
    observer?.onProgress?.({ kind: "primary", currentAddress: 250, startAddress: 0, endAddress: 250, devicesFound: matches.length, state: "completed" });
    return matches;
  }

  async readBySecondaryId(identificationNumber: string, observer?: ScanObserver): Promise<DeviceReadResult> {
    this.assertConnected();
    const device = mockDevices.find((candidate) => candidate.identificationNumber === identificationNumber);
    if (!device) throw new Error(`No mock device with secondary ID ${identificationNumber}`);
    observer?.onLog?.({ timestamp: new Date().toISOString(), level: "SECONDARY", message: `Device found: ${identificationNumber}` });
    return this.makeResult({ ...device });
  }

  stopScan(): Promise<void> { this.cancelled = true; return Promise.resolve(); }

  async readDevice(device: MbusDevice, observer?: ScanObserver): Promise<DeviceReadResult> {
    this.assertConnected();
    await wait(350);
    const current = device.protocolHint === "RELAY_PADPULS_M1" ? mockDevices.find((candidate) => candidate.protocolHint === "RELAY_PADPULS_M1") ?? device : device;
    const result = this.makeResult(current);
    observer?.onLog?.({ timestamp: new Date().toISOString(), level: "INFO", message: "Mock device read", address: device.primaryAddress });
    return result;
  }

  getCachedRecords(_deviceId: string): MbusDataRecord[] {
    return mockRecords.map((record) => ({ ...record }));
  }

  getRawTelegram(_deviceId: string): RawTelegram {
    return this.makeResult(mockDevices[0]).rawTelegram;
  }

  async writePrimaryAddress(request: PrimaryAddressWriteRequest, _observer?: ScanObserver): Promise<ConfigurationWriteResult> {
    this.assertConnected();
    if (request.newAddress < 0 || request.newAddress > 250 || !Number.isInteger(request.newAddress)) return { status: "Rejected", message: "Primary address must be between 0 and 250.", telegrams: [] };
    if (mockDevices.some((device) => device.primaryAddress === request.newAddress && device.primaryAddress !== request.currentAddress)) return { status: "AddressInUse", message: "Address already in use.", telegrams: [] };
    const timestamp = new Date().toISOString();
    const telegrams: TechnicalTelegram[] = [
      { timestamp, direction: "TX", operation: "Mock SND_UD primary address", primaryAddress: request.currentAddress, secondaryId: request.secondaryAddress.identificationNumber, rawTelegram: `MOCK 01 7A ${request.newAddress.toString(16).padStart(2, "0").toUpperCase()}` },
      { timestamp, direction: "RX", operation: "Mock ACK", primaryAddress: request.currentAddress, secondaryId: request.secondaryAddress.identificationNumber, rawTelegram: "E5", parsedResult: "ACK" },
    ];
    this.technicalTelegrams = [...this.technicalTelegrams, ...telegrams].slice(-200);
    await wait(150);
    return { status: "Success", message: "Mock write acknowledged; read-back required.", telegrams };
  }

  getTechnicalTelegrams(): TechnicalTelegram[] { return [...this.technicalTelegrams]; }

  async sendFrameAndWaitForAck(request: ManufacturerFrameWriteRequest, observer?: ScanObserver): Promise<ConfigurationWriteResult> {
    this.assertConnected();
    const timestamp = new Date().toISOString();
    const rawTelegram = request.frame.map((byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    if (request.frame[6] === 0xa6) {
      const data = new Array(25).fill(0);
      data.splice(19, 6, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60);
      const response = toHex(buildLongFrame({ control: 0x08, address: request.targetAddress, ci: 0x72, data }));
      const telegrams: TechnicalTelegram[] = [
        { timestamp, direction: "TX", operation: request.operation, primaryAddress: request.targetAddress, rawTelegram },
        { timestamp, direction: "RX", operation: request.operation, primaryAddress: request.targetAddress, rawTelegram: response, parsedResult: "Mock Cyble information response" },
      ];
      this.technicalTelegrams = [...this.technicalTelegrams, ...telegrams].slice(-200);
      telegrams.forEach((telegram) => observer?.onLog?.({ timestamp, level: telegram.direction, message: telegram.operation, address: request.targetAddress, hex: telegram.rawTelegram }));
      await wait(100);
      return { status: "NoAck", message: "Mock Cyble information response.", telegrams };
    }
    const telegrams: TechnicalTelegram[] = [
      { timestamp, direction: "TX", operation: request.operation, primaryAddress: request.targetAddress, rawTelegram },
      { timestamp, direction: "RX", operation: request.operation, primaryAddress: request.targetAddress, rawTelegram: "E5", parsedResult: "ACK" },
    ];
    this.technicalTelegrams = [...this.technicalTelegrams, ...telegrams].slice(-200);
    telegrams.forEach((telegram) => observer?.onLog?.({ timestamp, level: telegram.direction, message: telegram.operation, address: request.targetAddress, hex: telegram.rawTelegram }));
    await wait(100);
    return { status: "Success", message: "Mock manufacturer command acknowledged.", telegrams };
  }

  previewPadPulsConfiguration(request: PadPulsWriteRequest): Promise<TechnicalTelegram> {
    return invoke<TechnicalTelegram>("preview_padpuls_m1_configuration", { request });
  }

  async writePadPulsConfiguration(request: PadPulsWriteRequest, _observer?: ScanObserver): Promise<ConfigurationWriteResult> {
    this.assertConnected();
    if (request.writeProtected) return { status: "Rejected", message: "Configuration locked on device", telegrams: [] };
    const timestamp = new Date().toISOString();
    const telegrams: TechnicalTelegram[] = [
      { timestamp, direction: "TX", operation: "Mock PadPuls M1 complete configuration", primaryAddress: request.currentAddress, secondaryId: request.secondaryId, rawTelegram: "MOCK PADPULS SND_UD" },
      { timestamp, direction: "RX", operation: "Mock PadPuls ACK", primaryAddress: request.currentAddress, secondaryId: request.secondaryId, rawTelegram: "E5", parsedResult: "ACK" },
    ];
    this.technicalTelegrams = [...this.technicalTelegrams, ...telegrams].slice(-200);
    const device = mockDevices.find((candidate) => candidate.protocolHint === "RELAY_PADPULS_M1");
    if (device) {
      device.id = `secondary-${request.secondaryId}-${request.manufacturerRaw.toString(16).padStart(4, "0").toUpperCase()}-${request.generation.toString(16).padStart(2, "0").toUpperCase()}-${request.medium.toString(16).padStart(2, "0").toUpperCase()}`;
      device.primaryAddress = request.primaryAddress;
      device.identificationNumber = request.secondaryId;
      device.mediumRaw = request.medium;
      device.medium = mediumLabel(request.medium);
      if (device.secondaryAddress) device.secondaryAddress = { ...device.secondaryAddress, identificationNumber: request.secondaryId, medium: request.medium };
      device.padPulsConfiguration = { primaryAddress: request.primaryAddress, secondaryId: request.secondaryId, manufacturerRaw: request.manufacturerRaw, generation: request.generation, medium: request.medium, vif: request.vif, counter: request.counter, numerator: request.numerator, denominator: request.denominator, writeProtected: false };
    }
    return { status: "Success", message: "Mock PadPuls write acknowledged; read-back required.", telegrams };
  }

  private makeResult(device: MbusDevice): DeviceReadResult {
    return { device: { ...device }, records: mockRecords.map((record) => ({ ...record })), rawTelegram: { direction: "RX", timestamp: new Date().toISOString(), length: 22, hex: "68 10 10 68 08 0C 72 32 90 41 72 93 24 02 07 2A 00 00 00 6F 16" } };
  }

  private assertConnected(): void {
    if (!this.transport.isConnected()) throw new Error("The mock M-Bus transport is disconnected.");
  }
}
