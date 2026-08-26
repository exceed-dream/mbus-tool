import type { ConfigureDeviceResult, ConfigurationValidation, ConfigurationVerificationResult, ConfigurationWriteResult, DeviceConfiguration, TechnicalTelegram } from "../../domain/configuration/DeviceConfiguration";
import { changedFields } from "../../domain/configuration/DeviceConfiguration.ts";
import type { DeviceProtocolAdapter } from "../../domain/devices/DeviceProtocolAdapter";
import type { DeviceProfile, DeviceProfileMatch } from "../../domain/devices/DeviceProfile";
import type { ScanObserver } from "../../domain/mbus/MbusClient";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";

export interface ConfigurationObserver extends ScanObserver {
  onVerifying?: () => void;
}

export const CYBLE_PRIMARY_STABILIZATION_DELAY_MS = 400;
export const CYBLE_PRIMARY_VERIFICATION_RETRY_DELAY_MS = 500;
export const CYBLE_PRIMARY_MAX_VERIFICATION_ATTEMPTS = 3;

type Delay = (milliseconds: number) => Promise<void>;

export class ConfigureDeviceService {
  private readonly adapter: DeviceProtocolAdapter;
  private readonly delay: Delay;

  constructor(adapter: DeviceProtocolAdapter, delay: Delay = wait) { this.adapter = adapter; this.delay = delay; }

  identify(device: MbusDevice, profiles: DeviceProfile[]): DeviceProfileMatch {
    return this.adapter.identify(device, profiles);
  }

  currentConfigurationFromSnapshot(device: MbusDevice, profile: DeviceProfile | undefined): DeviceConfiguration | undefined {
    return this.adapter.configurationFromSnapshot(device, profile);
  }

  readCurrentConfiguration(device: MbusDevice, profile: DeviceProfile | undefined, observer?: ScanObserver): Promise<DeviceConfiguration> {
    return this.adapter.readConfiguration(device, profile, observer);
  }

  validateRequestedConfiguration(configuration: DeviceConfiguration): ConfigurationValidation {
    return this.adapter.validateConfiguration(configuration);
  }

  previewRequestedConfiguration(device: MbusDevice, configuration: DeviceConfiguration): Promise<TechnicalTelegram | undefined> {
    return this.adapter.previewConfiguration(device, configuration);
  }

  async configure(device: MbusDevice, profile: DeviceProfile | undefined, requested: DeviceConfiguration, observer?: ConfigurationObserver): Promise<ConfigureDeviceResult> {
    const validation = this.validateRequestedConfiguration(requested);
    if (!validation.valid) {
      return {
        status: "Rejected",
        commandsAttempted: 0, commandsAcknowledged: 0, rereadSuccessful: false, validationSuccessful: false,
        errors: validation.issues.map((issue) => ({ stage: "validation" as const, message: issue.message })),
        write: { status: "Rejected", message: validation.issues.map((issue) => issue.message).join(" "), telegrams: [] },
        verification: { status: "VerificationFailed", message: "Configuration validation failed.", fields: [] },
      };
    }
    const write = await this.adapter.writeConfiguration(device, requested, observer);
    const commandsAttempted = write.telegrams.filter((telegram) => telegram.direction === "TX").length;
    const commandsAcknowledged = write.telegrams.filter((telegram) => telegram.direction === "RX" && telegram.rawTelegram.trim().toUpperCase() === "E5").length;
    if (write.status !== "Success") {
      return { status: write.status, commandsAttempted, commandsAcknowledged, rereadSuccessful: false, validationSuccessful: false, errors: [{ stage: write.status === "Timeout" || write.status === "NoAck" ? "ack" : "writing", message: write.message }], write, verification: { status: write.status === "Unsupported" ? "Unsupported" : "VerificationFailed", message: "Write was not acknowledged; read-back was not attempted.", fields: [] } };
    }
    const primaryChange = changedFields(requested).find((field) => field.id === "primaryAddress");
    const secondaryIdChange = changedFields(requested).find((field) => field.id === "secondaryId");
    const readBackDevice = {
      ...device,
      primaryAddress: primaryChange ? Number(primaryChange.requestedValue) : device.primaryAddress,
      identificationNumber: secondaryIdChange ? String(secondaryIdChange.requestedValue) : device.identificationNumber,
      secondaryAddress: device.secondaryAddress && secondaryIdChange ? { ...device.secondaryAddress, identificationNumber: String(secondaryIdChange.requestedValue) } : device.secondaryAddress,
    };
    observer?.onVerifying?.();
    if (primaryChange && isCybleConfiguration(requested, profile, device)) {
      return this.verifyCyblePrimaryAddress(requested, profile, readBackDevice, expectedCybleIdentity(device, requested), write, commandsAttempted, commandsAcknowledged, observer);
    }
    observer?.onLog?.({ timestamp: new Date().toISOString(), level: "VERIFY", message: "Reading configuration after write", address: readBackDevice.primaryAddress });
    try {
      const readBack = await this.adapter.readConfiguration(readBackDevice, profile, observer);
      const verification = this.adapter.verifyConfiguration(requested, readBack);
      observer?.onLog?.({ timestamp: new Date().toISOString(), level: "VERIFY", message: verification.message, address: readBackDevice.primaryAddress });
      return verificationResult(write, commandsAttempted, commandsAcknowledged, readBack, verification);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      observer?.onLog?.({ timestamp: new Date().toISOString(), level: "VERIFY", message: `Read-back failed: ${message}`, address: readBackDevice.primaryAddress });
      return { status: "VerificationFailed", commandsAttempted, commandsAcknowledged, rereadSuccessful: false, validationSuccessful: false, errors: [{ stage: "reread", message }], write, verification: { status: "VerificationFailed", message: `Read-back failed: ${message}`, fields: [] } };
    }
  }

