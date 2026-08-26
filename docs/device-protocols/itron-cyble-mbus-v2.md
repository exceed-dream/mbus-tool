# Itron Cyble M-Bus V2

## Identification

Confirmed automatic identification requires all of the following observed criteria:

- fixed-header manufacturer `ACW`, raw `0x0477`;
- version `20` (`0x14`);
- a decoded standard fabrication-number record (`DIF 0C`, `VIF 78`);
- a variable-length plain-text VIF whose description is `cust. ID` and whose value is numeric;
- an instantaneous 32-bit volume record using a confirmed normal Pulse-weight VIF in `0x10..0x17`.

The application protocol hint is `ITRON_CYBLE_MBUS_V2` and the profile ID is `itron-cyble-mbus-v2`. Manufacturer and version alone are deliberately only a possible match; they do not identify every ACW device as Cyble. A user can select the possible profile manually, in which case unavailable manufacturer fields remain visibly unavailable.

## Confirmed from real reads

The supplied real telegrams confirm:

- primary and eight-digit secondary addresses come from the M-Bus link/fixed header;
- `0C 78` contains the fabrication number;
- the reversed mode-1 description bytes decode to `cust. ID`; its fixed 10-byte value is ASCII decoded in transmission order and only leading/trailing space padding is removed, without discarding the raw record;
- Medium uses the standard fixed-header value (`0x07` Water, `0x16` Cold water; the earlier ACW fixture uses `0x03` Gas);
- the complete normal Pulse-weight resolution range `0x10..0x17` is confirmed by material captures: `0.000001`, `0.00001`, `0.0001`, `0.001`, `0.01`, `0.1`, `1` and `10 m³/p` respectively;
- `VIF 0x14` has resolution `0.01 m³`; raw `600` displays as `6 m³` and corresponds to `10 l/p`;
- `VIF 0x13` has resolution `0.001 m³`; raw `12345678` displays as `12345.678 m³` and corresponds to `1 l/p`.
- Secondary address and fabrication number are independent: changing the observed secondary address from `17017648` to `17017649` left fabrication number `17017648` unchanged.
- the real value bytes `20 20 20 20 36 35 34 33 32 33` decode exactly to Customer ID `654323`, never `323456`; Customer ID is neither BCD nor a reversed integer.

The Date and Time record is preserved but not exposed as decoded configuration until its exact standard representation is implemented. Alarm reset is represented as an unavailable device action.

Gas-only settings use effective Boolean defaults of `false` when no decoded value exists, so selecting Gas never requires an artificial user choice. These defaults are not presented as device read-back:

- `Corrected Volume` defaults to `false`. It indicates whether the represented gas volume is corrected to reference temperature and pressure conditions; it is an informational characteristic of the volume and does not imply that Cyble performs the correction.
- `Pulse weight ×10` defaults to `false`. It remains a separate manufacturer-specific Gas option; its exact semantic effect is not yet documented or confirmed.

The controls are hidden outside Gas and reset effectively to `false` when leaving Gas. Only confirmed command combinations remain writable. Because current telegrams do not decode these flags, verification reports their read-back as unavailable rather than marking them verified.

## Local preparation rules

Volume input accepts `.` or `,`, no sign, at most six decimal places, and at most eight digits in total. The local rule prefers the observed `0.01 m³` resolution when it fits in eight raw digits, then reduces precision only as needed for large integer parts; explicit decimal places are always preserved. It selects the matching standard volume resolution (`VIF = 0x16 - decimal places`) down to `10^-6 m³`. Scaling uses decimal strings and an integer, not floating-point arithmetic. The derived integer raw value must be exact and no greater than eight digits. The complete `0x10..0x17` mapping is confirmed for normal Pulse-weight selection and read-back; Volume-value preparation outside the captured `0x13`/`0x14` writes remains inferred from the Field Tool's accepted eight-digit inputs.

Examples:

- `6` → resolution `0.01 m³`, `VIF 0x14`, raw `600`, pulse weight `10 l/p`;
- `12345.678` → resolution `0.001 m³`, `VIF 0x13`, raw `12345678`, pulse weight `1 l/p`.

Changing Medium is flagged as risky because it changes interpretation of the fixed-header medium and may be incompatible with the connected meter.

## CONFIRMED — real writes

The profile now implements only the supplied, byte-for-byte confirmed operations:

