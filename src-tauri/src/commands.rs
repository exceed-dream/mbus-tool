use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::Instant;

use serialport::SerialPort;
use tauri::{AppHandle, Emitter, State};

use crate::{
    mbus::{
        confirmed_candidate_address, deduplicate_devices, deselect_secondary,
        encode_padpuls_configuration_frame, encode_req_ud2, encode_secondary_selection,
        encode_selected_req_ud2, encode_snd_ud, exchange, hex, initial_masks, now_timestamp,
        parse_frame, primary_address_candidate, probe_secondary_address, read_primary_address,
        refine_mask, retain_explicit_primary_address, set_confirmed_primary_address,
        CommunicationLogEntry, ConfigurationWriteResult, ConfigurationWriteStatus,
        DeviceReadResult, ManufacturerFrameWriteRequest, MbusFrame, PadPulsWriteRequest,
        PrimaryAddressWriteRequest, ScanOptions, ScanProgress, ScanReadError, SecondaryAddressMask,
        SecondaryProbeKind, SecondaryScanProgress, TechnicalTelegram,
    },
    serial::{self, SerialConnection, SerialConnectionSettings, SerialPortInfo},
};

#[derive(Clone, Default)]
pub struct AppState {
    connection: Arc<Mutex<Option<SerialConnection>>>,
    cancel_scan: Arc<AtomicBool>,
}

#[tauri::command]
pub fn list_serial_ports() -> Result<Vec<SerialPortInfo>, String> {
    serial::list_ports()
}

#[tauri::command]
pub async fn connect_serial(
    state: State<'_, AppState>,
    settings: SerialConnectionSettings,
) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let connection = serial::open_port(settings)?;
        let mut guard = state
            .connection
            .lock()
            .map_err(|_| "Serial connection state is unavailable".to_string())?;
        *guard = Some(connection);
        Ok(())
    })
    .await
    .map_err(|error| format!("Connection task failed: {error}"))?
}

#[tauri::command]
pub fn disconnect_serial(state: State<'_, AppState>) -> Result<(), String> {
    state.cancel_scan.store(true, Ordering::SeqCst);
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    *guard = None;
    Ok(())
}

#[tauri::command]
pub async fn scan_primary(
    app: AppHandle,
    state: State<'_, AppState>,
    options: ScanOptions,
) -> Result<Vec<DeviceReadResult>, String> {
    validate_scan_options(&options)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_primary_scan(&app, &state, options))
        .await
        .map_err(|error| format!("Scan task failed: {error}"))?
}

#[tauri::command]
pub fn stop_scan(state: State<'_, AppState>) {
    state.cancel_scan.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn scan_secondary(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<DeviceReadResult>, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_secondary_scan(&app, &state))
        .await
        .map_err(|error| format!("Secondary scan task failed: {error}"))?
}

#[tauri::command]
pub async fn read_mbus_by_secondary_id(
    app: AppHandle,
    state: State<'_, AppState>,
    identification_number: String,
) -> Result<DeviceReadResult, String> {
    if identification_number.len() != 8
        || !identification_number
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err("Known secondary ID must contain exactly 8 digits".to_string());
    }
    let mask = SecondaryAddressMask::identification_only(&identification_number)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || read_known_secondary(&app, &state, &mask))
        .await
        .map_err(|error| format!("Secondary read task failed: {error}"))?
}

#[tauri::command]
pub async fn read_mbus_device(
    app: AppHandle,
    state: State<'_, AppState>,
    primary_address: u8,
) -> Result<DeviceReadResult, String> {
    if primary_address > 250 {
        return Err("Primary address must be between 0 and 250".to_string());
    }
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = state
            .connection
            .lock()
            .map_err(|_| "Serial connection state is unavailable".to_string())?;
        let connection = guard
            .as_mut()
            .ok_or_else(|| "Serial port unavailable: connect first".to_string())?;
        emit_tx(&app, primary_address);
        match read_primary_address(
            connection.port.as_mut(),
            primary_address,
            connection.settings.baud_rate,
        ) {
            Ok((result, _, response)) => {
                emit_log(
                    &app,
                    "RX",
                    "M-Bus response received",
                    Some(primary_address),
                    Some(hex(&response)),
                );
                Ok(result)
            }
            Err(error) => {
                let message = read_error_message(error);
                emit_log(&app, "ERROR", &message, Some(primary_address), None);
                Err(message)
            }
        }
    })
    .await
    .map_err(|error| format!("Read task failed: {error}"))?
}

