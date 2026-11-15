/**
 * ============================================================================
 * NavigateNED — C++17 Campus & Indoor Routing Engine (core/src/navcore.cpp)
 * ============================================================================
 *
 * Single-file Data Structures & Algorithms (DSA) engine compiled to both
 * native C++17 (for Doctest unit tests and terminal CLI) and WebAssembly via
 * Emscripten (for the Next.js static web client).
 *
 * TABLE OF CONTENTS
 * -----------------
 *   SECTION 1: Types & Graph Representation
 *              - Node, Edge, TraceEvent, RouteOptions, RouteResult structs
 *              - Geodesic Haversine distance utility
 *              - Graph class (adjacency list, ID <-> index maps, coordinates)
 *
 *   SECTION 2: JSON Graph Loading (Outdoor + Multi-Building Indoor Merger)
 *              - Outdoor campus graph parser (data/graph.json)
 *              - Indoor floor-plan parser (data/indoor/<buildingId>.json)
 *              - Entrance coordinate propagation for admissible indoor heuristics
 *              - Filesystem directory loader (merges graph.json + indoor/*.json)
 *
 *   SECTION 3: Routing Algorithms & Path Step Formatting
 *              - 3.1 Path Reconstruction & Outdoor/Indoor/Floor Step Builder
 *              - 3.2 Dijkstra's Algorithm (Binary Min-Heap Priority Queue)
 *              - 3.3 A* Search Algorithm (Admissible Haversine Heuristic)
 *              - 3.4 Breadth-First Search / BFS (Fewest-Hops FIFO Queue)
 *              - 3.5 Bellman-Ford Algorithm (Edge Relaxation & Negative Cycle Check)
 *              - 3.6 Multi-Algorithm Benchmark Comparator
 *
 *   SECTION 4: WASM / Native JSON Dispatcher — call(fn, argsJson)
 *              - Request handlers: "ping", "load", "route", "compare"
 *              - Exception-safe C ABI entry point & #ifdef __EMSCRIPTEN__ export
 *
 *   SECTION 5: Optional Terminal CLI Runner (#ifdef NAVCORE_CLI)
 *              - Command-line interface for "route", "compare", and "ping"
 * ============================================================================
 */

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <limits>
#include <queue>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define NAVCORE_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define NAVCORE_EXPORT
#endif

namespace navcore {

using json = nlohmann::json;

// ============================================================================
// SECTION 1: Types & Graph Representation
// ============================================================================

constexpr double kEarthRadiusMeters = 6371000.0;
constexpr double kPi = 3.14159265358979323846;
constexpr double kInf = std::numeric_limits<double>::infinity();
constexpr size_t kMaxTraceEvents = 2000;

/**
 * Computes the great-circle Haversine distance in meters between two
 * geographic coordinates (lat1, lng1) and (lat2, lng2) in degrees.
 */
inline double haversineMeters(double lat1, double lng1, double lat2, double lng2) {
    const double phi1 = lat1 * (kPi / 180.0);
    const double phi2 = lat2 * (kPi / 180.0);
    const double dphi = (lat2 - lat1) * (kPi / 180.0);
    const double dlam = (lng2 - lng1) * (kPi / 180.0);

    const double sinDphi = std::sin(dphi * 0.5);
    const double sinDlam = std::sin(dlam * 0.5);
    const double a = sinDphi * sinDphi +
                     std::cos(phi1) * std::cos(phi2) * sinDlam * sinDlam;
    const double clampedA = std::min(1.0, std::max(0.0, a));
    return 2.0 * kEarthRadiusMeters * std::atan2(std::sqrt(clampedA), std::sqrt(1.0 - clampedA));
}

/**
 * Formats a floating-point meter distance to 1 decimal place for step descriptions.
 */
inline std::string formatMeters(double meters) {
    std::ostringstream oss;
    oss << std::fixed << std::setprecision(1) << meters;
    return oss.str();
}

/**
 * Represents a single vertex in the merged outdoor + indoor navigation graph.
 * - Outdoor nodes have IDs "n<number>" and GPS coordinates (lat, lng).
 * - Indoor nodes have IDs "<buildingId>:<local>", floor level, local planar
 *   coordinates (x, y), and inherit their building's outdoor entrance (lat, lng)
 *   for admissible A* heuristic evaluation.
 */
struct Node {
    int index = -1;
    std::string id;
    std::string name;
    std::string kind = "path"; // path, entrance, gate, assembly, poi, corridor, room, stairs, lift, exit
    bool isIndoor = false;
    std::string buildingId;
    std::string buildingName;
    int floor = 0;
    double lat = 0.0;
    double lng = 0.0;
    bool hasCoords = false;
    double x = 0.0;
    double y = 0.0;
};

/**
 * Represents a directed edge in the adjacency list.
 * Undirected edges in JSON (oneway: false) are stored as two symmetric directed edges.
 */
struct Edge {
    int from = -1;
    int to = -1;
    double w = 0.0;            // Honest walking weight in meters
    std::string kind = "walk"; // "walk" | "stairs" | "lift"
    bool accessible = true;    // false for stairs, true for ramps/lifts/walkways
    bool oneway = false;
    bool covered = false;
};

/**
 * Represents a single step in the algorithm execution trace for visual replay.
 */
struct TraceEvent {
    std::string type; // "visit" | "relax" | "frontier"
    std::string node; // Node ID string
    double dist = 0.0;
};

/**
 * Per-query routing configuration supporting algorithm selection, step-free
 * accessibility filtering, and blocked nodes / edges.
 */
struct RouteOptions {
    std::string algo = "dijkstra";
    bool accessibleOnly = false;
    std::unordered_set<int> blockedNodes;
    std::unordered_set<uint64_t> blockedEdges;
    size_t maxTrace = kMaxTraceEvents;

    static uint64_t edgeKey(int u, int v) {
        return (static_cast<uint64_t>(static_cast<uint32_t>(u)) << 32) |
               static_cast<uint32_t>(v);
    }

    void blockEdge(int u, int v, bool bothDirections = true) {
        blockedEdges.insert(edgeKey(u, v));
        if (bothDirections) {
            blockedEdges.insert(edgeKey(v, u));
        }
    }

    bool isNodeBlocked(int u) const {
        return blockedNodes.find(u) != blockedNodes.end();
    }

    bool isEdgeBlocked(int u, int v) const {
        return blockedEdges.find(edgeKey(u, v)) != blockedEdges.end();
    }
};

/**
 * Result returned by any single-pair shortest path algorithm.
 */
struct RouteResult {
    bool found = false;
    bool negativeCycle = false;
    double distance = 0.0;
    int visitedCount = 0;
    std::vector<int> pathIndices;
    std::vector<std::string> path;
    std::vector<std::string> steps;
    std::vector<TraceEvent> trace;
    std::string error;
};

/**
 * Adjacency-list graph storing the merged outdoor campus network and all indoor
 * multi-floor building graphs.
 */
class Graph {
public:
    std::vector<Node> nodes;
    std::unordered_map<std::string, int> idToIndex;
    std::vector<std::vector<Edge>> adj;

