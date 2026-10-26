

import { cryptoRng } from "@zolvency-cmi/core";
import { auditorKeyHex } from "../localnet.js";

process.stdout.write(`${auditorKeyHex(cryptoRng.scalar())}\n`);
