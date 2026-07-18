// Node-global shims for the browser. The eERC proving stack (@avalabs/eerc-sdk,
// snarkjs, ffjavascript) and some @noble/@scure utilities reach for Node's
// `Buffer` global, which the browser doesn't provide, without this, the private
// balance activation (refreshBalance -> proving chunk) throws
// `ReferenceError: Buffer is not defined`. Import this FIRST in main.tsx so the
// global is set before any other module's top-level code (or the on-demand
// proving chunk) runs.
// biome-ignore lint/style/useNodejsImportProtocol: this is the npm `buffer` browser polyfill, NOT Node's built-in, `node:buffer` would not resolve in the browser bundle.
import { Buffer } from "buffer";

if (typeof (globalThis as { Buffer?: unknown }).Buffer === "undefined") {
  (globalThis as { Buffer?: unknown }).Buffer = Buffer;
}
