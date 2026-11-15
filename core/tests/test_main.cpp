/**
 * ============================================================================
 * NavigateNED — C++17 Routing Core Doctest Suite (core/tests/test_main.cpp)
 * ============================================================================
 * Includes the single-file routing engine (`../src/navcore.cpp`) directly so
 * the entire test suite compiles with:
 *   g++ -std=c++17 -I core/third_party core/tests/test_main.cpp
 */

#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest/doctest.h>

#include "../src/navcore.cpp"

#include <random>

using json = nlohmann::json;

namespace {

/**
 * Helper to load the real merged campus graph (`data/graph.json` + all 6
 * `data/indoor/*.json` files) via the `call("load", ...)` API.
 */
json loadRealMergedGraph() {
    const std::string resolvedDir = navcore::Graph::resolveDataDirectory("data");
    json loadArgs = {{"dataDir", resolvedDir}};
    const char* raw = call("load", loadArgs.dump().c_str());
    REQUIRE(raw != nullptr);
    return json::parse(raw);
}

} // namespace

TEST_CASE("WASM API call: ping and error boundary") {
    const char* res = call("ping", "{}");
    REQUIRE(res != nullptr);
    auto parsed = json::parse(res);
    CHECK(parsed["status"] == "pong");
    CHECK(parsed["version"] == "1.0.0");

    // Unknown function returns {"error": "..."} without throwing
    const char* badFn = call("nonexistent_fn", "{}");
    REQUIRE(badFn != nullptr);
    auto badParsed = json::parse(badFn);
    CHECK(badParsed.contains("error"));

    // Malformed JSON returns {"error": "..."} without throwing
    const char* badJson = call("route", "{not valid json");
    REQUIRE(badJson != nullptr);
    auto badJsonParsed = json::parse(badJson);
    CHECK(badJsonParsed.contains("error"));
}

TEST_CASE("WASM API call: synthetic load and unreachable / blocked behavior") {
    const char* sampleGraph = R"({
        "meta": {"version": "1.0"},
        "nodes": [
            {"id": "n1", "lat": 24.9310, "lng": 67.1110},
            {"id": "n2", "lat": 24.9315, "lng": 67.1115},
            {"id": "n3", "lat": 24.9320, "lng": 67.1120},
            {"id": "n4", "lat": 24.9350, "lng": 67.1150}
        ],
        "edges": [
            {"a": "n1", "b": "n2", "w": 80.0, "oneway": false},
            {"a": "n2", "b": "n3", "w": 80.0, "oneway": false}
        ]
    })";

    const char* res = call("load", sampleGraph);
    REQUIRE(res != nullptr);
    auto parsed = json::parse(res);
    CHECK(parsed["status"] == "ok");
    CHECK(parsed["nodeCount"] == 4);

    // Unreachable node n4 returns found: false across all 4 algorithms
    for (const char* algo : {"dijkstra", "astar", "bfs", "bellmanford"}) {
        json req = {{"from", "n1"}, {"to", "n4"}, {"algo", algo}};
        auto r = json::parse(call("route", req.dump().c_str()));
        CHECK(r["found"] == false);
        CHECK(r["path"].empty());
    }

    // Blocking intermediate node n2 makes n3 unreachable from n1
    {
        json req = {
            {"from", "n1"},
            {"to", "n3"},
            {"algo", "dijkstra"},
            {"avoid", json::array({"n2"})}
        };
        auto r = json::parse(call("route", req.dump().c_str()));
        CHECK(r["found"] == false);
    }

    // Blocking edge n1-n2 makes n3 unreachable from n1
    {
        json req = {
            {"from", "n1"},
            {"to", "n3"},
            {"algo", "astar"},
            {"blockedEdges", json::array({json{{"a", "n1"}, {"b", "n2"}}})}
        };
        auto r = json::parse(call("route", req.dump().c_str()));
        CHECK(r["found"] == false);
    }
}

TEST_CASE("Bellman-Ford detects reachable negative weight cycle") {
    const char* negCycleGraph = R"({
        "meta": {"version": "1.0"},
        "nodes": [
            {"id": "n1", "lat": 24.9310, "lng": 67.1110},
            {"id": "n2", "lat": 24.9312, "lng": 67.1112},
            {"id": "n3", "lat": 24.9314, "lng": 67.1114}
        ],
        "edges": [
            {"a": "n1", "b": "n2", "w": 5.0, "oneway": true},
            {"a": "n2", "b": "n3", "w": 3.0, "oneway": true},
            {"a": "n3", "b": "n1", "w": -12.0, "oneway": true}
        ]
    })";

    auto loadRes = json::parse(call("load", negCycleGraph));
    REQUIRE(loadRes["status"] == "ok");

    json req = {{"from", "n1"}, {"to", "n3"}, {"algo", "bellmanford"}};
    auto r = json::parse(call("route", req.dump().c_str()));
    CHECK(r["found"] == false);
    CHECK(r["negativeCycle"] == true);
    CHECK(r.contains("error"));
}

