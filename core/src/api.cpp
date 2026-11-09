#include <string>
#include <cstring>
#include <cstdlib>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

namespace {
    // In-memory graph storage placeholder
    json g_currentGraph = json::object();
    // Static return buffer so caller receives valid pointer
    std::string g_responseBuffer;
}

std::string handlePing() {
    json res = {
        {"status", "pong"},
        {"version", "1.0.0"}
    };
    return res.dump();
}

std::string handleLoad(const std::string& argsJson) {
    try {
        json parsed = json::parse(argsJson);
        g_currentGraph = parsed;
        int nodeCount = 0;
        if (g_currentGraph.contains("nodes") && g_currentGraph["nodes"].is_array()) {
            nodeCount = static_cast<int>(g_currentGraph["nodes"].size());
        }
        json res = {
            {"status", "ok"},
            {"nodeCount", nodeCount}
        };
        return res.dump();
    } catch (const std::exception& e) {
        json err = {
            {"status", "error"},
            {"message", e.what()}
        };
        return err.dump();
    }
}

extern "C" {
    const char* call(const char* fn, const char* argsJson) {
        std::string functionName = fn ? fn : "";
        std::string args = argsJson ? argsJson : "{}";

        if (functionName == "ping") {
            g_responseBuffer = handlePing();
        } else if (functionName == "load") {
            g_responseBuffer = handleLoad(args);
        } else {
            json err = {
                {"status", "error"},
                {"message", "Unknown or unimplemented function: " + functionName}
            };
            g_responseBuffer = err.dump();
        }
        return g_responseBuffer.c_str();
    }
}

