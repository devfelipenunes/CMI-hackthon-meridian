# @zolvency-cmi/artifacts

The circuits (ACIR) and verification keys for CMI Auctions and the Confidential Token from a
contracts release, **always checked by SHA-256 before use** (a circuit different from the on-chain
VK produces proofs the contract rejects).

```ts
import { loadArtifacts } from "@zolvency-cmi/artifacts/node";       // Node: reads releases/<tag>/
import { ArtifactSet, verifyArtifacts, SUPPORTED_CONTRACTS_TAGS } from "@zolvency-cmi/artifacts"; // browser: build the set and check it

const artifacts = loadArtifacts({ release: "v0.1.0" });
```

- `SUPPORTED_CONTRACTS_TAGS = ["v0.1.0"]`.
- The contracts release brings the CMI circuits and VKs plus the token VKs; a missing token circuit
  is filled in from the version the SDK pins, and only if the VK matches (S-06).
- In the browser, serve the files with the `SHA256SUMS` and build an `ArtifactSet` (see the
  repository's `examples/bidder-web`).
