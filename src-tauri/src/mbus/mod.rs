mod checksum;
mod client;
mod frame;
pub(crate) mod models;
mod padpuls;
mod parser;
mod secondary;

pub(crate) use client::exchange;
pub use client::{
    deselect_secondary, probe_secondary_address, read_primary_address, ScanReadError,
};
pub use frame::{
    encode_req_ud2, encode_secondary_selection, encode_selected_req_ud2, encode_snd_ud,
};
pub use frame::{parse as parse_frame, MbusFrame};
pub use models::{hex, now_timestamp};
pub use models::{
    CommunicationLogEntry, ConfigurationWriteResult, ConfigurationWriteStatus, DeviceReadResult,
    ManufacturerFrameWriteRequest, PadPulsWriteRequest, PrimaryAddressWriteRequest, ScanOptions,
    ScanProgress, SecondaryScanProgress, TechnicalTelegram,
};
pub use padpuls::encode_configuration_frame as encode_padpuls_configuration_frame;
pub use secondary::{
    deduplicate_devices, initial_masks, refine_mask, SecondaryAddressMask, SecondaryProbeKind,
};