- the observed `A6` refresh command;
- Primary Address through the existing standard M-Bus workflow;
- Secondary Address `17017649 → 17017543`: `68 09 09 68 53 05 51 0C 79 43 75 01 17 FE 16`;
- numeric Customer ID (`A9 01 01`), right-aligned in a fixed ten-byte ASCII field with left space padding and ten trailing NUL bytes; read-back preserves transmission order;
- Medium uses `A9 01 0A <medium>` for the profile destinations Water (`0x07`), Gas (`0x03`), Cold Water (`0x16`), Hot Water (`0x06`) and Other (`0x00`); the captured Cold Water fixture remains `68 06 06 68 53 05 A9 01 0A 16 22 16`;
- Volume `400.00 m³`, raw `40000`, VIF `0x14`: `68 0B 0B 68 53 05 A9 02 06 00 40 9C 00 00 14 F9 16`;
- normal Pulse weight uses `A9 01 00 <resolutionCode>` with the fully confirmed mapping `0.000001 → 0x10`, `0.00001 → 0x11`, `0.0001 → 0x12`, `0.001 → 0x13`, `0.01 → 0x14`, `0.1 → 0x15`, `1 → 0x16`, `10 → 0x17`; the captured address-6 frames remain `68 06 06 68 53 06 A9 01 00 13 16 16` for `0.001` and `68 06 06 68 53 06 A9 01 00 15 18 16` for `0.1`;
- remove ×10;
- Corrected Volume with ×10 enabled;
- the longer transition to Gas with ×10 enabled and Corrected Volume disabled;

Every long frame is built from control/address/CI/data, with dynamic length and checksum. Fixture addresses are never embedded by a command builder. Volume and normal Pulse weight share one resolution mapping. A Volume change derives its Pulse weight; an explicit coherent Volume/Pulse-weight pair produces no redundant Pulse-weight command, while an inconsistent pair is rejected before transmission. Production writes require an actual `E5` response. A Cyble configuration batch performs one confirmed TOTAL unlock before the deterministic order Medium/Gas, Volume, Pulse weight, Customer ID, Secondary Address, then Primary Address. Read-back verifies the requested resolution as well as the other requested values.

## Confirmed unlock algorithm from Itron Field Tool implementation

Before `WriteConfig`, the Field Tool sends an information request (`CI A6`) to the current Primary Address. mbus-tool retains the complete plaintext M-Bus response exactly as received from the serial transport. In that full long-frame representation, Itron `DecryptedFrame[26..31]` maps to raw-frame indices `26..31`, or long-frame data offsets `19..24`; frame structure, length, address and checksum are validated before those six seed bytes are accepted.

For the WriteConfig TOTAL unlock, the seed bytes `d0 d1 d2 d3 d4 d5` are processed as `d2 d3 d4 d5 d0 d1`. The CRC starts at `0xFFFF`, uses polynomial `0x78E4`, and is masked to unsigned 16-bit arithmetic after every shift. The Field Tool also defines PARTIAL polynomial `0x4E87`, but mbus-tool does not select it for configuration writes.

The resulting TOTAL CRC is placed little-endian in `CI A5` data `80 00 CRC_LO CRC_HI`. An exact `E5` response is mandatory. Thus the confirmed preparation sequence is:

`A6 → six-byte seed → reorder 2,3,4,5,0,1 → CRC TOTAL 0x78E4 → A5 80 00 LO HI → E5 → configuration writes`

Any A6 timeout/malformed response, unavailable seed, checksum error, A5 timeout, or non-`E5` A5 response aborts the batch before a configuration command is sent. Engineering diagnostics retain the A6 exchange, seed, TOTAL CRC and A5 exchange.

## INFERRED

The Field Tool Volume input policy (up to eight digits, `.` or `,`) and Volume-write VIF selection outside the captured `0x13`/`0x14` cases remain derived from observed accepted inputs. The normal Pulse-weight mapping `0x10..0x17` itself is confirmed. A non-zero fourth raw-volume value byte has no confirmed write capture and is blocked.

## UNKNOWN — blocked

Date/Time, alarm reset, non-numeric Customer ID characters, Medium values outside the Cyble profile capability list and unobserved Gas combinations remain blocked. Gas flags are not yet decoded from read-back telegrams, so an acknowledged Gas write can still finish with verification failure rather than report unverified success.

## Regression fixtures

Automated parser tests preserve the supplied real telegram bytes and decode their Customer ID text in transmission order. Dedicated material fixtures cover `654323`, `334799` and `997433`, including the exact ten-byte left-space-padded values. No Gas telegram absent from the supplied material was invented.
