import { useEffect, useMemo, useState } from "react";
import { MbusService } from "./application/mbus/MbusService";
import { upsertMbusDevices, withoutDeviceListMetadata, type MbusDeviceListItem } from "./application/mbus/upsertMbusDevice";
import { hasEditableConfigurationFields } from "./application/devices/configurationCapability";
import { applicableProfilesForMatch, defaultProfileForMatch } from "./application/devices/DeviceProfileSelection";
import { ConfigureDeviceService } from "./application/configuration/ConfigureDeviceService";
import type { OperationStatus } from "./domain/commissioning/OperationStatus";
import type { CommunicationLogEntry, ScanProgress } from "./domain/mbus/MbusClient";
import type { MbusDevice } from "./domain/mbus/MbusDevice";
import type { SerialConnectionSettings, SerialPortInfo } from "./domain/mbus/MbusTransport";
import { ConfigurationPage } from "./features/configuration/ConfigurationPage";
import { DeviceDetailsPage } from "./features/device-details/DeviceDetailsPage";
import { DeviceLibraryPage } from "./features/device-library/DeviceLibraryPage";
import { ScanPage } from "./features/scan/ScanPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { MockMbusClient } from "./infrastructure/mbus/MockMbusClient";
import { MockMbusTransport } from "./infrastructure/mbus/MockMbusTransport";
import { RealMbusClient } from "./infrastructure/mbus/RealMbusClient";
import { MockDeviceRepository } from "./infrastructure/persistence/MockDeviceRepository";
import { SerialMbusTransport } from "./infrastructure/serial/SerialMbusTransport";
import { StandardMbusAdapter } from "./infrastructure/devices/StandardMbusAdapter";
import { PadPulsM1Adapter } from "./infrastructure/devices/PadPulsM1Adapter";
import { DeviceProtocolAdapterRegistry } from "./infrastructure/devices/DeviceProtocolAdapterRegistry";
import { ItronCybleMbusV2Adapter } from "./infrastructure/devices/ItronCybleMbusV2Adapter";
import { AppShell, type AppPage } from "./layouts/AppShell";
import "./styles/global.css";

const deviceRepository = new MockDeviceRepository();
export type MbusMode = "mock" | "real";

const defaultSettings: SerialConnectionSettings = { portName: "", baudRate: 2400, dataBits: 8, stopBits: 1, parity: "even", timeout: 800 };