    // Metadata maps for linking indoor buildings to outdoor entrance nodes
    std::unordered_map<std::string, std::string> landmarkToEntranceNode;
    std::unordered_map<std::string, std::string> buildingNames;
    std::unordered_map<std::string, std::unordered_map<int, std::string>> floorLabels;

    int logicalEdgeCount = 0;
    int indoorBuildingCount = 0;
    double heuristicScale = 0.999;

    void clear() {
        nodes.clear();
        idToIndex.clear();
        adj.clear();
        landmarkToEntranceNode.clear();
        buildingNames.clear();
        floorLabels.clear();
        logicalEdgeCount = 0;
        indoorBuildingCount = 0;
        heuristicScale = 0.999;
    }

    int nodeCount() const {
        return static_cast<int>(nodes.size());
    }

    bool hasNode(const std::string& id) const {
        return idToIndex.find(id) != idToIndex.end();
    }

    int getNodeIndex(const std::string& id) const {
        auto it = idToIndex.find(id);
        return (it != idToIndex.end()) ? it->second : -1;
    }

    /**
     * Ensures a node with the given string ID exists in the graph and returns its integer index.
     */
    int ensureNode(const std::string& id) {
        auto it = idToIndex.find(id);
        if (it != idToIndex.end()) {
            return it->second;
        }
        const int idx = static_cast<int>(nodes.size());
        Node n;
        n.index = idx;
        n.id = id;
        const auto colonPos = id.find(':');
        if (colonPos != std::string::npos) {
            n.isIndoor = true;
            n.buildingId = id.substr(0, colonPos);
        }
        nodes.push_back(std::move(n));
        adj.emplace_back();
        idToIndex[id] = idx;
        return idx;
    }

    /**
     * Adds a single directed edge (u -> v) to the adjacency list, avoiding exact duplicates.
     */
    void addDirectedEdge(int u, int v, double w, const std::string& kind,
                         bool accessible, bool oneway, bool covered) {
        for (auto& existing : adj[u]) {
            if (existing.to == v && existing.kind == kind &&
                std::abs(existing.w - w) < 1e-9) {
                existing.accessible = accessible;
                existing.oneway = oneway;
                existing.covered = covered;
                return;
            }
        }
        Edge e;
        e.from = u;
        e.to = v;
        e.w = w;
        e.kind = kind;
        e.accessible = accessible;
        e.oneway = oneway;
        e.covered = covered;
        adj[u].push_back(std::move(e));
    }

    /**
     * Adds an edge from JSON parameters (adds both directions when oneway is false).
     */
    void addEdge(const std::string& aId, const std::string& bId, double w,
                 const std::string& kind = "walk", bool accessible = true,
                 bool oneway = false, bool covered = false) {
        const int u = ensureNode(aId);
        const int v = ensureNode(bId);
        addDirectedEdge(u, v, w, kind, accessible, oneway, covered);
        if (!oneway) {
            addDirectedEdge(v, u, w, kind, accessible, oneway, covered);
        }
        logicalEdgeCount++;
    }

    /**
     * Returns whether an edge (u -> v) can be traversed under the given RouteOptions.
     */
    bool canTraverse(int u, const Edge& e, const RouteOptions& opts) const {
        if (opts.isNodeBlocked(e.to)) return false;
        if (opts.isEdgeBlocked(u, e.to)) return false;
        if (opts.accessibleOnly && !e.accessible) return false;
        return true;
    }

    /**
     * Admissible Haversine heuristic in meters from node u to target node.
     * Indoor nodes use their building's outdoor entrance coordinates.
     * Consequently:
     * - Two nodes in the same building have h = 0 <= true indoor distance.
     * - An indoor node and an outdoor node have h = Haversine(entrance, outdoor)
     *   <= outdoor footpath distance < indoor leg + 3m entrance link + outdoor leg.
     */
    double heuristic(int u, int target) const {
        if (u < 0 || target < 0 || u >= nodeCount() || target >= nodeCount()) {
            return 0.0;
        }
        if (u == target) return 0.0;
        const Node& nu = nodes[u];
        const Node& nt = nodes[target];
        if (!nu.hasCoords || !nt.hasCoords) return 0.0;
        if (!nu.buildingId.empty() && nu.buildingId == nt.buildingId) {
            return 0.0;
        }
        const double rawMeters = haversineMeters(nu.lat, nu.lng, nt.lat, nt.lng);
        return std::max(0.0, rawMeters * heuristicScale - 0.05);
    }

    /**
     * Returns a human-readable label for a node index.
     */
    std::string displayNodeName(int idx) const {
        if (idx < 0 || idx >= nodeCount()) return "";
        const Node& n = nodes[idx];
        if (!n.name.empty()) {
            return n.name + " (" + n.id + ")";
        }
        return n.id;
    }

    /**
     * Returns a human-readable floor label for an indoor node index.
     */
    std::string floorLabel(int idx) const {
        if (idx < 0 || idx >= nodeCount()) return "Floor 0";
        const Node& n = nodes[idx];
        auto bIt = floorLabels.find(n.buildingId);
        if (bIt != floorLabels.end()) {
            auto fIt = bIt->second.find(n.floor);
            if (fIt != bIt->second.end() && !fIt->second.empty()) {
                return fIt->second;
            }
        }
        if (n.floor == 0) return "Ground Floor";
        return "Floor " + std::to_string(n.floor);
    }

    // ========================================================================
    // SECTION 2: JSON Graph Loading (Outdoor + Multi-Building Indoor Merger)
    // ========================================================================

    /**
     * Loads an outdoor campus graph JSON object (conforming to data/graph.json).
     * Ignores optional edge `geometry` arrays for routing; uses honest meter weight `w`.
     */
    void loadOutdoorJson(const json& j) {
        if (j.contains("landmarks") && j["landmarks"].is_array()) {
            for (const auto& lm : j["landmarks"]) {
                const std::string lmId = lm.value("id", "");
                const std::string nodeId = lm.value("nodeId", "");
                const std::string lmName = lm.value("name", "");
                if (!lmId.empty() && !nodeId.empty()) {
                    landmarkToEntranceNode[lmId] = nodeId;
                }
                if (!lmId.empty() && !lmName.empty()) {
                    buildingNames[lmId] = lmName;
                }
            }
        }

        if (j.contains("nodes") && j["nodes"].is_array()) {
            for (const auto& nj : j["nodes"]) {
                const std::string id = nj.value("id", "");
                if (id.empty()) continue;
                const int idx = ensureNode(id);
                Node& n = nodes[idx];
                n.isIndoor = (id.find(':') != std::string::npos);
                n.kind = nj.value("kind", n.isIndoor ? "corridor" : "path");
                if (nj.contains("name") && nj["name"].is_string()) {
                    n.name = nj["name"].get<std::string>();
                } else if (nj.contains("label") && nj["label"].is_string()) {
                    n.name = nj["label"].get<std::string>();
                }
                if (nj.contains("lat") && nj.contains("lng") &&
                    nj["lat"].is_number() && nj["lng"].is_number()) {
                    n.lat = nj["lat"].get<double>();
                    n.lng = nj["lng"].get<double>();
                    n.hasCoords = true;
                }
                if (nj.contains("floor") && nj["floor"].is_number_integer()) {
                    n.floor = nj["floor"].get<int>();
                }
            }
        }

        if (j.contains("edges") && j["edges"].is_array()) {
            for (const auto& ej : j["edges"]) {
                const std::string a = ej.value("a", "");
                const std::string b = ej.value("b", "");
                if (a.empty() || b.empty()) continue;
                const double w = ej.value("w", 1.0);
                const std::string kind = ej.value("kind", "walk");
                const bool defaultAcc = (kind != "stairs");
                const bool accessible = ej.value("accessible", defaultAcc);
                const bool oneway = ej.value("oneway", false);
                const bool covered = ej.value("covered", false);
                // Note: ej["geometry"] is optional display-only data and intentionally ignored.
                addEdge(a, b, w, kind, accessible, oneway, covered);
            }
        }
    }

