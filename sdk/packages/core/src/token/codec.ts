import { scvStruct } from "@ctd/sdk";
import { xdr } from "@stellar/stellar-sdk";

import { pointToBytes, toBytes32BE, type Point } from "../field/encoding.js";

const bytesVal = (b: Uint8Array): xdr.ScVal => xdr.ScVal.scvBytes(Buffer.from(b));
export const pointVal = (p: Point): xdr.ScVal => bytesVal(pointToBytes(p));
export const fieldVal = (v: bigint): xdr.ScVal => bytesVal(toBytes32BE(v));
export const pairVal = (a: bigint, b: bigint): xdr.ScVal => bytesVal(new Uint8Array([...toBytes32BE(a), ...toBytes32BE(b)]));

export function encodeData(payload: Record<string, xdr.ScVal>, proof: Uint8Array): Uint8Array {
  return new Uint8Array(scvStruct({ payload: scvStruct(payload), proof: bytesVal(proof) }).toXDR());
}