function App() {
  const [page, setPage] = useState<AppPage>("scan");
  const [mode, setMode] = useState<MbusMode>("real");
  const [connectionStatus, setConnectionStatus] = useState<OperationStatus>("disconnected");
  const [scanStatus, setScanStatus] = useState<OperationStatus>("idle");
  const [devices, setDevices] = useState<MbusDeviceListItem[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<MbusDevice | null>(null);
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [settings, setSettings] = useState<SerialConnectionSettings>(defaultSettings);
  const [scanRange, setScanRange] = useState({ startAddress: 0, endAddress: 250 });
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [logs, setLogs] = useState<CommunicationLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manualProfileId, setManualProfileId] = useState<string>();
  const [configurationTargetFieldId, setConfigurationTargetFieldId] = useState<string>();
  const services = useMemo(() => {
    if (mode === "real") {
      const transport = new SerialMbusTransport();
      const client = new RealMbusClient();
      const adapter = new DeviceProtocolAdapterRegistry(new StandardMbusAdapter(client, client), new PadPulsM1Adapter(client, client), new ItronCybleMbusV2Adapter(client, client));
      return { mbusService: new MbusService(transport, client), configureService: new ConfigureDeviceService(adapter) };
    }
    const transport = new MockMbusTransport();
    const client = new MockMbusClient(transport);
    const adapter = new DeviceProtocolAdapterRegistry(new StandardMbusAdapter(client, client), new PadPulsM1Adapter(client, client), new ItronCybleMbusV2Adapter(client, client));
    return { mbusService: new MbusService(transport, client), configureService: new ConfigureDeviceService(adapter) };
  }, [mode]);
  const { mbusService, configureService } = services;
  const profiles = useMemo(() => deviceRepository.getAll(), []);
  const selectedProfileMatch = selectedDevice ? configureService.identify(selectedDevice, profiles) : { status: "unknown" as const, matches: [] as [] };
  const applicableProfiles = applicableProfilesForMatch(selectedProfileMatch, profiles);
  const manualProfile = applicableProfiles.find((profile) => profile.id === manualProfileId);
  const selectedProfile = manualProfile ?? defaultProfileForMatch(selectedProfileMatch, profiles);
  const profileSelectionKind = manualProfile
    ? "manual" as const
    : selectedProfileMatch.status === "known" ? "known" as const
      : selectedProfileMatch.status === "possible" ? "possible" as const
        : selectedProfile ? "generic" as const : "unselected" as const;

  useEffect(() => { setManualProfileId(undefined); }, [selectedDevice?.id]);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [page]);

  const refreshPorts = async () => {
    try {
      setError(null);
      const discovered = await mbusService.listPorts();
      setPorts(discovered);
      if (discovered.length && !discovered.some((port) => port.portName === settings.portName)) {
        setSettings((current) => ({ ...current, portName: discovered[0].portName }));
      }
    } catch (caught) {
      setPorts([]);
      setError(readError(caught));
    }
  };

  useEffect(() => { void refreshPorts(); }, [mbusService]);

  const observer = {
    onProgress: setScanProgress,
    onDevice: ({ device }: { device: MbusDevice }) => setDevices((current) => upsertMbusDevices(current, [device])),
    onLog: (entry: CommunicationLogEntry) => setLogs((current) => [...current.slice(-199), entry]),
  };

  const handleConnect = async () => {
    try {
      setError(null);
      if (connectionStatus === "connected") {
        await mbusService.disconnect();
        setConnectionStatus("disconnected");
        return;
      }
      setConnectionStatus("connecting");
      await mbusService.connect(settings);
      setConnectionStatus("connected");
    } catch (caught) {
      setConnectionStatus("error");
      setError(readError(caught));
    }
  };

  const handlePrimaryScan = async () => {
    if (connectionStatus !== "connected") return;
    if (scanRange.startAddress < 0 || scanRange.endAddress > 250 || scanRange.startAddress > scanRange.endAddress) {
      setError("Primary range must satisfy 0 ≤ start ≤ end ≤ 250");
      return;
    }
    try {
      setError(null); setDevices([]); setScanProgress(null); setScanStatus("scanning");
      const discovered = await mbusService.scanPrimary(scanRange, observer);
      setDevices((current) => upsertMbusDevices(current, discovered));
      setScanStatus((current) => current === "idle" ? "idle" : "success");
    } catch (caught) {
      setScanStatus("error"); setError(readError(caught));
    }
  };

  const handleQuickScan = async () => {
    if (connectionStatus !== "connected") return;
    try {
      setError(null); setDevices([]); setScanProgress(null); setScanStatus("scanning");
      const discovered = await mbusService.scanSecondary(observer);
      setDevices((current) => upsertMbusDevices(current, discovered));
      setScanStatus((current) => current === "idle" ? "idle" : "success");
    } catch (caught) { setScanStatus("error"); setError(readError(caught)); }
  };

  const handleKnownId = async (identificationNumber: string) => {
    if (connectionStatus !== "connected") return;
    try {
      setError(null); setScanProgress(null); setScanStatus("reading");
      const result = await mbusService.readBySecondaryId(identificationNumber, observer);
      setDevices((current) => upsertMbusDevices(current, [result.device]));
      setSelectedDevice(result.device);
      setScanStatus("success");
    } catch (caught) { setScanStatus("error"); setError(readError(caught)); }
  };

  const handleStop = async () => { await mbusService.stopScan(); setScanStatus("idle"); };

  const handleModeChange = async (nextMode: MbusMode) => {
    if (connectionStatus === "connected") await mbusService.disconnect().catch(() => undefined);
    setMode(nextMode); setConnectionStatus("disconnected"); setScanStatus("idle"); setDevices([]); setSelectedDevice(null); setLogs([]); setError(null);
    setSettings((current) => ({ ...current, portName: nextMode === "mock" ? "MOCK" : "" }));
  };

  const handleReadDevice = async () => {
    if (!selectedDevice) return;
    try {
      setError(null); setScanStatus("reading");
      const result = await mbusService.readDevice(selectedDevice, observer);
      setSelectedDevice(result.device);
      setDevices((current) => upsertMbusDevices(current, [result.device]));
      setScanStatus("success");
    } catch (caught) { setScanStatus("error"); setError(readError(caught)); }
  };

  const openDevice = (device: MbusDeviceListItem) => {
    setSelectedDevice(withoutDeviceListMetadata(device));
    setConfigurationTargetFieldId(undefined);
    setPage("device-details");
  };

  const openConfiguration = (fieldId?: string) => {
    setConfigurationTargetFieldId(fieldId);
    setPage("configuration");
  };

  const openDeviceConfiguration = (device: MbusDeviceListItem) => {
    setSelectedDevice(withoutDeviceListMetadata(device));
    setManualProfileId(undefined);
    setConfigurationTargetFieldId(undefined);
    setPage("configuration");
  };

  const scanPage = (
    <ScanPage
      connectionStatus={connectionStatus}
      scanStatus={scanStatus}
      devices={devices}
      mode={mode}
      ports={ports}
      settings={settings}
      scanRange={scanRange}
      progress={scanProgress}
      logs={logs}
      error={error}
      onModeChange={handleModeChange}
      onSettingsChange={setSettings}
      onScanRangeChange={setScanRange}
      onRefreshPorts={refreshPorts}
      onConnect={handleConnect}
      onPrimaryScan={handlePrimaryScan}
      onQuickScan={handleQuickScan}
      onReadById={handleKnownId}
      onStop={handleStop}
      onOpenDevice={openDevice}
      onConfigureDevice={openDeviceConfiguration}
      canConfigureDevice={(device) => applicableProfilesForMatch(configureService.identify(device, profiles), profiles).some(hasEditableConfigurationFields)}
      getRecords={(device) => mbusService.getCachedRecords(device.id)}
    />
  );

  const renderPage = () => {
    switch (page) {
      case "device-details":
        return selectedDevice ? (
          <DeviceDetailsPage
            device={selectedDevice}
            records={mbusService.getCachedRecords(selectedDevice.id)}
            rawTelegram={mbusService.getRawTelegram(selectedDevice.id)}
            logs={logs}
            interfaceName={settings.portName}
            reading={scanStatus === "reading"}
            profile={selectedProfile}
            onRead={handleReadDevice}
            onConfigure={openConfiguration}
            onBack={() => setPage("scan")}
          />
        ) : scanPage;
      case "configuration":
        return (
          <ConfigurationPage
            device={selectedDevice}
            profile={selectedProfile}
            profileStatus={selectedProfileMatch.status}
            profileSelectionKind={profileSelectionKind}
            applicableProfiles={applicableProfiles}
            initialEditFieldId={configurationTargetFieldId}
            onSelectProfile={(profile) => setManualProfileId(profile.id)}
            connected={connectionStatus === "connected"}
            service={configureService}
            onLog={observer.onLog}
            onDeviceUpdated={(device) => {
              const previousDevice = selectedDevice ?? undefined;
              setSelectedDevice(device);
              setDevices((current) => upsertMbusDevices(current, [device], { replaces: previousDevice, showPrimaryAddressChange: true }));
            }}
            onBackToNetwork={() => setPage("scan")}
            onBackToDevice={selectedDevice ? () => setPage("device-details") : undefined}
          />
        );
      case "device-library":
        return <DeviceLibraryPage profiles={profiles} />;
      case "settings":
        return <SettingsPage mode={mode} onModeChange={handleModeChange} />;
      case "scan":
        return scanPage;
    }
  };

  return (
    <AppShell currentPage={page} connectionStatus={connectionStatus} mode={mode} interfaceName={settings.portName} onNavigate={setPage}>
      {renderPage()}
    </AppShell>
  );
}

function readError(value: unknown): string {
  if (value instanceof Error) return value.message;
  return typeof value === "string" ? value : "Unexpected M-Bus error";
}

export default App;