#[tauri::command]
pub async fn write_primary_address(
    app: AppHandle,
    state: State<'_, AppState>,
    request: PrimaryAddressWriteRequest,
) -> Result<ConfigurationWriteResult, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_primary_address_write(&app, &state, request))
        .await
        .map_err(|error| format!("Configuration task failed: {error}"))?
}

#[tauri::command]
pub async fn send_mbus_frame_wait_for_ack(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ManufacturerFrameWriteRequest,
) -> Result<ConfigurationWriteResult, String> {
    validate_manufacturer_frame(&request)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_frame_write(&app, &state, request))
        .await
        .map_err(|error| format!("Manufacturer configuration task failed: {error}"))?
}

fn validate_manufacturer_frame(request: &ManufacturerFrameWriteRequest) -> Result<(), String> {
    if request.target_address > 250 {
        return Err("Target primary address must be between 0 and 250".to_string());
    }
    match parse_frame(&request.frame)? {
        MbusFrame::Long {
            control, address, ..
        } if control == 0x53 && address == request.target_address => Ok(()),
        MbusFrame::Long { .. } => Err(
            "Manufacturer frame must be SND_UD (0x53) and match the declared target address"
                .to_string(),
        ),
        _ => Err("Only a validated M-Bus long frame may be sent by this command".to_string()),
    }
}

fn run_frame_write(
    app: &AppHandle,
    state: &AppState,
    request: ManufacturerFrameWriteRequest,
) -> Result<ConfigurationWriteResult, String> {
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    let connection = guard
        .as_mut()
        .ok_or_else(|| "Serial port unavailable: connect first".to_string())?;
    let started = Instant::now();
    let tx = technical_telegram(
        "TX",
        &request.operation,
        Some(request.target_address),
        None,
        &request.frame,
        Some("Waiting for E5 ACK"),
    );
    emit_log(
        app,
        "TX",
        &request.operation,
        Some(request.target_address),
        Some(hex(&request.frame)),
    );
    let response = exchange(connection.port.as_mut(), &request.frame);
    let elapsed_ms = started.elapsed().as_millis();
    let (status, message, rx_bytes, parsed) = classify_ack_response(response, elapsed_ms);
    let mut telegrams = vec![tx];
    if let Some(bytes) = rx_bytes.as_ref() {
        emit_log(
            app,
            "RX",
            &message,
            Some(request.target_address),
            Some(hex(bytes)),
        );
        telegrams.push(technical_telegram(
            "RX",
            &request.operation,
            Some(request.target_address),
            None,
            bytes,
            Some(&parsed),
        ));
    } else {
        emit_log(app, "ERROR", &message, Some(request.target_address), None);
    }
    eprintln!(
        "timestamp={} port={} target={} tx=\"{}\" rx=\"{}\" duration_ms={} timeout={} result={:?}",
        now_timestamp(),
        connection.settings.port_name,
        request.target_address,
        hex(&request.frame),
        rx_bytes
            .as_ref()
            .map(|bytes| hex(bytes))
            .unwrap_or_default(),
        elapsed_ms,
        status == ConfigurationWriteStatus::Timeout,
        status
    );
    Ok(write_result(status, message, telegrams))
}

fn classify_ack_response(
    response: Result<Vec<u8>, ScanReadError>,
    elapsed_ms: u128,
) -> (ConfigurationWriteStatus, String, Option<Vec<u8>>, String) {
    match response {
        Ok(bytes) if bytes == [0xe5] => (
            ConfigurationWriteStatus::Success,
            format!("ACK received in {elapsed_ms} ms"),
            Some(bytes),
            "ACK".to_string(),
        ),
        Ok(bytes) => (
            ConfigurationWriteStatus::NoAck,
            format!("Unexpected response instead of E5 ACK after {elapsed_ms} ms"),
            Some(bytes),
            "Unexpected response".to_string(),
        ),
        Err(ScanReadError::Timeout) => (
            ConfigurationWriteStatus::Timeout,
            format!("Timeout waiting for E5 ACK after {elapsed_ms} ms"),
            None,
            "Timeout".to_string(),
        ),
        Err(ScanReadError::Protocol(message)) | Err(ScanReadError::Io(message)) => (
            ConfigurationWriteStatus::ProtocolError,
            message.clone(),
            None,
            message,
        ),
    }
}

#[tauri::command]
pub fn preview_padpuls_m1_configuration(
    request: PadPulsWriteRequest,
) -> Result<TechnicalTelegram, String> {
    let frame = encode_padpuls_configuration_frame(&request)?;
    Ok(technical_telegram(
        "TX",
        "Pending configuration telegram",
        Some(request.current_address),
        Some(&request.secondary_id),
        &frame,
        Some("Preview only — not transmitted"),
    ))
}

