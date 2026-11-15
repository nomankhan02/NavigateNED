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

// ============================================================================
// Task B3 Unit Tests: Emergency Evacuation (Multi-Source Dijkstra & Min-Cost Max-Flow)
// ============================================================================

TEST_CASE("Task B3.1: evac.json loading and nearest mode matches brute-force minimum over all assembly areas on random nodes") {
    auto loadRes = loadRealMergedGraph();
    REQUIRE(loadRes["status"] == "ok");
    CHECK(loadRes["assemblyAreaCount"].get<int>() == 7);
    CHECK(loadRes["buildingExitCount"].get<int>() == 12);

    const navcore::Graph& g = navcore::detail::globalGraph();
    REQUIRE(g.assemblyAreas.size() == 7);
    REQUIRE(g.buildingExits.size() == 12);

    // Collect all non-lift nodes so we can sample random outdoor and indoor nodes
    std::vector<int> candidateNodes;
    for (int u = 0; u < g.nodeCount(); ++u) {
        if (g.nodes[u].kind != "lift") {
            candidateNodes.push_back(u);
        }
    }
    REQUIRE(candidateNodes.size() > 600);

    std::mt19937 rng(2026);
    std::uniform_int_distribution<size_t> distNode(0, candidateNodes.size() - 1);

    // Build a RouteOptions that blocks all lift nodes so single-pair forward Dijkstra
    // computes the exact lift-free shortest distance to each assembly area.
    navcore::RouteOptions liftBlockedOpts;
    liftBlockedOpts.algo = "dijkstra";
    liftBlockedOpts.maxTrace = 0;
    for (int u = 0; u < g.nodeCount(); ++u) {
        if (g.nodes[u].kind == "lift") {
            liftBlockedOpts.blockedNodes.insert(u);
        }
    }

    json peopleArr = json::array();
    std::vector<std::string> sampledIds;
    std::set<std::string> seen;

    while (sampledIds.size() < 60) {
        const int u = candidateNodes[distNode(rng)];
        const std::string& id = g.nodes[u].id;
        if (seen.insert(id).second) {
            sampledIds.push_back(id);
            peopleArr.push_back({{"at", id}, {"count", 5}});
        }
    }

    json evacReq = {
        {"mode", "nearest"},
        {"disableLifts", true},
        {"blocked", {{"nodes", json::array()}, {"edges", json::array()}}},
        {"people", peopleArr}
    };
    const auto evacRes = json::parse(call("evacuate", evacReq.dump().c_str()));
    REQUIRE(evacRes.contains("assignments"));
    CHECK(evacRes["mode"] == "nearest");
    CHECK(evacRes["unassigned"] == 0);
    REQUIRE(evacRes["assignments"].size() == sampledIds.size());

    for (const auto& assign : evacRes["assignments"]) {
        const std::string fromId = assign["from"].get<std::string>();
        const double reportedDist = assign["distance"].get<double>();
        const std::string reportedArea = assign["assemblyId"].get<std::string>();
        const int u = g.getNodeIndex(fromId);
        REQUIRE(u >= 0);

        // Brute-force minimum over all 7 assembly areas using forward single-pair Dijkstra
        double bruteMinDist = std::numeric_limits<double>::infinity();
        std::string bruteBestAreaId;
        for (const auto& area : g.assemblyAreas) {
            const int aNodeIdx = g.getNodeIndex(area.nodeId);
            REQUIRE(aNodeIdx >= 0);
            const auto r = navcore::runDijkstra(g, u, aNodeIdx, liftBlockedOpts);
            if (r.found) {
                if (r.distance + 1e-9 < bruteMinDist ||
                    (std::abs(r.distance - bruteMinDist) <= 1e-9 && area.id < bruteBestAreaId)) {
                    bruteMinDist = r.distance;
                    bruteBestAreaId = area.id;
                }
            }
        }

        CHECK(reportedDist == doctest::Approx(bruteMinDist).epsilon(1e-6));
        CHECK(reportedArea == bruteBestAreaId);

        // Also check call("nearestAssembly") agrees for this node
        json singleReq = {{"from", fromId}, {"disableLifts", true}};
        const auto singleRes = json::parse(call("nearestAssembly", singleReq.dump().c_str()));
        CHECK(singleRes["found"] == true);
        CHECK(singleRes["assemblyId"] == reportedArea);
        CHECK(singleRes["distance"].get<double>() == doctest::Approx(reportedDist).epsilon(1e-6));
    }
}