  private async verifyCyblePrimaryAddress(requested: DeviceConfiguration, profile: DeviceProfile | undefined, readBackDevice: MbusDevice, expectedIdentity: ExpectedCybleIdentity, write: ConfigurationWriteResult, commandsAttempted: number, commandsAcknowledged: number, observer?: ConfigurationObserver): Promise<ConfigureDeviceResult> {
    await this.delay(CYBLE_PRIMARY_STABILIZATION_DELAY_MS);
    let lastError = "No valid read-back response.";
    for (let attempt = 1; attempt <= CYBLE_PRIMARY_MAX_VERIFICATION_ATTEMPTS; attempt += 1) {
      observer?.onLog?.({ timestamp: new Date().toISOString(), level: "VERIFY", message: `Verification attempt ${attempt}/${CYBLE_PRIMARY_MAX_VERIFICATION_ATTEMPTS}`, address: expectedIdentity.primaryAddress });
      try {
        const readBack = await this.adapter.readConfiguration(readBackDevice, profile, observer);
        const identityError = cybleIdentityError(readBack, expectedIdentity);
        if (identityError) {
          const verification = failedVerification(identityError);
          observer?.onLog?.({ timestamp: new Date().toISOString(), level: "VERIFY", message: identityError, address: expectedIdentity.primaryAddress });
          return verificationResult(write, commandsAttempted, commandsAcknowledged, readBack, verification);
        }
        const verification = this.adapter.verifyConfiguration(requested, readBack);
        observer?.onLog?.({ timestamp: new Date().toISOString(), level: "VERIFY", message: verification.message, address: expectedIdentity.primaryAddress });
        return verificationResult(write, commandsAttempted, commandsAcknowledged, readBack, verification);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        const outcome = /timeout/i.test(lastError) ? "timeout" : "failed";
        observer?.onLog?.({ timestamp: new Date().toISOString(), level: "ERROR", message: `Verification attempt ${attempt}/${CYBLE_PRIMARY_MAX_VERIFICATION_ATTEMPTS} ${outcome}: ${lastError}`, address: expectedIdentity.primaryAddress });
        if (attempt < CYBLE_PRIMARY_MAX_VERIFICATION_ATTEMPTS) await this.delay(CYBLE_PRIMARY_VERIFICATION_RETRY_DELAY_MS);
      }
    }
    const message = `Read-back failed after ${CYBLE_PRIMARY_MAX_VERIFICATION_ATTEMPTS} attempts: ${lastError}`;
    return { status: "VerificationFailed", commandsAttempted, commandsAcknowledged, rereadSuccessful: false, validationSuccessful: false, errors: [{ stage: "reread", message }], write, verification: failedVerification(message) };
  }
}

interface ExpectedCybleIdentity { primaryAddress: number; secondaryId: string; }

function isCybleConfiguration(requested: DeviceConfiguration, profile: DeviceProfile | undefined, device: MbusDevice): boolean {
  return requested.profileId === "itron-cyble-mbus-v2" || profile?.id === "itron-cyble-mbus-v2" || device.protocolHint === "ITRON_CYBLE_MBUS_V2";
}

function expectedCybleIdentity(device: MbusDevice, requested: DeviceConfiguration): ExpectedCybleIdentity {
  const primary = requested.fields.find((field) => field.id === "primaryAddress")?.requestedValue;
  const secondary = requested.fields.find((field) => field.id === "secondaryId")?.requestedValue ?? device.secondaryAddress?.identificationNumber ?? device.identificationNumber;
  return { primaryAddress: Number(primary), secondaryId: String(secondary ?? "") };
}

function cybleIdentityError(readBack: DeviceConfiguration, expected: ExpectedCybleIdentity): string | undefined {
  const actual = readBack.device;
  const primaryField = readBack.fields.find((field) => field.id === "primaryAddress")?.currentValue;
  const secondaryField = readBack.fields.find((field) => field.id === "secondaryId")?.currentValue;
  const actualSecondary = actual?.secondaryAddress?.identificationNumber ?? actual?.identificationNumber ?? secondaryField;
  if (actual?.primaryAddress !== expected.primaryAddress || Number(primaryField) !== expected.primaryAddress) return `Primary Address verification failed: expected ${expected.primaryAddress}.`;
  if (String(actualSecondary ?? "") !== expected.secondaryId) return `Secondary ID verification failed: expected ${expected.secondaryId}.`;
  if (actual?.manufacturer?.trim().toUpperCase() !== "ACW") return "Manufacturer verification failed: expected ACW.";
  if (String(actual?.version ?? "") !== "20") return "Version verification failed: expected 20.";
  return undefined;
}

function verificationResult(write: ConfigurationWriteResult, commandsAttempted: number, commandsAcknowledged: number, readBack: DeviceConfiguration, verification: ConfigurationVerificationResult): ConfigureDeviceResult {
  const validationSuccessful = verification.status === "Verified";
  return { status: validationSuccessful ? "Success" : "VerificationFailed", commandsAttempted, commandsAcknowledged, rereadSuccessful: true, validationSuccessful, errors: validationSuccessful ? [] : [{ stage: "verification", message: verification.message }], write, readBack, verification };
}

function failedVerification(message: string): ConfigurationVerificationResult { return { status: "VerificationFailed", message, fields: [] }; }
function wait(milliseconds: number): Promise<void> { return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)); }
