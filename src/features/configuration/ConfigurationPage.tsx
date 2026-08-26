import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigureDeviceService } from "../../application/configuration/ConfigureDeviceService";
import { Icon } from "../../components/Icon";
import { PageHeader } from "../../components/PageHeader";
import { Panel } from "../../components/Panel";
import type { ConfigureDeviceResult, ConfigurationField, ConfigurationValidationIssue, ConfigurationValue, DeviceConfiguration, TechnicalTelegram } from "../../domain/configuration/DeviceConfiguration";
import { changedFields, resetRequestedValues, sameValue, withRequestedValue } from "../../domain/configuration/DeviceConfiguration";
import type { DeviceProfile } from "../../domain/devices/DeviceProfile";
import type { CommunicationLogEntry } from "../../domain/mbus/MbusClient";
import type { MbusDevice } from "../../domain/mbus/MbusDevice";
import { describePulseValue, physicalRepresentationForVif, unitForVif } from "../../domain/mbus/MbusVif";
import { deriveCybleVolumeEncoding } from "../../domain/mbus/CybleVolumeEncoding";
import { AutomaticConfigurationReadGate, SingleConfigurationWriteGate, appendOperationCommunicationEntry, beginOperationCommunicationLog, editableTargetAfterRead, isApplyConfigurationEnabled, profileChangeRequiresConfirmation, rebuildConfigurationForProfile, refreshRequiresDiscard, retainVerifiedSnapshot, selectValueLabel, showApplyConfirmation, statusAfterRead, type ConfigurationOperationKind, type OperationCommunicationLog } from "./ConfigurationUiPolicy";
import { CYBLE_MEDIUM_CHANGE_WARNING, isCybleFieldVisible, withCybleMediumAndGasDefaults } from "../../domain/mbus/CybleConfigurationPolicy";

type ConfigurationStatus = "Reading" | "Ready" | "Modified" | "Validating" | "Writing" | "Waiting for ACK" | "Verifying" | "Verified" | "Error";

interface ConfigurationPageProps {
  device: MbusDevice | null;
  profile?: DeviceProfile;
  profileStatus: "known" | "possible" | "unknown" | "ambiguous";
  profileSelectionKind: "known" | "possible" | "manual" | "generic" | "unselected";
  applicableProfiles: DeviceProfile[];
  initialEditFieldId?: string;
  onSelectProfile: (profile: DeviceProfile) => void;
  connected: boolean;
  service: ConfigureDeviceService;
  onLog: (entry: CommunicationLogEntry) => void;
  onDeviceUpdated: (device: MbusDevice) => void;
  onBackToNetwork: () => void;
  onBackToDevice?: () => void;
}

