/**
 * Placeholder navcore.js module simulating Emscripten ES6 modularize export
 * until compiled via GitHub Actions CI pipeline.
 */
let graphStore = null;

function call(fn, argsJson) {
  try {
    if (fn === "ping") {
      return JSON.stringify({
        status: "pong",
        version: "1.0.0 (placeholder runtime - awaiting CI emscripten build)"
      });
    }

    if (fn === "load") {
      const parsed = JSON.parse(argsJson || "{}");
      graphStore = parsed;
      const count = (parsed.nodes && Array.isArray(parsed.nodes)) ? parsed.nodes.length : 0;
      return JSON.stringify({
        status: "ok",
        nodeCount: count
      });
    }

    return JSON.stringify({
      status: "error",
      message: "Unimplemented in placeholder: " + fn
    });
  } catch (err) {
    return JSON.stringify({
      status: "error",
      message: err instanceof Error ? err.message : String(err)
    });
  }
}

export default async function createNavcoreModule() {
  return {
    cwrap(funcName, returnType, argTypes) {
      if (funcName === "call") {
        return (fn, argsJson) => call(fn, argsJson);
      }
      throw new Error("Unknown cwrap symbol: " + funcName);
    },
    call
  };
}

