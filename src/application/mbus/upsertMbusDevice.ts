import type { MbusDevice, MbusSecondaryAddress } from "../../domain/mbus/MbusDevice";

export interface MbusDeviceListItem extends MbusDevice {
  listKey: string;
  previousPrimaryAddress?: number;
}

export interface UpsertMbusDeviceOptions {
  replaces?: MbusDevice;
  showPrimaryAddressChange?: boolean;
}

export function upsertMbusDevices(current: MbusDeviceListItem[], incoming: MbusDevice[], options: UpsertMbusDeviceOptions = {}): MbusDeviceListItem[] {
  const merged = [...current];
  for (const device of incoming) {
    const replacementIndex = options.replaces ? merged.findIndex((candidate) => sameMbusDevice(candidate, options.replaces!)) : -1;
    const index = replacementIndex >= 0 ? replacementIndex : merged.findIndex((candidate) => sameMbusDevice(candidate, device));
    if (index < 0) {
      merged.push({ ...device, listKey: stableMbusDeviceKey(device) });
      continue;
    }

    const existing = merged[index];
    const previousPrimaryAddress = options.showPrimaryAddressChange
      && existing.primaryAddress !== undefined
      && device.primaryAddress !== undefined
      && existing.primaryAddress !== device.primaryAddress
      ? existing.primaryAddress
      : undefined;
    merged[index] = {
      ...existing,
      ...device,
      id: device.id,
      listKey: existing.listKey,
      primaryAddress: device.primaryAddress ?? existing.primaryAddress,
      previousPrimaryAddress,
    };
  }
  return merged;
}

export function sameMbusDevice(left: MbusDevice, right: MbusDevice): boolean {
  if (left.secondaryAddress && right.secondaryAddress && sameCompleteSecondaryIdentity(left.secondaryAddress, right.secondaryAddress)) return true;

  const leftIdentification = identificationNumber(left);
  const rightIdentification = identificationNumber(right);
  if (leftIdentification && rightIdentification) {
    return leftIdentification === rightIdentification && sameKnownManufacturer(left, right);
  }

  if (leftIdentification || rightIdentification) return false;
  return left.primaryAddress !== undefined && left.primaryAddress === right.primaryAddress;
}

export function stableMbusDeviceKey(device: MbusDevice): string {
  if (device.secondaryAddress) {
    const identity = device.secondaryAddress;
    return `secondary-${identity.identificationNumber}-${identity.manufacturerRaw}-${identity.version}-${identity.medium}`;
  }
  const identification = identificationNumber(device);
  if (identification) return `identified-${identification}-${device.manufacturerRaw ?? normalize(device.manufacturer)}`;
  return device.id || `primary-${device.primaryAddress ?? "unknown"}`;
}

export function withoutDeviceListMetadata(device: MbusDeviceListItem): MbusDevice {
  const { listKey: _listKey, previousPrimaryAddress: _previousPrimaryAddress, ...mbusDevice } = device;
  return mbusDevice;
}

function sameCompleteSecondaryIdentity(left: MbusSecondaryAddress, right: MbusSecondaryAddress): boolean {
  return left.identificationNumber === right.identificationNumber
    && left.manufacturerRaw === right.manufacturerRaw
    && left.version === right.version
    && left.medium === right.medium;
}

function identificationNumber(device: MbusDevice): string | undefined {
  return device.secondaryAddress?.identificationNumber ?? device.identificationNumber;
}

function sameKnownManufacturer(left: MbusDevice, right: MbusDevice): boolean {
  const leftRaw = left.secondaryAddress?.manufacturerRaw ?? left.manufacturerRaw;
  const rightRaw = right.secondaryAddress?.manufacturerRaw ?? right.manufacturerRaw;
  if (leftRaw !== undefined && rightRaw !== undefined) return leftRaw === rightRaw;
  const leftName = normalize(left.manufacturer);
  const rightName = normalize(right.manufacturer);
  return Boolean(leftName && rightName && leftName === rightName);
}

function normalize(value?: string): string | undefined {
  return value?.trim().toUpperCase() || undefined;
}
