import { describe, expect, it } from "vitest";

import { parseEnv, upsertEnv } from "../lib/env.js";

describe("parseEnv", () => {
  it("reads bare, quoted and exported values and ignores comments", () => {
    const env = parseEnv(
      [
        "# comentário",
        "CMI_REGISTER_DATA=",
        "CMI_OPERATOR_SPENDER_KEY=abc",
        'VITE_DEV_WALLET="1"',
        "export CMI_SOMETHING='x y'",
        "OUTRA=valor # nota",
      ].join("\n"),
    );
    expect(env.get("CMI_REGISTER_DATA")).toBe("");
    expect(env.get("CMI_OPERATOR_SPENDER_KEY")).toBe("abc");
    expect(env.get("VITE_DEV_WALLET")).toBe("1");
    expect(env.get("CMI_SOMETHING")).toBe("x y");
    expect(env.get("OUTRA")).toBe("valor");
  });

  it("keeps a # that is part of the value", () => {
    expect(parseEnv("CMI_X=a#b").get("CMI_X")).toBe("a#b");
  });
});

describe("upsertEnv", () => {
  it("replaces the line without duplicating it", () => {
    const out = upsertEnv("A=1\nB=2\n", "B", "3");
    expect(out).toBe("A=1\nB=3\n");
    expect(out.match(/^B=/gm)).toHaveLength(1);
  });

  it("appends with a trailing newline when the key is new", () => {
    expect(upsertEnv("A=1\n", "B", "2")).toBe("A=1\nB=2\n");
  });
});