    /**
     * Merges an indoor building JSON object (conforming to data/indoor/<id>.json)
     * into the current graph. Links the building's entrance node to the outdoor
     * campus graph via the 3 m edge already present in the indoor JSON's edges array.
     */
    void loadIndoorJson(const json& j) {
        const std::string bId = j.value("id", j.value("landmarkId", ""));
        const std::string bName = j.value("name", bId);
        if (!bId.empty() && !bName.empty()) {
            buildingNames[bId] = bName;
        }

        if (j.contains("floors") && j["floors"].is_array()) {
            for (const auto& fj : j["floors"]) {
                if (fj.contains("level") && fj["level"].is_number_integer()) {
                    const int lvl = fj["level"].get<int>();
                    const std::string lbl = fj.value("label", "Floor " + std::to_string(lvl));
                    floorLabels[bId][lvl] = lbl;
                }
            }
        }

        if (j.contains("nodes") && j["nodes"].is_array()) {
            for (const auto& nj : j["nodes"]) {
                const std::string id = nj.value("id", "");
                if (id.empty()) continue;
                const int idx = ensureNode(id);
                Node& n = nodes[idx];
                n.isIndoor = true;
                if (!bId.empty()) {
                    n.buildingId = bId;
                }
                n.buildingName = bName;
                n.floor = nj.value("floor", 0);
                n.kind = nj.value("type", nj.value("kind", "corridor"));
                if (nj.contains("name") && nj["name"].is_string()) {
                    n.name = nj["name"].get<std::string>();
                }
                n.x = nj.value("x", 0.0);
                n.y = nj.value("y", 0.0);
            }
        }

        if (j.contains("edges") && j["edges"].is_array()) {
            for (const auto& ej : j["edges"]) {
                const std::string a = ej.value("a", "");
                const std::string b = ej.value("b", "");
                if (a.empty() || b.empty()) continue;
                const std::string kind = ej.value("kind", "walk");
                const double w = ej.value("w", kind == "stairs" ? 10.0 : (kind == "lift" ? 15.0 : 1.0));
                const bool defaultAcc = (kind != "stairs");
                const bool accessible = ej.value("accessible", defaultAcc);
                const bool oneway = ej.value("oneway", false);
                const bool covered = ej.value("covered", true);
                addEdge(a, b, w, kind, accessible, oneway, covered);
            }
        }

        indoorBuildingCount++;
    }

    /**
     * Propagates each building's outdoor entrance (lat, lng) coordinates to all
     * indoor nodes belonging to that building so A* heuristics remain admissible,
     * and calibrates heuristicScale so h(u, v) <= w(u, v) across all positive edges.
     */
    void finalizeCoordinatesAndHeuristic() {
        // 1. Discover buildingId -> outdoor entrance node from cross-boundary edges (e.g. b-csit:ent <-> n21)
        for (const auto& uEdges : adj) {
            for (const auto& e : uEdges) {
                const Node& nu = nodes[e.from];
                const Node& nv = nodes[e.to];
                if (nu.isIndoor && !nv.isIndoor && nv.hasCoords && !nu.buildingId.empty()) {
                    landmarkToEntranceNode[nu.buildingId] = nv.id;
                } else if (!nu.isIndoor && nv.isIndoor && nu.hasCoords && !nv.buildingId.empty()) {
                    landmarkToEntranceNode[nv.buildingId] = nu.id;
                }
            }
        }

        // 2. Assign outdoor entrance (lat, lng) to every indoor node of that building
        for (auto& n : nodes) {
            if (n.isIndoor && !n.buildingId.empty()) {
                if (n.buildingName.empty()) {
                    auto bnIt = buildingNames.find(n.buildingId);
                    if (bnIt != buildingNames.end()) {
                        n.buildingName = bnIt->second;
                    }
                }
                auto it = landmarkToEntranceNode.find(n.buildingId);
                if (it != landmarkToEntranceNode.end()) {
                    const int entIdx = getNodeIndex(it->second);
                    if (entIdx >= 0 && nodes[entIdx].hasCoords) {
                        n.lat = nodes[entIdx].lat;
                        n.lng = nodes[entIdx].lng;
                        n.hasCoords = true;
                    }
                }
            }
        }

        // 3. Ensure heuristicScale never overestimates any positive-weight edge
        heuristicScale = 0.999;
        for (const auto& uEdges : adj) {
            for (const auto& e : uEdges) {
                if (e.w <= 0.0) continue;
                const Node& nu = nodes[e.from];
                const Node& nv = nodes[e.to];
                if (!nu.hasCoords || !nv.hasCoords) continue;
                if (!nu.buildingId.empty() && nu.buildingId == nv.buildingId) continue;
                const double hav = haversineMeters(nu.lat, nu.lng, nv.lat, nv.lng);
                if (hav > 1e-6 && hav * heuristicScale > e.w) {
                    heuristicScale = std::max(0.0, (e.w / hav) * 0.999);
                }
            }
        }
    }

    /**
     * Loads a JSON value that may be:
     * - An outdoor campus graph (with optional embedded "indoor" array)
     * - A single indoor building floor-plan JSON (merged into current graph)
     * - A bundle {"outdoor": {...}, "indoor": [...]}
     * - A filesystem loader directive {"dataDir": "data"} or {"graphPath": "..."}
     */
    void loadFromJsonValue(const json& parsed) {
        if (parsed.is_array()) {
            clear();
            for (const auto& item : parsed) {
                if (isIndoorJsonObject(item)) {
                    loadIndoorJson(item);
                } else {
                    loadOutdoorJson(item);
                }
            }
            finalizeCoordinatesAndHeuristic();
            return;
        }

        if (!parsed.is_object()) {
            throw std::runtime_error("Graph JSON must be an object or array");
        }

        // Directive to load from disk directory (e.g. {"dataDir": "data"} or empty {})
        if (parsed.empty() || parsed.contains("dataDir") || parsed.contains("graphPath")) {
            const std::string reqDir = parsed.value("dataDir", "");
            const std::string reqGraphPath = parsed.value("graphPath", "");
            if (!reqGraphPath.empty()) {
                const std::string indoorDir = parsed.value("indoorDir", "");
                loadFromDiskFiles(reqGraphPath, indoorDir);
                return;
            }
            const std::string resolvedDir = resolveDataDirectory(reqDir.empty() ? "data" : reqDir);
            loadFromDataDirectory(resolvedDir);
            return;
        }

        // Combined {"outdoor": {...}, "indoor": [...]} bundle
        if (parsed.contains("outdoor") && parsed["outdoor"].is_object()) {
            clear();
            loadOutdoorJson(parsed["outdoor"]);
            if (parsed.contains("indoor") && parsed["indoor"].is_array()) {
                for (const auto& ind : parsed["indoor"]) {
                    loadIndoorJson(ind);
                }
            }
            finalizeCoordinatesAndHeuristic();
            return;
        }

        // Single indoor building JSON: merge into existing graph unless "reset": true
        if (isIndoorJsonObject(parsed)) {
            if (parsed.value("reset", false)) {
                clear();
            }
            loadIndoorJson(parsed);
            finalizeCoordinatesAndHeuristic();
            return;
        }

        // Standard outdoor graph JSON
        if (!parsed.value("append", false)) {
            clear();
        }
        loadOutdoorJson(parsed);
        if (parsed.contains("indoor") && parsed["indoor"].is_array()) {
            for (const auto& ind : parsed["indoor"]) {
                loadIndoorJson(ind);
            }
        }
        finalizeCoordinatesAndHeuristic();
    }

