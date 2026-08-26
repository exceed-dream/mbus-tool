import { useState } from "react";
import type { MbusDeviceListItem } from "../../application/mbus/upsertMbusDevice";
import { Icon } from "../../components/Icon";
import { PageHeader } from "../../components/PageHeader";
import { Panel } from "../../components/Panel";
import type { OperationStatus } from "../../domain/commissioning/OperationStatus";
import type { MbusDataRecord } from "../../domain/mbus/MbusDataRecord";
import type { CommunicationLogEntry, ScanProgress } from "../../domain/mbus/MbusClient";
import type { SerialConnectionSettings, SerialPortInfo } from "../../domain/mbus/MbusTransport";
import type { MbusMode } from "../../App";
import { ConnectionPanel } from "../connection/ConnectionPanel";
import { DeviceTable } from "./DeviceTable";
import { runSelectedScan, type NetworkScanMode } from "./scanPresentation";

export function ScanPage({ connectionStatus, scanStatus, devices, mode, ports, settings, scanRange, progress, logs, error, onModeChange, onSettingsChange, onScanRangeChange, onRefreshPorts, onConnect, onPrimaryScan, onQuickScan, onReadById, onStop, onOpenDevice, onConfigureDevice, canConfigureDevice, getRecords }: { connectionStatus: OperationStatus; scanStatus: OperationStatus; devices: MbusDeviceListItem[]; mode: MbusMode; ports: SerialPortInfo[]; settings: SerialConnectionSettings; scanRange: { startAddress: number; endAddress: number }; progress: ScanProgress | null; logs: CommunicationLogEntry[]; error: string | null; onModeChange: (mode: MbusMode) => void; onSettingsChange: (settings: SerialConnectionSettings) => void; onScanRangeChange: (range: { startAddress: number; endAddress: number }) => void; onRefreshPorts: () => void; onConnect: () => void; onPrimaryScan: () => void; onQuickScan: () => void; onReadById: (identificationNumber: string) => void; onStop: () => void; onOpenDevice: (device: MbusDeviceListItem) => void; onConfigureDevice: (device: MbusDeviceListItem) => void; canConfigureDevice: (device: MbusDeviceListItem) => boolean; getRecords: (device: MbusDeviceListItem) => MbusDataRecord[] }) {
  const connected = connectionStatus === "connected";
  const busy = scanStatus === "scanning" || scanStatus === "reading";
  const [scanMode, setScanMode] = useState<NetworkScanMode>("quick");
  const [knownId, setKnownId] = useState("22075482");
  const rangeValid = scanRange.startAddress >= 0 && scanRange.endAddress <= 250 && scanRange.startAddress <= scanRange.endAddress;
  const knownIdValid = /^\d{8}$/.test(knownId);
  const percent = progress?.kind === "primary" ? Math.round(((progress.currentAddress - progress.startAddress + 1) / (progress.endAddress - progress.startAddress + 1)) * 100) : 0;
  const statusText = progress ? progress.state === "stopped" ? "Scan stopped" : progress.state === "completed" ? "Scan completed" : progress.kind === "primary" ? `Scanning primary address ${progress.currentAddress} / ${progress.endAddress}` : `Scanning ${progress.mask}…` : busy ? "Starting scan…" : "Ready";
  const startDisabled = !connected || busy || (scanMode === "primary" && !rangeValid);
  const scanAction = busy
    ? <button className="button button--secondary network-start-scan" onClick={onStop}><Icon name="stop"/>Stop</button>
    : <button className="button button--primary network-start-scan" disabled={startDisabled} onClick={() => runSelectedScan(scanMode, onQuickScan, onPrimaryScan)}><Icon name="search"/>Start scan</button>;

  return <div className="page"><PageHeader eyebrow="Network" title="M-Bus Network" description="Connect to a master, discover devices and inspect their data."/>
    <Panel title="Network operations" description="Connect the Techbase interface, select a scan mode and start discovery." className="network-operations-panel"><div className="network-operations-grid">
      <section className="network-operation-column"><h3>Connection</h3><ConnectionPanel embedded status={connectionStatus} mode={mode} ports={ports} settings={settings} error={error} onModeChange={onModeChange} onSettingsChange={onSettingsChange} onRefresh={onRefreshPorts} onConnect={onConnect} afterConnect={scanAction}/></section>
      <section className="network-operation-column network-scan-settings"><h3>Scan settings</h3><div className="scan-mode-tabs"><button className={scanMode === "quick" ? "active" : ""} onClick={() => setScanMode("quick")} disabled={busy}><Icon name="activity"/>Quick scan<small>Secondary search</small></button><button className={scanMode === "primary" ? "active" : ""} onClick={() => setScanMode("primary")} disabled={busy}><Icon name="search"/>Primary scan<small>Sequential 0–250</small></button></div>
        {scanMode === "quick" ? <div className="scan-section network-scan-section"><div><strong>Secondary address search</strong><p>Standard 8-digit wildcard tree. The active mask is shown in scan status.</p></div><div className="known-id"><div><strong>Advanced</strong><small>Known secondary ID</small></div><div className="known-id__controls"><input aria-label="Known secondary ID" inputMode="numeric" maxLength={8} value={knownId} onChange={(event) => setKnownId(event.target.value.replace(/\D/g, "").slice(0, 8))}/><button className="button button--secondary" disabled={!connected || busy || !knownIdValid} onClick={() => onReadById(knownId)}>Read by ID</button></div></div></div> : <div className="scan-section network-scan-section"><div><strong>Primary address range</strong><p>Reserved addresses 251–255 are excluded.</p></div><div className="scan-actions"><label className="compact-field"><span>Start address</span><input type="number" min="0" max="250" value={scanRange.startAddress} disabled={busy} onChange={(event) => onScanRangeChange({ ...scanRange, startAddress: Number(event.target.value) })}/></label><label className="compact-field"><span>End address</span><input type="number" min="0" max="250" value={scanRange.endAddress} disabled={busy} onChange={(event) => onScanRangeChange({ ...scanRange, endAddress: Number(event.target.value) })}/></label></div>{!rangeValid && <div className="validation-error">Primary range must satisfy 0 ≤ start ≤ end ≤ 250.</div>}</div>}
      </section></div>
      <div className="network-scan-status"><div><span className={busy ? "connection-dot connection-dot--on" : "connection-dot"}/><strong>{statusText}</strong>{devices.length > 0 && <small>{devices.length} discovered</small>}</div>{progress?.kind === "primary" && <div className="progress-track"><span style={{ width: `${percent}%` }}/></div>}</div>
    </Panel>
    <Panel title={`Discovered devices${devices.length ? ` · ${devices.length}` : ""}`} description={devices.length ? `${devices.length} device${devices.length > 1 ? "s" : ""} on ${settings.portName}` : "Waiting for a scan"}><DeviceTable devices={devices} onOpenDevice={onOpenDevice} onConfigureDevice={onConfigureDevice} canConfigureDevice={canConfigureDevice} getRecords={getRecords}/></Panel>
    <Panel title="Communication log" description="Primary, secondary, TX/RX and collision diagnostics for this session."><CommunicationLog entries={logs}/></Panel>
  </div>;
}

function CommunicationLog({ entries }: { entries: CommunicationLogEntry[] }) {
  if (!entries.length) return <div className="log-empty">No M-Bus traffic yet.</div>;
  return <div className="communication-log">{entries.map((entry, index) => <div className={`log-entry log-entry--${entry.level.toLowerCase()}`} key={`${entry.timestamp}-${index}`}><time>{formatTime(entry.timestamp)}</time><strong>{entry.level}</strong><span>{entry.message}{entry.address != null ? ` → address ${entry.address}` : ""}{entry.hex ? ` · ${entry.hex}` : ""}</span></div>)}</div>;
}

function formatTime(value: string): string {
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour12: false });
}
