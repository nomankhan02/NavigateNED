#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest/doctest.h>
#include <nlohmann/json.hpp>

extern "C" {
    const char* call(const char* fn, const char* argsJson);
}

TEST_CASE("WASM API call: ping") {
    const char* res = call("ping", "{}");
    REQUIRE(res != nullptr);
    auto parsed = nlohmann::json::parse(res);
    CHECK(parsed["status"] == "pong");
    CHECK(parsed["version"] == "1.0.0");
}

TEST_CASE("WASM API call: load") {
    const char* sampleGraph = R"({
        "meta": {"version": "1.0"},
        "nodes": [
            {"id": "n1", "lat": 24.93, "lng": 67.11},
            {"id": "n2", "lat": 24.94, "lng": 67.12}
        ],
        "edges": []
    })";

    const char* res = call("load", sampleGraph);
    REQUIRE(res != nullptr);
    auto parsed = nlohmann::json::parse(res);
    CHECK(parsed["status"] == "ok");
    CHECK(parsed["nodeCount"] == 2);
}

