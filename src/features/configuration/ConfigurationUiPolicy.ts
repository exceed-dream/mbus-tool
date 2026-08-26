import type { ConfigurationField, ConfigurationValue, DeviceConfiguration } from "../../domain/configuration/DeviceConfiguration";
import type { DeviceProfile } from "../../domain/devices/DeviceProfile";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";
import type { CommunicationLogEntry } from "../../domain/mbus/MbusClient";

export type ReadResultStatus = "Ready" | "Error";
export type ConfigurationOperationKind = "READ_CONFIGURATION" | "APPLY_CONFIGURATION";

export interface OperationCommunicationLog {
  operationId: number;
  operation: ConfigurationOperationKind;
  entries: CommunicationLogEntry[];
}

export class AutomaticConfigurationReadGate {
  private lastKey?: string;

  shouldRead(deviceId: string, profileId?: string): boolean {
    const key = `${deviceId}:${profileId ?? "standard"}`;
    if (this.lastKey === key) return false;
    this.lastKey = key;
    return true;
  }
}

export class SingleConfigurationWriteGate {
  private active = false;

  tryStart(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  finish(): void {
    this.active = false;
  }
}

export function statusAfterRead(succeeded: boolean): ReadResultStatus {
  return succeeded ? "Ready" : "Error";
}

export function showApplyConfirmation(changeCount: number): boolean {
  return changeCount > 0;
}

export function refreshRequiresDiscard(changeCount: number): boolean {
  return changeCount > 0;
}

export function profileChangeRequiresConfirmation(changeCount: number): boolean { return changeCount > 0; }

export function beginOperationCommunicationLog(previousOperationId: number, operation: ConfigurationOperationKind): OperationCommunicationLog {
  return { operationId: previousOperationId + 1, operation, entries: [] };
}

export function appendOperationCommunicationEntry(log: OperationCommunicationLog, operationId: number, entry: CommunicationLogEntry): OperationCommunicationLog {
  if (log.operationId !== operationId || !isConfigurationOperationEntry(entry)) return log;
  return { ...log, entries: [...log.entries, entry] };
}

export function isConfigurationOperationEntry(entry: CommunicationLogEntry): boolean {
  return ["TX", "RX", "INFO", "VERIFY", "ERROR"].includes(entry.level);
}

export function retainVerifiedSnapshot(gate: AutomaticConfigurationReadGate, deviceId: string, profileId?: string): void {
  gate.shouldRead(deviceId, profileId);
}

export function selectValueLabel(field: ConfigurationField, value: ConfigurationValue): string {
  const option = field.options?.find((candidate) => candidate.value === value);
  if (option) return option.label;
  if (typeof value === "number") return `Unsupported (0x${value.toString(16).padStart(2, "0").toUpperCase()})`;
  return value === null || value === "" ? "—" : String(value);
}

export function rebuildConfigurationForProfile(reader: { currentConfigurationFromSnapshot(device: MbusDevice, profile: DeviceProfile | undefined): DeviceConfiguration | undefined }, device: MbusDevice, profile: DeviceProfile): DeviceConfiguration | undefined {
  return reader.currentConfigurationFromSnapshot(device, profile);
}

export function isApplyConfigurationEnabled({ connected, changeCount, validationValid, busy, writeProtected }: { connected: boolean; changeCount: number; validationValid: boolean; busy: boolean; writeProtected: boolean }): boolean {
  return connected && changeCount > 0 && validationValid && !busy && !writeProtected;
}

export function editableTargetAfterRead(configuration: DeviceConfiguration, targetFieldId?: string): string | undefined {
  if (!targetFieldId || configuration.writeProtected) return undefined;
  return configuration.fields.find((field) => field.id === targetFieldId && field.editable && field.writeSupport === "SUPPORTED")?.id;
}
