import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CommunicationLogEntry, DeviceReadResult, ManufacturerFrameWriteRequest, MbusClient, PadPulsWriteRequest, PrimaryAddressWriteRequest, PrimaryScanOptions, PrimaryScanProgress, RawTelegram, ScanObserver, SecondaryScanProgress } from "../../domain/mbus/MbusClient";
import type { ConfigurationWriteResult, TechnicalTelegram } from "../../domain/configuration/DeviceConfiguration";
import type { MbusDataRecord } from "../../domain/mbus/MbusDataRecord";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";

export class RealMbusClient implements MbusClient {
  private readonly cache = new Map<string, DeviceReadResult>();
  private technicalTelegrams: TechnicalTelegram[] = [];

  async scanPrimary(options: PrimaryScanOptions, observer?: ScanObserver): Promise<MbusDevice[]> {
    const unlisten = await this.listenToEvents(observer);
    try {
      const results = await invoke<DeviceReadResult[]>("scan_primary", { options });
      results.forEach((result) => this.cache.set(result.device.id, result));
      return results.map((result) => result.device);
    } finally {
      unlisten.forEach((remove) => remove());
    }
  }

  async scanSecondary(observer?: ScanObserver): Promise<MbusDevice[]> {
    const unlisten = await this.listenToEvents(observer);
    try {
      const results = await invoke<DeviceReadResult[]>("scan_secondary");
      results.forEach((result) => this.cache.set(result.device.id, result));
      return results.map((result) => result.device);
    } finally {
      unlisten.forEach((remove) => remove());
    }
  }

  async readBySecondaryId(identificationNumber: string, observer?: ScanObserver): Promise<DeviceReadResult> {
    const unlisten = await this.listenToEvents(observer);
    try {
      const result = await invoke<DeviceReadResult>("read_mbus_by_secondary_id", { identificationNumber });
      this.cache.set(result.device.id, result);
      return result;
    } finally {
      unlisten.forEach((remove) => remove());
    }
  }

  stopScan(): Promise<void> { return invoke("stop_scan"); }

  async readDevice(device: MbusDevice, observer?: ScanObserver): Promise<DeviceReadResult> {
    const unlisten = await this.listenToEvents(observer);
    try {
      if (device.primaryAddress === undefined && !device.identificationNumber) throw new Error("Device has no readable M-Bus address");
      const result = device.primaryAddress !== undefined
        ? await invoke<DeviceReadResult>("read_mbus_device", { primaryAddress: device.primaryAddress })
        : await invoke<DeviceReadResult>("read_mbus_by_secondary_id", { identificationNumber: device.identificationNumber });
      this.cache.set(result.device.id, result);
      return result;
    } finally {
      unlisten.forEach((remove) => remove());
    }
  }

  getCachedRecords(deviceId: string): MbusDataRecord[] { return this.cache.get(deviceId)?.records ?? []; }
  getRawTelegram(deviceId: string): RawTelegram | undefined { return this.cache.get(deviceId)?.rawTelegram; }

  async writePrimaryAddress(request: PrimaryAddressWriteRequest, observer?: ScanObserver): Promise<ConfigurationWriteResult> {
    const result = await invoke<ConfigurationWriteResult>("write_primary_address", { request });
    this.technicalTelegrams = [...this.technicalTelegrams, ...result.telegrams].slice(-200);
    result.telegrams.forEach((telegram) => observer?.onLog?.({
      timestamp: telegram.timestamp,
      level: telegram.direction,
      message: telegram.operation,
      address: telegram.primaryAddress,
      hex: telegram.rawTelegram,
    }));
    return result;
  }

  getTechnicalTelegrams(): TechnicalTelegram[] { return [...this.technicalTelegrams]; }

  async sendFrameAndWaitForAck(request: ManufacturerFrameWriteRequest, observer?: ScanObserver): Promise<ConfigurationWriteResult> {
    const result = await invoke<ConfigurationWriteResult>("send_mbus_frame_wait_for_ack", { request });
    this.captureWriteResult(result, observer);
    return result;
  }

  previewPadPulsConfiguration(request: PadPulsWriteRequest): Promise<TechnicalTelegram> {
    return invoke<TechnicalTelegram>("preview_padpuls_m1_configuration", { request });
  }

  async writePadPulsConfiguration(request: PadPulsWriteRequest, observer?: ScanObserver): Promise<ConfigurationWriteResult> {
    const result = await invoke<ConfigurationWriteResult>("write_padpuls_m1_configuration", { request });
    this.technicalTelegrams = [...this.technicalTelegrams, ...result.telegrams].slice(-200);
    result.telegrams.forEach((telegram) => observer?.onLog?.({ timestamp: telegram.timestamp, level: telegram.direction, message: telegram.operation, address: telegram.primaryAddress, hex: telegram.rawTelegram }));
    return result;
  }

  private captureWriteResult(result: ConfigurationWriteResult, observer?: ScanObserver): void {
    this.technicalTelegrams = [...this.technicalTelegrams, ...result.telegrams].slice(-200);
    result.telegrams.forEach((telegram) => observer?.onLog?.({ timestamp: telegram.timestamp, level: telegram.direction, message: telegram.operation, address: telegram.primaryAddress, hex: telegram.rawTelegram }));
  }

  private async listenToEvents(observer?: ScanObserver): Promise<UnlistenFn[]> {
    if (!observer) return [];
    return Promise.all([
      listen<Omit<PrimaryScanProgress, "kind">>("mbus://scan-progress", ({ payload }) => observer.onProgress?.({ kind: "primary", ...payload })),
      listen<Omit<SecondaryScanProgress, "kind">>("mbus://secondary-progress", ({ payload }) => observer.onProgress?.({ kind: "secondary", ...payload })),
      listen<DeviceReadResult>("mbus://device-found", ({ payload }) => {
        this.cache.set(payload.device.id, payload);
        observer.onDevice?.(payload);
      }),
      listen<CommunicationLogEntry>("mbus://log", ({ payload }) => observer.onLog?.(payload)),
    ]);
  }
}
