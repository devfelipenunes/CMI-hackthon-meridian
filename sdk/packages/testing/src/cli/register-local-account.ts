

import { loadDevArtifacts } from "@zolvency-cmi/artifacts/node";
import { createProver, keypairSigner } from "@zolvency-cmi/core";

import { LOCAL_DEPLOYMENT_PATH, loadLocalDeployment, localChain, registerLocalAccount } from "../localnet.js";

const secret = process.env["CMI_ACCOUNT_SECRET"];
if (secret === undefined || secret === "") throw new Error("falta CMI_ACCOUNT_SECRET");

const dep = loadLocalDeployment(process.env["CMI_DEPLOYMENT"] ?? LOCAL_DEPLOYMENT_PATH);
const signer = keypairSigner(secret);
const prover = createProver({ artifacts: loadDevArtifacts() });
try {
  const created = await registerLocalAccount({ chain: localChain(dep), dep, signer, prover });
  process.stdout.write(`${created ? "registrada" : "já registrada"}: ${signer.address}\n`);
} finally {
  await prover.destroy();
}
process.exit(0);