    /**
     * Reads and parses a JSON file from disk.
     */
    static json readJsonFile(const std::filesystem::path& filePath) {
        std::ifstream ifs(filePath);
        if (!ifs.is_open()) {
            throw std::runtime_error("Cannot open file: " + filePath.string());
        }
        json j;
        ifs >> j;
        return j;
    }

    /**
     * Resolves the path to the `data/` directory across different working directories
     * (e.g., repo root, `core/`, or `core/build-native/`).
     */
    static std::string resolveDataDirectory(const std::string& hint = "data") {
        namespace fs = std::filesystem;
        const std::vector<fs::path> candidates = {
            fs::path(hint),
            fs::path("..") / hint,
            fs::path("..") / ".." / hint,
            fs::path("..") / ".." / ".." / hint
        };
        for (const auto& cand : candidates) {
            std::error_code ec;
            if (fs::exists(cand / "graph.json", ec)) {
                return cand.string();
            }
        }
        return hint;
    }

    /**
     * Loads outdoor `graphPath` and all `*.json` files inside `indoorDir` into one merged graph.
     */
    void loadFromDiskFiles(const std::string& graphPath, const std::string& indoorDir = "") {
        namespace fs = std::filesystem;
        clear();
        const json outdoorJson = readJsonFile(fs::path(graphPath));
        loadOutdoorJson(outdoorJson);

        if (!indoorDir.empty()) {
            std::error_code ec;
            const fs::path indPath(indoorDir);
            if (fs::exists(indPath, ec) && fs::is_directory(indPath, ec)) {
                std::vector<fs::path> indoorFiles;
                for (const auto& entry : fs::directory_iterator(indPath, ec)) {
                    if (entry.is_regular_file() && entry.path().extension() == ".json") {
                        indoorFiles.push_back(entry.path());
                    }
                }
                std::sort(indoorFiles.begin(), indoorFiles.end());
                for (const auto& f : indoorFiles) {
                    loadIndoorJson(readJsonFile(f));
                }
            }
        }
        finalizeCoordinatesAndHeuristic();
    }

