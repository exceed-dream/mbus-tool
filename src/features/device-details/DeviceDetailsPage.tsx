import { useState } from "react";
import { Icon } from "../../components/Icon";
import { Panel } from "../../components/Panel";
import { StatusBadge } from "../../components/StatusBadge";
import type { CommunicationLogEntry, RawTelegram } from "../../domain/mbus/MbusClient";
import type { MbusDataRecord } from "../../domain/mbus/MbusDataRecord";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";
import type { DeviceProfile } from "../../domain/devices/DeviceProfile";
import { DEVICE_DETAIL_TABS, DEVICE_SUMMARY_FIELDS, deviceDisplayName, formatLastRead, OVERVIEW_SECTIONS, supportedCurrentValues } from "./devicePresentation";
import { configurationFieldIdForCurrentValue, hasEditableConfigurationFields } from "../../application/devices/configurationCapability";

interface DeviceDetailsProps {
  device: MbusDevice;
  records: MbusDataRecord[];
  rawTelegram?: RawTelegram;
  logs: CommunicationLogEntry[];
  interfaceName: string;
  reading: boolean;
  profile?: DeviceProfile;
  onBack: () => void;
  onRead: () => void;
  onConfigure: (fieldId?: string) => void;
}

export function DeviceDetailsPage({ device, records, rawTelegram, logs, interfaceName, reading, profile, onBack, onRead, onConfigure }: DeviceDetailsProps) {
  const [tab, setTab] = useState<"overview" | "records" | "raw">("overview");
  const fields: { label: string; value: string | number | undefined; configurationFieldId?: string }[] = [
    { label: "Primary address", value: device.primaryAddress, configurationFieldId: "primaryAddress" },
    { label: "Secondary address", value: device.secondaryAddress?.identificationNumber, configurationFieldId: "secondaryId" },
    { label: "Medium", value: device.medium, configurationFieldId: "medium" },
    { label: "Manufacturer", value: device.manufacturer },
    { label: "Manufacturer raw", value: device.manufacturerRaw === undefined ? undefined : `0x${device.manufacturerRaw.toString(16).toUpperCase().padStart(4, "0")}` },
    { label: "Identification number", value: device.identificationNumber },
    { label: "Version", value: device.version },
    ...(device.fabricationNumber ? [{ label: "Fabrication number", value: device.fabricationNumber }] : []),
  ];
  const supportedRecords = supportedCurrentValues(records);
  const configurationUnsupported = Boolean(profile && !hasEditableConfigurationFields(profile));
  const deviceName = profile ? `${profile.manufacturer} ${profile.model}` : deviceDisplayName(device);

  return <div className="page">
    <button className="back-button" onClick={onBack}><Icon name="arrow"/>Back to network</button>
    <div className="device-details-header"><div className="device-details-actions"><button className="button button--primary" onClick={onRead} disabled={reading}><Icon name="refresh"/>{reading ? "Reading…" : "Read device"}</button><button className="button button--secondary" title={configurationUnsupported ? "Configuration unsupported for this device profile" : "Open configuration"} onClick={() => onConfigure()} disabled={configurationUnsupported}><Icon name="sliders"/>Configure</button></div><div className="device-summary"><div><small>{DEVICE_SUMMARY_FIELDS[0]}</small><StatusBadge status={device.status}/></div><div><small>{DEVICE_SUMMARY_FIELDS[1]}</small><strong>{deviceName}</strong></div><div><small>{DEVICE_SUMMARY_FIELDS[2]}</small><strong className="mono">{device.primaryAddress ?? "Secondary only"}</strong></div><div><small>{DEVICE_SUMMARY_FIELDS[3]}</small><strong className="mono">{formatLastRead(device.lastReadAt)}</strong></div></div></div>
    <div className="tabs"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>{DEVICE_DETAIL_TABS[0]}</button><button className={tab === "records" ? "active" : ""} onClick={() => setTab("records")}>{DEVICE_DETAIL_TABS[1]} <span>{records.length}</span></button><button className={tab === "raw" ? "active" : ""} onClick={() => setTab("raw")}>{DEVICE_DETAIL_TABS[2]}</button></div>
    {tab === "overview" && <div className="details-grid">
      <Panel title={OVERVIEW_SECTIONS[0]} className="details-grid__wide">{supportedRecords.length ? <div className="value-grid">{supportedRecords.map((record) => { const configurationFieldId = configurationFieldIdForCurrentValue(profile, record); const locked = Boolean(configurationFieldId && device.padPulsConfiguration?.writeProtected); return <div className="value-card" key={record.id}><span>{record.label}</span><div className="value-card__reading"><strong>{record.value}</strong>{record.unit && <small>{record.unit}</small>}{configurationFieldId && <button type="button" className="icon-button current-value-edit-button" disabled={locked} title={locked ? "Configuration locked on device" : `Edit ${record.label} in Configuration`} aria-label={locked ? `${record.label}: Configuration locked on device` : `Edit ${record.label} in Configuration`} onClick={() => onConfigure(configurationFieldId)}><Icon name="edit" size={15}/></button>}</div></div>; })}</div> : <div className="empty-inline">No supported values decoded yet.</div>}</Panel>
      <Panel title={OVERVIEW_SECTIONS[1]}><dl className="detail-list">{fields.map((field) => { const editable = Boolean(field.configurationFieldId && profile?.installerFields.some((candidate) => candidate.id === field.configurationFieldId && candidate.editable && (candidate.writeSupport === "SUPPORTED" || profile.configurationProtocol === "ITRON_CYBLE"))); const locked = editable && Boolean(device.padPulsConfiguration?.writeProtected); return <div key={field.label}><dt>{field.label}</dt><dd className={field.label.includes("address") || field.label.includes("number") ? "mono" : ""}><span>{field.value ?? "—"}</span>{editable && <button type="button" className="icon-button detail-edit-button" disabled={locked} title={locked ? "Configuration locked on device" : `Edit ${field.label} in Configuration`} aria-label={locked ? `${field.label}: Configuration locked on device` : `Edit ${field.label} in Configuration`} onClick={() => field.configurationFieldId && onConfigure(field.configurationFieldId)}><Icon name="edit" size={15}/></button>}</dd></div>; })}</dl></Panel>
      <Panel title={OVERVIEW_SECTIONS[2]}><dl className="detail-list"><div><dt>Interface</dt><dd>{interfaceName}</dd></div><div><dt>Baud rate</dt><dd>{device.baudRate}</dd></div><div><dt>Access number</dt><dd className="mono">{device.accessNumber ?? "—"}</dd></div><div><dt>Raw status</dt><dd className="mono">{device.statusByte === undefined ? "—" : `0x${device.statusByte.toString(16).toUpperCase().padStart(2, "0")}`}</dd></div><div><dt>Status details</dt><dd>{device.statusFlags?.length ? <span className="status-flags">{device.statusFlags.map((flag) => <span key={flag}>{flag}</span>)}</span> : "No reported error"}</dd></div><div><dt>Signature</dt><dd className="mono">{device.signature ?? "—"}</dd></div><div><dt>Protocol</dt><dd>M-Bus EN 13757 · read operations + protected configuration operations</dd></div></dl></Panel>
    </div>}
    {tab === "records" && <Panel title="Decoded data records" description="Unsupported records are preserved with their complete header and raw bytes."><div className="table-wrap"><table><thead><tr><th>Record</th><th>Function</th><th>Storage</th><th>DIF</th><th>DIFE</th><th>VIF</th><th>VIFE</th><th>VIF description</th><th>LVAR</th><th>Unit</th><th>Value</th><th>Parse status</th><th>Raw bytes</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td className="strong">{record.label}</td><td>{record.function}</td><td>{record.storageNumber}</td><td className="mono">{record.dif ?? "—"}</td><td className="mono">{record.dife?.join(" ") || "—"}</td><td className="mono">{record.vif ?? "—"}</td><td className="mono">{record.vife?.join(" ") || "—"}</td><td>{record.vifDescription ?? "—"}</td><td className="mono">{record.lvar ?? "—"}</td><td>{record.unit}</td><td className="strong">{record.value}</td><td><span className={`parse-status parse-status--${(record.parseStatus ?? (record.supported === false ? "Unsupported" : "Decoded")).toLowerCase()}`}>{record.parseStatus ?? (record.supported === false ? "Unsupported" : "Decoded")}</span></td><td className="mono raw-value">{record.rawBytes ?? record.rawValue}</td></tr>)}</tbody></table></div></Panel>}
    {tab === "raw" && <div className="details-grid"><Panel title="Raw Telegram" description="Exact bytes returned by the meter." className="details-grid__wide">{rawTelegram ? <div className="telegram"><div><span>{rawTelegram.direction}</span><time>{rawTelegram.timestamp}</time><small>{rawTelegram.length} bytes</small></div><pre>{rawTelegram.hex}</pre></div> : <div className="empty-inline">Read the device to capture a telegram.</div>}</Panel><Panel title="Communication log" className="details-grid__wide"><div className="communication-log">{logs.slice(-50).map((entry, index) => <div className={`log-entry log-entry--${entry.level.toLowerCase()}`} key={`${entry.timestamp}-${index}`}><time>{entry.timestamp}</time><strong>{entry.level}</strong><span>{entry.message}{entry.address != null ? ` · address ${entry.address}` : ""}{entry.hex ? ` · ${entry.hex}` : ""}</span></div>)}</div></Panel></div>}
  </div>;
}
