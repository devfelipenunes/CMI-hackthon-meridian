import { describe, expect, it } from "vitest";

import { UsageError, parseArgs } from "../lib/cli.js";

describe("parseArgs", () => {
  it("separates value options from flags", () => {
    const args = parseArgs(["--to", "GABC", "--amount=10", "--resume"], ["to", "amount"]);
    expect(args.values.get("to")).toBe("GABC");
    expect(args.values.get("amount")).toBe("10");
    expect(args.flags.has("resume")).toBe(true);
    expect(args.positional).toEqual([]);
  });

  it("stops consuming at `--` and keeps loose arguments", () => {
    const args = parseArgs(["--", "--to", "x"], ["to"]);
    expect(args.values.size).toBe(0);
    expect(args.positional).toEqual(["--to", "x"]);
  });

  it("rejects a value option without a value", () => {
    expect(() => parseArgs(["--to"], ["to"])).toThrow(UsageError);
  });

  it("rejects a value on a boolean option", () => {
    expect(() => parseArgs(["--resume=yes"], [])).toThrow(UsageError);
  });
});
