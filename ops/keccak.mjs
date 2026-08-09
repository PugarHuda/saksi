// Node's crypto ships sha3-256, which is NOT keccak-256 — different padding, different
// digest. Ethereum uses keccak-256, so this has to come from a library.
export { keccak256 as keccak_256 } from "js-sha3";