export function ConfigurationPage({ device, profile, profileStatus, profileSelectionKind, applicableProfiles, initialEditFieldId, onSelectProfile, connected, service, onLog, onDeviceUpdated, onBackToNetwork, onBackToDevice }: ConfigurationPageProps) {
  const [configuration, setConfiguration] = useState<DeviceConfiguration>();
  const [status, setStatus] = useState<ConfigurationStatus>("Reading");
  const [error, setError] = useState<string>();
  const [confirmReload, setConfirmReload] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<DeviceProfile>();
  const [result, setResult] = useState<ConfigureDeviceResult>();
  const [view, setView] = useState<"installer" | "engineering">("installer");
  const [editingFieldIds, setEditingFieldIds] = useState<Set<string>>(() => new Set());
  const [pendingPreview, setPendingPreview] = useState<TechnicalTelegram>();
  const [previewError, setPreviewError] = useState<string>();
  const [operationCommunicationLog, setOperationCommunicationLog] = useState<OperationCommunicationLog>(() => beginOperationCommunicationLog(0, "READ_CONFIGURATION"));
  const automaticReadGate = useRef(new AutomaticConfigurationReadGate());
  const writeGate = useRef(new SingleConfigurationWriteGate());
  const operationLogId = useRef(operationCommunicationLog.operationId);
  const resetDeviceKey = useRef<string | undefined>(undefined);
  const activeReadId = useRef(0);
  const changes = useMemo(() => configuration ? changedFields(configuration) : [], [configuration]);
  const validation = useMemo(() => configuration ? service.validateRequestedConfiguration(configuration) : { valid: true, issues: [] }, [configuration, service]);
  const busy = status === "Reading" || status === "Validating" || status === "Writing" || status === "Waiting for ACK" || status === "Verifying";
  const cybleProfile = configuration?.profileId === "itron-cyble-mbus-v2";

  useEffect(() => {
    if (resetDeviceKey.current === device?.id) return;
    resetDeviceKey.current = device?.id;
    activeReadId.current += 1;
    const clearedLog = beginOperationCommunicationLog(operationLogId.current, "READ_CONFIGURATION");
    operationLogId.current = clearedLog.operationId;
    setOperationCommunicationLog(clearedLog);
    setConfiguration(undefined); setStatus("Reading"); setError(undefined); setConfirmReload(false); setPendingProfile(undefined); setResult(undefined); setView("installer"); setEditingFieldIds(new Set());
  }, [device?.id]);

  const startOperationLog = useCallback((operation: ConfigurationOperationKind) => {
    const started = beginOperationCommunicationLog(operationLogId.current, operation);
    operationLogId.current = started.operationId;
    setOperationCommunicationLog(started);
    return (entry: CommunicationLogEntry) => {
      onLog(entry);
      setOperationCommunicationLog((current) => appendOperationCommunicationEntry(current, started.operationId, entry));
    };
  }, [onLog]);

  const readConfiguration = useCallback(async (editFieldId?: string) => {
    if (!device) return;
    const readId = ++activeReadId.current;
    const captureOperationLog = startOperationLog("READ_CONFIGURATION");
    setStatus("Reading"); setError(undefined); setResult(undefined);
    try {
      const current = await service.readCurrentConfiguration(device, profile, { onLog: captureOperationLog });
      if (readId !== activeReadId.current) return;
      const target = editableTargetAfterRead(current, editFieldId);
      setConfiguration(current); setStatus(statusAfterRead(true)); setEditingFieldIds(target ? new Set([target]) : new Set());
    } catch (caught) {
      if (readId !== activeReadId.current) return;
      captureOperationLog({ timestamp: new Date().toISOString(), level: "ERROR", message: `Read configuration failed: ${readError(caught)}`, address: device.primaryAddress });
      setConfiguration(undefined); setError("Unable to read device configuration"); setStatus(statusAfterRead(false));
    }
  }, [device, profile, service, startOperationLog]);

  useEffect(() => {
    if (!device || !connected || !profile) return;
    if (!automaticReadGate.current.shouldRead(device.id, profile?.id)) return;
    void readConfiguration(initialEditFieldId);
  }, [connected, device, initialEditFieldId, profile, profileStatus, readConfiguration]);

  useEffect(() => {
    let cancelled = false;
    if (!device || !configuration || changes.length === 0) {
      setPendingPreview(undefined); setPreviewError(undefined);
      return () => { cancelled = true; };
    }
    void service.previewRequestedConfiguration(device, configuration).then((preview) => {
      if (!cancelled) { setPendingPreview(preview); setPreviewError(undefined); }
    }).catch((caught) => {
      if (!cancelled) { setPendingPreview(undefined); setPreviewError(readError(caught)); }
    });
    return () => { cancelled = true; };
  }, [changes.length, configuration, device, service]);

  const updateField = (field: ConfigurationField, rawValue: ConfigurationValue) => {
    if (!configuration) return;
    const value: ConfigurationValue = field.type === "integer" || field.type === "decimal" ? Number(rawValue) : rawValue;
    const next = cybleProfile && field.id === "medium" ? withCybleMediumAndGasDefaults(configuration, value) : withRequestedValue(configuration, field.id, value);
    setConfiguration(next); setStatus(changedFields(next).length ? "Modified" : "Ready"); setError(undefined); setResult(undefined);
  };

  const applyConfiguration = async () => {
    if (!device || !configuration) return;
    if (!validation.valid || changes.length === 0) return;
    if (!writeGate.current.tryStart()) return;
    const captureOperationLog = startOperationLog("APPLY_CONFIGURATION");
    setStatus("Validating"); setError(undefined);
    try {
      setStatus("Writing");
      const applied = await service.configure(device, profile, configuration, { onLog: (entry) => { captureOperationLog(entry); if (entry.level === "TX") setStatus("Waiting for ACK"); }, onVerifying: () => setStatus("Verifying") });
      setResult(applied);
      if (applied.write.status !== "Success") {
        captureOperationLog({ timestamp: new Date().toISOString(), level: "ERROR", message: applied.write.message, address: device.primaryAddress });
        setError(applied.write.message); setStatus("Error"); return;
      }
      if (applied.verification.status === "Verified" && applied.readBack) {
        setConfiguration(applied.readBack); setStatus("Verified"); setEditingFieldIds(new Set());
        const primaryAddress = applied.readBack.fields.find((field) => field.id === "primaryAddress")?.currentValue;
        const updatedDevice = applied.readBack.device ?? { ...device, primaryAddress: typeof primaryAddress === "number" ? primaryAddress : device.primaryAddress };
        resetDeviceKey.current = updatedDevice.id;
        retainVerifiedSnapshot(automaticReadGate.current, updatedDevice.id, profile?.id);
        onDeviceUpdated(updatedDevice);
      } else {
        captureOperationLog({ timestamp: new Date().toISOString(), level: "ERROR", message: applied.verification.message, address: device.primaryAddress });
        setError(applied.verification.message); setStatus("Error");
      }
    } catch (caught) {
      captureOperationLog({ timestamp: new Date().toISOString(), level: "ERROR", message: `Apply configuration failed: ${readError(caught)}`, address: device.primaryAddress });
      setError(readError(caught)); setStatus("Error");
    } finally {
      writeGate.current.finish();
    }
  };

  const reset = () => {
    if (!configuration) return;
    setConfiguration(resetRequestedValues(configuration)); setStatus("Ready"); setError(undefined); setResult(undefined); setEditingFieldIds(new Set());
  };

  const changeProfile = (nextProfile: DeviceProfile) => {
    if (!device || nextProfile.id === profile?.id) return;
    const snapshot = configuration?.device ?? device;
    const rebuilt = rebuildConfigurationForProfile(service, snapshot, nextProfile);
    automaticReadGate.current.shouldRead(device.id, nextProfile.id);
    activeReadId.current += 1;
    setConfiguration(rebuilt); setStatus(rebuilt ? "Ready" : "Error"); setError(rebuilt ? undefined : "Unable to rebuild configuration from the current snapshot");
    setResult(undefined); setPendingPreview(undefined); setPreviewError(undefined); setEditingFieldIds(new Set()); setPendingProfile(undefined);
    onSelectProfile(nextProfile);
  };

  const requestProfileChange = (profileId: string) => {
    const nextProfile = applicableProfiles.find((candidate) => candidate.id === profileId);
    if (!nextProfile || nextProfile.id === profile?.id) return;
    if (profileChangeRequiresConfirmation(changes.length)) { setPendingProfile(nextProfile); return; }
    changeProfile(nextProfile);
  };

  const requestRefresh = () => {
    if (refreshRequiresDiscard(changes.length)) { setConfirmReload(true); return; }
    void readConfiguration();
  };

  const discardAndReload = () => {
    setConfirmReload(false);
    if (configuration) setConfiguration(resetRequestedValues(configuration));
    void readConfiguration();
  };

  const beginEditing = (fieldId: string) => setEditingFieldIds((current) => new Set(current).add(fieldId));
  const finishEditing = (fieldId: string) => setEditingFieldIds((current) => { const next = new Set(current); next.delete(fieldId); return next; });
  const cancelEditing = (field: ConfigurationField) => {
    if (!configuration) return;
    const restored = withRequestedValue(configuration, field.id, field.currentValue);
    const next = cybleProfile && field.id === "medium" ? { ...restored, fields: restored.fields.map((item) => item.id === "pulseWeightX10" || item.id === "correctedVolume" ? { ...item, requestedValue: typeof item.currentValue === "boolean" ? item.currentValue : false } : item) } : restored;
    setConfiguration(next); setStatus(changedFields(next).length ? "Modified" : "Ready"); setError(undefined); setResult(undefined); finishEditing(field.id);
  };

  const profileLabel = profile ? `${profile.manufacturer} ${profile.model}` : profileStatus === "ambiguous" ? "Select profile" : "Unknown device · Standard M-Bus capabilities only";
  const profileConfidenceLabel = profileSelectionKind === "possible" ? "Possible match" : profileSelectionKind === "manual" ? "Manually selected" : undefined;
  const protectedConfiguration = Boolean(configuration?.writeProtected);
  const ratio = configuration?.fields.find((field) => field.id === "multiplicator")?.requestedValue;
  const unit = configuration?.fields.find((field) => field.id === "unit")?.requestedValue;
  const pulseDescription = typeof ratio === "object" && ratio !== null && typeof unit === "number" ? describePulseValue(ratio.numerator, ratio.denominator, unit) : undefined;
  const issueByField = new Map(validation.issues.map((issue) => [issue.fieldId, issue]));
  const padPulsSnapshot = configuration?.device?.padPulsConfiguration;
  const installerUnit = padPulsSnapshot ? unitForVif(padPulsSnapshot.vif) : undefined;
  const physicalUnit = padPulsSnapshot ? physicalRepresentationForVif(padPulsSnapshot.vif) : undefined;
  const cybleSnapshot = configuration?.device?.cybleConfiguration;
  const requestedMedium = configuration?.fields.find((field) => field.id === "medium")?.requestedValue;
  const cybleVolume = configuration?.fields.find((field) => field.id === "volume")?.requestedValue;
  let cybleEncoding: ReturnType<typeof deriveCybleVolumeEncoding> | undefined;
  if (cybleProfile && typeof cybleVolume === "string") {
    try { cybleEncoding = deriveCybleVolumeEncoding(cybleVolume); } catch { /* Validation displays the error beside the field. */ }
  }
  const pulseWeightField = configuration?.fields.find((field) => field.id === "pulseWeight");
  const volumeChanged = changes.some((field) => field.id === "volume");
  const pulseWeightExplicitlyChanged = changes.some((field) => field.id === "pulseWeight");
  const derivedPulseWeightChanged = Boolean(volumeChanged && !pulseWeightExplicitlyChanged && cybleEncoding && String(pulseWeightField?.currentValue ?? "") !== cybleEncoding.resolution);
  const applyEnabled = isApplyConfigurationEnabled({ connected, changeCount: changes.length, validationValid: validation.valid, busy, writeProtected: protectedConfiguration });

  return <div className="page">
    <div className="configuration-back-actions"><button className="back-button" onClick={onBackToNetwork}><Icon name="arrow"/>Back to network</button>{device && onBackToDevice && <button className="back-button" onClick={onBackToDevice}><Icon name="arrow"/>Back to device</button>}</div>
    <PageHeader eyebrow="Commissioning" title="Configuration" description="Read, edit, write and verify supported device parameters." actions={<button className="button button--ghost configuration-refresh" disabled={!device || !connected || busy} onClick={requestRefresh}><Icon name="refresh"/>Refresh</button>}/>
    <div className="configuration-summary"><div><small>DEVICE</small><strong>{device ? `${device.manufacturer ?? "Unknown"} · ${device.identificationNumber ?? "No identification"}` : "No device selected"}</strong></div><div><small>PROFILE</small>{applicableProfiles.length > 1 || !profile ? <select aria-label="Configuration profile" value={profile?.id ?? ""} disabled={busy && Boolean(profile)} onChange={(event) => requestProfileChange(event.target.value)}><option value="" disabled>Select profile</option>{applicableProfiles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.manufacturer} {candidate.model}</option>)}</select> : <strong>{profileLabel}</strong>}{profileConfidenceLabel && <small>{profileConfidenceLabel}</small>}</div><div><small>CONFIGURATION STATUS</small><strong className={`configuration-status configuration-status--${status.toLowerCase().replace(" ", "-")}`}>{status}</strong></div></div>
    <div className="tabs"><button className={view === "installer" ? "active" : ""} onClick={() => setView("installer")}>Installer configuration</button><button className={view === "engineering" ? "active" : ""} onClick={() => setView("engineering")}>Engineering diagnostics <span>{result?.write.telegrams.length ?? 0}</span></button></div>
    {view === "installer" && <><div className="configuration-workspace"><div className="configuration-workspace__parameters"><Panel title="Parameters" description="Only fields declared by the detected profile are shown. Unsupported manufacturer writes remain unavailable.">
      {!configuration ? <div className="configuration-empty">{!profile ? <div className="notice"><div><strong>Select profile</strong><p>Choose one of the compatible profiles from the PROFILE field.</p></div></div> : status === "Reading" ? <div className="configuration-reading"><Icon name="refresh"/><strong>Reading configuration…</strong><span>Waiting for the current device values.</span></div> : <div className="configuration-read-error"><strong>Unable to read device configuration</strong><button className="button button--secondary" disabled={!device || !connected} onClick={() => void readConfiguration(initialEditFieldId)}><Icon name="refresh"/>Retry</button></div>}</div> : <>
        <div className="configuration-fields">{configuration.fields.filter((field) => !cybleProfile || isCybleFieldVisible(field.id, typeof requestedMedium === "number" ? requestedMedium : undefined)).map((field) => <Fragment key={field.id}>{field.id === "correctedVolume" && <h3 className="configuration-section-heading">Gas settings</h3>}{field.id === "alarmReset" && <h3 className="configuration-section-heading">Actions</h3>}<ConfigurationFieldRow field={field} editing={editingFieldIds.has(field.id)} disabled={busy || Boolean(configuration.writeProtected && field.writeSupport === "SUPPORTED")} locked={Boolean(configuration.writeProtected && field.writeSupport === "SUPPORTED")} issue={issueByField.get(field.id)} help={field.id === "multiplicator" ? pulseDescription : field.id === "pulseWeight" && derivedPulseWeightChanged ? `Will change to ${cybleEncoding?.resolution} · Derived from volume resolution` : field.id === "correctedVolume" ? "Default OFF; read-back unavailable. Indicates that the volume is corrected to reference temperature and pressure conditions." : field.id === "pulseWeightX10" ? "Default OFF; read-back unavailable. Gas-specific Cyble pulse-weight option." : undefined} onEdit={() => beginEditing(field.id)} onFinish={() => finishEditing(field.id)} onCancel={() => cancelEditing(field)} onChange={(value) => updateField(field, value)}/></Fragment>)}{configuration.writeProtected !== undefined && <WriteProtectionRow active={configuration.writeProtected}/>}</div>
        {cybleProfile && <div className="notice"><div><strong>Confirmed commands only</strong><p>Cyble writes use the confirmed A6 challenge and dynamic TOTAL A5 unlock before configuration. Primary and Secondary addresses, numeric Customer ID, Volume, normal Pulse weight, Medium and observed Gas flag combinations can be written.</p></div></div>}
        {configuration.writeProtected && <div className="notice notice--error"><div><strong>Configuration locked on device</strong><p>Status bit 7 is active; opening the enclosure and using the physical button is required to unlock it.</p></div></div>}
        {error && <div className="notice notice--error"><div><strong>Configuration error</strong><p>{error}</p></div></div>}
        <div className="configuration-actions"><span className={changes.length ? "unsaved-count unsaved-count--active" : "unsaved-count"}>{changes.length} unsaved {changes.length === 1 ? "change" : "changes"}</span></div>
      </>}
    </Panel></div><aside className="configuration-workspace__operation">
    {showApplyConfirmation(changes.length) && <Panel title="Apply configuration?" description="Review every change before data is sent to the M-Bus device. Each command must receive an E5 ACK."><div className="change-list">{changes.map((field) => <div key={field.id}><strong>{field.label}</strong><span>{formatFieldValue(field, field.currentValue)} → {formatFieldValue(field, field.requestedValue)}</span></div>)}{derivedPulseWeightChanged && <div><strong>Pulse weight</strong><span>{formatValue(pulseWeightField?.currentValue ?? null)} → {cybleEncoding?.resolution}<small>Derived from volume resolution</small></span></div>}</div>{cybleProfile && changes.some((field) => field.id === "medium") && <div className="validation-error">{CYBLE_MEDIUM_CHANGE_WARNING}</div>}{!validation.valid && <div className="validation-error">{validation.issues.map((issue) => issue.message).join(" ")}</div>}<div className="form-actions confirmation-actions"><button className="button button--secondary" disabled={busy} onClick={reset}>Reset changes</button><button className="button button--primary" disabled={!applyEnabled} onClick={applyConfiguration}><Icon name="check"/>Apply changes</button></div></Panel>}
    {confirmReload && <Panel title="Discard unsaved changes and reload configuration?" description="Refreshing replaces every local change with values read from the device."><div className="form-actions confirmation-actions"><button className="button button--secondary" onClick={() => setConfirmReload(false)}>Cancel</button><button className="button button--primary" onClick={discardAndReload}><Icon name="refresh"/>Discard and reload</button></div></Panel>}
    {pendingProfile && <Panel title="Change profile?" description="Changing profile will discard unsaved changes."><div className="form-actions confirmation-actions"><button className="button button--secondary" onClick={() => setPendingProfile(undefined)}>Cancel</button><button className="button button--primary" onClick={() => changeProfile(pendingProfile)}>Change profile</button></div></Panel>}
    {result && <Panel title="Write verification"><div className={`verification-result verification-result--${result.verification.status.toLowerCase()}`}><strong>{result.verification.status}</strong><span>{result.verification.message}</span></div>{result.verification.fields.map((field) => <div className="verification-row" key={field.fieldId}><span>{field.fieldId}</span><span>Requested: {formatValue(field.requestedValue)}</span><span>Read back: {formatValue(field.readBackValue)}</span><strong>{field.verified ? "Verified" : field.readBackValue === null ? "Read-back unavailable" : "Mismatch"}</strong></div>)}</Panel>}
    <Panel title="Communication log" description={operationCommunicationLog.operation === "APPLY_CONFIGURATION" ? "Exchanges from the latest Apply changes operation." : "Exchanges from the latest configuration read."}><div className="operation-communication-log">{operationCommunicationLog.entries.length ? operationCommunicationLog.entries.map((entry, index) => <div className={`operation-communication-entry operation-communication-entry--${entry.level.toLowerCase()}`} key={`${entry.timestamp}-${index}`}><div><time>{operationLogTime(entry.timestamp)}</time><strong>{entry.level}</strong><span>{entry.message}{entry.address !== undefined ? ` · address ${entry.address}` : ""}</span></div>{entry.hex && <code>{entry.hex}</code>}</div>) : <div className="empty-inline">No M-Bus exchange captured for this operation yet.</div>}</div></Panel></aside></div></>}
    {view === "engineering" && <Panel title="Engineering diagnostics" description="Read-only configuration details and TX preview. Preview generation never accesses the serial port.">
      {padPulsSnapshot && <div className="snapshot-diagnostics"><div><small>VIF raw</small><strong>0x{padPulsSnapshot.vif.toString(16).toUpperCase().padStart(2, "0")}</strong></div><div><small>Physical representation</small><strong>{physicalUnit ?? "—"}</strong></div><div><small>Installer label</small><strong>{installerUnit?.label ?? "—"}</strong></div><div><small>MAN / GEN</small><strong>0x{padPulsSnapshot.manufacturerRaw.toString(16).toUpperCase().padStart(4, "0")} / 0x{padPulsSnapshot.generation.toString(16).toUpperCase().padStart(2, "0")}</strong></div></div>}
      {cybleSnapshot && <div className="snapshot-diagnostics"><div><small>Read VIF / resolution</small><strong>0x{cybleSnapshot.volumeVif.toString(16).toUpperCase()} / {cybleSnapshot.volumeResolution} m³</strong></div><div><small>Read raw volume</small><strong>{cybleSnapshot.volumeRaw}</strong></div><div><small>Prepared VIF / resolution</small><strong>{cybleEncoding ? `0x${cybleEncoding.vif.toString(16).toUpperCase()} / ${cybleEncoding.resolution} m³` : "Invalid volume"}</strong></div><div><small>Prepared raw / pulse weight</small><strong>{cybleEncoding ? `${cybleEncoding.raw} / ${cybleEncoding.pulseWeightLitres} l/p` : "—"}</strong></div></div>}
      {changes.length > 0 && <div className="pending-telegram"><strong>Pending configuration telegram</strong>{pendingPreview ? <><span>TX preview</span><code>{pendingPreview.rawTelegram}</code><small>{pendingPreview.parsedResult}</small></> : previewError ? <span className="configuration-field__error">{previewError}</span> : <span>No manufacturer frame preview is available for this change.</span>}</div>}
      {result?.write.telegrams.length ? <div className="diagnostic-list">{result.write.telegrams.map((telegram, index) => <div key={`${telegram.timestamp}-${index}`}><time>{telegram.timestamp}</time><strong>{telegram.direction}</strong><span>{telegram.operation}</span><code>{telegram.rawTelegram}</code><small>{telegram.parsedResult ?? "—"}</small></div>)}</div> : !changes.length && <div className="empty-inline">No pending configuration telegram or captured exchange.</div>}
    </Panel>}
  </div>;
}

