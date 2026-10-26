import { ArtifactSet, parseSha256Sums, verifyArtifacts } from "@zolvency-cmi/artifacts";

export async function loadBrowserArtifacts(base = "/artifacts/"): Promise<ArtifactSet> {
  const fetchBytes = async (path: string): Promise<Uint8Array> => {
    const response = await fetch(`${base}${path}`);
    if (!response.ok) throw new Error(`artefato ${path}: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const sums = parseSha256Sums(new TextDecoder().decode(await fetchBytes("SHA256SUMS")));
  const files = new Map<string, Uint8Array>();
  for (const path of sums.keys()) files.set(path, await fetchBytes(path));
  const set = new ArtifactSet(files, sums, { contractsTag: null });
  verifyArtifacts(set);
  return set;
}
