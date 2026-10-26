const LINE = /^([0-9a-f]{64}) [ *](.+)$/;

export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const m = LINE.exec(line);
    if (!m) throw new Error(`linha inválida no SHA256SUMS: ${line}`);
    sums.set(m[2]!, m[1]!);
  }
  return sums;
}