function ConfigurationFieldRow({ field, editing, disabled, locked, issue, help, onEdit, onFinish, onCancel, onChange }: { field: ConfigurationField; editing: boolean; disabled: boolean; locked: boolean; issue?: ConfigurationValidationIssue; help?: string; onEdit: () => void; onFinish: () => void; onCancel: () => void; onChange: (value: ConfigurationValue) => void }) {
  const supported = field.editable && field.writeSupport !== "READ_ONLY";
  const supportLabel = field.writeSupport === "SUPPORTED" && field.verificationSupport === "SUPPORTED" ? "Write + verify" : field.writeSupport === "SUPPORTED" ? "Write · read-back unavailable" : field.writeSupport === "LOCAL_ONLY" ? "Local only · not stored in device" : field.writeSupport === "READ_ONLY" ? "Read only" : "Not implemented";
  const dirty = !sameValue(field.currentValue, field.requestedValue);
  return <div className={`configuration-field ${dirty ? "configuration-field--dirty" : ""}`}>
    <div className="configuration-field__heading"><strong>{field.label}</strong><span>{field.category.replace(/_/g, " ")}</span></div>
    <div className="configuration-field__control">
      {!editing ? <div className="configuration-field__read-value"><strong>{field.kind === "ACTION" && field.currentValue === null ? "Unavailable" : field.currentValue === null && field.readSupport === "NOT_IMPLEMENTED" ? "Not available · value not decoded yet" : dirty ? <><span>{formatFieldValue(field, field.currentValue)}</span><b>→</b><em>{formatFieldValue(field, field.requestedValue)}</em></> : formatFieldValue(field, field.currentValue)}</strong>{supported && <button type="button" className="field-edit-button" disabled={disabled} title={locked ? "Configuration locked on device" : `Edit ${field.label} locally`} aria-label={locked ? `${field.label}: Configuration locked on device` : `Edit ${field.label} locally`} onClick={onEdit}><Icon name="edit" size={16}/></button>}</div> : <div className="configuration-field__editor"><div>{renderInput(field, disabled, onChange)}</div><button type="button" className="field-edit-button field-edit-button--finish" disabled={disabled || Boolean(issue)} title="Finish editing locally" aria-label={`Finish editing ${field.label} locally`} onClick={onFinish}><Icon name="check" size={16}/></button><button type="button" className="field-edit-button" disabled={disabled} title="Cancel this field edit" aria-label={`Cancel editing ${field.label}`} onClick={onCancel}><Icon name="close" size={16}/></button></div>}
      {issue && <span className="configuration-field__error">{issue.message}</span>}
      {locked && <span className="configuration-field__locked">Configuration locked on device</span>}
      {help && <span className="configuration-field__help">{help}</span>}
    </div>
    <div className="configuration-field__support"><small>Support</small><strong>{supportLabel}</strong></div>
  </div>;
}

