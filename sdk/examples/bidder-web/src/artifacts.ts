import { ArtifactSet, parseSha256Sums, verifyArtifacts } from "@zolvency-cmi/artifacts";

/**
 * Os circuitos e VKs que o bidder usa, servidos pelo app em `/artifacts/` com um `SHA256SUMS`
 * (o `vite.config` os copia). Toda carga é conferida (S-06): um circuito diferente da VK on-chain
 * geraria uma prova que o contrato recusa.
 */
export async function loadBrowserArtifacts(base = "/artifacts/"): Promise<ArtifactSet> {
  const fetchBytes = async (path: string): Promise<Uint8Array> => {
    const res = await fetch(`${base}${path}`);
    if (!res.ok) throw new Error(`artefato ${path}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const sums = parseSha256Sums(new TextDecoder().decode(await fetchBytes("SHA256SUMS")));
  const files = new Map<string, Uint8Array>();
  for (const path of sums.keys()) files.set(path, await fetchBytes(path));
  const set = new ArtifactSet(files, sums, { contractsTag: null });
  verifyArtifacts(set);
  return set;
}