TEST_CASE("Task B3.2: capacity mode respects all area capacities, assigns everyone when capacity suffices, and reports exact unassigned when demand exceeds capacity") {
    auto loadRes = loadRealMergedGraph();
    REQUIRE(loadRes["status"] == "ok");

    const navcore::Graph& g = navcore::detail::globalGraph();
    int totalCampusCapacity = 0;
    for (const auto& a : g.assemblyAreas) {
        totalCampusCapacity += a.capacity;
    }
    REQUIRE(totalCampusCapacity == 6800);

    SUBCASE("Concentrated demand near Courtyard Fountain (cap 600) overloads in nearest mode but splits cleanly in capacity mode") {
        // Place 1,500 people right around Courtyard Fountain (n28, capacity 600) and Library (n76)
        json people = json::array({
            {{"at", "n28"}, {"count", 500}},
            {{"at", "b-library:204"}, {"count", 500}},
            {{"at", "b-csit:201"}, {"count", 500}}
        });

        json cmpReq = {
            {"disableLifts", true},
            {"blocked", {{"nodes", json::array()}, {"edges", json::array()}}},
            {"people", people}
        };
        const auto cmpRes = json::parse(call("evacuationCompare", cmpReq.dump().c_str()));
        REQUIRE(cmpRes.contains("nearest"));
        REQUIRE(cmpRes.contains("capacity"));

        const auto& nearMode = cmpRes["nearest"];
        const auto& capMode = cmpRes["capacity"];

        // Both modes assign all 1,500 people since total capacity is 6,800
        CHECK(nearMode["unassigned"].get<int>() == 0);
        CHECK(capMode["unassigned"].get<int>() == 0);

        // Nearest mode overloads at least one assembly area
        CHECK(nearMode["overloadedAreasCount"].get<int>() >= 1);
        CHECK( cmpRes["overloadedAreasCount"]["nearest"].get<int>() >= 1);

        // Capacity mode NEVER exceeds any assembly area's capacity
        CHECK(capMode["overloadedAreasCount"].get<int>() == 0);
        CHECK(cmpRes["overloadedAreasCount"]["capacity"].get<int>() == 0);

        int sumAssignedCap = 0;
        for (const auto& loadEntry : capMode["assemblyLoad"]) {
            const int assigned = loadEntry["assigned"].get<int>();
            const int cap = loadEntry["capacity"].get<int>();
            CHECK(assigned <= cap);
            sumAssignedCap += assigned;
        }
        CHECK(sumAssignedCap == 1500);
    }

    SUBCASE("Unassigned is exact when total demand exceeds total campus capacity (6,800)") {
        // Total demand = 8,050 across 4 locations -> excess = 8,050 - 6,800 = 1,250 unassigned
        json people = json::array({
            {{"at", "b-library:204"}, {"count", 2500}},
            {{"at", "b-csit:201"}, {"count", 2000}},
            {{"at", "b-auditorium:g01"}, {"count", 2000}},
            {{"at", "b-admin:101"}, {"count", 1550}}
        });

        json req = {
            {"mode", "capacity"},
            {"disableLifts", true},
            {"blocked", {{"nodes", json::array()}, {"edges", json::array()}}},
            {"people", people}
        };
        const auto res = json::parse(call("evacuate", req.dump().c_str()));
        CHECK(res["unassigned"].get<int>() == 1250);

        int totalAssigned = 0;
        for (const auto& loadEntry : res["assemblyLoad"]) {
            const int assigned = loadEntry["assigned"].get<int>();
            const int cap = loadEntry["capacity"].get<int>();
            CHECK(assigned == cap); // Every reachable assembly area is filled to 100% capacity
            totalAssigned += assigned;
        }
        CHECK(totalAssigned == 6800);
    }
}

