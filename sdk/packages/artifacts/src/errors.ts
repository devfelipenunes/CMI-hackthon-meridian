
export class ArtifactError extends Error {
  readonly code: "ArtifactMismatch" | "ArtifactNotFound";
  readonly path: string;

  constructor(code: ArtifactError["code"], path: string, detail: string) {
    super(`${code}: ${path} — ${detail}`);
    this.name = "ArtifactError";
    this.code = code;
    this.path = path;
  }
}