#[tauri::command]
pub async fn write_padpuls_m1_configuration(
    state: State<'_, AppState>,
    request: PadPulsWriteRequest,
) -> Result<ConfigurationWriteResult, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || run_padpuls_write(&state, request))
        .await
        .map_err(|error| format!("PadPuls configuration task failed: {error}"))?
}

fn run_padpuls_write(
    state: &AppState,
    request: PadPulsWriteRequest,
) -> Result<ConfigurationWriteResult, String> {
    let frame = match encode_padpuls_configuration_frame(&request) {
        Ok(frame) => frame,
        Err(message) => {
            return Ok(write_result(
                ConfigurationWriteStatus::Rejected,
                message,
                Vec::new(),
            ))
        }
    };
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    let connection = guard
        .as_mut()
        .ok_or_else(|| "Serial port unavailable: connect first".to_string())?;
    let mut telegrams = Vec::new();
    if request.primary_address != request.current_address {
        let check_frame = encode_req_ud2(request.primary_address)?;
        telegrams.push(technical_telegram(
            "TX",
            "Check PadPuls target address",
            Some(request.primary_address),
            Some(&request.secondary_id),
            &check_frame,
            None,
        ));
        match read_primary_address(
            connection.port.as_mut(),
            request.primary_address,
            connection.settings.baud_rate,
        ) {
            Ok((device, _, response)) => {
                telegrams.push(technical_telegram(
                    "RX",
                    "PadPuls target address response",
                    Some(request.primary_address),
                    device.device.identification_number.as_deref(),
                    &response,
                    Some("Address already in use"),
                ));
                return Ok(write_result(
                    ConfigurationWriteStatus::AddressInUse,
                    "Address already in use".to_string(),
                    telegrams,
                ));
            }
            Err(ScanReadError::Timeout) => {}
            Err(error) => {
                return Ok(write_result(
                    ConfigurationWriteStatus::ProtocolError,
                    format!(
                        "Target address safety check failed: {}",
                        read_error_message(error)
                    ),
                    telegrams,
                ))
            }
        }
    }
    telegrams.push(technical_telegram(
        "TX",
        "PadPuls M1 complete configuration",
        Some(request.current_address),
        Some(&request.secondary_id),
        &frame,
        Some("Grouped PadPuls configuration"),
    ));
    let acknowledgement = match exchange(connection.port.as_mut(), &frame) {
        Ok(response) => response,
        Err(ScanReadError::Timeout) => {
            return Ok(write_result(
                ConfigurationWriteStatus::NoAck,
                "No ACK received for PadPuls configuration".to_string(),
                telegrams,
            ))
        }
        Err(error) => {
            return Ok(write_result(
                ConfigurationWriteStatus::ProtocolError,
                read_error_message(error),
                telegrams,
            ))
        }
    };
    let acknowledged = matches!(parse_frame(&acknowledgement), Ok(MbusFrame::Ack));
    telegrams.push(technical_telegram(
        "RX",
        "PadPuls configuration ACK",
        Some(request.current_address),
        Some(&request.secondary_id),
        &acknowledgement,
        Some(if acknowledged {
            "ACK"
        } else {
            "Non-ACK response"
        }),
    ));
    if !acknowledged {
        return Ok(write_result(
            ConfigurationWriteStatus::Rejected,
            "PadPuls response was not an ACK".to_string(),
            telegrams,
        ));
    }
    Ok(write_result(
        ConfigurationWriteStatus::Success,
        "PadPuls configuration acknowledged; read-back required".to_string(),
        telegrams,
    ))
}

