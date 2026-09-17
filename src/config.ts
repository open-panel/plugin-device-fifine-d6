import { DEFAULT_IMAGE_KEY_MAP } from "./protocol.js";

/**
 * FIFINE D6 identification.
 *
 * Confirmed against real hardware (see ../README.md "Hardware notes"): the
 * D6 enumerates over USB as a generic OEM controller board reporting itself
 * as "HOTSPOTEKUSB HID DEMO", vendorId 0x3142 / productId 0x60, and exposes
 * two HID interfaces:
 *   - usagePage 0xFFA0 (65440, vendor-defined): button events + image output.
 *     This is the one the adapter should talk to.
 *   - usagePage 0x0001 (Generic Desktop): unused by this adapter — writes to
 *     it are rejected by Windows and it never reports button presses.
 *
 * These are shipped as defaults since they matched real hardware, but stay
 * fully overridable via env vars in case a different D6 revision differs.
 */
const DEFAULT_VENDOR_ID = 0x3142;
const DEFAULT_PRODUCT_ID = 0x60;
const DEFAULT_USAGE_PAGE = 0xffa0;

/**
 * Per-button display size in pixels (square) — confirmed empirically (a
 * smaller guess rendered with a black border, i.e. too small for the real
 * screen). See ../README.md "Image output".
 */
const DEFAULT_IMAGE_SIZE = 128;
/** The display renders upside down without this — confirmed empirically. */
const DEFAULT_IMAGE_ROTATION = 180;
/** Brightness (0-100) applied once on connect. */
const DEFAULT_BRIGHTNESS = 100;

export interface FifineD6Config {
  vendorId?: number;
  productId?: number;
  /** HID usage page filter — narrows discovery to the interface that actually carries button/image data. */
  usagePage?: number;
  buttonCount: number;
  /** Square pixel size to resize/encode icons to before sending — see the note above. */
  imageSize: number;
  /** Degrees to rotate an icon before sending (0/90/180/270) — see the note above. */
  imageRotation: number;
  /** position -> image-protocol key index — see protocol.ts#DEFAULT_IMAGE_KEY_MAP for provenance. */
  imageKeyMap: readonly number[];
  /** Brightness applied once on connect, 0-100. */
  brightness: number;
}

function parseHexEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseNumberListEnv(name: string): number[] | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  const values = raw.split(",").map((s) => Number(s.trim()));
  return values.every((v) => Number.isFinite(v)) ? values : undefined;
}

export function loadFifineD6Config(overrides: Partial<FifineD6Config> = {}): FifineD6Config {
  return {
    vendorId: overrides.vendorId ?? parseHexEnv("OPENPANEL_FIFINE_VENDOR_ID") ?? DEFAULT_VENDOR_ID,
    productId:
      overrides.productId ?? parseHexEnv("OPENPANEL_FIFINE_PRODUCT_ID") ?? DEFAULT_PRODUCT_ID,
    usagePage:
      overrides.usagePage ?? parseHexEnv("OPENPANEL_FIFINE_USAGE_PAGE") ?? DEFAULT_USAGE_PAGE,
    buttonCount: overrides.buttonCount ?? Number(process.env.OPENPANEL_FIFINE_BUTTON_COUNT ?? 15),
    imageSize:
      overrides.imageSize ?? Number(process.env.OPENPANEL_FIFINE_IMAGE_SIZE ?? DEFAULT_IMAGE_SIZE),
    imageRotation:
      overrides.imageRotation ??
      Number(process.env.OPENPANEL_FIFINE_IMAGE_ROTATION ?? DEFAULT_IMAGE_ROTATION),
    imageKeyMap:
      overrides.imageKeyMap ??
      parseNumberListEnv("OPENPANEL_FIFINE_IMAGE_KEY_MAP") ??
      DEFAULT_IMAGE_KEY_MAP,
    brightness:
      overrides.brightness ?? Number(process.env.OPENPANEL_FIFINE_BRIGHTNESS ?? DEFAULT_BRIGHTNESS),
  };
}