TEST_CASE("Real merged campus + indoor graph: end-to-end routing, step-free, and blocked nodes") {
    auto loadRes = loadRealMergedGraph();
    REQUIRE(loadRes["status"] == "ok");
    // 86 outdoor nodes + 611 indoor nodes across 6 buildings = 697 nodes
    CHECK(loadRes["nodeCount"].get<int>() == 697);
    CHECK(loadRes["indoorBuildings"].get<int>() == 6);

    const navcore::Graph& g = navcore::detail::globalGraph();

    SUBCASE("Indoor-to-outdoor and indoor-to-indoor routes work end to end") {
        // Route from a 2nd-floor room in CSIT (b-csit:201) to Main Gate (n1)
        json req = {
            {"from", "b-csit:201"},
            {"to", "n1"},
            {"algo", "dijkstra"},
            {"accessible", false}
        };
        auto r = json::parse(call("route", req.dump().c_str()));
        REQUIRE(r["found"] == true);
        CHECK(r["distance"].get<double>() > 50.0);

        const auto path = r["path"].get<std::vector<std::string>>();
        REQUIRE(path.size() >= 5);
        CHECK(path.front() == "b-csit:201");
        CHECK(path.back() == "n1");

        // Verify the path crosses b-csit:ent and n21 (the outdoor entrance of b-csit)
        bool sawIndoorEnt = false;
        bool sawOutdoorEnt = false;
        for (const auto& nid : path) {
            if (nid == "b-csit:ent") sawIndoorEnt = true;
            if (nid == "n21") sawOutdoorEnt = true;
        }
        CHECK(sawIndoorEnt);
        CHECK(sawOutdoorEnt);

        // Verify steps[] includes floor change, entrance crossing, and outdoor walk
        const auto steps = r["steps"].get<std::vector<std::string>>();
        CHECK(steps.size() >= 3);
        bool hasFloorStep = false;
        bool hasExitStep = false;
        bool hasOutdoorStep = false;
        for (const auto& s : steps) {
            if (s.find("stairs") != std::string::npos || s.find("lift") != std::string::npos) {
                hasFloorStep = true;
            }
            if (s.find("Exit") != std::string::npos || s.find("Enter") != std::string::npos) {
                hasExitStep = true;
            }
            if (s.find("Walk outdoors") != std::string::npos) {
                hasOutdoorStep = true;
            }
        }
        CHECK(hasFloorStep);
        CHECK(hasExitStep);
        CHECK(hasOutdoorStep);

        // Trace is populated and capped at <= 2000 events
        CHECK(!r["trace"].empty());
        CHECK(r["trace"].size() <= 2000);
    }

    SUBCASE("Step-free mode (accessible: true) never uses an accessible: false edge") {
        // Test across all 4 algorithms on a multi-floor route from 2nd floor of CSIT to 2nd floor of Library
        for (const char* algo : {"dijkstra", "astar", "bfs", "bellmanford"}) {
            json req = {
                {"from", "b-csit:201"},
                {"to", "b-library:204"},
                {"algo", algo},
                {"accessible", true}
            };
            auto r = json::parse(call("route", req.dump().c_str()));
            REQUIRE(r["found"] == true);

            const auto path = r["path"].get<std::vector<std::string>>();
            REQUIRE(path.size() >= 2);

            bool usedLift = false;
            for (size_t i = 0; i + 1 < path.size(); ++i) {
                const int u = g.getNodeIndex(path[i]);
                const int v = g.getNodeIndex(path[i + 1]);
                REQUIRE(u >= 0);
                REQUIRE(v >= 0);

                // Ensure NO stairs node is visited and the traversed edge is accessible: true
                CHECK(g.nodes[u].kind != "stairs");
                CHECK(g.nodes[v].kind != "stairs");

                bool foundAccessibleEdge = false;
                for (const auto& e : g.adj[u]) {
                    if (e.to == v && e.accessible) {
                        foundAccessibleEdge = true;
                        if (e.kind == "lift") usedLift = true;
                    }
                }
                CHECK(foundAccessibleEdge);
            }
            CHECK(usedLift);
        }

        // Standard (accessible: false) takes stairs (10m per floor vs 15m for lift), so step-free is slightly longer
        auto normalRes = json::parse(call("route", R"({"from":"b-csit:201","to":"b-library:204","algo":"dijkstra","accessible":false})"));
        auto stepFreeRes = json::parse(call("route", R"({"from":"b-csit:201","to":"b-library:204","algo":"dijkstra","accessible":true})"));
        CHECK(stepFreeRes["distance"].get<double>() > normalRes["distance"].get<double>());
    }

    SUBCASE("Blocked nodes are strictly avoided when routing") {
        // Find initial shortest path between n1 and n50
        auto initial = json::parse(call("route", R"({"from":"n1","to":"n50","algo":"dijkstra"})"));
        REQUIRE(initial["found"] == true);
        const auto initPath = initial["path"].get<std::vector<std::string>>();
        REQUIRE(initPath.size() >= 4);

        // Block an intermediate node on the shortest path
        const std::string blockedMid = initPath[initPath.size() / 2];
        for (const char* algo : {"dijkstra", "astar", "bfs", "bellmanford"}) {
            json req = {
                {"from", "n1"},
                {"to", "n50"},
                {"algo", algo},
                {"avoid", json::array({blockedMid})}
            };
            auto rerouted = json::parse(call("route", req.dump().c_str()));
            REQUIRE(rerouted["found"] == true);
            for (const auto& nid : rerouted["path"].get<std::vector<std::string>>()) {
                CHECK(nid != blockedMid);
            }
        }
    }
}

