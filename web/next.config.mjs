import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
export default {
  // The repo root also has a lockfile (the ops scripts), so pin the workspace root here
  // rather than letting Turbopack infer the wrong one.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  env: {
    NEXT_PUBLIC_RPC: process.env.MONAD_RPC ?? "https://testnet-rpc.monad.xyz",
    NEXT_PUBLIC_EXPLORER: process.env.MONAD_EXPLORER ?? "https://testnet.monadexplorer.com",
  },
};
