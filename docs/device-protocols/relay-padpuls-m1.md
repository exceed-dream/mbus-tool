# Relay PadPuls M1

## Identification

- Manufacturer: Relay (`REL`, raw M-Bus manufacturer value `0x48AC`)
- Generation/version: `0x09`
- Exact telegram signature: fixed data header followed by `DIF 06`, one VIF byte, six count bytes with `Count6 = 00`, then `0F 01 <numerator> <denominator>`
- Application profile ID: `RELAY_PADPULS_M1`

Manufacturer alone is treated only as a possible match. Automatic activation requires all of the criteria above. A manually selected possible profile is still validated against the exact response structure when the configuration is read.

## Documented configuration

The PadPuls M1 manual version 1.4 applies to generation `0x09`. Its grouped configuration is sent in one long `SND_UD` frame:

- `C = 0x53`, current primary address, `CI = 0x51`
- payload: `01 7A Adr 07 79 ID1 ID2 ID3 ID4 Man1 Man2 Gen Med 06 VIF Count1 Count2 Count3 Count4 Count5 Count6 0F 01 Num Den`
- secondary ID: four reverse-order packed-BCD bytes, preserving leading zeroes
- counter: five effective little-endian bytes; `Count6` is always zero
- multiplicator: numerator and non-zero denominator, each one byte
- acknowledgement: exact M-Bus ACK `E5`
- verification: read the device at its requested new primary address and compare every configuration field

The implementation sends the complete documented group whenever any bus-backed field changes. It does not emit partial manufacturer telegrams. Before a primary-address change it probes the target address and refuses the write if a device responds. Direct connection to a single PadPuls is recommended for configuration.

Engineering diagnostics can preview the pending long frame without opening or writing to the serial port. Preview and real write both call the same `encode_configuration_frame` function; only the confirmed write path performs address probing and serial exchange.

Write protection is status-byte bit 7. When active, configuration writes are rejected without transmitting a write telegram.

`Fabric. no.` has no encoding in this documented telegram. It is deliberately stored as local application metadata and labelled as such.

## Unit and medium mappings

The Medium byte is the standard fixed-data-header medium value. The real telegram contains `0x01`, which maps to `Oil`; the existing display is therefore correct.

PadPuls stores a standard primary VIF. Relevant installer choices use the standard ranges for energy (Wh/J), volume, and mass. For example, `VIF 0x13` means `10^-3 m³`, i.e. `1 L`. The effective pulse value shown in the UI is `(numerator / denominator) × VIF scale`.

## Evidence

- Relay PadPuls M1/M2 user manual, version 1.4: <https://service.relay.de/media/manuals/IM001G_E.pdf>
- Standard M-Bus primary VIF table: <https://m-bus.com/documentation-wired/08-appendix>
- Validated real response used by the parser regression test: `68 1B 1B 68 08 02 72 82 54 07 22 AC 48 09 01 39 00 00 00 06 13 0F 00 00 00 00 00 0F 01 01 0A F5 16`
