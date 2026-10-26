import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { loadBrowserArtifacts } from "@/sdk/artifacts";

const FILES: Record<string, Uint8Array> = {
  "circuits/set_spender.json": new TextEncoder().encode('{"circuit":"set_spender"}'),
  "vks/set_spender.vk.bin": Uint8Array.of(1, 2, 3, 4),
};

function sums(): string {
  return (
    Object.entries(FILES)
      .map(([path, bytes]) => `${createHash("sha256").update(bytes).digest("hex")}  ${path}`)
      .join("\n") + "\n"
  );
}

function serve(overrides: Record<string, Uint8Array | null> = {}): void {
  const files: Record<string, Uint8Array | null> = { ...FILES, ...overrides };
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const path = String(input).replace(/^\/artifacts\//, "");
    if (path === "SHA256SUMS") {
      return new Response(sums(), { status: 200 });
    }
    const bytes = files[path];
    if (bytes == null) return new Response("not found", { status: 404 });
    return new Response(bytes.slice().buffer, { status: 200 });
  });
}

describe("loadBrowserArtifacts", () => {
  it("accepts a set whose files match SHA256SUMS", async () => {
    serve();
    const set = await loadBrowserArtifacts();
    expect([...set.sums().keys()].sort()).toEqual(Object.keys(FILES).sort());
    expect(set.file("vks/set_spender.vk.bin")).toEqual(FILES["vks/set_spender.vk.bin"]);
  });

  it("rejects a tampered file before any proof runs", async () => {
    serve({ "circuits/set_spender.json": new TextEncoder().encode('{"circuit":"outro"}') });
    await expect(loadBrowserArtifacts()).rejects.toMatchObject({ code: "ArtifactMismatch" });
  });

  it("rejects a missing file", async () => {
    serve({ "vks/set_spender.vk.bin": null });
    await expect(loadBrowserArtifacts()).rejects.toThrow(/HTTP 404/);
  });
});