fn run_primary_address_write(
    app: &AppHandle,
    state: &AppState,
    request: PrimaryAddressWriteRequest,
) -> Result<ConfigurationWriteResult, String> {
    if let Err(message) = validate_primary_address_write(&request) {
        return Ok(write_result(
            ConfigurationWriteStatus::Rejected,
            message,
            Vec::new(),
        ));
    }
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    let connection = guard
        .as_mut()
        .ok_or_else(|| "Serial port unavailable: connect first".to_string())?;
    let mut telegrams = Vec::new();
    let secondary_id = request.secondary_address.identification_number.clone();

    emit_log(
        app,
        "CONFIG",
        &format!("Checking target address {}", request.new_address),
        Some(request.new_address),
        None,
    );
    let collision_request = encode_req_ud2(request.new_address)?;
    telegrams.push(technical_telegram(
        "TX",
        "Check target address",
        Some(request.new_address),
        Some(&secondary_id),
        &collision_request,
        None,
    ));
    let target_check = read_primary_address(
        connection.port.as_mut(),
        request.new_address,
        connection.settings.baud_rate,
    );
    let target_state = match &target_check {
        Ok(_) => TargetAddressState::Occupied,
        Err(ScanReadError::Timeout) => TargetAddressState::Available,
        Err(_) => TargetAddressState::Uncertain,
    };
    if !target_address_write_allowed(target_state) {
        return match target_check {
            Ok((device, _, response)) => {
                telegrams.push(technical_telegram(
                    "RX",
                    "Target address response",
                    Some(request.new_address),
                    device.device.identification_number.as_deref(),
                    &response,
                    Some("Address already in use"),
                ));
                Ok(write_result(
                    ConfigurationWriteStatus::AddressInUse,
                    "Address already in use".to_string(),
                    telegrams,
                ))
            }
            Err(error) => Ok(write_result(
                ConfigurationWriteStatus::ProtocolError,
                format!(
                    "Target address safety check failed: {}",
                    read_error_message(error)
                ),
                telegrams,
            )),
        };
    }

    let _ = deselect_secondary(connection.port.as_mut());
    let mask = SecondaryAddressMask {
        identification_number: secondary_id.clone(),
        manufacturer: Some(request.secondary_address.manufacturer_raw),
        version: Some(request.secondary_address.version),
        medium: Some(request.secondary_address.medium),
    };
    let selection_data = mask.encode()?;
    let selection_frame = encode_secondary_selection(&selection_data);
    let selected_request = encode_selected_req_ud2();
    let probe = match probe_secondary_address(
        connection.port.as_mut(),
        &mask,
        connection.settings.baud_rate,
    ) {
        Ok(probe) => probe,
        Err(error) => {
            let _ = deselect_secondary(connection.port.as_mut());
            return Ok(write_result(
                ConfigurationWriteStatus::ProtocolError,
                read_error_message(error),
                telegrams,
            ));
        }
    };
    telegrams.push(technical_telegram(
        "TX",
        "Select exact secondary identity",
        Some(0xfd),
        Some(&secondary_id),
        &selection_frame,
        None,
    ));
    let selection_acknowledged = probe.acknowledgement.as_deref() == Some(&[0xe5]);
    if let Some(acknowledgement) = probe.acknowledgement.as_ref() {
        telegrams.push(technical_telegram(
            "RX",
            "Secondary selection ACK",
            Some(0xfd),
            Some(&secondary_id),
            acknowledgement,
            Some(if selection_acknowledged {
                "ACK"
            } else {
                "Non-ACK response"
            }),
        ));
    }
    if selection_acknowledged {
        telegrams.push(technical_telegram(
            "TX",
            "Read selected identity",
            Some(0xfd),
            Some(&secondary_id),
            &selected_request,
            None,
        ));
    }
    if let Some(response) = probe.response.as_ref() {
        telegrams.push(technical_telegram(
            "RX",
            "Selected identity response",
            Some(0xfd),
            Some(&secondary_id),
            response,
            Some("RSP_UD"),
        ));
    }
    let selected = match probe.kind {
        SecondaryProbeKind::NoDevice => {
            let _ = deselect_secondary(connection.port.as_mut());
            return Ok(write_result(
                ConfigurationWriteStatus::Timeout,
                "The expected secondary identity did not respond".to_string(),
                telegrams,
            ));
        }
        SecondaryProbeKind::Collision => {
            let _ = deselect_secondary(connection.port.as_mut());
            return Ok(write_result(
                ConfigurationWriteStatus::Rejected,
                "Secondary selection was ambiguous; write blocked".to_string(),
                telegrams,
            ));
        }
        SecondaryProbeKind::SingleDevice => probe.result,
    };
    let Some(selected) = selected else {
        let _ = deselect_secondary(connection.port.as_mut());
        return Ok(write_result(
            ConfigurationWriteStatus::ProtocolError,
            "Selected device response could not be decoded".to_string(),
            telegrams,
        ));
    };
    if !same_secondary_identity(&selected, &request) {
        let _ = deselect_secondary(connection.port.as_mut());
        return Ok(write_result(
            ConfigurationWriteStatus::Rejected,
            "Selected device identity does not match the requested device".to_string(),
            telegrams,
        ));
    }

    let write_frame = encode_snd_ud(0x73, 0xfd, 0x51, &[0x01, 0x7a, request.new_address])?;
    telegrams.push(technical_telegram(
        "TX",
        "SND_UD change primary address",
        Some(0xfd),
        Some(&secondary_id),
        &write_frame,
        Some(&format!(
            "Primary address {} → {}",
            request.current_address, request.new_address
        )),
    ));
    let acknowledgement = match exchange(connection.port.as_mut(), &write_frame) {
        Ok(response) => response,
        Err(ScanReadError::Timeout) => {
            let _ = deselect_secondary(connection.port.as_mut());
            return Ok(write_result(
                ConfigurationWriteStatus::NoAck,
                "No ACK received for the configuration write".to_string(),
                telegrams,
            ));
        }
        Err(error) => {
            let _ = deselect_secondary(connection.port.as_mut());
            return Ok(write_result(
                ConfigurationWriteStatus::ProtocolError,
                read_error_message(error),
                telegrams,
            ));
        }
    };
    let acknowledged = matches!(parse_frame(&acknowledgement), Ok(MbusFrame::Ack));
    telegrams.push(technical_telegram(
        "RX",
        "Configuration ACK",
        Some(0xfd),
        Some(&secondary_id),
        &acknowledgement,
        Some(if acknowledged {
            "ACK"
        } else {
            "Non-ACK response"
        }),
    ));
    let _ = deselect_secondary(connection.port.as_mut());
    if !acknowledged {
        return Ok(write_result(
            ConfigurationWriteStatus::Rejected,
            "Configuration response was not an ACK".to_string(),
            telegrams,
        ));
    }
    Ok(write_result(
        ConfigurationWriteStatus::Success,
        "Write acknowledged; read-back verification is required".to_string(),
        telegrams,
    ))
}

