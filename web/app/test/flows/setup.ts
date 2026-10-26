import "../setup";

import { Buffer as NodeBuffer } from "node:buffer";
import { runInThisContext } from "node:vm";

globalThis.Buffer = NodeBuffer;
const NodeUint8Array = runInThisContext("Uint8Array") as typeof Uint8Array;
globalThis.Uint8Array = NodeUint8Array;
Object.defineProperty(NodeUint8Array, Symbol.hasInstance, {
  value: (value: unknown) => ArrayBuffer.isView(value),
});

if (typeof HTMLDialogElement !== "undefined") {
  const proto = HTMLDialogElement.prototype;
  if (typeof proto.showModal !== "function") {
    proto.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}
