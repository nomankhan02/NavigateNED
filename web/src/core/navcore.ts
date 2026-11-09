/**
 * Type-safe client bridge and in-memory module caching for C++ WASM navcore.
 */

export interface PingResponse {
  status: string;
  version: string;
}

export interface LoadResponse {
  status: "ok" | "error";
  nodeCount?: number;
  message?: string;
}

export type NativeCallFn = (fn: string, argsJson: string) => string;

interface NavcoreModuleInstance {
  cwrap: (funcName: string, returnType: string, argTypes: string[]) => NativeCallFn;
  call?: NativeCallFn;
}

// In-memory module cache
let cachedCallFn: NativeCallFn | null = null;
let modulePromise: Promise<NativeCallFn> | null = null;

/**
 * Loads the WebAssembly core module using dynamic import and returns the native call bridge.
 * Caches the initialized module instance in memory.
 */
export async function getNavCore(): Promise<NativeCallFn> {
  if (cachedCallFn) {
    return cachedCallFn;
  }

  if (modulePromise) {
    return modulePromise;
  }

  modulePromise = (async () => {
    // Navcore is placed in public/wasm/navcore.js
    const importUrl = "/wasm/navcore.js";
    const navcoreModule = await (Function("url", "return import(url)")(importUrl));
    const createModule = navcoreModule.default || navcoreModule;
    const instance: NavcoreModuleInstance = await createModule();

    let callFn: NativeCallFn;
    if (typeof instance.cwrap === "function") {
      callFn = instance.cwrap("call", "string", ["string", "string"]);
    } else if (typeof instance.call === "function") {
      callFn = instance.call;
    } else {
      throw new Error("Unable to locate call() export on navcore module");
    }

    cachedCallFn = callFn;
    return callFn;
  })();

  return modulePromise;
}

/**
 * Invokes the exported C++ WASM ping routine.
 */
export async function pingCore(): Promise<PingResponse> {
  const call = await getNavCore();
  const raw = call("ping", "{}");
  return JSON.parse(raw) as PingResponse;
}

/**
 * Fetches and caches campus graph JSON via browser fetch cache, then loads it into C++ memory.
 */
export async function loadGraphIntoCore(graphUrl: string): Promise<LoadResponse> {
  const call = await getNavCore();
  const response = await fetch(graphUrl, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Failed to fetch graph from ${graphUrl}: HTTP ${response.status}`);
  }
  const graphJsonString = await response.text();
  const raw = call("load", graphJsonString);
  return JSON.parse(raw) as LoadResponse;
}