function WriteProtectionRow({ active }: { active: boolean }) {
  return <div className="configuration-field configuration-field--readonly"><div className="configuration-field__heading"><strong>Write protection</strong><span>DEVICE STATUS</span></div><div className="configuration-field__control"><div className="configuration-field__read-value"><strong>{active ? "Active" : "Inactive"}</strong></div>{active && <span className="configuration-field__locked">Configuration locked on device</span>}</div><div className="configuration-field__support"><small>Support</small><strong>Read only</strong></div></div>;
}

function renderInput(field: ConfigurationField, disabled: boolean, onChange: (value: ConfigurationValue) => void) {
  if (field.type === "ratio") {
    const ratio = typeof field.requestedValue === "object" && field.requestedValue !== null ? field.requestedValue : { numerator: 1, denominator: 1 };
    return <div className="ratio-input"><input autoFocus aria-label="Numerator" type="number" min={0} max={255} value={ratio.numerator} disabled={disabled} onChange={(event) => onChange({ ...ratio, numerator: Number(event.target.value) })}/><span>/</span><input aria-label="Denominator" type="number" min={1} max={255} value={ratio.denominator} disabled={disabled} onChange={(event) => onChange({ ...ratio, denominator: Number(event.target.value) })}/></div>;
  }
  if (field.type === "boolean") return <input type="checkbox" checked={Boolean(field.requestedValue)} disabled={disabled} onChange={(event) => onChange(event.target.checked)}/>;
  if (field.type === "select") {
    const listed = field.options?.some((option) => sameValue(option.value, field.requestedValue));
    return <select autoFocus value={String(field.requestedValue ?? "")} disabled={disabled} onChange={(event) => onChange(field.options?.find((option) => String(option.value) === event.target.value)?.value ?? event.target.value)}>{!listed && field.requestedValue !== null && field.requestedValue !== "" && <option value={String(field.requestedValue)} disabled>{selectValueLabel(field, field.requestedValue)}</option>}{field.options?.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select>;
  }
  return <input autoFocus type={field.type === "text" ? "text" : "number"} step={field.type === "integer" ? 1 : "any"} min={field.minimum} max={field.maximum} value={String(field.requestedValue ?? "")} disabled={disabled} onChange={(event) => onChange(event.target.value)}/>;
}

function formatFieldValue(field: ConfigurationField, value: ConfigurationValue): string {
  if (field.type === "select") return selectValueLabel(field, value);
  return formatValue(value, field.unit);
}

function formatValue(value: ConfigurationValue, unit?: string): string {
  if (value === null || value === "") return "—";
  if (typeof value === "object") return `${value.numerator} / ${value.denominator}`;
  return `${String(value)}${unit ? ` ${unit}` : ""}`;
}

function operationLogTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toLocaleTimeString([], { hour12: false });
}

function readError(value: unknown): string {
  return value instanceof Error ? value.message : typeof value === "string" ? value : "Unexpected configuration error";
}
