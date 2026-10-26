// O @stellar/stellar-sdk (e, por ele, o SDK do CMI) usa o `Buffer` do Node. No navegador ele vem
// do pacote `buffer`, instalado antes de qualquer outro import.
import { Buffer } from "buffer";

(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
