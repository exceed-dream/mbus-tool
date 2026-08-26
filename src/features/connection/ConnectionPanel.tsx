import { Icon } from "../../components/Icon";
import { Panel } from "../../components/Panel";
import type { OperationStatus } from "../../domain/commissioning/OperationStatus";
import type { SerialConnectionSettings, SerialPortInfo } from "../../domain/mbus/MbusTransport";
import type { MbusMode } from "../../App";
import type { ReactNode } from "react";

const baudRates = [300, 600, 1200, 2400, 4800, 9600, 19200];

export function ConnectionPanel({ status, mode, ports, settings, error, onModeChange, onSettingsChange, onRefresh, onConnect, embedded = false, afterConnect }: { status: OperationStatus; mode: MbusMode; ports: SerialPortInfo[]; settings: SerialConnectionSettings; error: string | null; onModeChange: (mode: MbusMode) => void; onSettingsChange: (settings: SerialConnectionSettings) => void; onRefresh: () => void; onConnect: () => void; embedded?: boolean; afterConnect?: ReactNode }) {
  const connected = status === "connected";
  const connecting = status === "connecting";
  const noInterface = mode === "real" && ports.length === 0;
  const content = <>
    <div className="connection-form">
      <label className="connection-field connection-field--interface"><span>Interface</span><div className="inline-control"><select value={settings.portName} disabled={noInterface || connected} onChange={(event) => onSettingsChange({ ...settings, portName: event.target.value })}>{ports.map((port) => <option value={port.portName} key={port.portName}>{port.portName}{port.product ? ` · ${port.product}` : ""}</option>)}</select><button type="button" className="button button--secondary" onClick={onRefresh} disabled={connected}><Icon name="refresh"/>Refresh</button></div><small className={`field-message field-message--slot ${noInterface ? "" : "field-message--empty"}`} aria-hidden={!noInterface}>{noInterface ? "No serial interface detected" : " "}</small></label>
      <label className="connection-field"><span>M-Bus mode</span><select value={mode} disabled={connected || connecting} onChange={(event) => onModeChange(event.target.value as MbusMode)}><option value="mock">Mock</option><option value="real">Real</option></select><small className="field-message field-message--slot field-message--empty" aria-hidden="true"> </small></label>
      <label className="connection-field"><span>Baud rate</span><select value={settings.baudRate} disabled={connected} onChange={(event) => onSettingsChange({ ...settings, baudRate: Number(event.target.value) })}>{baudRates.map((rate) => <option value={rate} key={rate}>{rate}</option>)}</select><small className="field-message field-message--slot field-message--empty" aria-hidden="true"> </small></label>
      <label className="connection-field"><span>Timeout</span><input type="number" min="50" max="10000" value={settings.timeout} disabled={connected} onChange={(event) => onSettingsChange({ ...settings, timeout: Math.max(1, Number(event.target.value)) })}/><small className="field-message field-message--slot field-message--empty" aria-hidden="true"> </small></label>
      <label className="connection-field"><span>Serial format</span><div className="readonly-field">8 data bits · Even parity · 1 stop bit</div><small className="field-message field-message--slot field-message--empty" aria-hidden="true"> </small></label>
    </div>
    <div className={`connection-strip ${connected ? "connection-strip--on" : ""} ${status === "error" ? "connection-strip--error" : ""}`}><div className="network-primary-actions"><button type="button" className={`button connection-strip__action ${connected ? "button--secondary" : "button--primary"}`} onClick={onConnect} disabled={connecting || (!settings.portName && !connected)}><Icon name="usb"/>{connecting ? "Connecting…" : connected ? "Disconnect" : "Connect"}</button>{afterConnect}</div><span className="connection-dot"/>
      <div><strong>{connected ? "Interface connected" : connecting ? `Opening ${settings.portName}…` : status === "error" ? "Connection error" : "Interface disconnected"}</strong><small>{error ?? (connected ? `${settings.portName} · ${settings.baudRate} baud · 8E1 · Ready for scan` : "Connect an interface to start scanning the network")}</small></div>
      <span className="connection-strip__mode">{mode === "mock" ? "SIMULATED TRANSPORT" : "TAURI / RUST SERIAL"}</span>
    </div>
  </>;
  return embedded ? <div className="network-connection">{content}</div> : <Panel title="Connection" description="Configure the physical interface to the M-Bus master.">{content}</Panel>;
}