TEST_CASE("A* equals Dijkstra on 300 random pairs and all weighted algorithms agree") {
    auto loadRes = loadRealMergedGraph();
    REQUIRE(loadRes["status"] == "ok");

    const navcore::Graph& g = navcore::detail::globalGraph();
    const int n = g.nodeCount();
    REQUIRE(n == 697);

    std::mt19937 rng(42);
    std::uniform_int_distribution<int> nodeDist(0, n - 1);

    navcore::RouteOptions dOpts;
    dOpts.algo = "dijkstra";
    dOpts.maxTrace = 0;

    navcore::RouteOptions aOpts;
    aOpts.algo = "astar";
    aOpts.maxTrace = 0;

    navcore::RouteOptions bfOpts;
    bfOpts.algo = "bellmanford";
    bfOpts.maxTrace = 0;

    navcore::RouteOptions bfsOpts;
    bfsOpts.algo = "bfs";
    bfsOpts.maxTrace = 0;

    // 1. Test A* == Dijkstra on 300 random pairs across the full merged outdoor+indoor graph
    for (int trial = 0; trial < 300; ++trial) {
        const int u = nodeDist(rng);
        const int v = nodeDist(rng);

        const auto dRes = navcore::runDijkstra(g, u, v, dOpts);
        const auto aRes = navcore::runAStar(g, u, v, aOpts);

        REQUIRE(dRes.found == aRes.found);
        if (dRes.found) {
            CHECK(dRes.distance == doctest::Approx(aRes.distance).epsilon(1e-7));
        }
    }

    // 2. Test all four algorithms agree on reachability, and Dijkstra == A* == Bellman-Ford
    //    on distance (with BFS finding <= hops and >= metric distance) on 50 random pairs
    for (int trial = 0; trial < 50; ++trial) {
        const int u = nodeDist(rng);
        const int v = nodeDist(rng);

        const auto dRes = navcore::runDijkstra(g, u, v, dOpts);
        const auto aRes = navcore::runAStar(g, u, v, aOpts);
        const auto bfRes = navcore::runBellmanFord(g, u, v, bfOpts);
        const auto bfsRes = navcore::runBFS(g, u, v, bfsOpts);

        REQUIRE(dRes.found == aRes.found);
        REQUIRE(dRes.found == bfRes.found);
        REQUIRE(dRes.found == bfsRes.found);

        if (dRes.found) {
            CHECK(dRes.distance == doctest::Approx(aRes.distance).epsilon(1e-7));
            CHECK(dRes.distance == doctest::Approx(bfRes.distance).epsilon(1e-7));
            // BFS minimizes hops, so its hop count <= Dijkstra's hop count and metric distance >= Dijkstra's
            CHECK(bfsRes.path.size() <= dRes.path.size());
            CHECK(bfsRes.distance + 1e-7 >= dRes.distance);
        }
    }
}
