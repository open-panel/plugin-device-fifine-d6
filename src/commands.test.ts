import { describe, expect, it } from "vitest";
import {
  buildClearButtonCommand,
  buildFlushCommand,
  buildImageDataReports,
  buildInitCommands,
  buildKeepAliveCommand,
  buildSendImageHeader,
  buildSetBrightnessCommand,
  PACKET_SIZE,
  REPORT_LENGTH,
} from "./commands.js";

const PREFIX = [0x00, 0x43, 0x52, 0x54, 0x00, 0x00]; // "\0CRT\0\0"

describe("command framing", () => {
  it("every command is exactly REPORT_LENGTH bytes, zero-padded", () => {
    const commands = [
      ...buildInitCommands(),
      buildSetBrightnessCommand(50),
      buildClearButtonCommand(0),
      buildClearButtonCommand(0xff),
      buildSendImageHeader(0, 1234),
      buildFlushCommand(),
      buildKeepAliveCommand(),
    ];
    for (const cmd of commands) expect(cmd.length).toBe(REPORT_LENGTH);
  });

  it("builds the DIS/LIG init sequence with the shared \\0CRT\\0\\0 prefix", () => {
    const commands = buildInitCommands();
    expect(commands).toHaveLength(2);
    const [dis, lig] = commands as [Buffer, Buffer];
    expect([...dis.subarray(0, 9)]).toEqual([...PREFIX, 0x44, 0x49, 0x53]);
    expect([...lig.subarray(0, 13)]).toEqual([...PREFIX, 0x4c, 0x49, 0x47, 0x00, 0x00, 0x00, 0x00]);
  });

  it("clamps brightness to 0-100", () => {
    expect(buildSetBrightnessCommand(150)[11]).toBe(100);
    expect(buildSetBrightnessCommand(-10)[11]).toBe(0);
    expect(buildSetBrightnessCommand(42)[11]).toBe(42);
  });

  it("clears a specific button using 1-based key numbering", () => {
    const cmd = buildClearButtonCommand(4);
    expect(cmd[12]).toBe(5); // position 4 -> key byte 5
  });

  it("clears all buttons with 0xff", () => {
    const cmd = buildClearButtonCommand(0xff);
    expect(cmd[12]).toBe(0xff);
  });

  it("encodes the image length as big-endian u16 and the 1-based key", () => {
    const header = buildSendImageHeader(2, 0x1234);
    expect(header[11]).toBe(0x12);
    expect(header[12]).toBe(0x34);
    expect(header[13]).toBe(3); // position 2 -> key byte 3
  });
});

describe("buildImageDataReports", () => {
  it("splits image bytes into REPORT_LENGTH packets with a leading zero byte", () => {
    const image = Buffer.alloc(PACKET_SIZE * 2 + 100, 0xab);
    const reports = buildImageDataReports(image);

    expect(reports).toHaveLength(3);
    for (const report of reports) expect(report.length).toBe(REPORT_LENGTH);
    expect(reports[0]![0]).toBe(0x00);
    expect(reports[0]!.subarray(1, PACKET_SIZE + 1)).toEqual(image.subarray(0, PACKET_SIZE));
  });

  it("zero-pads the final, shorter chunk", () => {
    const image = Buffer.alloc(10, 0xff);
    const [report] = buildImageDataReports(image);
    expect(report!.subarray(1, 11)).toEqual(image);
    expect(report!.subarray(11).every((b) => b === 0)).toBe(true);
  });

  it("returns no reports for empty image data", () => {
    expect(buildImageDataReports(Buffer.alloc(0))).toEqual([]);
  });
});
