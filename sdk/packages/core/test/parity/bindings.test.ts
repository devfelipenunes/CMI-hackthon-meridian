import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  AUCTION_RULE,
  FEE_BPS,
  FINALIZATION_GRACE_LEDGERS,
  MAX_BIDS,
  MAX_DURATION_LEDGERS,
  MIN_FEE_RESERVE,
  QUOTA_UNIT,
  REIMBURSEMENT_PER_CALL,
  SECONDS_PER_LEDGER,
  SETTLEMENT_MARGIN_LEDGERS,
  TTL_BUFFER_LEDGERS,
  specEntriesFromWasm,
} from "../../src/index.js";
import { AUCTION_SPEC, AUCTION_WASM_SHA256 } from "../../src/bindings/auction.js";

const CONTRACTS = fileURLToPath(new URL("../../../../contracts/", import.meta.url));

function contractConstants(): Map<string, bigint> {
  const src = readFileSync(`${CONTRACTS}contracts/shared/src/types.rs`, "utf8");
  const out = new Map<string, bigint>();
  for (const m of src.matchAll(/^pub const (\w+): \w+ = ([^;]+);/gm)) {
    const expr = m[2]!.replace(/\bas \w+/g, "").replace(/(\d)_(?=\d)/g, "$1");
    const tokens = expr.match(/\d+|[A-Z][A-Z0-9_]*|[()+\-*/]/g) ?? [];
    let i = 0;
    const atom = (): bigint => {
      const t = tokens[i++]!;
      if (t === "(") {
        const v = sum();
        i++;
        return v;
      }
      if (/^\d+$/.test(t)) return BigInt(t);
      const v = out.get(t);
      if (v === undefined) throw new Error(`constante desconhecida ${t}`);
      return v;
    };
    const product = (): bigint => {
      let v = atom();
      while (tokens[i] === "*" || tokens[i] === "/") v = tokens[i++] === "*" ? v * atom() : v / atom();
      return v;
    };
    const sum = (): bigint => {
      let v = product();
      while (tokens[i] === "+" || tokens[i] === "-") v = tokens[i++] === "+" ? v + product() : v - product();
      return v;
    };
    out.set(m[1]!, sum());
  }
  return out;
}

describe("bindings (S-07)", () => {
  it("bindings are regenerated identically from pinned wasm (auction)", () => {
    const wasm = readFileSync(`${CONTRACTS}wasm/auction.wasm`);
    expect(createHash("sha256").update(wasm).digest("hex")).toBe(AUCTION_WASM_SHA256);
    expect(specEntriesFromWasm(wasm)).toEqual([...AUCTION_SPEC]);
  });
});

describe("constantes (contrato §1)", () => {
  const c = contractConstants();

  it("SDK constants equal contract constants", () => {
    expect({
      MAX_BIDS: BigInt(MAX_BIDS),
      FEE_BPS,
      AUCTION_RULE: BigInt(AUCTION_RULE),
      QUOTA_UNIT,
      SECONDS_PER_LEDGER: BigInt(SECONDS_PER_LEDGER),
      MAX_DURATION_LEDGERS: BigInt(MAX_DURATION_LEDGERS),
      FINALIZATION_GRACE_LEDGERS: BigInt(FINALIZATION_GRACE_LEDGERS),
      SETTLEMENT_MARGIN_LEDGERS: BigInt(SETTLEMENT_MARGIN_LEDGERS),
      TTL_BUFFER_LEDGERS: BigInt(TTL_BUFFER_LEDGERS),
      REIMBURSEMENT_PER_CALL,
      MIN_FEE_RESERVE,
    }).toEqual(
      Object.fromEntries(
        [
          "MAX_BIDS", "FEE_BPS", "AUCTION_RULE", "QUOTA_UNIT", "SECONDS_PER_LEDGER", "MAX_DURATION_LEDGERS",
          "FINALIZATION_GRACE_LEDGERS", "SETTLEMENT_MARGIN_LEDGERS", "TTL_BUFFER_LEDGERS", "REIMBURSEMENT_PER_CALL", "MIN_FEE_RESERVE",
        ].map((k) => [k, c.get(k)]),
      ),
    );
  });

  it("the evaluator reads the documented values (518_400, 34_560, 5 XLM)", () => {
    expect([c.get("MAX_DURATION_LEDGERS"), c.get("FINALIZATION_GRACE_LEDGERS"), c.get("MIN_FEE_RESERVE")]).toEqual([518_400n, 34_560n, 50_000_000n]);
  });
});