TEST_CASE("Task B3.3: Min-cost max-flow cost equals brute-force optimum on a 3-group, 3-area instance and respects oneway edges") {
    // Construct a directed graph with 3 group nodes (g1, g2, g3) and 3 assembly areas (a1, a2, a3)
    // with asymmetric distances and capacities so greedy nearest assignment is suboptimal.
    const char* syntheticEvacGraph = R"({
        "meta": {"version": "1.0"},
        "nodes": [
            {"id": "g1", "lat": 24.9310, "lng": 67.1110},
            {"id": "g2", "lat": 24.9312, "lng": 67.1112},
            {"id": "g3", "lat": 24.9314, "lng": 67.1114},
            {"id": "a1", "lat": 24.9320, "lng": 67.1120},
            {"id": "a2", "lat": 24.9322, "lng": 67.1122},
            {"id": "a3", "lat": 24.9324, "lng": 67.1124}
        ],
        "edges": [
            {"a": "g1", "b": "a1", "w": 10.0, "oneway": true},
            {"a": "g1", "b": "a2", "w": 20.0, "oneway": true},
            {"a": "g1", "b": "a3", "w": 90.0, "oneway": true},
            {"a": "g2", "b": "a1", "w": 12.0, "oneway": true},
            {"a": "g2", "b": "a2", "w": 60.0, "oneway": true},
            {"a": "g2", "b": "a3", "w": 70.0, "oneway": true},
            {"a": "g3", "b": "a1", "w": 50.0, "oneway": true},
            {"a": "g3", "b": "a2", "w": 25.0, "oneway": true},
            {"a": "g3", "b": "a3", "w": 30.0, "oneway": true}
        ],
        "assemblyAreas": [
            {"id": "area-1", "name": "Assembly 1", "nodeId": "a1", "capacity": 5},
            {"id": "area-2", "name": "Assembly 2", "nodeId": "a2", "capacity": 5},
            {"id": "area-3", "name": "Assembly 3", "nodeId": "a3", "capacity": 4}
        ]
    })";

    auto loadRes = json::parse(call("load", syntheticEvacGraph));
    REQUIRE(loadRes["status"] == "ok");
    CHECK(loadRes["assemblyAreaCount"] == 3);

    // Group supplies: g1 = 4, g2 = 5, g3 = 3 (total demand = 12 <= total capacity = 14)
    const int s[3] = {4, 5, 3};
    const int cap[3] = {5, 5, 4};
    const double cost[3][3] = {
        {10.0, 20.0, 90.0},
        {12.0, 60.0, 70.0},
        {50.0, 25.0, 30.0}
    };

    // Brute-force enumerate all non-negative integer 3x3 flow matrices f[i][j]
    // satisfying row sums == s[i] and column sums <= cap[j].
    double bruteOptCost = std::numeric_limits<double>::infinity();
    for (int f00 = 0; f00 <= s[0]; ++f00) {
        for (int f01 = 0; f00 + f01 <= s[0]; ++f01) {
            const int f02 = s[0] - f00 - f01;
            for (int f10 = 0; f10 <= s[1]; ++f10) {
                for (int f11 = 0; f10 + f11 <= s[1]; ++f11) {
                    const int f12 = s[1] - f10 - f11;
                    for (int f20 = 0; f20 <= s[2]; ++f20) {
                        for (int f21 = 0; f20 + f21 <= s[2]; ++f21) {
                            const int f22 = s[2] - f20 - f21;
                            if (f00 + f10 + f20 > cap[0]) continue;
                            if (f01 + f11 + f21 > cap[1]) continue;
                            if (f02 + f12 + f22 > cap[2]) continue;

                            const double totalC =
                                f00 * cost[0][0] + f01 * cost[0][1] + f02 * cost[0][2] +
                                f10 * cost[1][0] + f11 * cost[1][1] + f12 * cost[1][2] +
                                f20 * cost[2][0] + f21 * cost[2][1] + f22 * cost[2][2];
                            bruteOptCost = std::min(bruteOptCost, totalC);
                        }
                    }
                }
            }
        }
    }

    json evacReq = {
        {"mode", "capacity"},
        {"people", json::array({
            {{"at", "g1"}, {"count", s[0]}},
            {{"at", "g2"}, {"count", s[1]}},
            {{"at", "g3"}, {"count", s[2]}}
        })}
    };
    const auto evacRes = json::parse(call("evacuate", evacReq.dump().c_str()));
    CHECK(evacRes["unassigned"].get<int>() == 0);
    CHECK(evacRes["totalDistance"].get<double>() == doctest::Approx(bruteOptCost).epsilon(1e-6));
}