    /**
     * Loads `<dataDir>/graph.json` plus every `<dataDir>/indoor/*.json` into ONE merged graph.
     */
    void loadFromDataDirectory(const std::string& dataDir = "data") {
        namespace fs = std::filesystem;
        const fs::path resolved = resolveDataDirectory(dataDir);
        const fs::path graphPath = resolved / "graph.json";
        const fs::path indoorDir = resolved / "indoor";
        loadFromDiskFiles(graphPath.string(), indoorDir.string());
    }

private:
    static bool isIndoorJsonObject(const json& j) {
        if (!j.is_object()) return false;
        if (j.contains("floors") || j.contains("rooms") || j.contains("landmarkId")) {
            return true;
        }
        if (j.contains("nodes") && j["nodes"].is_array() && !j["nodes"].empty()) {
            const auto& first = j["nodes"][0];
            if (first.is_object() && (first.contains("floor") || first.contains("x"))) {
                return true;
            }
        }
        return false;
    }
};

// ============================================================================
// SECTION 3: Routing Algorithms & Path Step Formatting
// ============================================================================

// ----------------------------------------------------------------------------
// 3.1 Path Reconstruction & Outdoor/Indoor/Floor Step Builder
// ----------------------------------------------------------------------------

/**
 * Helper to append a trace event while respecting the 2000-event cap.
 */
inline void recordTrace(std::vector<TraceEvent>& trace, size_t maxEvents,
                        const std::string& type, const std::string& nodeId, double dist) {
    if (trace.size() < maxEvents) {
        trace.push_back(TraceEvent{type, nodeId, dist});
    }
}

/**
 * Finds the best traversed edge between u and v under the active RouteOptions.
 */
inline const Edge* findTraversedEdge(const Graph& g, int u, int v, const RouteOptions& opts) {
    const Edge* best = nullptr;
    for (const auto& e : g.adj[u]) {
        if (e.to != v) continue;
        if (!g.canTraverse(u, e, opts)) continue;
        if (!best || e.w < best->w) {
            best = &e;
        }
    }
    return best;
}

/**
 * Reconstructs the sequence of node indices from `from` to `to` using `parent`,
 * populates `res.path` with node IDs, and builds human-readable navigation `res.steps`
 * grouped into outdoor legs, building entrance crossings, indoor floor walks,
 * and stairs/lift floor changes.
 */
inline void populatePathAndSteps(const Graph& g, int from, int to,
                                 const std::vector<int>& parent,
                                 const RouteOptions& opts,
                                 RouteResult& res) {
    res.pathIndices.clear();
    res.path.clear();
    res.steps.clear();

    int curr = to;
    int safety = 0;
    const int maxNodes = g.nodeCount() + 2;
    while (curr != -1 && safety <= maxNodes) {
        res.pathIndices.push_back(curr);
        if (curr == from) break;
        curr = parent[curr];
        safety++;
    }

    if (res.pathIndices.empty() || res.pathIndices.back() != from) {
        res.found = false;
        res.pathIndices.clear();
        return;
    }

    std::reverse(res.pathIndices.begin(), res.pathIndices.end());
    res.path.reserve(res.pathIndices.size());
    for (int idx : res.pathIndices) {
        res.path.push_back(g.nodes[idx].id);
    }

    if (res.pathIndices.size() == 1) {
        res.steps.push_back("Arrive at " + g.displayNodeName(from) + " (0.0 m)");
        return;
    }

    // Group consecutive path edges into logical outdoor/indoor/entrance/floor steps
    enum class LegCategory { OutdoorWalk, EntranceCross, IndoorWalk, Stairs, Lift };

    struct RawSegment {
        int u;
        int v;
        double w;
        LegCategory cat;
    };

    std::vector<RawSegment> segments;
    segments.reserve(res.pathIndices.size() - 1);

    for (size_t i = 0; i + 1 < res.pathIndices.size(); ++i) {
        const int u = res.pathIndices[i];
        const int v = res.pathIndices[i + 1];
        const Edge* edge = findTraversedEdge(g, u, v, opts);
        const double w = edge ? edge->w : 0.0;
        const std::string kind = edge ? edge->kind : "walk";

        const Node& nu = g.nodes[u];
        const Node& nv = g.nodes[v];

        LegCategory cat = LegCategory::OutdoorWalk;
        if (nu.isIndoor != nv.isIndoor) {
            cat = LegCategory::EntranceCross;
        } else if (kind == "stairs") {
            cat = LegCategory::Stairs;
        } else if (kind == "lift") {
            cat = LegCategory::Lift;
        } else if (nu.isIndoor && nv.isIndoor) {
            cat = LegCategory::IndoorWalk;
        } else {
            cat = LegCategory::OutdoorWalk;
        }
        segments.push_back(RawSegment{u, v, w, cat});
    }

    size_t i = 0;
    while (i < segments.size()) {
        const LegCategory cat = segments[i].cat;
        const int startU = segments[i].u;
        int endV = segments[i].v;
        double legDist = segments[i].w;

        if (cat == LegCategory::EntranceCross) {
            const Node& nu = g.nodes[startU];
            const Node& nv = g.nodes[endV];
            if (!nu.isIndoor && nv.isIndoor) {
                const std::string bName = nv.buildingName.empty() ? nv.buildingId : nv.buildingName;
                res.steps.push_back("Enter " + bName + " via " + g.displayNodeName(endV) +
                                    " (" + formatMeters(legDist) + " m)");
            } else {
                const std::string bName = nu.buildingName.empty() ? nu.buildingId : nu.buildingName;
                res.steps.push_back("Exit " + bName + " from " + g.displayNodeName(startU) +
                                    " to " + g.displayNodeName(endV) +
                                    " (" + formatMeters(legDist) + " m)");
            }
            ++i;
            continue;
        }

        if (cat == LegCategory::Stairs || cat == LegCategory::Lift) {
            size_t j = i + 1;
            while (j < segments.size() && segments[j].cat == cat) {
                endV = segments[j].v;
                legDist += segments[j].w;
                ++j;
            }
            const std::string modeStr = (cat == LegCategory::Stairs) ? "stairs" : "lift";
            res.steps.push_back("Take " + modeStr + " from " + g.floorLabel(startU) +
                                " to " + g.floorLabel(endV) +
                                " (" + formatMeters(legDist) + " m)");
            i = j;
            continue;
        }

        if (cat == LegCategory::IndoorWalk) {
            const int startFloor = g.nodes[startU].floor;
            const std::string startBldg = g.nodes[startU].buildingId;
            size_t j = i + 1;
            while (j < segments.size() &&
                   segments[j].cat == LegCategory::IndoorWalk &&
                   g.nodes[segments[j].v].floor == startFloor &&
                   g.nodes[segments[j].v].buildingId == startBldg) {
                endV = segments[j].v;
                legDist += segments[j].w;
                ++j;
            }
            res.steps.push_back("Walk indoors on " + g.floorLabel(startU) + " from " +
                                g.displayNodeName(startU) + " to " + g.displayNodeName(endV) +
                                " (" + formatMeters(legDist) + " m)");
            i = j;
            continue;
        }

        // OutdoorWalk
        size_t j = i + 1;
        while (j < segments.size() && segments[j].cat == LegCategory::OutdoorWalk) {
            endV = segments[j].v;
            legDist += segments[j].w;
            ++j;
        }
        res.steps.push_back("Walk outdoors from " + g.displayNodeName(startU) +
                            " to " + g.displayNodeName(endV) +
                            " (" + formatMeters(legDist) + " m)");
        i = j;
    }
}

// ----------------------------------------------------------------------------
// 3.2 Dijkstra's Algorithm (Binary Min-Heap Priority Queue)
// ----------------------------------------------------------------------------

/**
 * Algorithm: Dijkstra's Single-Source Shortest Path (Binary Min-Heap)
 * What it does:
 *   Finds the exact minimum-distance path (in meters) from `from` to `to` across
 *   non-negative weighted edges by greedily expanding the unvisited frontier node
 *   with the smallest tentative distance `g(u)`.
 * Time Complexity:
 *   O((V + E) log V) time, O(V) auxiliary space.
 * Where the app uses it:
 *   Default optimal campus & indoor route planner when "dijkstra" is selected,
 *   ground-truth distance baseline in the multi-algorithm comparator, and
 *   step-free accessibility routing (`accessibleOnly = true`).
 */
inline RouteResult runDijkstra(const Graph& g, int from, int to, const RouteOptions& opts) {
    RouteResult res;
    const int n = g.nodeCount();
    if (from < 0 || to < 0 || from >= n || to >= n) {
        res.error = "Invalid source or destination node";
        return res;
    }
    if (opts.isNodeBlocked(from) || opts.isNodeBlocked(to)) {
        return res;
    }

    std::vector<double> dist(n, kInf);
    std::vector<int> parent(n, -1);
    std::vector<bool> closed(n, false);

    using PQItem = std::pair<double, int>;
    std::priority_queue<PQItem, std::vector<PQItem>, std::greater<PQItem>> pq;

    dist[from] = 0.0;
    pq.push({0.0, from});
    recordTrace(res.trace, opts.maxTrace, "frontier", g.nodes[from].id, 0.0);

    while (!pq.empty()) {
        const auto [d, u] = pq.top();
        pq.pop();

        if (closed[u]) continue;
        closed[u] = true;
        res.visitedCount++;
        recordTrace(res.trace, opts.maxTrace, "visit", g.nodes[u].id, d);

        if (u == to) {
            res.found = true;
            res.distance = dist[to];
            break;
        }

        for (const auto& e : g.adj[u]) {
            if (!g.canTraverse(u, e, opts)) continue;
            if (closed[e.to]) continue;

            const double nd = d + e.w;
            if (nd + 1e-12 < dist[e.to]) {
                const bool wasInf = std::isinf(dist[e.to]);
                dist[e.to] = nd;
                parent[e.to] = u;
                pq.push({nd, e.to});
                if (wasInf) {
                    recordTrace(res.trace, opts.maxTrace, "frontier", g.nodes[e.to].id, nd);
                }
                recordTrace(res.trace, opts.maxTrace, "relax", g.nodes[e.to].id, nd);
            }
        }
    }

    if (res.found) {
        populatePathAndSteps(g, from, to, parent, opts, res);
    }
    return res;
}

// ----------------------------------------------------------------------------
// 3.3 A* Search Algorithm (Admissible Haversine Heuristic)
// ----------------------------------------------------------------------------

/**
 * Algorithm: A* (A-Star) Heuristic-Guided Shortest Path
 * What it does:
 *   Prioritizes frontier nodes by `f(u) = g(u) + h(u, to)`, where `g(u)` is the
 *   exact distance from `from` and `h(u, to)` is the admissible Haversine
 *   great-circle distance to `to` (using the building's outdoor entrance coordinates
 *   for indoor nodes). Guarantees the exact same shortest distance as Dijkstra
 *   while expanding fewer off-direction nodes.
 * Time Complexity:
 *   O((V + E) log V) worst-case time, O(V) space.
 * Where the app uses it:
 *   Interactive point-to-point outdoor and building-to-building navigation,
 *   and live trace visualization contrasting directional heuristic search
 *   against Dijkstra's radial exploration.
 */
inline RouteResult runAStar(const Graph& g, int from, int to, const RouteOptions& opts) {
    RouteResult res;
    const int n = g.nodeCount();
    if (from < 0 || to < 0 || from >= n || to >= n) {
        res.error = "Invalid source or destination node";
        return res;
    }
    if (opts.isNodeBlocked(from) || opts.isNodeBlocked(to)) {
        return res;
    }

    std::vector<double> gScore(n, kInf);
    std::vector<int> parent(n, -1);

    struct AStarNode {
        double f;
        double g;
        int u;
        bool operator>(const AStarNode& other) const {
            if (std::abs(f - other.f) > 1e-12) return f > other.f;
            return g > other.g;
        }
    };

    std::priority_queue<AStarNode, std::vector<AStarNode>, std::greater<AStarNode>> openSet;

    gScore[from] = 0.0;
    const double h0 = g.heuristic(from, to);
    openSet.push(AStarNode{h0, 0.0, from});
    recordTrace(res.trace, opts.maxTrace, "frontier", g.nodes[from].id, 0.0);

    while (!openSet.empty()) {
        const AStarNode current = openSet.top();
        openSet.pop();

        const int u = current.u;
        if (current.g > gScore[u] + 1e-12) {
            continue;
        }

        res.visitedCount++;
        recordTrace(res.trace, opts.maxTrace, "visit", g.nodes[u].id, gScore[u]);

        if (u == to) {
            res.found = true;
            res.distance = gScore[to];
            break;
        }

        for (const auto& e : g.adj[u]) {
            if (!g.canTraverse(u, e, opts)) continue;

            const double tentativeG = gScore[u] + e.w;
            if (tentativeG + 1e-12 < gScore[e.to]) {
                const bool wasInf = std::isinf(gScore[e.to]);
                gScore[e.to] = tentativeG;
                parent[e.to] = u;
                const double fScore = tentativeG + g.heuristic(e.to, to);
                openSet.push(AStarNode{fScore, tentativeG, e.to});
                if (wasInf) {
                    recordTrace(res.trace, opts.maxTrace, "frontier", g.nodes[e.to].id, tentativeG);
                }
                recordTrace(res.trace, opts.maxTrace, "relax", g.nodes[e.to].id, tentativeG);
            }
        }
    }

    if (res.found) {
        populatePathAndSteps(g, from, to, parent, opts, res);
    }
    return res;
}

// ----------------------------------------------------------------------------
// 3.4 Breadth-First Search / BFS (Fewest-Hops FIFO Queue)
// ----------------------------------------------------------------------------

/**
 * Algorithm: Breadth-First Search (BFS — Fewest-Hops Pathfinding)
 * What it does:
 *   Explores the graph layer-by-layer in unweighted hop count using a FIFO queue,
 *   guaranteeing a path with the minimum number of edges (hops) from `from` to `to`,
 *   and reporting the cumulative walking distance in meters along that path.
 * Time Complexity:
 *   O(V + E) time, O(V) space.
 * Where the app uses it:
 *   Fewest-turn / fewest-corridor navigation mode and educational algorithm
 *   comparison demonstrating why fewest hops differs from shortest metric distance.
 */
inline RouteResult runBFS(const Graph& g, int from, int to, const RouteOptions& opts) {
    RouteResult res;
    const int n = g.nodeCount();
    if (from < 0 || to < 0 || from >= n || to >= n) {
        res.error = "Invalid source or destination node";
        return res;
    }
    if (opts.isNodeBlocked(from) || opts.isNodeBlocked(to)) {
        return res;
    }

    std::vector<bool> visited(n, false);
    std::vector<int> parent(n, -1);
    std::vector<double> distMeters(n, kInf);
    std::queue<int> q;

    visited[from] = true;
    distMeters[from] = 0.0;
    q.push(from);
    recordTrace(res.trace, opts.maxTrace, "frontier", g.nodes[from].id, 0.0);

    while (!q.empty()) {
        const int u = q.front();
        q.pop();

        res.visitedCount++;
        recordTrace(res.trace, opts.maxTrace, "visit", g.nodes[u].id, distMeters[u]);

        if (u == to) {
            res.found = true;
            res.distance = distMeters[to];
            break;
        }

        for (const auto& e : g.adj[u]) {
            if (!g.canTraverse(u, e, opts)) continue;
            if (!visited[e.to]) {
                visited[e.to] = true;
                parent[e.to] = u;
                distMeters[e.to] = distMeters[u] + e.w;
                q.push(e.to);
                recordTrace(res.trace, opts.maxTrace, "frontier", g.nodes[e.to].id, distMeters[e.to]);
            }
        }
    }

    if (res.found) {
        populatePathAndSteps(g, from, to, parent, opts, res);
    }
    return res;
}

// ----------------------------------------------------------------------------
// 3.5 Bellman-Ford Algorithm (Edge Relaxation & Negative Cycle Detection)
// ----------------------------------------------------------------------------

/**
 * Algorithm: Bellman-Ford Single-Source Shortest Path with Negative Cycle Detection
 * What it does:
 *   Iteratively relaxes all traversable edges up to V - 1 times (with early
 *   stopping when a pass produces no improvements), then performs a V-th pass
 *   to detect any reachable negative-weight cycle.
 * Time Complexity:
 *   O(V * E) worst-case time, O(V) space.
 * Where the app uses it:
 *   Algorithm benchmark & educational trace mode ("bellmanford"), verifying
 *   distance agreement with Dijkstra/A* and detecting negative cycles in
 *   modified/test graphs.
 */
inline RouteResult runBellmanFord(const Graph& g, int from, int to, const RouteOptions& opts) {
    RouteResult res;
    const int n = g.nodeCount();
    if (from < 0 || to < 0 || from >= n || to >= n) {
        res.error = "Invalid source or destination node";
        return res;
    }
    if (opts.isNodeBlocked(from) || opts.isNodeBlocked(to)) {
        return res;
    }

    std::vector<double> dist(n, kInf);
    std::vector<int> parent(n, -1);
    std::vector<bool> everVisited(n, false);

    dist[from] = 0.0;
    everVisited[from] = true;
    recordTrace(res.trace, opts.maxTrace, "frontier", g.nodes[from].id, 0.0);

    // Up to V - 1 relaxation passes
    for (int iter = 0; iter < std::max(0, n - 1); ++iter) {
        bool anyRelaxed = false;
        for (int u = 0; u < n; ++u) {
            if (opts.isNodeBlocked(u) || std::isinf(dist[u])) continue;

            for (const auto& e : g.adj[u]) {
                if (!g.canTraverse(u, e, opts)) continue;
                const double nd = dist[u] + e.w;
                if (nd + 1e-12 < dist[e.to]) {
                    const bool firstReach = std::isinf(dist[e.to]);
                    dist[e.to] = nd;
                    parent[e.to] = u;
                    everVisited[e.to] = true;
                    anyRelaxed = true;
                    if (firstReach) {
                        recordTrace(res.trace, opts.maxTrace, "frontier", g.nodes[e.to].id, nd);
                    }
                    recordTrace(res.trace, opts.maxTrace, "relax", g.nodes[e.to].id, nd);
                }
            }
        }
        if (!anyRelaxed) {
            break;
        }
    }

    for (int u = 0; u < n; ++u) {
        if (everVisited[u]) {
            res.visitedCount++;
            recordTrace(res.trace, opts.maxTrace, "visit", g.nodes[u].id, dist[u]);
        }
    }

    // V-th pass: check for reachable negative-weight cycles
    for (int u = 0; u < n; ++u) {
        if (opts.isNodeBlocked(u) || std::isinf(dist[u])) continue;
        for (const auto& e : g.adj[u]) {
            if (!g.canTraverse(u, e, opts)) continue;
            if (dist[u] + e.w + 1e-9 < dist[e.to]) {
                res.found = false;
                res.negativeCycle = true;
                res.distance = -1.0;
                res.error = "Negative weight cycle detected";
                return res;
            }
        }
    }

    if (!std::isinf(dist[to])) {
        res.found = true;
        res.distance = dist[to];
        populatePathAndSteps(g, from, to, parent, opts, res);
    }
    return res;
}

/**
 * Unified router entry point dispatching to the requested algorithm.
 */
inline RouteResult computeRoute(const Graph& g, int from, int to, const RouteOptions& opts) {
    std::string algo = opts.algo;
    std::transform(algo.begin(), algo.end(), algo.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });

    if (algo == "dijkstra" || algo.empty()) {
        return runDijkstra(g, from, to, opts);
    } else if (algo == "astar" || algo == "a*") {
        return runAStar(g, from, to, opts);
    } else if (algo == "bfs") {
        return runBFS(g, from, to, opts);
    } else if (algo == "bellmanford" || algo == "bellman-ford" || algo == "bf") {
        return runBellmanFord(g, from, to, opts);
    } else {
        RouteResult err;
        err.error = "Unknown routing algorithm: " + opts.algo;
        return err;
    }
}

// ----------------------------------------------------------------------------
// 3.6 Multi-Algorithm Benchmark Comparator
// ----------------------------------------------------------------------------

/**
 * Algorithm: Multi-Algorithm Benchmark Comparator
 * What it does:
 *   Executes Dijkstra, A*, BFS, and Bellman-Ford on the exact same (from, to)
 *   query and records execution wall-clock time (ms), visited node count, hop
 *   count, and total path distance in meters.
 * Time Complexity:
 *   O((V + E) log V + V * E) combined across all 4 algorithms.
 * Where the app uses it:
 *   Algorithm Comparison Drawer in the web UI and the `compare` command in the CLI.
 */
inline json compareAlgorithms(const Graph& g, int from, int to, const RouteOptions& baseOpts) {
    const std::vector<std::string> algos = {"dijkstra", "astar", "bfs", "bellmanford"};
    json results = json::object();

    for (const auto& algoName : algos) {
        RouteOptions opts = baseOpts;
        opts.algo = algoName;
        opts.maxTrace = 0; // Skip trace allocation during timing benchmark

        const auto t0 = std::chrono::high_resolution_clock::now();
        const RouteResult r = computeRoute(g, from, to, opts);
        const auto t1 = std::chrono::high_resolution_clock::now();
        const double elapsedMs =
            std::chrono::duration<double, std::milli>(t1 - t0).count();

        json entry = {
            {"found", r.found},
            {"distance", r.found ? r.distance : -1.0},
            {"timeMs", elapsedMs},
            {"visitedCount", r.visitedCount},
            {"hops", r.path.empty() ? 0 : static_cast<int>(r.path.size()) - 1},
            {"negativeCycle", r.negativeCycle}
        };
        results[algoName] = std::move(entry);
    }

    return json{{"results", results}};
}