fn validate_primary_address_write(request: &PrimaryAddressWriteRequest) -> Result<(), String> {
    if request.current_address > 250 || request.new_address > 250 {
        return Err("Primary address must be between 0 and 250".to_string());
    }
    if request.current_address == request.new_address {
        return Err("New primary address is unchanged".to_string());
    }
    if request.secondary_address.identification_number.len() != 8
        || !request
            .secondary_address
            .identification_number
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return Err("A complete 8-digit secondary identity is required".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
enum TargetAddressState {
    Available,
    Occupied,
    Uncertain,
}

fn target_address_write_allowed(state: TargetAddressState) -> bool {
    matches!(state, TargetAddressState::Available)
}

fn same_secondary_identity(
    result: &DeviceReadResult,
    request: &PrimaryAddressWriteRequest,
) -> bool {
    result
        .device
        .secondary_address
        .as_ref()
        .map(|identity| {
            identity.identification_number == request.secondary_address.identification_number
                && identity.manufacturer_raw == request.secondary_address.manufacturer_raw
                && identity.version == request.secondary_address.version
                && identity.medium == request.secondary_address.medium
        })
        .unwrap_or(false)
}

fn technical_telegram(
    direction: &str,
    operation: &str,
    primary_address: Option<u8>,
    secondary_id: Option<&str>,
    bytes: &[u8],
    parsed_result: Option<&str>,
) -> TechnicalTelegram {
    TechnicalTelegram {
        timestamp: now_timestamp(),
        direction: direction.to_string(),
        operation: operation.to_string(),
        primary_address,
        secondary_id: secondary_id.map(str::to_string),
        raw_telegram: hex(bytes),
        parsed_result: parsed_result.map(str::to_string),
    }
}

fn write_result(
    status: ConfigurationWriteStatus,
    message: String,
    telegrams: Vec<TechnicalTelegram>,
) -> ConfigurationWriteResult {
    ConfigurationWriteResult {
        status,
        message,
        telegrams,
    }
}

fn run_primary_scan(
    app: &AppHandle,
    state: &AppState,
    options: ScanOptions,
) -> Result<Vec<DeviceReadResult>, String> {
    state.cancel_scan.store(false, Ordering::SeqCst);
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    let connection = guard
        .as_mut()
        .ok_or_else(|| "Serial port unavailable: connect first".to_string())?;
    let mut devices = Vec::new();
    emit_log(app, "PRIMARY", "Primary address scan started", None, None);

    for address in options.start_address..=options.end_address {
        if state.cancel_scan.load(Ordering::SeqCst) {
            emit_progress(app, &options, address, devices.len(), "stopped");
            emit_log(app, "PRIMARY", "Scan stopped", None, None);
            return Ok(devices);
        }
        emit_progress(app, &options, address, devices.len(), "scanning");
        emit_tx(app, address);
        match read_primary_address(
            connection.port.as_mut(),
            address,
            connection.settings.baud_rate,
        ) {
            Ok((result, _, response)) => {
                emit_log(
                    app,
                    "RX",
                    "M-Bus response received",
                    Some(address),
                    Some(hex(&response)),
                );
                emit_log(app, "PRIMARY", "Device detected", Some(address), None);
                let _ = app.emit("mbus://device-found", &result);
                devices.push(result);
            }
            Err(ScanReadError::Timeout) => {}
            Err(error) => {
                let message = read_error_message(error);
                emit_log(app, "ERROR", &message, Some(address), None);
            }
        }
    }
    emit_progress(
        app,
        &options,
        options.end_address,
        devices.len(),
        "completed",
    );
    emit_log(app, "PRIMARY", "Primary address scan completed", None, None);
    Ok(devices)
}

fn validate_scan_options(options: &ScanOptions) -> Result<(), String> {
    if options.end_address > 250 {
        return Err("Primary scan addresses must be between 0 and 250".to_string());
    }
    if options.start_address > options.end_address {
        return Err("Start address must not be greater than end address".to_string());
    }
    Ok(())
}

fn run_secondary_scan(app: &AppHandle, state: &AppState) -> Result<Vec<DeviceReadResult>, String> {
    state.cancel_scan.store(false, Ordering::SeqCst);
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    let connection = guard
        .as_mut()
        .ok_or_else(|| "Serial port unavailable: connect first".to_string())?;
    let mut devices = Vec::new();
    let mut masks = VecDeque::from(initial_masks());
    emit_log(app, "SECONDARY", "Quick scan started", None, None);
    if let Ok(frame) = deselect_secondary(connection.port.as_mut()) {
        emit_log(
            app,
            "TX",
            "Reset secondary selection",
            Some(0xfd),
            Some(hex(&frame)),
        );
    }

    while let Some(mask) = masks.pop_front() {
        if state.cancel_scan.load(Ordering::SeqCst) {
            emit_secondary_progress(app, &mask.identification_number, devices.len(), "stopped");
            emit_log(app, "SECONDARY", "Quick scan stopped", None, None);
            let _ = deselect_secondary(connection.port.as_mut());
            return Ok(deduplicate_devices(devices));
        }
        emit_secondary_progress(app, &mask.identification_number, devices.len(), "searching");
        emit_log(
            app,
            "SECONDARY",
            &format!("Searching {}", mask.identification_number),
            None,
            None,
        );
        if let Ok(data) = mask.encode() {
            emit_log(
                app,
                "TX",
                "Secondary selection",
                Some(0xfd),
                Some(hex(&encode_secondary_selection(&data))),
            );
        }
        let probe = probe_secondary_address(
            connection.port.as_mut(),
            &mask,
            connection.settings.baud_rate,
        )
        .map_err(read_error_message)?;
        if let Some(acknowledgement) = probe.acknowledgement.as_ref() {
            emit_log(
                app,
                "RX",
                "Secondary selection ACK",
                Some(0xfd),
                Some(hex(acknowledgement)),
            );
        }
        match probe.kind {
            SecondaryProbeKind::NoDevice => {}
            SecondaryProbeKind::SingleDevice => {
                let response_address = probe.response_address;
                emit_log(
                    app,
                    "TX",
                    "REQ_UD2 selected slave",
                    Some(0xfd),
                    Some(hex(&encode_selected_req_ud2())),
                );
                if let Some(response) = probe.response.as_ref() {
                    emit_log(
                        app,
                        "RX",
                        &secondary_response_message(response_address),
                        response_address,
                        Some(hex(response)),
                    );
                }
                if let Some(mut result) = probe.result {
                    resolve_secondary_primary_address(
                        app,
                        connection.port.as_mut(),
                        connection.settings.baud_rate,
                        &mut result,
                        response_address,
                    );
                    let identification = result
                        .device
                        .identification_number
                        .as_deref()
                        .unwrap_or("unknown");
                    emit_log(
                        app,
                        "SECONDARY",
                        &format!("Device found: {identification}"),
                        None,
                        None,
                    );
                    let _ = app.emit("mbus://device-found", &result);
                    devices.push(result);
                    devices = deduplicate_devices(devices);
                }
            }
            SecondaryProbeKind::Collision => {
                emit_log(
                    app,
                    "COLLISION",
                    &format!(
                        "Branch {}{}",
                        mask.identification_number,
                        probe
                            .diagnostic
                            .as_deref()
                            .map(|message| format!(" · {message}"))
                            .unwrap_or_default()
                    ),
                    None,
                    probe.response.as_ref().map(|bytes| hex(bytes)),
                );
                if mask.is_exact() {
                    emit_log(
                        app,
                        "ERROR",
                        "Multiple devices share the same secondary identification",
                        None,
                        None,
                    );
                } else {
                    for child in refine_mask(&mask).into_iter().rev() {
                        masks.push_front(child);
                    }
                }
            }
        }
    }
    let _ = deselect_secondary(connection.port.as_mut());
    emit_secondary_progress(app, "", devices.len(), "completed");
    emit_log(app, "SECONDARY", "Quick scan completed", None, None);
    Ok(deduplicate_devices(devices))
}

fn read_known_secondary(
    app: &AppHandle,
    state: &AppState,
    mask: &SecondaryAddressMask,
) -> Result<DeviceReadResult, String> {
    let mut guard = state
        .connection
        .lock()
        .map_err(|_| "Serial connection state is unavailable".to_string())?;
    let connection = guard
        .as_mut()
        .ok_or_else(|| "Serial port unavailable: connect first".to_string())?;
    let _ = deselect_secondary(connection.port.as_mut());
    emit_log(
        app,
        "SECONDARY",
        &format!("Reading known ID {}", mask.identification_number),
        None,
        None,
    );
    if let Ok(data) = mask.encode() {
        emit_log(
            app,
            "TX",
            "Secondary selection",
            Some(0xfd),
            Some(hex(&encode_secondary_selection(&data))),
        );
    }
    let probe = probe_secondary_address(
        connection.port.as_mut(),
        mask,
        connection.settings.baud_rate,
    )
    .map_err(read_error_message)?;
    if let Some(acknowledgement) = probe.acknowledgement.as_ref() {
        emit_log(
            app,
            "RX",
            "Secondary selection ACK",
            Some(0xfd),
            Some(hex(acknowledgement)),
        );
    }
    let _ = deselect_secondary(connection.port.as_mut());
    match probe.kind {
        SecondaryProbeKind::NoDevice => Err(format!(
            "No device responded for secondary ID {}",
            mask.identification_number
        )),
        SecondaryProbeKind::Collision => Err(format!(
            "Collision: multiple devices match secondary ID {}",
            mask.identification_number
        )),
        SecondaryProbeKind::SingleDevice => {
            let response_address = probe.response_address;
            emit_log(
                app,
                "TX",
                "REQ_UD2 selected slave",
                Some(0xfd),
                Some(hex(&encode_selected_req_ud2())),
            );
            if let Some(response) = probe.response.as_ref() {
                emit_log(
                    app,
                    "RX",
                    &secondary_response_message(response_address),
                    response_address,
                    Some(hex(response)),
                );
            }
            let mut result = probe
                .result
                .ok_or_else(|| "Secondary response did not contain device data".to_string())?;
            resolve_secondary_primary_address(
                app,
                connection.port.as_mut(),
                connection.settings.baud_rate,
                &mut result,
                response_address,
            );
            emit_log(
                app,
                "SECONDARY",
                &format!("Device found: {}", mask.identification_number),
                None,
                None,
            );
            Ok(result)
        }
    }
}

fn secondary_response_message(address: Option<u8>) -> String {
    address
        .map(|address| format!("Secondary response (A=0x{address:02X})"))
        .unwrap_or_else(|| "Secondary response (A unavailable)".to_string())
}

fn resolve_secondary_primary_address(
    app: &AppHandle,
    port: &mut dyn SerialPort,
    baud_rate: u32,
    result: &mut DeviceReadResult,
    response_address: Option<u8>,
) {
    let decoded_address = result.device.primary_address;
    retain_explicit_primary_address(result);
    if let Some(address) = result.device.primary_address {
        set_confirmed_primary_address(result, address);
        emit_log(
            app,
            "SECONDARY",
            "Primary address decoded explicitly from device data",
            Some(address),
            None,
        );
        return;
    }

    let candidate = primary_address_candidate(response_address, decoded_address);
    let Some(candidate) = candidate else {
        emit_log(
            app,
            "SECONDARY",
            "Primary address remains unknown: response did not provide a valid candidate",
            None,
            None,
        );
        return;
    };

    emit_log(
        app,
        "VERIFY",
        "Verifying primary address candidate from secondary response",
        Some(candidate),
        None,
    );
    emit_tx(app, candidate);
    match read_primary_address(port, candidate, baud_rate) {
        Ok((verified, _, response)) => {
            emit_log(
                app,
                "RX",
                "Targeted primary verification response",
                Some(candidate),
                Some(hex(&response)),
            );
            if confirmed_candidate_address(candidate, &result.device, &verified.device).is_some() {
                set_confirmed_primary_address(result, candidate);
                emit_log(
                    app,
                    "VERIFY",
                    "Primary address confirmed by complete secondary identity",
                    Some(candidate),
                    None,
                );
            } else {
                emit_log(
                    app,
                    "VERIFY",
                    "Primary address candidate rejected: secondary identity differs",
                    Some(candidate),
                    None,
                );
            }
        }
        Err(error) => emit_log(
            app,
            "VERIFY",
            &format!(
                "Primary address candidate could not be confirmed: {}",
                read_error_message(error)
            ),
            Some(candidate),
            None,
        ),
    }

    if result.device.primary_address.is_none() {
        emit_log(
            app,
            "SECONDARY",
            "Primary address remains unknown",
            None,
            None,
        );
    }
}

fn emit_secondary_progress(app: &AppHandle, mask: &str, count: usize, state: &str) {
    let _ = app.emit(
        "mbus://secondary-progress",
        SecondaryScanProgress {
            mask: mask.to_string(),
            devices_found: count,
            state: state.to_string(),
        },
    );
}

#[cfg(test)]
mod tests {
    use super::{
        classify_ack_response, target_address_write_allowed, validate_primary_address_write,
        validate_scan_options, TargetAddressState,
    };
    use crate::mbus::models::SecondaryAddressWriteIdentity;
    use crate::mbus::{ConfigurationWriteStatus, ScanReadError};
    use crate::mbus::{PrimaryAddressWriteRequest, ScanOptions};

    #[test]
    fn accepts_primary_address_zero_only() {
        assert!(validate_scan_options(&ScanOptions {
            start_address: 0,
            end_address: 0
        })
        .is_ok());
    }

    #[test]
    fn accepts_full_normal_primary_range() {
        assert!(validate_scan_options(&ScanOptions {
            start_address: 0,
            end_address: 250
        })
        .is_ok());
    }

    #[test]
    fn rejects_reserved_or_reversed_primary_ranges() {
        assert!(validate_scan_options(&ScanOptions {
            start_address: 0,
            end_address: 251
        })
        .is_err());
        assert!(validate_scan_options(&ScanOptions {
            start_address: 10,
            end_address: 9
        })
        .is_err());
    }

    #[test]
    fn validates_primary_address_changes() {
        assert!(validate_primary_address_write(&write_request(2, 12)).is_ok());
        assert!(validate_primary_address_write(&write_request(2, 251)).is_err());
        assert!(validate_primary_address_write(&write_request(2, 2)).is_err());
    }

    #[test]
    fn requires_a_complete_secondary_identity_before_writing() {
        let mut request = write_request(2, 12);
        request.secondary_address.identification_number = "2207FFFF".to_string();
        assert!(validate_primary_address_write(&request).is_err());
    }

    #[test]
    fn allows_writing_only_when_the_target_address_is_confirmed_available() {
        assert!(target_address_write_allowed(TargetAddressState::Available));
        assert!(!target_address_write_allowed(TargetAddressState::Occupied));
        assert!(!target_address_write_allowed(TargetAddressState::Uncertain));
    }

    #[test]
    fn accepts_only_e5_as_write_acknowledgement() {
        assert_eq!(
            classify_ack_response(Ok(vec![0xe5]), 12).0,
            ConfigurationWriteStatus::Success
        );
        assert_eq!(
            classify_ack_response(Ok(vec![0x68, 0x00]), 12).0,
            ConfigurationWriteStatus::NoAck
        );
    }

    #[test]
    fn reports_ack_timeout_without_simulating_success() {
        assert_eq!(
            classify_ack_response(Err(ScanReadError::Timeout), 800).0,
            ConfigurationWriteStatus::Timeout
        );
    }

    fn write_request(current_address: u8, new_address: u8) -> PrimaryAddressWriteRequest {
        PrimaryAddressWriteRequest {
            current_address,
            new_address,
            secondary_address: SecondaryAddressWriteIdentity {
                identification_number: "22075482".to_string(),
                manufacturer_raw: 0x48ac,
                version: 9,
                medium: 1,
            },
        }
    }
}

fn emit_progress(app: &AppHandle, options: &ScanOptions, address: u8, count: usize, state: &str) {
    let _ = app.emit(
        "mbus://scan-progress",
        ScanProgress {
            current_address: address,
            start_address: options.start_address,
            end_address: options.end_address,
            devices_found: count,
            state: state.to_string(),
        },
    );
}

fn emit_tx(app: &AppHandle, address: u8) {
    let request_hex = encode_req_ud2(address).ok().map(|bytes| hex(&bytes));
    emit_log(app, "TX", "REQ_UD2", Some(address), request_hex);
}

fn emit_log(
    app: &AppHandle,
    level: &str,
    message: &str,
    address: Option<u8>,
    frame_hex: Option<String>,
) {
    let _ = app.emit(
        "mbus://log",
        CommunicationLogEntry {
            timestamp: now_timestamp(),
            level: level.to_string(),
            message: message.to_string(),
            address,
            hex: frame_hex,
        },
    );
}

fn read_error_message(error: ScanReadError) -> String {
    match error {
        ScanReadError::Timeout => "Timeout".to_string(),
        ScanReadError::Protocol(message) | ScanReadError::Io(message) => message,
    }
}
