import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import { Secret } from "../../src/index.js";

describe("Secret", () => {
  const price = new Secret(650_123_456n);

  it("toString, template literal, toJSON and inspect are redacted", () => {
    expect(String(price)).toBe("[redacted]");
    expect(`${price}`).toBe("[redacted]");
    expect(JSON.stringify({ price })).toBe('{"price":"[redacted]"}');
    expect(inspect(price)).toBe("[redacted]");
    expect(inspect({ nested: { price } }, { depth: 5 })).not.toContain("650123456");
  });

  it("expose returns the value", () => {
    expect(price.expose()).toBe(650_123_456n);
  });

  it("does not leak through enumerable properties", () => {
    expect(Object.keys(price)).toEqual([]);
    expect({ ...price }).toEqual({});
  });
});
