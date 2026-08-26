# Device protocol evidence

Manufacturer-specific configuration must not be implemented from assumptions. Create one document per manufacturer/model and keep every operation `NOT_IMPLEMENTED` until its encoding and verification are supported by reliable evidence.

Accepted evidence:

- a current M-Bus standard or reliable protocol documentation;
- manufacturer documentation;
- captured telegrams from the manufacturer's tool;
- data supplied explicitly to this project.

## Capture procedure

1. Record the device identity and all current values before changing anything.
2. Capture every TX and RX telegram while changing exactly one parameter.
3. Read the device again with the same tool and capture the verification traffic.
4. Repeat with at least two distinct values to separate constants from encoded values.
5. Mark hypotheses as unconfirmed until repeatable captures establish them.

Do not include credentials, customer data, or unrelated serial traffic.

## Protocol note template

```text
Manufacturer:
Model:
Hardware / firmware revision:
Software reference and version:
Operation:
Evidence source:

Current value:
Requested value:

TX telegram(s):
RX telegram(s):

Decoded fields:
Unknown bytes:
Checksum / framing:
Hypothesis:
Confidence: Confirmed / Unconfirmed

Read procedure:
Write procedure:
Expected acknowledgement:
Verification procedure:
Failure behaviour:
Safety constraints:
```

## Adapter implementation checklist

- Add precise matching criteria to `DeviceProfile` (manufacturer plus version, medium, identification pattern, or other confirmed discriminator).
- Define installer fields with independent `readSupport`, `writeSupport`, and `verificationSupport` values.
- Implement protocol semantics in a `DeviceProtocolAdapter`; never construct frames in React.
- Keep generic long-frame encoding separate from parameter-specific payload construction.
- Return an explicit write status and preserve all TX/RX telegrams.
- Require ACK or the documented response, then read back and compare both values and secondary identity.
- Add deterministic tests using recorded/synthetic telegrams. Never require connected hardware in automated tests.

## Current documented standard operation

Primary-address assignment uses a mode-1 `SND_UD` (`CI = 0x51`) with the record `DIF = 0x01`, `VIF = 0x7A`, followed by the new one-byte address. The implementation additionally selects the exact secondary identity before writing, blocks occupied target addresses, requires `E5`, and performs read-back verification.

Reference: <https://m-bus.com/documentation-wired/06-application-layer#64-configuring-slaves>

Manufacturer-specific meter index, pulse weight, and similar operations remain `NOT_IMPLEMENTED` until evidence is added here.

## Documented manufacturer profiles

- [Relay PadPuls M1](relay-padpuls-m1.md): exact generation `0x09` identification, grouped read/write codec, ACK handling, write protection, and full read-back verification.
- [ACW gas meter](acw-read-only.md): validated read values, standard status interpretation, fabrication number, and safe handling of an incomplete plain-text VIF record. Configuration remains unsupported.
- [Itron Cyble M-Bus V2](itron-cyble-mbus-v2.md): multi-criterion identification, real Water/Cold Water fixtures, exact local volume encoding preparation, and explicit unsupported write behaviour.
