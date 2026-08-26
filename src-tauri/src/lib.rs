mod commands;
mod mbus;
mod serial;

use commands::{
    connect_serial, disconnect_serial, list_serial_ports, preview_padpuls_m1_configuration,
    read_mbus_by_secondary_id, read_mbus_device, scan_primary, scan_secondary,
    send_mbus_frame_wait_for_ack, stop_scan, write_padpuls_m1_configuration, write_primary_address,
    AppState,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_serial_ports,
            connect_serial,
            disconnect_serial,
            scan_primary,
            scan_secondary,
            stop_scan,
            read_mbus_device,
            read_mbus_by_secondary_id,
            preview_padpuls_m1_configuration,
            write_primary_address,
            send_mbus_frame_wait_for_ack,
            write_padpuls_m1_configuration
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
