import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SKILL_DIR = fileURLToPath(new URL("../../.claude/skills/cmi-sdk-tdd/", import.meta.url));

describe("cmi-sdk-tdd skill", () => {
  const skill = existsSync(`${SKILL_DIR}SKILL.md`) ? readFileSync(`${SKILL_DIR}SKILL.md`, "utf8") : "";

  it("has frontmatter with name and description", () => {
    expect(skill).toMatch(/^---\nname: cmi-sdk-tdd\ndescription: .+\n---/);
  });

  it.each([
    ["TDD red before code", "teste vermelho"],
    ["no secret leaks", "assertNoSecretLeak"],
    ["Secret wrapper", "Secret<T>"],
    ["single implementation of formulas", "Nunca escreva uma fórmula duas vezes"],
    ["pinned noir_js", "1.0.0-beta.9"],
    ["pinned bb.js", "0.87.0"],
    ["keccak transcript", "keccak"],
    ["bid order", "`bid_validity` → `set_spender` → `submit_bid`"],
    ["operator never in browser", "`operator` nunca"],
    ["bigint values", "bigint"],
    ["third-party code via pinned submodule", "third_party/stellar-confidential-token-demo"],
    ["mock does not close RF", "Nunca marque um RF como `DONE` com base em fake"],
    ["no push or PR by the agent", "git push"],
    ["submodules not edited", "Nunca edite `specs/` nem `contracts/`"],
  ])("mentions: %s", (_label, text) => {
    expect(skill).toContain(text);
  });

  it.each(["pr-template.md", "reuse.md"])("ships reference %s", (file) => {
    expect(existsSync(`${SKILL_DIR}references/${file}`)).toBe(true);
  });
});