// ============================================================================
// SECTION 4: WASM / Native JSON Dispatcher — call(fn, argsJson)
// ============================================================================

namespace detail {

inline Graph& globalGraph() {
    static Graph g;
    return g;
}

inline std::string& responseBuffer() {
    static std::string buf;
    return buf;
}

inline std::string makeErrorJson(const std::string& message) {
    json err = {
        {"status", "error"},
        {"error", message},
        {"message", message}
    };
    return err.dump();
}

/**
 * Parses `avoid`, `blocked`, `blockedNodes`, and `blockedEdges` from a JSON
 * route/compare request into a `RouteOptions` struct.
 */
inline RouteOptions parseRouteOptions(const Graph& g, const json& args) {
    RouteOptions opts;
    opts.algo = args.value("algo", "dijkstra");
    opts.accessibleOnly = args.value("accessible", false);

    auto parseBlockedItem = [&](const json& item) {
        if (!item.is_string()) return;
        const std::string s = item.get<std::string>();
        const int idx = g.getNodeIndex(s);
        if (idx >= 0) {
            opts.blockedNodes.insert(idx);
            return;
        }
        // Check if string encodes an edge like "n1-n2" or "n1->n2"
        const auto arrowPos = s.find("->");
        if (arrowPos != std::string::npos) {
            const int u = g.getNodeIndex(s.substr(0, arrowPos));
            const int v = g.getNodeIndex(s.substr(arrowPos + 2));
            if (u >= 0 && v >= 0) opts.blockEdge(u, v, false);
            return;
        }
        const auto dashPos = s.find('-');
        if (dashPos != std::string::npos && s.rfind("b-", 0) != 0) {
            const int u = g.getNodeIndex(s.substr(0, dashPos));
            const int v = g.getNodeIndex(s.substr(dashPos + 1));
            if (u >= 0 && v >= 0) opts.blockEdge(u, v, true);
        }
    };

    for (const char* key : {"avoid", "blocked", "blockedNodes"}) {
        if (args.contains(key) && args[key].is_array()) {
            for (const auto& item : args[key]) {
                parseBlockedItem(item);
            }
        }
    }

    if (args.contains("blockedEdges") && args["blockedEdges"].is_array()) {
        for (const auto& ej : args["blockedEdges"]) {
            if (ej.is_object()) {
                const std::string a = ej.value("a", ej.value("from", ej.value("u", "")));
                const std::string b = ej.value("b", ej.value("to", ej.value("v", "")));
                const bool oneway = ej.value("oneway", false);
                const int u = g.getNodeIndex(a);
                const int v = g.getNodeIndex(b);
                if (u >= 0 && v >= 0) {
                    opts.blockEdge(u, v, !oneway);
                }
            } else if (ej.is_array() && ej.size() >= 2 && ej[0].is_string() && ej[1].is_string()) {
                const int u = g.getNodeIndex(ej[0].get<std::string>());
                const int v = g.getNodeIndex(ej[1].get<std::string>());
                if (u >= 0 && v >= 0) {
                    opts.blockEdge(u, v, true);
                }
            } else if (ej.is_string()) {
                parseBlockedItem(ej);
            }
        }
    }

    return opts;
}

/**
 * Resolves a node or landmark identifier string to a graph node index.
 * Supports direct node IDs ("n21", "b-csit:101") as well as building landmark IDs ("b-csit").
 */
inline int resolveEndpointIndex(const Graph& g, const std::string& id) {
    const int direct = g.getNodeIndex(id);
    if (direct >= 0) return direct;
    auto lmIt = g.landmarkToEntranceNode.find(id);
    if (lmIt != g.landmarkToEntranceNode.end()) {
        return g.getNodeIndex(lmIt->second);
    }
    return -1;
}

inline std::string handlePing() {
    json res = {
        {"status", "pong"},
        {"version", "1.0.0"}
    };
    return res.dump();
}

inline std::string handleLoad(const std::string& argsJson) {
    json parsed = argsJson.empty() ? json::object() : json::parse(argsJson);
    Graph& g = globalGraph();
    g.loadFromJsonValue(parsed);
    json res = {
        {"status", "ok"},
        {"nodeCount", g.nodeCount()},
        {"edgeCount", g.logicalEdgeCount},
        {"indoorBuildings", g.indoorBuildingCount}
    };
    return res.dump();
}

inline std::string handleRoute(const std::string& argsJson) {
    const json args = json::parse(argsJson);
    const Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }

    const std::string fromId = args.value("from", "");
    const std::string toId = args.value("to", "");
    if (fromId.empty() || toId.empty()) {
        return makeErrorJson("Both 'from' and 'to' node IDs are required");
    }

    const int fromIdx = resolveEndpointIndex(g, fromId);
    const int toIdx = resolveEndpointIndex(g, toId);
    if (fromIdx < 0) {
        return makeErrorJson("Unknown 'from' node ID: " + fromId);
    }
    if (toIdx < 0) {
        return makeErrorJson("Unknown 'to' node ID: " + toId);
    }

    const RouteOptions opts = parseRouteOptions(g, args);
    const RouteResult r = computeRoute(g, fromIdx, toIdx, opts);

    if (!r.error.empty() && !r.negativeCycle) {
        return makeErrorJson(r.error);
    }

    json traceJson = json::array();
    for (const auto& ev : r.trace) {
        traceJson.push_back({
            {"type", ev.type},
            {"node", ev.node},
            {"dist", ev.dist}
        });
    }

    json out = {
        {"found", r.found},
        {"distance", r.distance},
        {"path", r.path},
        {"steps", r.steps},
        {"trace", std::move(traceJson)},
        {"negativeCycle", r.negativeCycle}
    };
    if (r.negativeCycle && !r.error.empty()) {
        out["error"] = r.error;
    }
    return out.dump();
}

inline std::string handleCompare(const std::string& argsJson) {
    const json args = json::parse(argsJson);
    const Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }

    const std::string fromId = args.value("from", "");
    const std::string toId = args.value("to", "");
    const int fromIdx = resolveEndpointIndex(g, fromId);
    const int toIdx = resolveEndpointIndex(g, toId);
    if (fromIdx < 0 || toIdx < 0) {
        return makeErrorJson("Unknown 'from' or 'to' node ID");
    }

    const RouteOptions opts = parseRouteOptions(g, args);
    return compareAlgorithms(g, fromIdx, toIdx, opts).dump();
}

} // namespace detail
} // namespace navcore

extern "C" {

/**
 * Single C-ABI entry point invoked by Emscripten `cwrap("call", "string", ["string", "string"])`
 * and native unit tests. Never throws exceptions across the boundary.
 */
NAVCORE_EXPORT const char* call(const char* fn, const char* argsJson) {
    std::string& buffer = navcore::detail::responseBuffer();
    try {
        const std::string functionName = fn ? fn : "";
        const std::string args = (argsJson && std::strlen(argsJson) > 0) ? argsJson : "{}";

        if (functionName == "ping") {
            buffer = navcore::detail::handlePing();
        } else if (functionName == "load") {
            buffer = navcore::detail::handleLoad(args);
        } else if (functionName == "route") {
            buffer = navcore::detail::handleRoute(args);
        } else if (functionName == "compare") {
            buffer = navcore::detail::handleCompare(args);
        } else {
            buffer = navcore::detail::makeErrorJson("Unknown or unimplemented function: " + functionName);
        }
    } catch (const std::exception& e) {
        buffer = navcore::detail::makeErrorJson(std::string("Exception: ") + e.what());
    } catch (...) {
        buffer = navcore::detail::makeErrorJson("Unknown internal error in navcore::call");
    }
    return buffer.c_str();
}

} // extern "C"

// ============================================================================
// SECTION 5: Optional Terminal CLI Runner (#ifdef NAVCORE_CLI)
// ============================================================================

#ifdef NAVCORE_CLI
int main(int argc, char* argv[]) {
    using json = nlohmann::json;

    if (argc < 2) {
        std::cerr << "Usage:\n"
                  << "  navcore_cli ping\n"
                  << "  navcore_cli route <from> <to> [dijkstra|astar|bfs|bellmanford] [--accessible] [--data <dirOrFile>]\n"
                  << "  navcore_cli compare <from> <to> [--accessible] [--data <dirOrFile>]\n";
        return 1;
    }

    const std::string cmd = argv[1];
    if (cmd == "ping") {
        std::cout << call("ping", "{}") << "\n";
        return 0;
    }

    std::string dataTarget = "data";
    bool accessible = false;
    std::vector<std::string> positional;

    for (int i = 2; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--accessible" || arg == "--step-free") {
            accessible = true;
        } else if (arg == "--data" && i + 1 < argc) {
            dataTarget = argv[++i];
        } else {
            positional.push_back(arg);
        }
    }

    // Load graph from directory or file
    namespace fs = std::filesystem;
    std::error_code ec;
    json loadArgs;
    if (fs::is_regular_file(dataTarget, ec)) {
        loadArgs["graphPath"] = dataTarget;
        const fs::path parentIndoor = fs::path(dataTarget).parent_path() / "indoor";
        if (fs::is_directory(parentIndoor, ec)) {
            loadArgs["indoorDir"] = parentIndoor.string();
        }
    } else {
        loadArgs["dataDir"] = dataTarget;
    }

    const char* loadResStr = call("load", loadArgs.dump().c_str());
    const json loadRes = json::parse(loadResStr);
    if (loadRes.value("status", "") != "ok") {
        std::cerr << loadRes.dump(2) << "\n";
        return 1;
    }

    if (cmd == "route") {
        if (positional.size() < 2) {
            std::cerr << "Error: 'route' requires <from> and <to> arguments.\n";
            return 1;
        }
        const std::string algo = (positional.size() >= 3) ? positional[2] : "dijkstra";
        json routeArgs = {
            {"from", positional[0]},
            {"to", positional[1]},
            {"algo", algo},
            {"accessible", accessible}
        };
        const char* resStr = call("route", routeArgs.dump().c_str());
        std::cout << json::parse(resStr).dump(2) << "\n";
        return 0;
    } else if (cmd == "compare") {
        if (positional.size() < 2) {
            std::cerr << "Error: 'compare' requires <from> and <to> arguments.\n";
            return 1;
        }
        json cmpArgs = {
            {"from", positional[0]},
            {"to", positional[1]},
            {"accessible", accessible}
        };
        const char* resStr = call("compare", cmpArgs.dump().c_str());
        std::cout << json::parse(resStr).dump(2) << "\n";
        return 0;
    } else {
        std::cerr << "Unknown CLI command: " << cmd << "\n";
        return 1;
    }
}
#endif // NAVCORE_CLI

