import { useState } from "react";
import { Icon } from "../../components/Icon";
import { InfoTooltip } from "../../components/InfoTooltip";
import { Panel } from "../../components/Panel";
import { StatusBadge } from "../../components/StatusBadge";
import type { CommunicationLogEntry, RawTelegram } from "../../domain/mbus/MbusClient";
import type { MbusDataRecord } from "../../domain/mbus/MbusDataRecord";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";
import type { DeviceProfile } from "../../domain/devices/DeviceProfile";
import { DEVICE_DETAIL_TABS, DEVICE_SUMMARY_FIELDS, deviceDisplayName, deviceWarningReasons, formatLastRead, OVERVIEW_SECTIONS } from "./devicePresentation";
import { configurationFieldIdForDataRecord, hasEditableConfigurationFields } from "../../application/devices/configurationCapability";
import { exportMbusReadingToExcel } from "../../application/export/MbusReadingExcelExportService";

interface DeviceDetailsProps {
  device: MbusDevice;
  records: MbusDataRecord[];
  rawTelegram?: RawTelegram;
  logs: CommunicationLogEntry[];
  interfaceName: string;
  reading: boolean;
  profile?: DeviceProfile;
  onRead: () => void;
  onConfigure: (fieldId?: string) => void;
}

export function DeviceDetailsPage({ device, records, rawTelegram, logs, interfaceName, reading, profile, onRead, onConfigure }: DeviceDetailsProps) {
  const [tab, setTab] = useState<"overview" | "records" | "raw">("overview");
  const [exportError, setExportError] = useState<string>();
  const fields: { label: string; value: string | number | undefined; configurationFieldId?: string }[] = [
    { label: "Primary address", value: device.primaryAddress, configurationFieldId: "primaryAddress" },
    { label: "Secondary address", value: device.secondaryAddress?.identificationNumber, configurationFieldId: "secondaryId" },
    { label: "Manufacturer", value: device.manufacturer },
    { label: "Identification number", value: device.identificationNumber },
    { label: "Version", value: device.version },
    { label: "Medium", value: device.medium, configurationFieldId: "medium" },
    { label: "Last read", value: formatLastRead(device.lastReadAt) },
    { label: "Manufacturer raw", value: device.manufacturerRaw === undefined ? undefined : `0x${device.manufacturerRaw.toString(16).toUpperCase().padStart(4, "0")}` },
    ...(device.fabricationNumber ? [{ label: "Fabrication number", value: device.fabricationNumber }] : []),
  ];
  const configurationUnsupported = Boolean(profile && !hasEditableConfigurationFields(profile));
  const deviceName = profile ? `${profile.manufacturer} ${profile.model}` : deviceDisplayName(device);
  const warningReasons = deviceWarningReasons(device);
  const exportReading = () => {
    try {
      exportMbusReadingToExcel({ device, records, readingTimestamp: rawTelegram?.timestamp ?? device.lastReadAt });
      setExportError(undefined);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Unable to export the reading");
    }
  };

  return <div className="page">
    <div className="device-details-header"><div className="device-summary"><div><small>{DEVICE_SUMMARY_FIELDS[0]}</small><strong>{deviceName}</strong></div><div><small>{DEVICE_SUMMARY_FIELDS[1]}</small><strong className="mono">{device.primaryAddress ?? "Secondary only"}</strong></div><div><small>{DEVICE_SUMMARY_FIELDS[2]}</small><strong className="mono">{formatLastRead(device.lastReadAt)}</strong></div><div><small>{DEVICE_SUMMARY_FIELDS[3]}</small><span className="device-status-with-info"><StatusBadge status={device.status}/>{device.status === "warning" && <InfoTooltip label="Warning details" className="device-warning-info">{warningReasons.length > 1 ? <ul>{warningReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : warningReasons[0]}</InfoTooltip>}</span></div></div><div className="device-details-actions"><button className="button button--secondary" title={configurationUnsupported ? "Configuration unsupported for this device profile" : "Open configuration"} onClick={() => onConfigure()} disabled={configurationUnsupported}><Icon name="sliders"/>Configure</button><button className="button button--secondary" onClick={exportReading} disabled={!rawTelegram && records.length === 0} title={!rawTelegram && records.length === 0 ? "Read the device before exporting" : "Export the latest reading to Excel"}><Icon name="download"/>Export reading</button><button className="button button--primary" onClick={onRead} disabled={reading}><Icon name="refresh"/>{reading ? "Reading…" : "Read device"}</button></div></div>
    {exportError && <div className="notice notice--error"><div><strong>Export error</strong><p>{exportError}</p></div></div>}
    <div className="tabs"><button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>{DEVICE_DETAIL_TABS[0]}</button><button className={tab === "records" ? "active" : ""} onClick={() => setTab("records")}>{DEVICE_DETAIL_TABS[1]} <span>{records.length}</span></button><button className={tab === "raw" ? "active" : ""} onClick={() => setTab("raw")}>{DEVICE_DETAIL_TABS[2]}</button></div>
    {tab === "overview" && <div className="details-grid">
      <Panel title="M-Bus Data Records" description="Records are shown in the exact order received from the M-Bus module." className="details-grid__wide">{records.length ? <div className="table-wrap"><table className="device-reading-table mbus-records-table"><thead><tr><th>Record</th><th className="record-edit-column" aria-label="Edit parameter"/><th>Value</th><th>Unit</th><th>Storage</th><th>Raw value</th></tr></thead><tbody>{records.map((record) => { const configurationFieldId = configurationFieldIdForDataRecord(profile, record); const editable = Boolean(configurationFieldId && !device.padPulsConfiguration?.writeProtected); return <tr key={record.id}><td className="mono strong">{record.recordIndex}</td><td className="record-edit-column">{editable && <button type="button" className="icon-button data-record-edit-button" title={`Edit ${record.label} in Configuration`} aria-label={`Edit ${record.label} in Configuration`} onClick={() => configurationFieldId && onConfigure(configurationFieldId)}><Icon name="edit" size={15}/></button>}</td><td className="mono strong reading-value-cell">{record.value}</td><td>{record.unit || "—"}</td><td className="mono">{record.storageNumber}</td><td className="mono raw-value">{record.rawValue}</td></tr>; })}</tbody></table></div> : <div className="empty-inline">No M-Bus data records are available for this reading.</div>}</Panel>
      <Panel title={OVERVIEW_SECTIONS[0]}><dl className="detail-list">{fields.map((field) => { const editable = Boolean(field.configurationFieldId && profile?.installerFields.some((candidate) => candidate.id === field.configurationFieldId && candidate.editable && (candidate.writeSupport === "SUPPORTED" || profile.configurationProtocol === "ITRON_CYBLE"))); const locked = editable && Boolean(device.padPulsConfiguration?.writeProtected); return <div key={field.label}><dt>{field.label}</dt><dd className={field.label.includes("address") || field.label.includes("number") ? "mono" : ""}><span>{field.value ?? "—"}</span>{editable && <button type="button" className="icon-button detail-edit-button" disabled={locked} title={locked ? "Configuration locked on device" : `Edit ${field.label} in Configuration`} aria-label={locked ? `${field.label}: Configuration locked on device` : `Edit ${field.label} in Configuration`} onClick={() => field.configurationFieldId && onConfigure(field.configurationFieldId)}><Icon name="edit" size={15}/></button>}</dd></div>; })}</dl></Panel>
      <Panel title={OVERVIEW_SECTIONS[1]}><dl className="detail-list"><div><dt>Interface</dt><dd>{interfaceName}</dd></div><div><dt>Baud rate</dt><dd>{device.baudRate}</dd></div><div><dt>Access number</dt><dd className="mono">{device.accessNumber ?? "—"}</dd></div><div><dt>Raw status</dt><dd className="mono">{device.statusByte === undefined ? "—" : `0x${device.statusByte.toString(16).toUpperCase().padStart(2, "0")}`}</dd></div><div><dt>Status details</dt><dd>{device.statusFlags?.length ? <span className="status-flags">{device.statusFlags.map((flag) => <span key={flag}>{flag}</span>)}</span> : "No reported error"}</dd></div><div><dt>Signature</dt><dd className="mono">{device.signature ?? "—"}</dd></div><div><dt>Protocol</dt><dd>M-Bus EN 13757 · read operations + protected configuration operations</dd></div></dl></Panel>
    </div>}
    {tab === "records" && <Panel title="Decoded data records" description="Unsupported records are preserved with their complete header and raw bytes."><div className="table-wrap"><table><thead><tr><th>Record #</th><th>Record</th><th>Function</th><th>Storage</th><th>Value</th><th>Unit</th><th>DIF</th><th>DIFE</th><th>VIF</th><th>VIFE</th><th>VIF description</th><th>LVAR</th><th>Parse status</th><th>Raw bytes</th></tr></thead><tbody>{records.map((record) => <tr key={record.id}><td className="mono strong">{record.recordIndex}</td><td className="strong">{record.label}</td><td>{record.function}</td><td>{record.storageNumber}</td><td className="strong">{record.value}</td><td>{record.unit}</td><td className="mono">{record.dif ?? "—"}</td><td className="mono">{record.dife?.join(" ") || "—"}</td><td className="mono">{record.vif ?? "—"}</td><td className="mono">{record.vife?.join(" ") || "—"}</td><td>{record.vifDescription ?? "—"}</td><td className="mono">{record.lvar ?? "—"}</td><td><span className={`parse-status parse-status--${(record.parseStatus ?? (record.supported === false ? "Unsupported" : "Decoded")).toLowerCase()}`}>{record.parseStatus ?? (record.supported === false ? "Unsupported" : "Decoded")}</span></td><td className="mono raw-value">{record.rawBytes ?? record.rawValue}</td></tr>)}</tbody></table></div></Panel>}
    {tab === "raw" && <div className="details-grid"><Panel title="Raw Telegram" description="Exact bytes returned by the meter." className="details-grid__wide">{rawTelegram ? <div className="telegram"><div><span>{rawTelegram.direction}</span><time>{rawTelegram.timestamp}</time><small>{rawTelegram.length} bytes</small></div><pre>{rawTelegram.hex}</pre></div> : <div className="empty-inline">Read the device to capture a telegram.</div>}</Panel><Panel title="Communication log" className="details-grid__wide"><div className="communication-log">{logs.slice(-50).map((entry, index) => <div className={`log-entry log-entry--${entry.level.toLowerCase()}`} key={`${entry.timestamp}-${index}`}><time>{entry.timestamp}</time><strong>{entry.level}</strong><span>{entry.message}{entry.address != null ? ` · address ${entry.address}` : ""}{entry.hex ? ` · ${entry.hex}` : ""}</span></div>)}</div></Panel></div>}
  </div>;
}
