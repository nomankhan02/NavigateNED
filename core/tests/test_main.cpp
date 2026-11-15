/**
 * ============================================================================
 * NavigateNED — C++17 Routing & DSA Core Doctest Suite (core/tests/test_main.cpp)
 * ============================================================================
 * Includes the single-file routing engine (`../src/navcore.cpp`) directly so
 * the entire test suite compiles with:
 *   g++ -std=c++17 -I core/third_party core/tests/test_main.cpp
 */

#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include <doctest/doctest.h>

#include "../src/navcore.cpp"

#include <algorithm>
#include <random>
#include <set>

using json = nlohmann::json;

namespace {

/**
 * Helper to load the real merged campus graph (`data/graph.json` + all 6
 * `data/indoor/<id>.json` files) via the `call("load", ...)` API.
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

    // Unreachable node n4 returns found: false across all 5 algorithms
    for (const char* algo : {"dijkstra", "astar", "bfs", "bellmanford", "floyd"}) {
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
    CHECK(loadRes["nodeCount"].get<int>() == 697);
    CHECK(loadRes["indoorBuildings"].get<int>() == 6);

    const navcore::Graph& g = navcore::detail::globalGraph();

    SUBCASE("Indoor-to-outdoor and indoor-to-indoor routes work end to end") {
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

        bool sawIndoorEnt = false;
        bool sawOutdoorEnt = false;
        for (const auto& nid : path) {
            if (nid == "b-csit:ent") sawIndoorEnt = true;
            if (nid == "n21") sawOutdoorEnt = true;
        }
        CHECK(sawIndoorEnt);
        CHECK(sawOutdoorEnt);

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

        CHECK(!r["trace"].empty());
        CHECK(r["trace"].size() <= 2000);
    }

    SUBCASE("Step-free mode (accessible: true) never uses an accessible: false edge") {
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

        auto normalRes = json::parse(call("route", R"({"from":"b-csit:201","to":"b-library:204","algo":"dijkstra","accessible":false})"));
        auto stepFreeRes = json::parse(call("route", R"({"from":"b-csit:201","to":"b-library:204","algo":"dijkstra","accessible":true})"));
        CHECK(stepFreeRes["distance"].get<double>() > normalRes["distance"].get<double>());
    }

    SUBCASE("Blocked nodes are strictly avoided when routing") {
        auto initial = json::parse(call("route", R"({"from":"n1","to":"n50","algo":"dijkstra"})"));
        REQUIRE(initial["found"] == true);
        const auto initPath = initial["path"].get<std::vector<std::string>>();
        REQUIRE(initPath.size() >= 4);

        const std::string blockedMid = initPath[initPath.size() / 2];
        for (const char* algo : {"dijkstra", "astar", "bfs", "bellmanford", "floyd"}) {
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
            CHECK(bfsRes.path.size() <= dRes.path.size());
            CHECK(bfsRes.distance + 1e-7 >= dRes.distance);
        }
    }
}

// ============================================================================
// Task B2 Unit Tests (via call())
// ============================================================================

TEST_CASE("Task B2.1: Trie prefix search (whole name, word prefix, building number, indoor rooms, ranking)") {
    auto loadRes = loadRealMergedGraph();
    REQUIRE(loadRes["status"] == "ok");

    // 1. Exact building number match ("11" -> Main Auditorium b-auditorium) ranked first
    {
        auto res = json::parse(call("search", R"({"query": "11", "limit": 5})"));
        REQUIRE(res.contains("results"));
        REQUIRE(!res["results"].empty());
        CHECK(res["results"][0]["id"] == "b-auditorium");
        CHECK(res["results"][0]["kind"] == "landmark");
    }

    // 2. Case-insensitive short name / word prefix match ("auditorium" vs "AUDITORIUM" vs "Audi")
    {
        auto rLower = json::parse(call("search", R"({"query": "auditorium", "limit": 5})"));
        auto rUpper = json::parse(call("search", R"({"query": "AUDITORIUM", "limit": 5})"));
        auto rPref = json::parse(call("search", R"({"query": "Audi", "limit": 5})"));
        REQUIRE(!rLower["results"].empty());
        REQUIRE(!rUpper["results"].empty());
        REQUIRE(!rPref["results"].empty());
        CHECK(rLower["results"][0]["id"] == "b-auditorium");
        CHECK(rUpper["results"][0]["id"] == "b-auditorium");
        CHECK(rPref["results"][0]["id"] == "b-auditorium");
    }

    // 3. Word token prefix inside a multi-word landmark name ("Library" -> b-library)
    {
        auto res = json::parse(call("search", R"({"query": "libr", "limit": 5})"));
        REQUIRE(!res["results"].empty());
        CHECK(res["results"][0]["id"] == "b-library");
        CHECK(res["results"][0]["kind"] == "landmark");
    }

    // 4. Indoor room search returns kind="room" and buildingId
    {
        auto res = json::parse(call("search", R"({"query": "201", "limit": 10})"));
        REQUIRE(!res["results"].empty());
        bool foundRoom = false;
        for (const auto& item : res["results"]) {
            if (item["kind"] == "room") {
                foundRoom = true;
                CHECK(item.contains("buildingId"));
                CHECK(!item["buildingId"].get<std::string>().empty());
                CHECK(!item["label"].get<std::string>().empty());
            }
        }
        CHECK(foundRoom);
    }

    // 5. Shorter / exact matches come before longer matches, and limit is respected
    {
        auto res = json::parse(call("search", R"({"query": "admin", "limit": 3})"));
        REQUIRE(!res["results"].empty());
        CHECK(res["results"].size() <= 3);
        CHECK(res["results"][0]["id"] == "b-admin");
    }
}

TEST_CASE("Task B2.2: LRU cache memoization, eviction order, and blocked-set invalidation via call()") {
    auto loadRes = loadRealMergedGraph();
    REQUIRE(loadRes["status"] == "ok");

    // Reset cache with capacity = 2 to test exact LRU eviction order
    auto stats0 = json::parse(call("cacheStats", R"({"reset": true, "capacity": 2})"));
    CHECK(stats0["hits"] == 0);
    CHECK(stats0["misses"] == 0);
    CHECK(stats0["size"] == 0);
    CHECK(stats0["capacity"] == 2);

    // Query A: n1 -> n10 (Miss #1, cache = [A])
    call("route", R"({"from": "n1", "to": "n10", "algo": "dijkstra"})");
    auto s1 = json::parse(call("cacheStats", "{}"));
    CHECK(s1["misses"] == 1);
    CHECK(s1["hits"] == 0);
    CHECK(s1["size"] == 1);

    // Query A again: n1 -> n10 (Hit #1, cache = [A])
    call("route", R"({"from": "n1", "to": "n10", "algo": "dijkstra"})");
    auto s2 = json::parse(call("cacheStats", "{}"));
    CHECK(s2["misses"] == 1);
    CHECK(s2["hits"] == 1);
    CHECK(s2["size"] == 1);

    // Query B: n1 -> n20 (Miss #2, cache = [B, A])
    call("route", R"({"from": "n1", "to": "n20", "algo": "dijkstra"})");
    auto s3 = json::parse(call("cacheStats", "{}"));
    CHECK(s3["misses"] == 2);
    CHECK(s3["hits"] == 1);
    CHECK(s3["size"] == 2);

    // Touch Query A again: n1 -> n10 (Hit #2 -> promotes A to MRU, B becomes LRU: cache = [A, B])
    call("route", R"({"from": "n1", "to": "n10", "algo": "dijkstra"})");
    auto s4 = json::parse(call("cacheStats", "{}"));
    CHECK(s4["misses"] == 2);
    CHECK(s4["hits"] == 2);
    CHECK(s4["size"] == 2);

    // Query C: n1 -> n30 (Miss #3 -> evicts LRU entry B! cache = [C, A])
    call("route", R"({"from": "n1", "to": "n30", "algo": "dijkstra"})");
    auto s5 = json::parse(call("cacheStats", "{}"));
    CHECK(s5["misses"] == 3);
    CHECK(s5["hits"] == 2);
    CHECK(s5["size"] == 2);
    CHECK(s5["evictions"] == 1);

    // Verify A is still cached (Hit #3)
    call("route", R"({"from": "n1", "to": "n10", "algo": "dijkstra"})");
    auto s6 = json::parse(call("cacheStats", "{}"));
    CHECK(s6["hits"] == 3);
    CHECK(s6["misses"] == 3);

    // Verify B was evicted (Miss #4)
    call("route", R"({"from": "n1", "to": "n20", "algo": "dijkstra"})");
    auto s7 = json::parse(call("cacheStats", "{}"));
    CHECK(s7["hits"] == 3);
    CHECK(s7["misses"] == 4);

    // Changing the blocked set invalidates existing cache entries
    call("route", R"({"from": "n1", "to": "n10", "algo": "dijkstra", "avoid": ["n5"]})");
    auto s8 = json::parse(call("cacheStats", "{}"));
    CHECK(s8["misses"] == 5);
    CHECK(s8["size"] == 1);
    CHECK(s8["invalidations"].get<int>() >= 1);

    // Restore default cache capacity
    call("cacheStats", R"({"reset": true, "capacity": 128})");
}

TEST_CASE("Task B2.3: Floyd-Warshall allPairs matrix and route(algo='floyd') equal Dijkstra on 100 random landmark pairs") {
    auto loadRes = loadRealMergedGraph();
    REQUIRE(loadRes["status"] == "ok");

    auto allPairsRes = json::parse(call("allPairs", "{}"));
    REQUIRE(allPairsRes.contains("matrix"));
    const auto& matrix = allPairsRes["matrix"];
    CHECK(allPairsRes["landmarkCount"].get<int>() == 55);

    std::vector<std::string> landmarkIds;
    for (auto it = matrix.begin(); it != matrix.end(); ++it) {
        landmarkIds.push_back(it.key());
    }
    REQUIRE(landmarkIds.size() == 55);

    std::mt19937 rng(1337);
    std::uniform_int_distribution<size_t> distIdx(0, landmarkIds.size() - 1);

    for (int trial = 0; trial < 100; ++trial) {
        const std::string& lmA = landmarkIds[distIdx(rng)];
        const std::string& lmB = landmarkIds[distIdx(rng)];

        json dReq = {{"from", lmA}, {"to", lmB}, {"algo", "dijkstra"}};
        json fReq = {{"from", lmA}, {"to", lmB}, {"algo", "floyd"}};

        const auto dRes = json::parse(call("route", dReq.dump().c_str()));
        const auto fRes = json::parse(call("route", fReq.dump().c_str()));

        REQUIRE(dRes["found"] == fRes["found"]);
        if (dRes["found"].get<bool>()) {
            const double dDist = dRes["distance"].get<double>();
            const double fDist = fRes["distance"].get<double>();
            REQUIRE(!matrix[lmA][lmB].is_null());
            const double mDist = matrix[lmA][lmB].get<double>();

            CHECK(fDist == doctest::Approx(dDist).epsilon(1e-6));
            CHECK(mDist == doctest::Approx(dDist).epsilon(1e-6));
            CHECK(!fRes["path"].empty());
        } else {
            CHECK(matrix[lmA][lmB].is_null());
        }
    }

    // Verify call("compare") includes Floyd and reports distance, nodesVisited, and timeUs
    auto cmpRes = json::parse(call("compare", R"({"from": "b-csit", "to": "b-library"})"));
    REQUIRE(cmpRes.contains("results"));
    for (const char* algo : {"dijkstra", "astar", "bfs", "bellmanford", "floyd"}) {
        REQUIRE(cmpRes["results"].contains(algo));
        const auto& entry = cmpRes["results"][algo];
        CHECK(entry["found"] == true);
        CHECK(entry.contains("distance"));
        CHECK(entry.contains("nodesVisited"));
        CHECK(entry.contains("visitedCount"));
        CHECK(entry.contains("timeUs"));
    }
    CHECK(cmpRes["results"]["floyd"]["distance"].get<double>() ==
          doctest::Approx(cmpRes["results"]["dijkstra"]["distance"].get<double>()).epsilon(1e-6));
}

TEST_CASE("Task B2.4: Kruskal MST total equals Prim MST total via call('mst')") {
    auto loadRes = loadRealMergedGraph();
    REQUIRE(loadRes["status"] == "ok");

    auto kruskalRes = json::parse(call("mst", R"({"algo": "kruskal"})"));
    auto primRes = json::parse(call("mst", R"({"algo": "prim"})"));

    REQUIRE(kruskalRes.contains("totalWeight"));
    REQUIRE(primRes.contains("totalWeight"));
    REQUIRE(kruskalRes.contains("edges"));
    REQUIRE(primRes.contains("edges"));

    // 86 connected outdoor nodes -> spanning tree has 85 edges
    CHECK(kruskalRes["edges"].size() == 85);
    CHECK(primRes["edges"].size() == 85);
    CHECK(kruskalRes["totalWeight"].get<double>() > 1000.0);
    CHECK(kruskalRes["totalWeight"].get<double>() ==
          doctest::Approx(primRes["totalWeight"].get<double>()).epsilon(1e-6));
    CHECK(kruskalRes["totalLength"].get<double>() ==
          doctest::Approx(primRes["totalLength"].get<double>()).epsilon(1e-6));
}

TEST_CASE("Task B2.5: TSP bitmask DP is <= Nearest-Neighbor and matches brute-force on 6 stops") {
    auto loadRes = loadRealMergedGraph();
    REQUIRE(loadRes["status"] == "ok");

    const std::vector<std::string> stops = {"n1", "n15", "n25", "n37", "n52", "n68"};
    const int k = static_cast<int>(stops.size());

    json dpReq = {{"stops", stops}, {"algo", "dp"}, {"returnToStart", false}};
    json nnReq = {{"stops", stops}, {"algo", "nn"}, {"returnToStart", false}};

    auto dpRes = json::parse(call("tsp", dpReq.dump().c_str()));
    auto nnRes = json::parse(call("tsp", nnReq.dump().c_str()));

    REQUIRE(dpRes["found"] == true);
    REQUIRE(nnRes["found"] == true);

    const double dpDist = dpRes["totalDistance"].get<double>();
    const double nnDist = nnRes["totalDistance"].get<double>();

    CHECK(dpDist <= nnDist + 1e-6);
    CHECK(dpRes["heuristicGapPercent"].get<double>() >= 0.0);
    CHECK(dpRes["order"].size() == static_cast<size_t>(k));
    CHECK(dpRes["path"].size() >= static_cast<size_t>(k));
    CHECK(dpRes["path"].front() == stops.front());
    CHECK(dpRes["path"].back() == dpRes["order"].back());

    // Brute-force check over all 5! = 120 permutations fixing stop 0 ("n1") at the start
    std::vector<std::vector<double>> pairDist(k, std::vector<double>(k, 0.0));
    for (int i = 0; i < k; ++i) {
        for (int j = 0; j < k; ++j) {
            if (i == j) continue;
            json rReq = {{"from", stops[i]}, {"to", stops[j]}, {"algo", "dijkstra"}};
            auto rRes = json::parse(call("route", rReq.dump().c_str()));
            REQUIRE(rRes["found"] == true);
            pairDist[i][j] = rRes["distance"].get<double>();
        }
    }

    std::vector<int> perm = {1, 2, 3, 4, 5};
    double bruteBest = std::numeric_limits<double>::infinity();
    do {
        double d = pairDist[0][perm[0]];
        for (size_t i = 0; i + 1 < perm.size(); ++i) {
            d += pairDist[perm[i]][perm[i + 1]];
        }
        bruteBest = std::min(bruteBest, d);
    } while (std::next_permutation(perm.begin(), perm.end()));

    CHECK(dpDist == doctest::Approx(bruteBest).epsilon(1e-6));

    // Also verify returnToStart: true against brute-force closed tour
    json dpClosedReq = {{"stops", stops}, {"algo", "dp"}, {"returnToStart", true}};
    auto dpClosedRes = json::parse(call("tsp", dpClosedReq.dump().c_str()));
    REQUIRE(dpClosedRes["found"] == true);
    CHECK(dpClosedRes["order"].front() == "n1");
    CHECK(dpClosedRes["order"].back() == "n1");

    std::vector<int> permClosed = {1, 2, 3, 4, 5};
    double bruteClosedBest = std::numeric_limits<double>::infinity();
    do {
        double d = pairDist[0][permClosed[0]];
        for (size_t i = 0; i + 1 < permClosed.size(); ++i) {
            d += pairDist[permClosed[i]][permClosed[i + 1]];
        }
        d += pairDist[permClosed.back()][0];
        bruteClosedBest = std::min(bruteClosedBest, d);
    } while (std::next_permutation(permClosed.begin(), permClosed.end()));

    CHECK(dpClosedRes["totalDistance"].get<double>() ==
          doctest::Approx(bruteClosedBest).epsilon(1e-6));
}

TEST_CASE("Task B2.6: Tarjan's articulation points and bridges on hand-made graph and real campus graph") {
    SUBCASE("Small hand-made graph with known articulation points and bridges") {
        // Topology:
        // Triangle 1: n1 - n2 - n3 - n1
        // Triangle 2: n4 - n5 - n6 - n4
        // Bridge between triangles: n3 - n4
        // Pendant vertex attached to n1: n1 - n7
        // Expected articulation points: {"n1", "n3", "n4"}
        // Expected bridges: {["n1", "n7"], ["n3", "n4"]}
        const char* handmadeGraph = R"({
            "meta": {"version": "1.0"},
            "nodes": [
                {"id": "n1", "lat": 24.9310, "lng": 67.1110},
                {"id": "n2", "lat": 24.9312, "lng": 67.1112},
                {"id": "n3", "lat": 24.9314, "lng": 67.1114},
                {"id": "n4", "lat": 24.9316, "lng": 67.1116},
                {"id": "n5", "lat": 24.9318, "lng": 67.1118},
                {"id": "n6", "lat": 24.9320, "lng": 67.1120},
                {"id": "n7", "lat": 24.9308, "lng": 67.1108}
            ],
            "edges": [
                {"a": "n1", "b": "n2", "w": 10.0},
                {"a": "n2", "b": "n3", "w": 10.0},
                {"a": "n3", "b": "n1", "w": 10.0},
                {"a": "n3", "b": "n4", "w": 15.0},
                {"a": "n4", "b": "n5", "w": 10.0},
                {"a": "n5", "b": "n6", "w": 10.0},
                {"a": "n6", "b": "n4", "w": 10.0},
                {"a": "n1", "b": "n7", "w": 8.0}
            ],
            "landmarks": [
                {"id": "b-gate", "name": "Main Gate Hub", "nodeId": "n1"},
                {"id": "b-bridge-west", "name": "West Connector", "nodeId": "n3"}
            ]
        })";

        auto loadRes = json::parse(call("load", handmadeGraph));
        REQUIRE(loadRes["status"] == "ok");

        auto cp = json::parse(call("criticalPoints", "{}"));
        REQUIRE(cp.contains("articulationPoints"));
        REQUIRE(cp.contains("bridges"));
        REQUIRE(cp.contains("landmarkNames"));

        const auto ap = cp["articulationPoints"].get<std::vector<std::string>>();
        const std::vector<std::string> expectedAp = {"n1", "n3", "n4"};
        CHECK(ap == expectedAp);

        std::set<std::pair<std::string, std::string>> bridgeSet;
        for (const auto& b : cp["bridges"]) {
            std::string u = b[0].get<std::string>();
            std::string v = b[1].get<std::string>();
            if (v < u) std::swap(u, v);
            bridgeSet.insert({u, v});
        }
        const std::set<std::pair<std::string, std::string>> expectedBridges = {
            {"n1", "n7"},
            {"n3", "n4"}
        };
        CHECK(bridgeSet == expectedBridges);
        CHECK(cp["landmarkNames"]["n1"] == "Main Gate Hub");
        CHECK(cp["landmarkNames"]["n3"] == "West Connector");
    }

    SUBCASE("Real campus graph critical points verification") {
        auto loadRes = loadRealMergedGraph();
        REQUIRE(loadRes["status"] == "ok");

        auto cp = json::parse(call("criticalPoints", "{}"));
        REQUIRE(cp.contains("articulationPoints"));
        REQUIRE(cp.contains("bridges"));
        REQUIRE(cp.contains("nodes"));
        REQUIRE(cp.contains("edges"));

        const auto ap = cp["articulationPoints"].get<std::vector<std::string>>();
        const auto bridges = cp["bridges"];
        CHECK(!ap.empty());
        CHECK(!bridges.empty());

        // Verify that blocking any reported bridge [u, v] genuinely disconnects u from v
        for (const auto& br : bridges) {
            const std::string u = br[0].get<std::string>();
            const std::string v = br[1].get<std::string>();
            json req = {
                {"from", u},
                {"to", v},
                {"algo", "dijkstra"},
                {"blockedEdges", json::array({json{{"a", u}, {"b", v}}})}
            };
            auto r = json::parse(call("route", req.dump().c_str()));
            CHECK(r["found"] == false);
        }
    }
}

TEST_CASE("Task B2 fix: PrefixTrie search ranking is strictly deterministic across different insertion orders") {
    auto loadRes = loadRealMergedGraph();
    REQUIRE(loadRes["status"] == "ok");

    const navcore::Graph& g = navcore::detail::globalGraph();
    const auto& originalItems = g.searchTrie.items;
    REQUIRE(!originalItems.empty());

    // 1. Build Trie Forward: normal item insertion order
    navcore::PrefixTrie trieForward;
    for (size_t i = 0; i < originalItems.size(); ++i) {
        trieForward.addEntry(originalItems[i]);
    }

    // 2. Build Trie Reverse: reverse item insertion order
    navcore::PrefixTrie trieReverse;
    for (size_t i = originalItems.size(); i > 0; --i) {
        trieReverse.addEntry(originalItems[i - 1]);
    }

    // 3. Build Trie Shuffled: pseudo-random item insertion order with fixed seed
    std::vector<navcore::SearchItem> shuffledItems = originalItems;
    std::mt19937 rng(4242);
    std::shuffle(shuffledItems.begin(), shuffledItems.end(), rng);

    navcore::PrefixTrie trieShuffled;
    for (const auto& item : shuffledItems) {
        trieShuffled.addEntry(item);
    }

    // Test a wide variety of queries: full-name, prefix, short name, number, room code
    const std::vector<std::string> testQueries = {
        "libr", "admin", "11", "auditorium", "Audi", "lab", "csit", "201", "g09", "library", "central", "main"
    };

    for (const auto& q : testQueries) {
        auto rFwd = trieForward.search(q, 10);
        auto rRev = trieReverse.search(q, 10);
        auto rShuf = trieShuffled.search(q, 10);

        REQUIRE(rFwd.size() == rRev.size());
        REQUIRE(rFwd.size() == rShuf.size());

        for (size_t i = 0; i < rFwd.size(); ++i) {
            CHECK(rFwd[i].id == rRev[i].id);
            CHECK(rFwd[i].kind == rRev[i].kind);
            CHECK(rFwd[i].label == rRev[i].label);

            CHECK(rShuf[i].id == rFwd[i].id);
            CHECK(rShuf[i].kind == rFwd[i].kind);
            CHECK(rShuf[i].label == rFwd[i].label);
        }
    }

    // Explicitly assert that "libr" returns landmark "b-library" first before any room
    auto resLibrFwd = trieForward.search("libr", 5);
    auto resLibrRev = trieReverse.search("libr", 5);
    REQUIRE(!resLibrFwd.empty());
    REQUIRE(!resLibrRev.empty());
    CHECK(resLibrFwd[0].id == "b-library");
    CHECK(resLibrFwd[0].kind == "landmark");
    CHECK(resLibrRev[0].id == "b-library");
    CHECK(resLibrRev[0].kind == "landmark");
}