TEST_CASE("Task B3.4: Blocking a node on an evacuation path changes the path and assignment; lifts disabled by default; indoor upper-floor room evacuates via stairs with exitNodeId") {
    auto loadRes = loadRealMergedGraph();
    REQUIRE(loadRes["status"] == "ok");

    const navcore::Graph& g = navcore::detail::globalGraph();

    SUBCASE("Upper-floor indoor room (b-library:204) evacuates via stairs, never uses lifts when disableLifts=true, and populates exitNodeId") {
        json req = {
            {"mode", "nearest"},
            {"disableLifts", true},
            {"blocked", {{"nodes", json::array()}, {"edges", json::array()}}},
            {"people", json::array({{{"at", "b-library:204"}, {"count", 25}}})}
        };
        const auto res = json::parse(call("evacuate", req.dump().c_str()));
        REQUIRE(res["assignments"].size() == 1);
        const auto& assign = res["assignments"][0];

        CHECK(assign["from"] == "b-library:204");
        CHECK(assign["count"] == 25);
        CHECK(assign["distance"].get<double>() > 30.0);
        REQUIRE(assign.contains("exitNodeId"));
        const std::string exitId = assign["exitNodeId"].get<std::string>();
        CHECK((exitId == "b-library:exit_nw" || exitId == "b-library:exit_se"));

        const auto path = assign["path"].get<std::vector<std::string>>();
        REQUIRE(path.size() >= 6);
        CHECK(path.front() == "b-library:204");

        bool usedStairsEdge = false;
        bool usedLiftEdgeOrNode = false;
        for (size_t i = 0; i + 1 < path.size(); ++i) {
            const int u = g.getNodeIndex(path[i]);
            const int v = g.getNodeIndex(path[i + 1]);
            REQUIRE(u >= 0);
            REQUIRE(v >= 0);
            if (g.nodes[u].kind == "lift" || g.nodes[v].kind == "lift") {
                usedLiftEdgeOrNode = true;
            }
            for (const auto& e : g.adj[u]) {
                if (e.to == v) {
                    if (e.kind == "stairs") usedStairsEdge = true;
                    if (e.kind == "lift") usedLiftEdgeOrNode = true;
                }
            }
        }
        CHECK(usedStairsEdge);
        CHECK_FALSE(usedLiftEdgeOrNode);
    }

    SUBCASE("Blocking all stairs while disableLifts=true makes upper-floor room unreachable, whereas disableLifts=false evacuates via lift") {
        // Block the ground-floor staircase node in b-csit (b-csit:f0_stairs)
        json blockedStairsReq = {
            {"from", "b-csit:201"},
            {"disableLifts", true},
            {"blocked", {{"nodes", json::array({"b-csit:f0_stairs"})}, {"edges", json::array()}}}
        };
        const auto blockedRes = json::parse(call("nearestAssembly", blockedStairsReq.dump().c_str()));
        // With stairs blocked and disableLifts=true, floor 2 cannot reach floor 0!
        CHECK(blockedRes["found"] == false);

        // With disableLifts=false, floor 2 can use the elevator (b-csit:f2_lift -> f1_lift -> f0_lift)
        json allowLiftsReq = {
            {"from", "b-csit:201"},
            {"disableLifts", false},
            {"blocked", {{"nodes", json::array({"b-csit:f0_stairs"})}, {"edges", json::array()}}}
        };
        const auto liftRes = json::parse(call("nearestAssembly", allowLiftsReq.dump().c_str()));
        CHECK(liftRes["found"] == true);
        CHECK(liftRes["distance"].get<double>() > 30.0);
    }

    SUBCASE("Blocking a node on an evacuation path changes the path and the assigned assembly area") {
        json initReq = {
            {"mode", "nearest"},
            {"disableLifts", true},
            {"blocked", {{"nodes", json::array()}, {"edges", json::array()}}},
            {"people", json::array({{{"at", "b-csit:201"}, {"count", 40}}})}
        };
        const auto initRes = json::parse(call("evacuate", initReq.dump().c_str()));
        REQUIRE(initRes["assignments"].size() == 1);

        const auto initAssign = initRes["assignments"][0];
        const std::string initAreaId = initAssign["assemblyId"].get<std::string>();
        const auto initPath = initAssign["path"].get<std::vector<std::string>>();
        REQUIRE(initPath.size() >= 6);

        // 1. Block an intermediate node on the ring corridor (initPath[2]) -> path reroutes around the ring
        const std::string blockedCorridorNode = initPath[2];
        json midBlockedReq = {
            {"mode", "nearest"},
            {"disableLifts", true},
            {"blocked", {{"nodes", json::array({blockedCorridorNode})}, {"edges", json::array()}}},
            {"people", json::array({{{"at", "b-csit:201"}, {"count", 40}}})}
        };
        const auto midBlockedRes = json::parse(call("evacuate", midBlockedReq.dump().c_str()));
        REQUIRE(midBlockedRes["assignments"].size() == 1);
        const auto reroutedPath = midBlockedRes["assignments"][0]["path"].get<std::vector<std::string>>();
        CHECK(reroutedPath != initPath);
        for (const auto& nid : reroutedPath) {
            CHECK(nid != blockedCorridorNode);
        }

        // 2. Block the destination node of the initially assigned assembly area -> changes both path and assignment
        const std::string initAreaNodeId = initPath.back();
        json areaBlockedReq = {
            {"mode", "nearest"},
            {"disableLifts", true},
            {"blocked", {{"nodes", json::array({initAreaNodeId})}, {"edges", json::array()}}},
            {"people", json::array({{{"at", "b-csit:201"}, {"count", 40}}})}
        };
        const auto areaBlockedRes = json::parse(call("evacuate", areaBlockedReq.dump().c_str()));
        REQUIRE(areaBlockedRes["assignments"].size() == 1);
        const std::string newAreaId = areaBlockedRes["assignments"][0]["assemblyId"].get<std::string>();
        const auto newAreaPath = areaBlockedRes["assignments"][0]["path"].get<std::vector<std::string>>();
        CHECK(newAreaId != initAreaId);
        CHECK(newAreaPath != initPath);
        for (const auto& nid : newAreaPath) {
            CHECK(nid != initAreaNodeId);
        }
    }
}

