/**
 * FIFINE D6 report parsing — confirmed against a real unit (see
 * ../README.md "Hardware notes"). Every input report on the vendor-defined
 * interface (usagePage 0xFFA0) has this fixed shape:
 *
 *   bytes 0-8:  "ACK\0\0OK\0\0" (9-byte constant preamble)
 *   byte 9:     key code (1..buttonCount) — stable per physical button,
 *               but NOT cleared to 0 when the key is released, so it must
 *               never be read on its own
 *   byte 10:    state flag — 1 while the key is held, 0 once released
 *   bytes 11+:  always zero in every capture so far
 *
 * Only one key appears encodable per report (no rollover bitmask for
 * multiple simultaneous keys) — the Set-based API below still fits, it'll
 * just ever contain 0 or 1 entries for this device.
 *
 * Everything here is pure/synchronous specifically so it can be unit tested
 * without a physical device (specs.md #26, Rule 7).
 */

/** Offset of the key-code byte; see the report layout above. */
export const REPORT_CODE_OFFSET = 9;
/** Offset of the press(1)/release(0) flag byte. */
export const REPORT_STATE_OFFSET = 10;

export interface ButtonDiff {
  pressed: number[];
  released: number[];
}

/** Minimal shape we need from node-hid's Device for id computation (kept here so this stays hardware-free/testable). */
export interface HidIdentity {
  vendorId: number;
  productId: number;
  serialNumber?: string;
  path?: string;
  interface: number;
}

/**
 * A single physical macro pad exposes multiple HID interfaces (e.g. one
 * vendor-defined for button/image data, one generic-desktop that's
 * unused) which typically share the same USB serial number. The id MUST
 * stay stable across reconnects (specs.md #12 "Stable IDs") but also
 * distinguish sibling interfaces of the same device — using the interface
 * number (assigned by the device's own USB descriptor, not the OS) gets
 * both properties, unlike falling back to `path`, which the OS can
 * reassign on replug.
 */
export function computeDeviceId(hidInfo: HidIdentity): string {
  const base = hidInfo.serialNumber ?? `${hidInfo.vendorId}-${hidInfo.productId}`;
  return `fifine-d6-${base}-if${hidInfo.interface}`;
}

/** Maps raw HID keycodes 1..N to zero-based button positions 0..N-1. */
export function defaultKeycodeMap(buttonCount: number): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 1; i <= buttonCount; i++) map.set(i, i - 1);
  return map;
}

/**
 * Parses one input report into the set of currently pressed button
 * positions. Reads only the two meaningful bytes (code + state flag) —
 * NOT a full-buffer scan — because the code byte keeps its last value after
 * release instead of resetting to 0, which previously caused a spurious
 * "stuck" press on whichever position code 1 maps to.
 */
export function parseInputReport(
  data: Uint8Array,
  keycodeToPosition: Map<number, number>,
): Set<number> {
  const pressed = new Set<number>();
  const isPressed = data[REPORT_STATE_OFFSET] === 1;
  if (!isPressed) return pressed;

  const code = data[REPORT_CODE_OFFSET];
  const position = code === undefined ? undefined : keycodeToPosition.get(code);
  if (position !== undefined) pressed.add(position);
  return pressed;
}

export function diffButtonStates(previous: Set<number>, current: Set<number>): ButtonDiff {
  return {
    pressed: [...current].filter((p) => !previous.has(p)),
    released: [...previous].filter((p) => !current.has(p)),
  };
}

/**
 * The image (write) side uses different key numbering than button presses
 * (read side) — confirmed via a real USB capture of FIFINE's own official
 * software (Wireshark + USBPcap): setting an icon on the first physical
 * button sent a BAT header with key byte `0x0b` (11), i.e. 0-based key 10,
 * not key 0. That single ground-truth point matches this table exactly
 * (`DEFAULT_IMAGE_KEY_MAP[0] === 10`), which was otherwise obtained by
 * empirical black-box testing — see ../README.md "Image output" for the
 * full story, including two earlier, ultimately-wrong theories (a constant
 * offset, then "the key byte is ignored and only arrival order matters")
 * that black-box testing alone could not distinguish from this one.
 */
export const DEFAULT_IMAGE_KEY_MAP: readonly number[] = [
  10, 11, 12, 13, 14, 5, 6, 7, 8, 9, 0, 1, 2, 3, 4,
];

/**
 * Maps a button position to the key index the image (write) protocol
 * expects. Falls back to the identity mapping for a position/table
 * mismatch (e.g. a different button count with no confirmed table) rather
 * than guessing — see `keyMap` override.
 */
export function mapPositionToImageKey(
  position: number,
  keyMap: readonly number[] = DEFAULT_IMAGE_KEY_MAP,
): number {
  return keyMap[position] ?? position;
}
