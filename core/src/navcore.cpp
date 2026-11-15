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
 *              - Node, Edge, Landmark, TraceEvent, RouteOptions, RouteResult
 *              - Geodesic Haversine distance utility
 *              - Graph class (adjacency list, ID <-> index maps, coordinates)
 *
 *   SECTION 2: JSON Graph Loading (Outdoor + Multi-Building Indoor Merger)
 *              - Outdoor campus graph parser (data/graph.json)
 *              - Indoor floor-plan parser (data/indoor/<buildingId>.json)
 *              - Entrance coordinate propagation for admissible indoor heuristics
 *              - Filesystem directory loader (merges graph.json + indoor/<id>.json)
 *
 *   SECTION 3: Single-Pair Routing Algorithms & Path Step Formatting
 *              - 3.1 Path Reconstruction & Outdoor/Indoor/Floor Step Builder
 *              - 3.2 Dijkstra's Algorithm (Binary Min-Heap Priority Queue)
 *              - 3.3 A* Search Algorithm (Admissible Haversine Heuristic)
 *              - 3.4 Breadth-First Search / BFS (Fewest-Hops FIFO Queue)
 *              - 3.5 Bellman-Ford Algorithm (Edge Relaxation & Negative Cycle Check)
 *
 *   SECTION 4: Prefix Trie Search (Landmarks, Short Names, Numbers & Rooms)
 *              - Character Trie with word-prefix and whole-name indexing
 *              - Ranked prefix search (exact and shorter matches first)
 *
 *   SECTION 5: LRU Route Cache (Hash Map + Doubly Linked List)
 *              - O(1) lookup, promotion, insertion, and LRU eviction
 *              - Automatic cache invalidation when blocked sets change
 *
 *   SECTION 6: Floyd-Warshall All-Pairs Shortest Paths
 *              - O(V^3) dynamic programming distance & next-hop tables
 *              - Landmark-to-landmark distance matrix & path reconstruction
 *
 *   SECTION 7: Disjoint Set Union (Union-Find) & Minimum Spanning Tree (MST)
 *              - 7.1 Union-Find with Path Compression and Union by Rank
 *              - 7.2 Kruskal's MST Algorithm
 *              - 7.3 Prim's MST Algorithm (Binary Min-Heap)
 *
 *   SECTION 8: Multi-Stop Traveling Salesperson Problem (TSP)
 *              - 8.1 Pairwise Dijkstra Leg Matrix
 *              - 8.2 Held-Karp Exact Bitmask DP (up to 12 stops)
 *              - 8.3 Nearest-Neighbor Greedy Heuristic & Gap Comparison
 *
 *   SECTION 9: Tarjan's Articulation Points & Bridges (Critical Infrastructure)
 *              - Single-pass O(V + E) DFS discovery/low-link analysis
 *
 *   SECTION 10: Emergency Evacuation (Multi-Source Dijkstra & Min-Cost Max-Flow)
 *              - 10.1 Multi-Source Dijkstra on the Reversed Graph
 *              - 10.2 Min-Cost Max-Flow Assignment (Successive Shortest Paths / SPFA)
 *              - 10.3 Evacuation Mode Comparison (Nearest vs Capacity-Constrained)
 *
 *   SECTION 11: Turn-by-Turn Directions, GPS Progress & Live Rerouting
 *              - 11.1 Polyline Bearing Calculation, Turn Classification & Landmark Maneuvers
 *              - 11.2 GPS Polyline Segment Projection, Off-Route Detection & Noise Filtering
 *              - 11.3 Live GPS Graph Snapping & Rerouting
 *
 *   SECTION 12: Multi-Algorithm Benchmark Comparator
 *              - Side-by-side timing (microseconds), visited count, and distance
 *
 *   SECTION 13: WASM / Native JSON Dispatcher — call(fn, argsJson)
 *              - Handlers: "ping", "load", "route", "compare", "search",
 *                "cacheStats", "allPairs", "mst", "tsp", "criticalPoints",
 *                "evacuate", "nearestAssembly", "evacuationCompare",
 *                "directions", "progress", "reroute"
 *              - Exception-safe C ABI entry point & #ifdef __EMSCRIPTEN__ export
 *
 *   SECTION 14: Optional Terminal CLI Runner (#ifdef NAVCORE_CLI)
 *              - Terminal commands demonstrating every algorithm including directions & progress
 * ============================================================================
 */

#include <algorithm>
#include <cctype>
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
#include <list>
#include <numeric>
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
 * Lowercases an ASCII/UTF-8 string for case-insensitive matching.
 */
inline std::string toLowerCopy(const std::string& s) {
    std::string out = s;
    std::transform(out.begin(), out.end(), out.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return out;
}

/**
 * Trims leading and trailing whitespace from a string.
 */
inline std::string trimCopy(const std::string& s) {
    size_t start = 0;
    while (start < s.size() && std::isspace(static_cast<unsigned char>(s[start]))) {
        ++start;
    }
    size_t end = s.size();
    while (end > start && std::isspace(static_cast<unsigned char>(s[end - 1]))) {
        --end;
    }
    return s.substr(start, end - start);
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
    std::string shortName;
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
 * Optional `geometry` stores `[lat, lng]` points oriented from `from` to `to` for
 * display, turn-by-turn bearing calculation, and GPS progress snapping only;
 * all routing algorithms use `w` exclusively.
 */
struct Edge {
    int from = -1;
    int to = -1;
    double w = 0.0;            // Honest walking weight in meters
    std::string kind = "walk"; // "walk" | "stairs" | "lift"
    bool accessible = true;    // false for stairs, true for ramps/lifts/walkways
    bool oneway = false;
    bool covered = false;
    std::vector<std::pair<double, double>> geometry; // Optional [lat, lng] polyline points (from -> to)
};

/**
 * Represents a campus landmark from `data/graph.json`.
 */
struct Landmark {
    std::string id;        // e.g. "b-csit"
    std::string name;      // e.g. "Department of CS & IT"
    std::string shortName; // e.g. "CS & IT"
    std::string number;    // e.g. "5"
    std::string nodeId;    // Outdoor entrance node ID, e.g. "n21"
    std::string category;  // e.g. "academic"
};

/**
 * Represents an outdoor emergency assembly area from `data/evac.json`.
 */
struct AssemblyArea {
    std::string id;       // e.g. "a-cricket-ground"
    std::string name;     // e.g. "NED Cricket Ground"
    std::string nodeId;   // e.g. "n80"
    int capacity = 0;     // e.g. 1800
};

/**
 * Represents a designated building emergency exit from `data/evac.json`.
 */
struct BuildingExit {
    std::string buildingId; // e.g. "b-library"
    std::string nodeId;     // e.g. "b-library:exit_nw"
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

    /**
     * Computes a order-independent 64-bit FNV-1a hash of the blocked nodes and edges
     * so cache keys and invalidation checks detect any change to the blocked sets.
     */
    uint64_t blockedSetHash() const {
        if (blockedNodes.empty() && blockedEdges.empty()) {
            return 0ULL;
        }
        std::vector<int> sortedNodes(blockedNodes.begin(), blockedNodes.end());
        std::sort(sortedNodes.begin(), sortedNodes.end());

        std::vector<uint64_t> sortedEdges(blockedEdges.begin(), blockedEdges.end());
        std::sort(sortedEdges.begin(), sortedEdges.end());

        uint64_t h = 14695981039346656037ULL;
        auto mix = [&](uint64_t val) {
            h ^= val;
            h *= 1099511628211ULL;
        };
        mix(static_cast<uint64_t>(sortedNodes.size()));
        for (int u : sortedNodes) {
            mix(static_cast<uint64_t>(static_cast<uint32_t>(u)) + 0x9e3779b9ULL);
        }
        mix(static_cast<uint64_t>(sortedEdges.size()) ^ 0xabcdefULL);
        for (uint64_t e : sortedEdges) {
            mix(e);
        }
        return (h == 0ULL) ? 1ULL : h;
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

// ============================================================================
// SECTION 4 (Forward Declaration): Prefix Trie Search Structure
// ============================================================================

/**
 * Algorithm: Prefix Trie (Character Tree Index for Instant Autocomplete Search)
 * What it does:
 *   Indexes campus landmarks (by full name, short name, and building number)
 *   and indoor rooms (by room name and room code) into a character-by-character
 *   prefix tree. Supports case-insensitive prefix matching on the whole title
 *   or any individual word token, ranking exact and shorter matches first.
 * Time Complexity:
 *   - Build: O(N * L) where N is number of indexed strings and L is average length.
 *   - Query: O(|P| + K log K) where |P| is query prefix length and K is number
 *     of matching candidate entries.
 * Where the app uses it:
 *   Unified search bar (`call("search", {query, limit})`) for instant building,
 *   building-number, and classroom/lab lookup across the campus.
 */
struct SearchItem {
    std::string id;          // Landmark ID ("b-csit") or indoor node ID ("b-csit:101")
    std::string label;       // Display label
    std::string shortName;   // Optional short name
    std::string number;      // Optional building number
    std::string kind;        // "landmark" | "room"
    std::string buildingId;  // Set for indoor rooms (e.g. "b-csit")
    std::string nodeId;      // Entrance node ID for landmarks or room node ID
    std::string lowerLabel;
    std::string lowerShort;
    std::string lowerNumber;
    std::string lowerCode;
    std::string lowerId;
    std::vector<std::string> lowerWords;
};

class PrefixTrie {
public:
    struct TrieNode {
        std::unordered_map<char, int> next;
        std::vector<int> itemIndices;
    };

    std::vector<TrieNode> pool;
    std::vector<SearchItem> items;

    PrefixTrie() {
        clear();
    }

    void clear() {
        pool.clear();
        items.clear();
        pool.emplace_back(); // Root at index 0
    }

    /**
     * Tokenizes a lowercase string into alphanumeric word tokens.
     */
    static std::vector<std::string> tokenizeWords(const std::string& lowerStr) {
        std::vector<std::string> words;
        std::string cur;
        for (unsigned char c : lowerStr) {
            if (std::isalnum(c)) {
                cur.push_back(static_cast<char>(c));
            } else if (!cur.empty()) {
                words.push_back(cur);
                cur.clear();
            }
        }
        if (!cur.empty()) {
            words.push_back(cur);
        }
        return words;
    }

    void insertKey(const std::string& rawKey, int itemIdx) {
        const std::string key = trimCopy(toLowerCopy(rawKey));
        if (key.empty()) return;

        int curr = 0;
        for (char ch : key) {
            auto it = pool[curr].next.find(ch);
            if (it == pool[curr].next.end()) {
                const int nextIdx = static_cast<int>(pool.size());
                pool[curr].next[ch] = nextIdx;
                pool.emplace_back();
                curr = nextIdx;
            } else {
                curr = it->second;
            }
            auto& vec = pool[curr].itemIndices;
            if (vec.empty() || vec.back() != itemIdx) {
                vec.push_back(itemIdx);
            }
        }
    }

    void addEntry(SearchItem item) {
        const int idx = static_cast<int>(items.size());
        item.lowerLabel = trimCopy(toLowerCopy(item.label));
        item.lowerShort = trimCopy(toLowerCopy(item.shortName));
        item.lowerNumber = trimCopy(toLowerCopy(item.number));
        item.lowerId = trimCopy(toLowerCopy(item.id));

        const auto colonPos = item.id.find(':');
        if (colonPos != std::string::npos) {
            item.lowerCode = toLowerCopy(item.id.substr(colonPos + 1));
        } else if (item.id.rfind("b-", 0) == 0) {
            item.lowerCode = toLowerCopy(item.id.substr(2));
        } else {
            item.lowerCode = toLowerCopy(item.id);
        }

        // Collect all word tokens from label, shortName, and lowerCode
        auto w1 = tokenizeWords(item.lowerLabel);
        auto w2 = tokenizeWords(item.lowerShort);
        auto w3 = tokenizeWords(item.lowerCode);
        item.lowerWords = std::move(w1);
        for (const auto& w : w2) {
            if (std::find(item.lowerWords.begin(), item.lowerWords.end(), w) == item.lowerWords.end()) {
                item.lowerWords.push_back(w);
            }
        }
        for (const auto& w : w3) {
            if (std::find(item.lowerWords.begin(), item.lowerWords.end(), w) == item.lowerWords.end()) {
                item.lowerWords.push_back(w);
            }
        }

        // Insert full strings and individual word tokens into the Trie
        insertKey(item.lowerLabel, idx);
        insertKey(item.lowerShort, idx);
        insertKey(item.lowerNumber, idx);
        insertKey(item.lowerCode, idx);
        insertKey(item.lowerId, idx);
        for (const auto& w : item.lowerWords) {
            insertKey(w, idx);
        }

        items.push_back(std::move(item));
    }

    /**
     * Searches the Trie for `query` and returns up to `limit` ranked items.
     * Fully deterministic sorting per specification:
     * (1) match quality: exact full-name match (0), then prefix of full name (1), then prefix of word (2)
     * (2) kind: landmark before room (0 before 1)
     * (3) shorter label first (label.size())
     * (4) id in lexicographic order (strictly unique total order)
     */
    std::vector<SearchItem> search(const std::string& rawQuery, int limit = 10) const {
        const std::string q = trimCopy(toLowerCopy(rawQuery));
        if (q.empty() || limit <= 0 || pool.empty()) {
            return {};
        }

        auto traversePrefix = [&](const std::string& prefix) -> const std::vector<int>* {
            int curr = 0;
            for (char ch : prefix) {
                auto it = pool[curr].next.find(ch);
                if (it == pool[curr].next.end()) {
                    return nullptr;
                }
                curr = it->second;
            }
            return &pool[curr].itemIndices;
        };

        std::vector<int> candidateIndices;
        if (const auto* directList = traversePrefix(q)) {
            candidateIndices.insert(candidateIndices.end(), directList->begin(), directList->end());
        }

        // If query has multiple words, intersect matches of individual query words
        const auto qWords = tokenizeWords(q);
        if (qWords.size() > 1) {
            std::vector<int> multiMatch;
            bool firstWord = true;
            for (const auto& qw : qWords) {
                const auto* wList = traversePrefix(qw);
                if (!wList) {
                    multiMatch.clear();
                    break;
                }
                std::vector<int> sortedWList = *wList;
                std::sort(sortedWList.begin(), sortedWList.end());
                sortedWList.erase(std::unique(sortedWList.begin(), sortedWList.end()), sortedWList.end());
                if (firstWord) {
                    multiMatch = std::move(sortedWList);
                    firstWord = false;
                } else {
                    std::vector<int> nextMatch;
                    std::set_intersection(multiMatch.begin(), multiMatch.end(),
                                          sortedWList.begin(), sortedWList.end(),
                                          std::back_inserter(nextMatch));
                    multiMatch = std::move(nextMatch);
                }
            }
            candidateIndices.insert(candidateIndices.end(), multiMatch.begin(), multiMatch.end());
        }

        // Deterministically sort and deduplicate candidate item indices
        std::sort(candidateIndices.begin(), candidateIndices.end());
        candidateIndices.erase(std::unique(candidateIndices.begin(), candidateIndices.end()), candidateIndices.end());

        // Match quality definition:
        // Tier 0: Exact full-name match on label, shortName, number, code/slug, or id
        // Tier 1: Prefix of the full name on label, shortName, number, code/slug, or id
        // Tier 2: Prefix of an individual word token
        // Tier 3: Other
        auto computeMatchQuality = [&](const SearchItem& it) -> int {
            // (1) Exact full-name match
            if (it.lowerLabel == q ||
                (!it.lowerShort.empty() && it.lowerShort == q) ||
                (!it.lowerNumber.empty() && it.lowerNumber == q) ||
                (!it.lowerCode.empty() && it.lowerCode == q) ||
                it.lowerId == q) {
                return 0;
            }
            // (2) Prefix of the full name
            if (it.lowerLabel.rfind(q, 0) == 0 ||
                (!it.lowerShort.empty() && it.lowerShort.rfind(q, 0) == 0) ||
                (!it.lowerNumber.empty() && it.lowerNumber.rfind(q, 0) == 0) ||
                (!it.lowerCode.empty() && it.lowerCode.rfind(q, 0) == 0) ||
                it.lowerId.rfind(q, 0) == 0) {
                return 1;
            }
            // (3) Prefix of a word
            for (const auto& w : it.lowerWords) {
                if (w.rfind(q, 0) == 0) {
                    return 2;
                }
            }
            return 3;
        };

        struct RankedCandidate {
            int itemIdx;
            int matchQuality; // 0: exact full-name, 1: prefix of full name, 2: prefix of word
            int kindOrder;    // 0: landmark, 1: room
        };

        std::vector<RankedCandidate> ranked;
        ranked.reserve(candidateIndices.size());

        for (int idx : candidateIndices) {
            const SearchItem& it = items[idx];
            const int mq = computeMatchQuality(it);
            const int kindOrder = (it.kind == "landmark") ? 0 : 1;
            ranked.push_back(RankedCandidate{idx, mq, kindOrder});
        }

        // Fully deterministic sort order per specification:
        // (1) match quality: exact full-name match, then prefix of the full name, then prefix of a word
        // (2) kind: landmark before room
        // (3) shorter label first
        // (4) label lexicographical
        // (5) id in lexicographic order (strictly unique tie-breaker ensuring total ordering)
        std::sort(ranked.begin(), ranked.end(), [&](const RankedCandidate& a, const RankedCandidate& b) {
            if (a.matchQuality != b.matchQuality) {
                return a.matchQuality < b.matchQuality;
            }
            if (a.kindOrder != b.kindOrder) {
                return a.kindOrder < b.kindOrder;
            }
            const auto& ia = items[a.itemIdx];
            const auto& ib = items[b.itemIdx];
            if (ia.label.size() != ib.label.size()) {
                return ia.label.size() < ib.label.size();
            }
            if (ia.label != ib.label) {
                return ia.label < ib.label;
            }
            return ia.id < ib.id;
        });

        std::vector<SearchItem> results;
        const size_t count = std::min(static_cast<size_t>(limit), ranked.size());
        results.reserve(count);
        for (size_t i = 0; i < count; ++i) {
            results.push_back(items[ranked[i].itemIdx]);
        }
        return results;
    }
};

/**
 * Adjacency-list graph storing the merged outdoor campus network, all indoor
 * multi-floor building graphs, landmarks, and the prefix search Trie.
 */
class Graph {
public:
    std::vector<Node> nodes;
    std::unordered_map<std::string, int> idToIndex;
    std::vector<std::vector<Edge>> adj;

    std::vector<Landmark> landmarks;
    std::unordered_map<std::string, int> landmarkIdToIndex;
    std::unordered_map<std::string, std::string> landmarkToEntranceNode;
    std::unordered_map<std::string, std::vector<std::string>> nodeToLandmarkNames;
    std::unordered_map<std::string, std::string> buildingNames;
    std::unordered_map<std::string, std::unordered_map<int, std::string>> floorLabels;

    std::vector<AssemblyArea> assemblyAreas;
    std::vector<BuildingExit> buildingExits;
    std::unordered_set<std::string> buildingExitNodeIds;

    PrefixTrie searchTrie;

    int logicalEdgeCount = 0;
    int indoorBuildingCount = 0;
    double heuristicScale = 0.999;
    uint64_t loadGeneration = 1;

    void clear() {
        nodes.clear();
        idToIndex.clear();
        adj.clear();
        landmarks.clear();
        landmarkIdToIndex.clear();
        landmarkToEntranceNode.clear();
        nodeToLandmarkNames.clear();
        buildingNames.clear();
        floorLabels.clear();
        assemblyAreas.clear();
        buildingExits.clear();
        buildingExitNodeIds.clear();
        searchTrie.clear();
        logicalEdgeCount = 0;
        indoorBuildingCount = 0;
        heuristicScale = 0.999;
        loadGeneration++;
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

    void addDirectedEdge(int u, int v, double w, const std::string& kind,
                         bool accessible, bool oneway, bool covered,
                         std::vector<std::pair<double, double>> geom = {}) {
        for (auto& existing : adj[u]) {
            if (existing.to == v && existing.kind == kind &&
                std::abs(existing.w - w) < 1e-9) {
                existing.accessible = accessible;
                existing.oneway = oneway;
                existing.covered = covered;
                if (!geom.empty()) {
                    existing.geometry = std::move(geom);
                }
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
        e.geometry = std::move(geom);
        adj[u].push_back(std::move(e));
    }

    void addEdge(const std::string& aId, const std::string& bId, double w,
                 const std::string& kind = "walk", bool accessible = true,
                 bool oneway = false, bool covered = false,
                 const std::vector<std::pair<double, double>>& geom = {}) {
        const int u = ensureNode(aId);
        const int v = ensureNode(bId);
        addDirectedEdge(u, v, w, kind, accessible, oneway, covered, geom);
        if (!oneway) {
            std::vector<std::pair<double, double>> revGeom(geom.rbegin(), geom.rend());
            addDirectedEdge(v, u, w, kind, accessible, oneway, covered, std::move(revGeom));
        }
        logicalEdgeCount++;
    }

    bool canTraverse(int u, const Edge& e, const RouteOptions& opts) const {
        if (opts.isNodeBlocked(e.to)) return false;
        if (opts.isEdgeBlocked(u, e.to)) return false;
        if (opts.accessibleOnly && !e.accessible) return false;
        return true;
    }

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

    std::string displayNodeName(int idx) const {
        if (idx < 0 || idx >= nodeCount()) return "";
        const Node& n = nodes[idx];
        if (!n.name.empty()) {
            return n.name + " (" + n.id + ")";
        }
        return n.id;
    }

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

    void loadOutdoorJson(const json& j) {
        if (j.contains("landmarks") && j["landmarks"].is_array()) {
            for (const auto& lm : j["landmarks"]) {
                Landmark item;
                item.id = lm.value("id", "");
                item.name = lm.value("name", "");
                item.shortName = lm.value("short", "");
                if (lm.contains("number")) {
                    if (lm["number"].is_string()) {
                        item.number = lm["number"].get<std::string>();
                    } else if (lm["number"].is_number_integer()) {
                        item.number = std::to_string(lm["number"].get<int>());
                    }
                }
                item.nodeId = lm.value("nodeId", "");
                item.category = lm.value("category", "");

                if (!item.id.empty()) {
                    if (!item.nodeId.empty()) {
                        landmarkToEntranceNode[item.id] = item.nodeId;
                        if (!item.name.empty()) {
                            nodeToLandmarkNames[item.nodeId].push_back(item.name);
                        }
                    }
                    if (!item.name.empty()) {
                        buildingNames[item.id] = item.name;
                    }
                    auto it = landmarkIdToIndex.find(item.id);
                    if (it == landmarkIdToIndex.end()) {
                        landmarkIdToIndex[item.id] = static_cast<int>(landmarks.size());
                        landmarks.push_back(std::move(item));
                    } else {
                        landmarks[it->second] = std::move(item);
                    }
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
                if (nj.contains("short") && nj["short"].is_string()) {
                    n.shortName = nj["short"].get<std::string>();
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

                std::vector<std::pair<double, double>> geom;
                if (ej.contains("geometry") && ej["geometry"].is_array()) {
                    for (const auto& pt : ej["geometry"]) {
                        if (pt.is_array() && pt.size() >= 2 &&
                            pt[0].is_number() && pt[1].is_number()) {
                            geom.push_back({pt[0].get<double>(), pt[1].get<double>()});
                        }
                    }
                }
                addEdge(a, b, w, kind, accessible, oneway, covered, geom);
            }
        }
    }

    void loadIndoorJson(const json& j) {
        const std::string bId = j.value("id", j.value("landmarkId", ""));
        const std::string bName = j.value("name", bId);
        if (!bId.empty() && !bName.empty() && buildingNames.find(bId) == buildingNames.end()) {
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
                if (nj.contains("short") && nj["short"].is_string()) {
                    n.shortName = nj["short"].get<std::string>();
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
     * Propagates building entrance coordinates to indoor nodes, calibrates the
     * A* heuristic scale, and rebuilds the PrefixTrie search index.
     */
    void finalizeCoordinatesAndHeuristic() {
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

        rebuildSearchTrie();
        loadGeneration++;
    }

    /**
     * Populates the PrefixTrie with all landmarks (names, short names, building numbers)
     * and all indoor rooms (room names and codes).
     */
    void rebuildSearchTrie() {
        searchTrie.clear();

        // 1. Index campus landmarks
        for (const auto& lm : landmarks) {
            SearchItem item;
            item.id = lm.id;
            item.label = lm.name.empty() ? lm.id : lm.name;
            item.shortName = lm.shortName;
            item.number = lm.number;
            item.kind = "landmark";
            item.nodeId = lm.nodeId;
            searchTrie.addEntry(std::move(item));
        }

        // 2. Index indoor rooms
        for (const auto& n : nodes) {
            if (!n.isIndoor || n.kind != "room") continue;
            SearchItem item;
            item.id = n.id;
            item.label = n.name.empty() ? n.id : n.name;
            item.shortName = n.shortName;
            item.kind = "room";
            item.buildingId = n.buildingId;
            item.nodeId = n.id;
            searchTrie.addEntry(std::move(item));
        }
    }

    /**
     * Loads emergency evacuation metadata (`assemblyAreas` and `buildingExits`)
     * from `data/evac.json` or an inline JSON object.
     */
    void loadEvacJson(const json& j) {
        if (!j.is_object()) return;

        if (j.contains("assemblyAreas") && j["assemblyAreas"].is_array()) {
            for (const auto& aj : j["assemblyAreas"]) {
                if (!aj.is_object()) continue;
                AssemblyArea area;
                area.id = aj.value("id", "");
                area.name = aj.value("name", area.id);
                area.nodeId = aj.value("nodeId", "");
                area.capacity = aj.value("capacity", 0);
                if (area.id.empty() || area.nodeId.empty()) continue;

                bool updated = false;
                for (auto& existing : assemblyAreas) {
                    if (existing.id == area.id) {
                        existing = area;
                        updated = true;
                        break;
                    }
                }
                if (!updated) {
                    assemblyAreas.push_back(std::move(area));
                }
            }
            // Sort assembly areas deterministically by id
            std::sort(assemblyAreas.begin(), assemblyAreas.end(),
                      [](const AssemblyArea& a, const AssemblyArea& b) {
                          return a.id < b.id;
                      });
        }

        if (j.contains("buildingExits") && j["buildingExits"].is_array()) {
            for (const auto& ej : j["buildingExits"]) {
                if (!ej.is_object()) continue;
                BuildingExit be;
                be.buildingId = ej.value("buildingId", "");
                be.nodeId = ej.value("nodeId", "");
                if (be.nodeId.empty()) continue;
                if (buildingExitNodeIds.insert(be.nodeId).second) {
                    buildingExits.push_back(std::move(be));
                }
            }
            // Sort building exits deterministically by (buildingId, nodeId)
            std::sort(buildingExits.begin(), buildingExits.end(),
                      [](const BuildingExit& a, const BuildingExit& b) {
                          if (a.buildingId != b.buildingId) return a.buildingId < b.buildingId;
                          return a.nodeId < b.nodeId;
                      });
        }
    }

    void loadFromJsonValue(const json& parsed) {
        if (parsed.is_array()) {
            clear();
            for (const auto& item : parsed) {
                if (isIndoorJsonObject(item)) {
                    loadIndoorJson(item);
                } else if (isEvacOnlyJsonObject(item)) {
                    loadEvacJson(item);
                } else {
                    loadOutdoorJson(item);
                    loadEvacJson(item);
                }
            }
            finalizeCoordinatesAndHeuristic();
            return;
        }

        if (!parsed.is_object()) {
            throw std::runtime_error("Graph JSON must be an object or array");
        }

        if (parsed.empty() || parsed.contains("dataDir") || parsed.contains("graphPath")) {
            const std::string reqDir = parsed.value("dataDir", "");
            const std::string reqGraphPath = parsed.value("graphPath", "");
            const std::string reqEvacPath = parsed.value("evacPath", "");
            if (!reqGraphPath.empty()) {
                const std::string indoorDir = parsed.value("indoorDir", "");
                loadFromDiskFiles(reqGraphPath, indoorDir, reqEvacPath);
                return;
            }
            const std::string resolvedDir = resolveDataDirectory(reqDir.empty() ? "data" : reqDir);
            loadFromDataDirectory(resolvedDir);
            return;
        }

        // If the payload is purely an evac.json object (assemblyAreas / buildingExits without nodes),
        // merge it into the currently loaded graph without clearing nodes/edges unless reset=true.
        if (isEvacOnlyJsonObject(parsed)) {
            if (parsed.value("reset", false)) {
                clear();
            } else {
                assemblyAreas.clear();
                buildingExits.clear();
                buildingExitNodeIds.clear();
            }
            loadEvacJson(parsed);
            loadGeneration++;
            return;
        }

        if (parsed.contains("outdoor") && parsed["outdoor"].is_object()) {
            clear();
            loadOutdoorJson(parsed["outdoor"]);
            loadEvacJson(parsed["outdoor"]);
            if (parsed.contains("indoor") && parsed["indoor"].is_array()) {
                for (const auto& ind : parsed["indoor"]) {
                    loadIndoorJson(ind);
                }
            }
            if (parsed.contains("evac") && parsed["evac"].is_object()) {
                loadEvacJson(parsed["evac"]);
            }
            loadEvacJson(parsed);
            finalizeCoordinatesAndHeuristic();
            return;
        }

        if (isIndoorJsonObject(parsed)) {
            if (parsed.value("reset", false)) {
                clear();
            }
            loadIndoorJson(parsed);
            finalizeCoordinatesAndHeuristic();
            return;
        }

        if (!parsed.value("append", false)) {
            clear();
        }
        loadOutdoorJson(parsed);
        if (parsed.contains("indoor") && parsed["indoor"].is_array()) {
            for (const auto& ind : parsed["indoor"]) {
                loadIndoorJson(ind);
            }
        }
        if (parsed.contains("evac") && parsed["evac"].is_object()) {
            loadEvacJson(parsed["evac"]);
        }
        loadEvacJson(parsed);
        finalizeCoordinatesAndHeuristic();
    }

    static json readJsonFile(const std::filesystem::path& filePath) {
        std::ifstream ifs(filePath);
        if (!ifs.is_open()) {
            throw std::runtime_error("Cannot open file: " + filePath.string());
        }
        json j;
        ifs >> j;
        return j;
    }

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

    void loadFromDiskFiles(const std::string& graphPath,
                           const std::string& indoorDir = "",
                           const std::string& evacPath = "") {
        namespace fs = std::filesystem;
        clear();
        const fs::path gPath(graphPath);
        const json outdoorJson = readJsonFile(gPath);
        loadOutdoorJson(outdoorJson);
        loadEvacJson(outdoorJson);

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

        std::error_code ec;
        const fs::path resolvedEvacPath = !evacPath.empty()
                                              ? fs::path(evacPath)
                                              : (gPath.parent_path() / "evac.json");
        if (fs::exists(resolvedEvacPath, ec) && fs::is_regular_file(resolvedEvacPath, ec)) {
            loadEvacJson(readJsonFile(resolvedEvacPath));
        }

        finalizeCoordinatesAndHeuristic();
    }

    void loadFromDataDirectory(const std::string& dataDir = "data") {
        namespace fs = std::filesystem;
        const fs::path resolved = resolveDataDirectory(dataDir);
        const fs::path graphPath = resolved / "graph.json";
        const fs::path indoorDir = resolved / "indoor";
        const fs::path evacPath = resolved / "evac.json";
        loadFromDiskFiles(graphPath.string(), indoorDir.string(), evacPath.string());
    }

private:
    static bool isEvacOnlyJsonObject(const json& j) {
        if (!j.is_object()) return false;
        const bool hasEvac = j.contains("assemblyAreas") || j.contains("buildingExits");
        const bool hasGraph = j.contains("nodes") || j.contains("edges") ||
                              j.contains("outdoor") || j.contains("floors");
        return hasEvac && !hasGraph;
    }
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
// SECTION 3: Single-Pair Routing Algorithms & Path Step Formatting
// ============================================================================

// ----------------------------------------------------------------------------
// 3.1 Path Reconstruction & Outdoor/Indoor/Floor Step Builder
// ----------------------------------------------------------------------------

inline void recordTrace(std::vector<TraceEvent>& trace, size_t maxEvents,
                        const std::string& type, const std::string& nodeId, double dist) {
    if (trace.size() < maxEvents) {
        trace.push_back(TraceEvent{type, nodeId, dist});
    }
}

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
 * Formats an existing `res.pathIndices` sequence into `res.path` (node IDs)
 * and `res.steps` (grouped outdoor/indoor/entrance/floor-transition instructions).
 */
inline void buildStepsFromPathIndices(const Graph& g, const RouteOptions& opts, RouteResult& res) {
    res.path.clear();
    res.steps.clear();
    if (res.pathIndices.empty()) {
        res.found = false;
        return;
    }

    res.path.reserve(res.pathIndices.size());
    for (int idx : res.pathIndices) {
        res.path.push_back(g.nodes[idx].id);
    }

    if (res.pathIndices.size() == 1) {
        res.steps.push_back("Arrive at " + g.displayNodeName(res.pathIndices[0]) + " (0.0 m)");
        return;
    }

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
    buildStepsFromPathIndices(g, opts, res);
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
 *   pairwise leg generator for TSP, and ground-truth distance baseline.
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
 *   and live trace visualization contrasting directional search against Dijkstra.
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
            if (std::abs(g - other.g) > 1e-12) return g > other.g;
            // Deterministic tie-breaker on vertex index to ensure priority-queue extraction
            // and path reconstruction are 100% reproducible across platforms and compilers.
            return u > other.u;
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
 *   distance agreement with Dijkstra/A* and detecting negative cycles.
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

// ============================================================================
// SECTION 5: LRU Route Cache (Hash Map + Doubly Linked List)
// ============================================================================

/**
 * Algorithm: Least Recently Used (LRU) Route Cache
 * What it does:
 *   Memoizes computed `RouteResult` objects keyed by `(from, to, algo, accessible,
 *   blockedSetHash)` using a doubly linked list (`std::list`) ordered from
 *   most-recently-used (front) to least-recently-used (back) paired with an
 *   `std::unordered_map` from key to list iterator. Automatically invalidates
 *   cached entries whenever the active blocked node/edge set changes.
 * Time Complexity:
 *   O(1) average time for lookup (`get`), insertion (`put`), promotion, and
 *   LRU eviction; O(C) space where C is cache capacity.
 * Where the app uses it:
 *   Accelerates repeated route queries in `call("route", ...)` and exposes cache
 *   telemetry (`hits`, `misses`, `size`) via `call("cacheStats", ...)`.
 */
class RouteLRUCache {
public:
    using ListType = std::list<std::pair<std::string, RouteResult>>;

    explicit RouteLRUCache(size_t cap = 128) : capacity_(cap) {}

    bool get(const std::string& key, uint64_t blockedHash, RouteResult& outResult) {
        invalidateIfBlockedChanged(blockedHash);

        auto it = map_.find(key);
        if (it == map_.end()) {
            misses_++;
            return false;
        }
        // Promote to front (most recently used)
        items_.splice(items_.begin(), items_, it->second);
        hits_++;
        outResult = it->second->second;
        return true;
    }

    void put(const std::string& key, uint64_t blockedHash, const RouteResult& value) {
        invalidateIfBlockedChanged(blockedHash);
        if (capacity_ == 0) return;

        auto it = map_.find(key);
        if (it != map_.end()) {
            it->second->second = value;
            items_.splice(items_.begin(), items_, it->second);
            return;
        }

        if (items_.size() >= capacity_) {
            const auto& lruKey = items_.back().first;
            map_.erase(lruKey);
            items_.pop_back();
            evictions_++;
        }

        items_.emplace_front(key, value);
        map_[key] = items_.begin();
    }

    void invalidateIfBlockedChanged(uint64_t blockedHash) {
        if (hasBlockedHash_ && blockedHash != activeBlockedHash_) {
            items_.clear();
            map_.clear();
            invalidations_++;
        }
        activeBlockedHash_ = blockedHash;
        hasBlockedHash_ = true;
    }

    void invalidateEntries() {
        items_.clear();
        map_.clear();
        hasBlockedHash_ = false;
        activeBlockedHash_ = 0;
    }

    void resetAll(size_t newCapacity = 128) {
        items_.clear();
        map_.clear();
        capacity_ = newCapacity;
        hits_ = 0;
        misses_ = 0;
        evictions_ = 0;
        invalidations_ = 0;
        hasBlockedHash_ = false;
        activeBlockedHash_ = 0;
    }

    void setCapacity(size_t newCapacity) {
        capacity_ = newCapacity;
        while (items_.size() > capacity_) {
            map_.erase(items_.back().first);
            items_.pop_back();
            evictions_++;
        }
    }

    size_t hits() const { return hits_; }
    size_t misses() const { return misses_; }
    size_t size() const { return items_.size(); }
    size_t capacity() const { return capacity_; }
    size_t evictions() const { return evictions_; }
    size_t invalidations() const { return invalidations_; }

    std::vector<std::string> keysMRUFirst() const {
        std::vector<std::string> keys;
        keys.reserve(items_.size());
        for (const auto& kv : items_) {
            keys.push_back(kv.first);
        }
        return keys;
    }

private:
    size_t capacity_ = 128;
    ListType items_;
    std::unordered_map<std::string, ListType::iterator> map_;
    size_t hits_ = 0;
    size_t misses_ = 0;
    size_t evictions_ = 0;
    size_t invalidations_ = 0;
    bool hasBlockedHash_ = false;
    uint64_t activeBlockedHash_ = 0;
};

// ============================================================================
// SECTION 6: Floyd-Warshall All-Pairs Shortest Paths
// ============================================================================

/**
 * Algorithm: Floyd-Warshall All-Pairs Shortest Paths & Next-Hop Reconstruction
 * What it does:
 *   Computes exact shortest-path distances and next-hop pointers between every
 *   pair of outdoor campus vertices using dynamic programming over intermediate
 *   vertices k = 0 .. V_out - 1. Produces the landmark-to-landmark distance
 *   matrix (`call("allPairs")`) and reconstructs full shortest paths when
 *   `call("route", {..., algo: "floyd"})` is invoked.
 * Time Complexity:
 *   O(V^3) time, O(V^2) space (where V is the number of outdoor graph nodes).
 * Where the app uses it:
 *   Campus-wide landmark distance matrix (`call("allPairs")`), route planning
 *   under `algo: "floyd"`, and multi-algorithm comparison (`call("compare")`).
 */
struct FloydTable {
    uint64_t graphGeneration = 0;
    uint64_t blockedHash = 0;
    bool accessibleOnly = false;
    bool valid = false;

    std::vector<int> outdoorToGraphIdx; // matrix idx [0..M-1] -> Graph node idx
    std::unordered_map<int, int> graphToOutdoorIdx; // Graph node idx -> matrix idx
    std::vector<std::vector<double>> dist;
    std::vector<std::vector<int>> next;
};

inline FloydTable computeFloydWarshallTable(const Graph& g, const RouteOptions& opts) {
    FloydTable table;
    table.graphGeneration = g.loadGeneration;
    table.blockedHash = opts.blockedSetHash();
    table.accessibleOnly = opts.accessibleOnly;

    for (int u = 0; u < g.nodeCount(); ++u) {
        if (!g.nodes[u].isIndoor) {
            const int mIdx = static_cast<int>(table.outdoorToGraphIdx.size());
            table.outdoorToGraphIdx.push_back(u);
            table.graphToOutdoorIdx[u] = mIdx;
        }
    }

    const int m = static_cast<int>(table.outdoorToGraphIdx.size());
    table.dist.assign(m, std::vector<double>(m, kInf));
    table.next.assign(m, std::vector<int>(m, -1));

    for (int i = 0; i < m; ++i) {
        const int u = table.outdoorToGraphIdx[i];
        if (opts.isNodeBlocked(u)) continue;
        table.dist[i][i] = 0.0;
        table.next[i][i] = i;

        for (const auto& e : g.adj[u]) {
            if (!g.canTraverse(u, e, opts)) continue;
            auto it = table.graphToOutdoorIdx.find(e.to);
            if (it == table.graphToOutdoorIdx.end()) continue;
            const int j = it->second;
            if (e.w < table.dist[i][j]) {
                table.dist[i][j] = e.w;
                table.next[i][j] = j;
            }
        }
    }

    for (int k = 0; k < m; ++k) {
        for (int i = 0; i < m; ++i) {
            if (std::isinf(table.dist[i][k])) continue;
            for (int j = 0; j < m; ++j) {
                if (std::isinf(table.dist[k][j])) continue;
                const double cand = table.dist[i][k] + table.dist[k][j];
                if (cand + 1e-12 < table.dist[i][j]) {
                    table.dist[i][j] = cand;
                    table.next[i][j] = table.next[i][k];
                }
            }
        }
    }

    table.valid = true;
    return table;
}

inline FloydTable& cachedFloydTable(const Graph& g, const RouteOptions& opts, bool forceRecompute = false) {
    static FloydTable cached;
    const uint64_t bHash = opts.blockedSetHash();
    if (forceRecompute || !cached.valid ||
        cached.graphGeneration != g.loadGeneration ||
        cached.blockedHash != bHash ||
        cached.accessibleOnly != opts.accessibleOnly) {
        cached = computeFloydWarshallTable(g, opts);
    }
    return cached;
}

/**
 * Reconstructs a shortest path between `from` and `to` using the Floyd-Warshall
 * `next` matrix on the outdoor graph.
 */
inline RouteResult runFloydWarshallRoute(const Graph& g, int from, int to,
                                         const RouteOptions& opts,
                                         bool forceFreshComputation = false) {
    RouteResult res;
    const int n = g.nodeCount();
    if (from < 0 || to < 0 || from >= n || to >= n) {
        res.error = "Invalid source or destination node";
        return res;
    }
    if (opts.isNodeBlocked(from) || opts.isNodeBlocked(to)) {
        return res;
    }

    const FloydTable& fw = cachedFloydTable(g, opts, forceFreshComputation);
    auto itFrom = fw.graphToOutdoorIdx.find(from);
    auto itTo = fw.graphToOutdoorIdx.find(to);

    if (itFrom != fw.graphToOutdoorIdx.end() && itTo != fw.graphToOutdoorIdx.end()) {
        const int u = itFrom->second;
        const int v = itTo->second;
        res.visitedCount = static_cast<int>(fw.outdoorToGraphIdx.size());

        if (fw.next[u][v] == -1 || std::isinf(fw.dist[u][v])) {
            res.found = false;
            return res;
        }

        res.found = true;
        res.distance = fw.dist[u][v];

        int curr = u;
        int safety = 0;
        const int maxSteps = static_cast<int>(fw.outdoorToGraphIdx.size()) + 2;
        double accumDist = 0.0;

        while (curr != v && safety <= maxSteps) {
            const int gIdx = fw.outdoorToGraphIdx[curr];
            res.pathIndices.push_back(gIdx);
            recordTrace(res.trace, opts.maxTrace, "visit", g.nodes[gIdx].id, accumDist);
            const int nxt = fw.next[curr][v];
            if (nxt < 0) {
                res.found = false;
                res.pathIndices.clear();
                return res;
            }
            accumDist += fw.dist[curr][nxt];
            curr = nxt;
            safety++;
        }
        const int endGIdx = fw.outdoorToGraphIdx[v];
        res.pathIndices.push_back(endGIdx);
        recordTrace(res.trace, opts.maxTrace, "visit", g.nodes[endGIdx].id, res.distance);

        buildStepsFromPathIndices(g, opts, res);
        return res;
    }

    // Fallback when an indoor node is specified with algo="floyd": run full-graph Floyd-Warshall
    const int totalN = g.nodeCount();
    std::vector<std::vector<double>> dist(totalN, std::vector<double>(totalN, kInf));
    std::vector<std::vector<int>> next(totalN, std::vector<int>(totalN, -1));

    for (int i = 0; i < totalN; ++i) {
        if (opts.isNodeBlocked(i)) continue;
        dist[i][i] = 0.0;
        next[i][i] = i;
        for (const auto& e : g.adj[i]) {
            if (!g.canTraverse(i, e, opts)) continue;
            if (e.w < dist[i][e.to]) {
                dist[i][e.to] = e.w;
                next[i][e.to] = e.to;
            }
        }
    }

    for (int k = 0; k < totalN; ++k) {
        for (int i = 0; i < totalN; ++i) {
            if (std::isinf(dist[i][k])) continue;
            for (int j = 0; j < totalN; ++j) {
                if (std::isinf(dist[k][j])) continue;
                const double cand = dist[i][k] + dist[k][j];
                if (cand + 1e-12 < dist[i][j]) {
                    dist[i][j] = cand;
                    next[i][j] = next[i][k];
                }
            }
        }
    }

    res.visitedCount = totalN;
    if (next[from][to] == -1 || std::isinf(dist[from][to])) {
        res.found = false;
        return res;
    }

    res.found = true;
    res.distance = dist[from][to];
    int curr = from;
    int safety = 0;
    while (curr != to && safety <= totalN + 2) {
        res.pathIndices.push_back(curr);
        recordTrace(res.trace, opts.maxTrace, "visit", g.nodes[curr].id, dist[from][curr]);
        curr = next[curr][to];
        if (curr < 0) break;
        safety++;
    }
    res.pathIndices.push_back(to);
    recordTrace(res.trace, opts.maxTrace, "visit", g.nodes[to].id, res.distance);
    buildStepsFromPathIndices(g, opts, res);
    return res;
}

/**
 * Builds the `call("allPairs")` JSON response containing the landmark-to-landmark
 * shortest-path distance matrix (using landmark entrance nodes, unreachable as `null`).
 */
inline json computeAllPairsMatrixJson(const Graph& g, const RouteOptions& opts) {
    const FloydTable& fw = cachedFloydTable(g, opts, false);
    json matrix = json::object();

    if (!g.landmarks.empty()) {
        // Sort landmarks by ID so the allPairs matrix rows and columns appear in
        // strict deterministic lexicographic order, regardless of input JSON array order.
        std::vector<Landmark> sortedLandmarks = g.landmarks;
        std::sort(sortedLandmarks.begin(), sortedLandmarks.end(), [](const Landmark& a, const Landmark& b) {
            return a.id < b.id;
        });

        for (const auto& lmA : sortedLandmarks) {
            json row = json::object();
            const int gIdxA = g.getNodeIndex(lmA.nodeId);
            const auto itA = fw.graphToOutdoorIdx.find(gIdxA);

            for (const auto& lmB : sortedLandmarks) {
                const int gIdxB = g.getNodeIndex(lmB.nodeId);
                const auto itB = fw.graphToOutdoorIdx.find(gIdxB);
                if (itA != fw.graphToOutdoorIdx.end() && itB != fw.graphToOutdoorIdx.end()) {
                    const double d = fw.dist[itA->second][itB->second];
                    if (std::isinf(d)) {
                        row[lmB.id] = nullptr;
                    } else {
                        row[lmB.id] = d;
                    }
                } else {
                    row[lmB.id] = nullptr;
                }
            }
            matrix[lmA.id] = std::move(row);
        }
    } else {
        // Fallback when no landmarks exist: index by outdoor node IDs sorted deterministically
        std::vector<int> sortedOutdoor = fw.outdoorToGraphIdx;
        std::sort(sortedOutdoor.begin(), sortedOutdoor.end(), [&](int u, int v) {
            return g.nodes[u].id < g.nodes[v].id;
        });
        for (int u : sortedOutdoor) {
            const std::string& idA = g.nodes[u].id;
            const int i = fw.graphToOutdoorIdx.at(u);
            json row = json::object();
            for (int v : sortedOutdoor) {
                const std::string& idB = g.nodes[v].id;
                const int j = fw.graphToOutdoorIdx.at(v);
                const double d = fw.dist[i][j];
                if (std::isinf(d)) {
                    row[idB] = nullptr;
                } else {
                    row[idB] = d;
                }
            }
            matrix[idA] = std::move(row);
        }
    }

    return json{
        {"matrix", std::move(matrix)},
        {"landmarkCount", static_cast<int>(g.landmarks.size())},
        {"outdoorNodeCount", static_cast<int>(fw.outdoorToGraphIdx.size())}
    };
}

/**
 * Unified router entry point dispatching to Dijkstra, A*, BFS, Bellman-Ford, or Floyd-Warshall.
 */
inline RouteResult computeRoute(const Graph& g, int from, int to,
                                const RouteOptions& opts,
                                bool forceFreshFloyd = false) {
    const std::string algo = toLowerCopy(opts.algo);

    if (algo == "dijkstra" || algo.empty()) {
        return runDijkstra(g, from, to, opts);
    } else if (algo == "astar" || algo == "a*") {
        return runAStar(g, from, to, opts);
    } else if (algo == "bfs") {
        return runBFS(g, from, to, opts);
    } else if (algo == "bellmanford" || algo == "bellman-ford" || algo == "bf") {
        return runBellmanFord(g, from, to, opts);
    } else if (algo == "floyd" || algo == "floyd-warshall" || algo == "floydwarshall") {
        return runFloydWarshallRoute(g, from, to, opts, forceFreshFloyd);
    } else {
        RouteResult err;
        err.error = "Unknown routing algorithm: " + opts.algo;
        return err;
    }
}

// ============================================================================
// SECTION 7: Disjoint Set Union (Union-Find) & Minimum Spanning Tree (MST)
// ============================================================================

// ----------------------------------------------------------------------------
// 7.1 Union-Find with Path Compression and Union by Rank
// ----------------------------------------------------------------------------

/**
 * Algorithm: Disjoint Set Union (Union-Find with Path Compression & Union by Rank)
 * What it does:
 *   Maintains partitioned connected components over N elements, supporting
 *   near-constant-time component representative lookup (`find`) and component
 *   merging (`unite`).
 * Time Complexity:
 *   O(alpha(V)) amortized time per operation (inverse Ackermann), O(V) space.
 * Where the app uses it:
 *   Cycle detection in Kruskal's Minimum Spanning Tree algorithm.
 */
class UnionFind {
public:
    explicit UnionFind(int n) : parent_(n), rank_(n, 0) {
        std::iota(parent_.begin(), parent_.end(), 0);
    }

    int find(int x) {
        if (parent_[x] != x) {
            parent_[x] = find(parent_[x]);
        }
        return parent_[x];
    }

    bool unite(int x, int y) {
        int rx = find(x);
        int ry = find(y);
        if (rx == ry) return false;
        if (rank_[rx] < rank_[ry]) {
            std::swap(rx, ry);
        }
        parent_[ry] = rx;
        if (rank_[rx] == rank_[ry]) {
            rank_[rx]++;
        }
        return true;
    }

private:
    std::vector<int> parent_;
    std::vector<int> rank_;
};

struct UndirectedEdge {
    int u; // Outdoor dense index [0..M-1]
    int v; // Outdoor dense index [0..M-1]
    int graphU;
    int graphV;
    double w;
};

struct MSTResult {
    std::string algo;
    double totalWeight = 0.0;
    std::vector<UndirectedEdge> edges;
};

/**
 * Extracts deduplicated undirected outdoor edges (picking minimum weight when
 * parallel edges exist between two outdoor vertices).
 */
inline void extractOutdoorUndirectedGraph(const Graph& g,
                                          std::vector<int>& outdoorToGraph,
                                          std::vector<UndirectedEdge>& undirectedEdges) {
    outdoorToGraph.clear();
    undirectedEdges.clear();
    std::unordered_map<int, int> graphToOutdoor;

    for (int u = 0; u < g.nodeCount(); ++u) {
        if (!g.nodes[u].isIndoor) {
            const int idx = static_cast<int>(outdoorToGraph.size());
            outdoorToGraph.push_back(u);
            graphToOutdoor[u] = idx;
        }
    }

    // Use std::map (not unordered_map) so unique undirected edges are collected
    // in strict deterministic index order (a, b) across all platforms.
    std::map<uint64_t, double> bestWeight;
    for (int mU = 0; mU < static_cast<int>(outdoorToGraph.size()); ++mU) {
        const int gU = outdoorToGraph[mU];
        for (const auto& e : g.adj[gU]) {
            auto itV = graphToOutdoor.find(e.to);
            if (itV == graphToOutdoor.end()) continue;
            const int mV = itV->second;
            if (mU == mV) continue;
            const int a = std::min(mU, mV);
            const int b = std::max(mU, mV);
            const uint64_t key = RouteOptions::edgeKey(a, b);
            auto bwIt = bestWeight.find(key);
            if (bwIt == bestWeight.end() || e.w < bwIt->second) {
                bestWeight[key] = e.w;
            }
        }
    }

    undirectedEdges.reserve(bestWeight.size());
    for (const auto& [key, w] : bestWeight) {
        const int a = static_cast<int>(static_cast<uint32_t>(key >> 32));
        const int b = static_cast<int>(static_cast<uint32_t>(key & 0xFFFFFFFFULL));
        undirectedEdges.push_back(UndirectedEdge{
            a, b, outdoorToGraph[a], outdoorToGraph[b], w
        });
    }
}

// ----------------------------------------------------------------------------
// 7.2 Kruskal's MST Algorithm
// ----------------------------------------------------------------------------

/**
 * Algorithm: Kruskal's Minimum Spanning Tree (using Union-Find)
 * What it does:
 *   Sorts all undirected outdoor campus edges by ascending weight and greedily
 *   adds edges that connect previously disjoint components using Union-Find.
 * Time Complexity:
 *   O(E log E) time, O(V + E) space.
 * Where the app uses it:
 *   Campus backbone infrastructure planner (`call("mst", {algo: "kruskal"})`),
 *   computing the minimum total fiber/walkway length needed to connect all outdoor nodes.
 */
inline MSTResult runKruskalMST(const Graph& g) {
    MSTResult res;
    res.algo = "kruskal";

    std::vector<int> outdoorToGraph;
    std::vector<UndirectedEdge> allEdges;
    extractOutdoorUndirectedGraph(g, outdoorToGraph, allEdges);

    std::sort(allEdges.begin(), allEdges.end(), [](const UndirectedEdge& a, const UndirectedEdge& b) {
        if (std::abs(a.w - b.w) > 1e-12) return a.w < b.w;
        if (a.u != b.u) return a.u < b.u;
        return a.v < b.v;
    });

    UnionFind uf(static_cast<int>(outdoorToGraph.size()));
    for (const auto& e : allEdges) {
        if (uf.unite(e.u, e.v)) {
            res.totalWeight += e.w;
            res.edges.push_back(e);
        }
    }
    return res;
}

// ----------------------------------------------------------------------------
// 7.3 Prim's MST Algorithm (Binary Min-Heap)
// ----------------------------------------------------------------------------

/**
 * Algorithm: Prim's Minimum Spanning Tree (Binary Min-Heap)
 * What it does:
 *   Grows a minimum spanning tree (or spanning forest if disconnected) from a
 *   starting vertex by repeatedly attaching the lowest-weight frontier edge
 *   connecting the tree to an unvisited outdoor vertex.
 * Time Complexity:
 *   O((V + E) log V) time, O(V + E) space.
 * Where the app uses it:
 *   Alternative MST solver (`call("mst", {algo: "prim"})`) verifying total
 *   backbone length equivalence with Kruskal's algorithm.
 */
inline MSTResult runPrimMST(const Graph& g) {
    MSTResult res;
    res.algo = "prim";

    std::vector<int> outdoorToGraph;
    std::vector<UndirectedEdge> allEdges;
    extractOutdoorUndirectedGraph(g, outdoorToGraph, allEdges);

    const int m = static_cast<int>(outdoorToGraph.size());
    if (m == 0) return res;

    std::vector<std::vector<std::pair<int, double>>> uAdj(m);
    for (const auto& e : allEdges) {
        uAdj[e.u].push_back({e.v, e.w});
        uAdj[e.v].push_back({e.u, e.w});
    }

    struct PrimItem {
        double w;
        int from;
        int to;
        bool operator>(const PrimItem& other) const {
            if (std::abs(w - other.w) > 1e-12) return w > other.w;
            if (from != other.from) return from > other.from;
            return to > other.to;
        }
    };

    std::vector<bool> inMST(m, false);
    std::priority_queue<PrimItem, std::vector<PrimItem>, std::greater<PrimItem>> pq;

    for (int start = 0; start < m; ++start) {
        if (inMST[start]) continue;
        pq.push(PrimItem{0.0, -1, start});

        while (!pq.empty()) {
            const PrimItem cur = pq.top();
            pq.pop();

            if (inMST[cur.to]) continue;
            inMST[cur.to] = true;

            if (cur.from != -1) {
                const int a = std::min(cur.from, cur.to);
                const int b = std::max(cur.from, cur.to);
                res.totalWeight += cur.w;
                res.edges.push_back(UndirectedEdge{
                    a, b, outdoorToGraph[a], outdoorToGraph[b], cur.w
                });
            }

            for (const auto& [nxt, w] : uAdj[cur.to]) {
                if (!inMST[nxt]) {
                    pq.push(PrimItem{w, cur.to, nxt});
                }
            }
        }
    }
    return res;
}

// ============================================================================
// SECTION 8: Multi-Stop Traveling Salesperson Problem (TSP)
// ============================================================================

struct TSPResult {
    bool found = false;
    std::string algo;
    bool returnToStart = false;
    double totalDistance = 0.0;
    double dpDistance = 0.0;
    double nnDistance = 0.0;
    double heuristicGapPercent = 0.0;
    std::vector<std::string> orderedStops;
    std::vector<std::string> fullPath;
    std::string error;
};

// ----------------------------------------------------------------------------
// 8.1 Pairwise Dijkstra Leg Matrix
// ----------------------------------------------------------------------------

/**
 * Precomputes exact shortest-path distances and node sequences between all pairs
 * of the K requested TSP stops using Dijkstra's algorithm.
 */
inline bool buildPairwiseStopMatrix(const Graph& g,
                                    const std::vector<int>& stopNodeIndices,
                                    const RouteOptions& baseOpts,
                                    std::vector<std::vector<double>>& distMat,
                                    std::vector<std::vector<std::vector<std::string>>>& pathMat) {
    const int k = static_cast<int>(stopNodeIndices.size());
    distMat.assign(k, std::vector<double>(k, kInf));
    pathMat.assign(k, std::vector<std::vector<std::string>>(k));

    RouteOptions dOpts = baseOpts;
    dOpts.algo = "dijkstra";
    dOpts.maxTrace = 0;

    for (int i = 0; i < k; ++i) {
        distMat[i][i] = 0.0;
        pathMat[i][i] = {g.nodes[stopNodeIndices[i]].id};
        for (int j = 0; j < k; ++j) {
            if (i == j) continue;
            const RouteResult r = runDijkstra(g, stopNodeIndices[i], stopNodeIndices[j], dOpts);
            if (!r.found) {
                return false;
            }
            distMat[i][j] = r.distance;
            pathMat[i][j] = r.path;
        }
    }
    return true;
}

// ----------------------------------------------------------------------------
// 8.2 Held-Karp Exact Bitmask DP (up to 12 stops)
// ----------------------------------------------------------------------------

/**
 * Algorithm: Held-Karp Bitmask Dynamic Programming for Multi-Stop TSP
 * What it does:
 *   Finds the globally optimal ordering of K stops starting at `stops[0]`
 *   (optionally returning to `stops[0]`) over pairwise Dijkstra shortest-path
 *   distances using state `dp[mask][u]` (minimum distance visiting subset `mask`
 *   and ending at stop `u`).
 * Time Complexity:
 *   O(K^2 * 2^K + K * (V + E) log V) time, O(K * 2^K) space (for K <= 12).
 * Where the app uses it:
 *   Multi-stop campus tour optimizer (`call("tsp", {stops, algo: "dp"})`).
 */
inline std::pair<double, std::vector<int>> solveTspBitmaskDP(
    const std::vector<std::vector<double>>& distMat,
    bool returnToStart) {
    const int k = static_cast<int>(distMat.size());
    if (k == 0) return {0.0, {}};
    if (k == 1) {
        return {0.0, {0}};
    }

    const int numMasks = 1 << k;
    std::vector<std::vector<double>> dp(numMasks, std::vector<double>(k, kInf));
    std::vector<std::vector<int>> parent(numMasks, std::vector<int>(k, -1));

    dp[1][0] = 0.0;

    for (int mask = 1; mask < numMasks; ++mask) {
        if ((mask & 1) == 0) continue; // Stop 0 is always the start
        for (int u = 0; u < k; ++u) {
            if ((mask & (1 << u)) == 0) continue;
            const double curDist = dp[mask][u];
            if (std::isinf(curDist)) continue;

            for (int v = 0; v < k; ++v) {
                if (mask & (1 << v)) continue;
                const int nextMask = mask | (1 << v);
                const double cand = curDist + distMat[u][v];
                if (cand + 1e-12 < dp[nextMask][v]) {
                    dp[nextMask][v] = cand;
                    parent[nextMask][v] = u;
                }
            }
        }
    }

    const int fullMask = numMasks - 1;
    double bestTotal = kInf;
    int bestEnd = -1;

    for (int u = (k > 1 ? 1 : 0); u < k; ++u) {
        if (std::isinf(dp[fullMask][u])) continue;
        const double total = dp[fullMask][u] + (returnToStart ? distMat[u][0] : 0.0);
        if (total + 1e-12 < bestTotal) {
            bestTotal = total;
            bestEnd = u;
        }
    }

    if (bestEnd == -1) {
        return {kInf, {}};
    }

    std::vector<int> order;
    int currMask = fullMask;
    int currU = bestEnd;
    while (currU != -1) {
        order.push_back(currU);
        const int prevU = parent[currMask][currU];
        currMask ^= (1 << currU);
        currU = prevU;
    }
    std::reverse(order.begin(), order.end());
    if (returnToStart) {
        order.push_back(0);
    }
    return {bestTotal, order};
}

// ----------------------------------------------------------------------------
// 8.3 Nearest-Neighbor Greedy Heuristic & Gap Comparison
// ----------------------------------------------------------------------------

/**
 * Algorithm: Nearest-Neighbor Greedy TSP Heuristic
 * What it does:
 *   Starts at `stops[0]` and repeatedly steps to the closest unvisited stop
 *   until all K stops have been visited, providing a fast greedy baseline to
 *   measure the optimality gap against Held-Karp bitmask DP.
 * Time Complexity:
 *   O(K^2 + K * (V + E) log V) time, O(K) auxiliary space.
 * Where the app uses it:
 *   Multi-stop tour heuristic comparison (`call("tsp", {stops, algo: "nn"})`)
 *   and computing `heuristicGapPercent`.
 */
inline std::pair<double, std::vector<int>> solveTspNearestNeighbor(
    const std::vector<std::vector<double>>& distMat,
    bool returnToStart) {
    const int k = static_cast<int>(distMat.size());
    if (k == 0) return {0.0, {}};
    if (k == 1) return {0.0, {0}};

    std::vector<bool> visited(k, false);
    std::vector<int> order;
    order.reserve(k + 1);

    int curr = 0;
    visited[0] = true;
    order.push_back(0);
    double total = 0.0;

    for (int step = 1; step < k; ++step) {
        int bestNext = -1;
        double bestDist = kInf;
        for (int cand = 0; cand < k; ++cand) {
            if (!visited[cand] && distMat[curr][cand] + 1e-12 < bestDist) {
                bestDist = distMat[curr][cand];
                bestNext = cand;
            }
        }
        if (bestNext == -1) {
            return {kInf, {}};
        }
        visited[bestNext] = true;
        total += bestDist;
        order.push_back(bestNext);
        curr = bestNext;
    }

    if (returnToStart) {
        total += distMat[curr][0];
        order.push_back(0);
    }
    return {total, order};
}

/**
 * Executes multi-stop TSP (`dp` or `nn`), stitches the full node path from the
 * pairwise Dijkstra legs, and computes the heuristic gap percentage.
 */
inline TSPResult runTSP(const Graph& g,
                        const std::vector<std::string>& stopIds,
                        const std::vector<int>& stopNodeIndices,
                        const std::string& requestedAlgo,
                        bool returnToStart,
                        const RouteOptions& baseOpts) {
    TSPResult res;
    const std::string algo = toLowerCopy(requestedAlgo.empty() ? "dp" : requestedAlgo);
    res.algo = algo;
    res.returnToStart = returnToStart;

    const int k = static_cast<int>(stopNodeIndices.size());
    if (k == 0) {
        res.error = "At least one stop is required for TSP";
        return res;
    }
    if (algo == "dp" && k > 12) {
        res.error = "TSP bitmask DP supports at most 12 stops";
        return res;
    }

    std::vector<std::vector<double>> distMat;
    std::vector<std::vector<std::vector<std::string>>> pathMat;
    if (!buildPairwiseStopMatrix(g, stopNodeIndices, baseOpts, distMat, pathMat)) {
        res.error = "One or more TSP stops are mutually unreachable";
        return res;
    }

    const auto [nnDist, nnOrder] = solveTspNearestNeighbor(distMat, returnToStart);
    res.nnDistance = nnDist;

    double dpDist = nnDist;
    std::vector<int> dpOrder = nnOrder;
    if (k <= 12) {
        std::tie(dpDist, dpOrder) = solveTspBitmaskDP(distMat, returnToStart);
        res.dpDistance = dpDist;
    }

    const std::vector<int>& chosenOrder = (algo == "nn") ? nnOrder : dpOrder;
    const double chosenDist = (algo == "nn") ? nnDist : dpDist;

    if (chosenOrder.empty() || std::isinf(chosenDist)) {
        res.error = "Unable to construct valid TSP tour";
        return res;
    }

    res.found = true;
    res.totalDistance = chosenDist;
    if (res.dpDistance > 1e-9 && res.nnDistance >= res.dpDistance) {
        res.heuristicGapPercent = ((res.nnDistance - res.dpDistance) / res.dpDistance) * 100.0;
    } else {
        res.heuristicGapPercent = 0.0;
    }

    for (int sIdx : chosenOrder) {
        res.orderedStops.push_back(stopIds[sIdx]);
    }

    // Stitch full node-by-node path from pairwise Dijkstra legs
    if (chosenOrder.size() == 1) {
        res.fullPath.push_back(g.nodes[stopNodeIndices[chosenOrder[0]]].id);
    } else {
        for (size_t i = 0; i + 1 < chosenOrder.size(); ++i) {
            const int u = chosenOrder[i];
            const int v = chosenOrder[i + 1];
            const auto& leg = pathMat[u][v];
            if (leg.empty()) continue;
            const size_t startOffset = res.fullPath.empty() ? 0 : 1;
            for (size_t p = startOffset; p < leg.size(); ++p) {
                res.fullPath.push_back(leg[p]);
            }
        }
    }

    return res;
}

// ============================================================================
// SECTION 9: Tarjan's Articulation Points & Bridges (Critical Infrastructure)
// ============================================================================

/**
 * Algorithm: Tarjan's Single-Pass DFS for Articulation Points and Bridges
 * What it does:
 *   Identifies all critical outdoor campus intersections (articulation points)
 *   and critical footpath segments (bridges) whose removal increases the number
 *   of connected components in the undirected outdoor campus graph, using DFS
 *   discovery times `disc[u]` and low-link values `low[u]`.
 * Time Complexity:
 *   O(V + E) time, O(V + E) space.
 * Where the app uses it:
 *   Campus vulnerability & emergency resilience analyzer (`call("criticalPoints")`).
 */
struct CriticalPointsResult {
    std::vector<std::string> articulationPoints;
    std::vector<std::pair<std::string, std::string>> bridges;
    json nodeDetails = json::array();
    json edgeDetails = json::array();
    json landmarkNames = json::object();
};

inline CriticalPointsResult runTarjanCriticalPoints(const Graph& g) {
    CriticalPointsResult res;

    std::vector<int> outdoorToGraph;
    std::vector<UndirectedEdge> allEdges;
    extractOutdoorUndirectedGraph(g, outdoorToGraph, allEdges);

    const int m = static_cast<int>(outdoorToGraph.size());
    if (m == 0) return res;

    std::vector<std::vector<std::pair<int, double>>> uAdj(m);
    for (const auto& e : allEdges) {
        uAdj[e.u].push_back({e.v, e.w});
        uAdj[e.v].push_back({e.u, e.w});
    }
    for (int i = 0; i < m; ++i) {
        std::sort(uAdj[i].begin(), uAdj[i].end());
    }

    std::vector<int> disc(m, -1);
    std::vector<int> low(m, -1);
    std::vector<bool> isArticulation(m, false);
    std::vector<std::pair<int, int>> bridgeIndices;
    int timer = 0;

    std::function<void(int, int)> dfs = [&](int u, int p) {
        disc[u] = low[u] = timer++;
        int children = 0;

        for (const auto& [v, w] : uAdj[u]) {
            if (v == p) continue;
            if (disc[v] != -1) {
                low[u] = std::min(low[u], disc[v]);
            } else {
                children++;
                dfs(v, u);
                low[u] = std::min(low[u], low[v]);

                if (p == -1 && children > 1) {
                    isArticulation[u] = true;
                }
                if (p != -1 && low[v] >= disc[u]) {
                    isArticulation[u] = true;
                }
                if (low[v] > disc[u]) {
                    const int a = std::min(u, v);
                    const int b = std::max(u, v);
                    bridgeIndices.push_back({a, b});
                }
            }
        }
    };

    for (int i = 0; i < m; ++i) {
        if (disc[i] == -1) {
            dfs(i, -1);
        }
    }

    auto resolveNodeLandmarkLabel = [&](int gIdx) -> std::string {
        const std::string& nid = g.nodes[gIdx].id;
        auto it = g.nodeToLandmarkNames.find(nid);
        if (it != g.nodeToLandmarkNames.end() && !it->second.empty()) {
            std::string joined = it->second[0];
            for (size_t i = 1; i < it->second.size(); ++i) {
                joined += " / " + it->second[i];
            }
            return joined;
        }
        return g.nodes[gIdx].name;
    };

    for (int i = 0; i < m; ++i) {
        if (!isArticulation[i]) continue;
        const int gIdx = outdoorToGraph[i];
        const std::string& nid = g.nodes[gIdx].id;
        const std::string lmLabel = resolveNodeLandmarkLabel(gIdx);

        res.articulationPoints.push_back(nid);
        if (!lmLabel.empty()) {
            res.landmarkNames[nid] = lmLabel;
        }

        json detail = {
            {"id", nid},
            {"landmarkName", lmLabel}
        };
        auto lmIt = g.nodeToLandmarkNames.find(nid);
        if (lmIt != g.nodeToLandmarkNames.end()) {
            detail["landmarks"] = lmIt->second;
        } else {
            detail["landmarks"] = json::array();
        }
        res.nodeDetails.push_back(std::move(detail));
    }

    // Sort articulation points and node details deterministically by node ID
    // so results are 100% reproducible across platforms and independent of DFS graph traversal.
    std::sort(res.articulationPoints.begin(), res.articulationPoints.end());
    std::sort(res.nodeDetails.begin(), res.nodeDetails.end(), [](const json& a, const json& b) {
        return a["id"].get<std::string>() < b["id"].get<std::string>();
    });

    // Sort bridges by their endpoint node IDs for deterministic output
    std::vector<std::pair<std::string, std::string>> sortedBridges;
    sortedBridges.reserve(bridgeIndices.size());
    for (const auto& [u, v] : bridgeIndices) {
        std::string idA = g.nodes[outdoorToGraph[u]].id;
        std::string idB = g.nodes[outdoorToGraph[v]].id;
        if (idB < idA) std::swap(idA, idB);
        sortedBridges.push_back({idA, idB});
    }
    std::sort(sortedBridges.begin(), sortedBridges.end());

    for (const auto& [idA, idB] : sortedBridges) {
        res.bridges.push_back({idA, idB});
        const int gA = g.getNodeIndex(idA);
        const int gB = g.getNodeIndex(idB);
        const std::string lmA = (gA >= 0) ? resolveNodeLandmarkLabel(gA) : "";
        const std::string lmB = (gB >= 0) ? resolveNodeLandmarkLabel(gB) : "";
        if (!lmA.empty()) res.landmarkNames[idA] = lmA;
        if (!lmB.empty()) res.landmarkNames[idB] = lmB;

        res.edgeDetails.push_back({
            {"a", idA},
            {"b", idB},
            {"landmarkA", lmA},
            {"landmarkB", lmB}
        });
    }

    // Sort bridge edge details deterministically by endpoints (a, b)
    std::sort(res.edgeDetails.begin(), res.edgeDetails.end(), [](const json& a, const json& b) {
        if (a["a"] != b["a"]) return a["a"] < b["a"];
        return a["b"] < b["b"];
    });

    return res;
}

// ============================================================================
// SECTION 10: Emergency Evacuation (Multi-Source Dijkstra & Min-Cost Max-Flow)
// ============================================================================

/**
 * Configuration options for emergency evacuation routing and capacity assignment.
 */
struct EvacOptions {
    RouteOptions routeOpts;
    bool disableLifts = true; // Default true during evacuation: lifts disabled, stairs allowed
};

/**
 * Represents a group of evacuees starting at a specific graph node (`at`).
 */
struct EvacGroup {
    std::string fromId;
    int nodeIdx = -1;
    int count = 0;
};

/**
 * Represents a single group-to-assembly-area evacuation assignment.
 */
struct EvacAssignment {
    std::string from;
    std::string assemblyId;
    std::string assemblyName;
    int count = 0;
    double distance = 0.0;
    std::vector<std::string> path;
    std::string exitNodeId; // Populated when `from` is an indoor node
};

/**
 * Represents the assigned vs. total capacity load at an assembly area.
 */
struct AssemblyLoadEntry {
    std::string id;
    std::string name;
    int assigned = 0;
    int capacity = 0;
};

/**
 * Complete result of an `evacuate` calculation in either "nearest" or "capacity" mode.
 */
struct EvacResult {
    std::string mode = "nearest";
    std::vector<EvacAssignment> assignments;
    int unassigned = 0;
    std::vector<AssemblyLoadEntry> assemblyLoad;
    double totalDistance = 0.0;     // Weighted person-distance sum(count * distance)
    double totalPathDistance = 0.0; // Unweighted sum of assignment path distances
    int maxAssemblyLoad = 0;
    int overloadedAreasCount = 0;
};

/**
 * Checks whether a forward directed edge `e` (`u -> e.to`) can be traversed
 * by an evacuee under `evOpts`.
 * - Respects `oneway` (since only valid forward edges exist in `g.adj[u]`).
 * - Respects blocked nodes and blocked edges.
 * - When `evOpts.disableLifts` is true (default), disallows any edge with
 *   `e.kind == "lift"` or entering/leaving a lift shaft node (`kind == "lift"`),
 *   while allowing stairs (`e.kind == "stairs"`).
 */
inline bool canTraverseEvacForwardEdge(const Graph& g, int u, const Edge& e, const EvacOptions& evOpts) {
    if (u < 0 || e.to < 0 || u >= g.nodeCount() || e.to >= g.nodeCount()) return false;
    if (evOpts.routeOpts.isNodeBlocked(u) || evOpts.routeOpts.isNodeBlocked(e.to)) return false;
    if (evOpts.routeOpts.isEdgeBlocked(u, e.to)) return false;
    if (evOpts.disableLifts) {
        if (e.kind == "lift" || g.nodes[u].kind == "lift" || g.nodes[e.to].kind == "lift") {
            return false;
        }
    }
    if (evOpts.routeOpts.accessibleOnly && !e.accessible) return false;
    return true;
}

/**
 * Builds the reversed adjacency list of the graph for backward search from
 * assembly areas. Each reversed edge in `revAdj[v]` represents a forward
 * directed edge `u -> v` from `g.adj[u]`.
 */
struct ReversedEdge {
    int fromForward; // u in forward graph (u -> v)
    Edge forwardEdge;
};

inline std::vector<std::vector<ReversedEdge>> buildReversedAdjacency(const Graph& g) {
    const int n = g.nodeCount();
    std::vector<std::vector<ReversedEdge>> revAdj(n);
    for (int u = 0; u < n; ++u) {
        for (const auto& e : g.adj[u]) {
            revAdj[e.to].push_back(ReversedEdge{u, e});
        }
    }
    return revAdj;
}

/**
 * Determines the building exit node (`exitNodeId`) nearest along the indoor
 * portion of an evacuation path when the start node `startIdx` is indoors.
 * Checks `g.buildingExits` (loaded from `data/evac.json`) for the building,
 * measuring shortest indoor walk distance from the path's indoor vertices to
 * each designated building exit, with fallback to any `"exit"` or `"entrance"`
 * node on the path.
 */
inline std::string findExitNodeAlongPath(const Graph& g, int startIdx,
                                         const std::vector<int>& pathIndices) {
    if (startIdx < 0 || startIdx >= g.nodeCount() || !g.nodes[startIdx].isIndoor) {
        return "";
    }
    const std::string& bId = g.nodes[startIdx].buildingId;

    // 1. If the path directly visits a designated building exit or a node with kind=="exit", return it
    for (int idx : pathIndices) {
        if (idx < 0 || idx >= g.nodeCount()) continue;
        const Node& n = g.nodes[idx];
        if (!n.isIndoor || n.buildingId != bId) continue;
        if (g.buildingExitNodeIds.find(n.id) != g.buildingExitNodeIds.end() || n.kind == "exit") {
            return n.id;
        }
    }

    // 2. Collect designated buildingExits for this building from data/evac.json
    std::vector<int> candidateExitIndices;
    for (const auto& be : g.buildingExits) {
        if (be.buildingId == bId) {
            const int eIdx = g.getNodeIndex(be.nodeId);
            if (eIdx >= 0) {
                candidateExitIndices.push_back(eIdx);
            }
        }
    }
    // Also include any indoor node of this building with kind == "exit"
    for (const auto& n : g.nodes) {
        if (n.isIndoor && n.buildingId == bId && n.kind == "exit") {
            if (std::find(candidateExitIndices.begin(), candidateExitIndices.end(), n.index) ==
                candidateExitIndices.end()) {
                candidateExitIndices.push_back(n.index);
            }
        }
    }

    if (!candidateExitIndices.empty()) {
        // Measure shortest indoor graph distance from the indoor nodes on `pathIndices`
        // to each candidate building exit node (using multi-source Dijkstra seeded with the indoor path nodes).
        const int n = g.nodeCount();
        std::vector<double> indoorDist(n, kInf);
        using PItem = std::pair<double, int>;
        std::priority_queue<PItem, std::vector<PItem>, std::greater<PItem>> pq;

        for (int idx : pathIndices) {
            if (idx >= 0 && idx < n && g.nodes[idx].isIndoor && g.nodes[idx].buildingId == bId) {
                indoorDist[idx] = 0.0;
                pq.push({0.0, idx});
            }
        }

        while (!pq.empty()) {
            const auto [d, u] = pq.top();
            pq.pop();
            if (d > indoorDist[u] + 1e-12) continue;
            for (const auto& e : g.adj[u]) {
                if (!g.nodes[e.to].isIndoor || g.nodes[e.to].buildingId != bId) continue;
                if (e.kind == "lift") continue;
                const double nd = d + e.w;
                if (nd + 1e-12 < indoorDist[e.to]) {
                    indoorDist[e.to] = nd;
                    pq.push({nd, e.to});
                }
            }
        }

        int bestExitIdx = -1;
        double bestDist = kInf;
        for (int cIdx : candidateExitIndices) {
            double d = indoorDist[cIdx];
            if (std::isinf(d)) {
                // Planar fallback if disconnected
                const Node& startN = g.nodes[startIdx];
                const Node& exitN = g.nodes[cIdx];
                d = 1000.0 + std::hypot(startN.x - exitN.x, startN.y - exitN.y);
            }
            if (bestExitIdx < 0 || d + 1e-12 < bestDist ||
                (std::abs(d - bestDist) <= 1e-12 && g.nodes[cIdx].id < g.nodes[bestExitIdx].id)) {
                bestDist = d;
                bestExitIdx = cIdx;
            }
        }
        if (bestExitIdx >= 0) {
            return g.nodes[bestExitIdx].id;
        }
    }

    // 3. Fallback: return the building entrance/exit node traversed along the path
    for (int idx : pathIndices) {
        if (idx >= 0 && idx < g.nodeCount() && g.nodes[idx].isIndoor &&
            g.nodes[idx].buildingId == bId &&
            (g.nodes[idx].kind == "entrance" || g.nodes[idx].id.find(":ent") != std::string::npos)) {
            return g.nodes[idx].id;
        }
    }
    return "";
}

// ----------------------------------------------------------------------------
// 10.1 Multi-Source Dijkstra on the Reversed Graph
// ----------------------------------------------------------------------------

/**
 * Algorithm: Multi-Source Dijkstra on the Reversed Graph
 * What it does:
 *   Initializes a single binary min-heap priority queue with all non-blocked
 *   assembly-area vertices at distance 0 and runs Dijkstra backward along the
 *   reversed directed edges (`revAdj`, where reversed edge `v -> u` corresponds
 *   to forward directed edge `u -> v`). In one pass, every vertex `u` in the
 *   merged outdoor+indoor graph receives its nearest reachable assembly area,
 *   exact shortest forward evacuation distance, and forward `nextHop[u]` pointer
 *   (respecting `oneway` edges, blocked nodes/edges, and `disableLifts`).
 * Time Complexity:
 *   O((V + E) log V) time, O(V + E) space in a single pass across all assembly areas.
 * Where the app uses it:
 *   Emergency evacuation mode (`call("evacuate", {mode: "nearest"})`), single-user
 *   "Evacuate Me" (`call("nearestAssembly")`), and `call("evacuationCompare")`.
 */
struct MultiSourceEvacTable {
    std::vector<double> dist;      // dist[u] = shortest forward distance from u to nearest assembly area
    std::vector<int> bestAreaIdx;  // bestAreaIdx[u] = index into g.assemblyAreas (or -1 if unreachable)
    std::vector<int> nextHop;      // nextHop[u] = next vertex along forward path from u to assembly area
};

inline MultiSourceEvacTable runMultiSourceReversedDijkstra(
    const Graph& g,
    const std::vector<AssemblyArea>& areas,
    const EvacOptions& evOpts,
    const std::vector<std::vector<ReversedEdge>>& revAdj) {
    const int n = g.nodeCount();
    MultiSourceEvacTable table;
    table.dist.assign(n, kInf);
    table.bestAreaIdx.assign(n, -1);
    table.nextHop.assign(n, -1);

    if (n == 0 || areas.empty()) {
        return table;
    }

    struct HeapItem {
        double d;
        int areaIdx;
        int u;
        std::string areaId;
        std::string nodeId;

        bool operator>(const HeapItem& other) const {
            if (std::abs(d - other.d) > 1e-12) return d > other.d;
            if (areaId != other.areaId) return areaId > other.areaId;
            return nodeId > other.nodeId;
        }
    };

    std::priority_queue<HeapItem, std::vector<HeapItem>, std::greater<HeapItem>> pq;

    // Seed all non-blocked assembly areas simultaneously at distance 0.0
    for (size_t aIdx = 0; aIdx < areas.size(); ++aIdx) {
        const int v = g.getNodeIndex(areas[aIdx].nodeId);
        if (v < 0 || v >= n) continue;
        if (evOpts.routeOpts.isNodeBlocked(v)) continue;
        if (evOpts.disableLifts && g.nodes[v].kind == "lift") continue;

        const int curArea = table.bestAreaIdx[v];
        if (curArea < 0 || areas[aIdx].id < areas[curArea].id) {
            table.dist[v] = 0.0;
            table.bestAreaIdx[v] = static_cast<int>(aIdx);
            table.nextHop[v] = -1;
            pq.push(HeapItem{0.0, static_cast<int>(aIdx), v, areas[aIdx].id, g.nodes[v].id});
        }
    }

    while (!pq.empty()) {
        const HeapItem top = pq.top();
        pq.pop();

        const int v = top.u;
        if (top.d > table.dist[v] + 1e-12) continue;
        if (std::abs(top.d - table.dist[v]) <= 1e-12 && top.areaIdx != table.bestAreaIdx[v]) {
            continue;
        }

        // Traverse reversed edges v -> u (which correspond to forward edges u -> v)
        for (const auto& revEdge : revAdj[v]) {
            const int u = revEdge.fromForward;
            const Edge& fwdEdge = revEdge.forwardEdge;
            if (!canTraverseEvacForwardEdge(g, u, fwdEdge, evOpts)) continue;

            const double candDist = top.d + fwdEdge.w;
            bool improve = false;
            if (candDist + 1e-12 < table.dist[u]) {
                improve = true;
            } else if (std::abs(candDist - table.dist[u]) <= 1e-12 && table.bestAreaIdx[u] >= 0) {
                const std::string& candAreaId = areas[top.areaIdx].id;
                const std::string& curAreaId = areas[table.bestAreaIdx[u]].id;
                if (candAreaId < curAreaId) {
                    improve = true;
                } else if (candAreaId == curAreaId) {
                    const int curNext = table.nextHop[u];
                    const std::string curNextId = (curNext >= 0) ? g.nodes[curNext].id : "";
                    if (g.nodes[v].id < curNextId) {
                        improve = true;
                    }
                }
            }

            if (improve) {
                table.dist[u] = candDist;
                table.bestAreaIdx[u] = top.areaIdx;
                table.nextHop[u] = v;
                pq.push(HeapItem{candDist, top.areaIdx, u, areas[top.areaIdx].id, g.nodes[u].id});
            }
        }
    }

    return table;
}

/**
 * Reconstructs the forward node-by-node evacuation path from `startIdx` to the
 * target assembly area using the `nextHop` pointers produced by Reversed Dijkstra.
 */
inline void reconstructForwardEvacPath(const Graph& g, int startIdx,
                                       const std::vector<int>& nextHop,
                                       std::vector<int>& outIndices,
                                       std::vector<std::string>& outIds) {
    outIndices.clear();
    outIds.clear();
    if (startIdx < 0 || startIdx >= g.nodeCount()) return;

    const int maxSteps = g.nodeCount() + 2;
    int curr = startIdx;
    int steps = 0;
    while (curr >= 0 && curr < g.nodeCount() && steps < maxSteps) {
        outIndices.push_back(curr);
        outIds.push_back(g.nodes[curr].id);
        curr = nextHop[curr];
        ++steps;
    }
}

// ----------------------------------------------------------------------------
// 10.2 Min-Cost Max-Flow Assignment (Successive Shortest Paths / SPFA)
// ----------------------------------------------------------------------------

/**
 * Algorithm: Min-Cost Max-Flow Evacuation Assignment (Successive Shortest Paths with SPFA)
 * What it does:
 *   Assigns evacuee groups (supply nodes with headcount `count`) to campus
 *   assembly areas (sink nodes with `capacity`) to minimize total person-walking
 *   distance `sum(count * distance)` without exceeding any assembly area's
 *   capacity. First computes exact blocked-aware, lift-disabled shortest evacuation
 *   distances between all groups and each assembly area via Reversed Dijkstra,
 *   then builds a directed bipartite flow network (`Source -> Group_i -> Area_j -> Sink`)
 *   and augments flow along minimum-cost residual paths found by Bellman-Ford / SPFA.
 *   A single group may be split across multiple assembly areas when the nearest
 *   area fills up; any excess demand beyond total reachable capacity is reported
 *   in `unassigned`.
 * Time Complexity:
 *   O(A * (V + E) log V + F * V_f * E_f) time, where A is the number of assembly
 *   areas, V_f = P + A + 2, E_f = O(P * A), and F <= P + A augmentations.
 * Where the app uses it:
 *   Capacity-constrained campus evacuation (`call("evacuate", {mode: "capacity"})`)
 *   and evacuation mode comparison (`call("evacuationCompare")`).
 */
inline EvacResult runEvacuation(const Graph& g,
                                const std::string& rawMode,
                                const std::vector<EvacGroup>& groups,
                                const EvacOptions& evOpts) {
    EvacResult res;
    const std::string mode = (toLowerCopy(rawMode) == "capacity") ? "capacity" : "nearest";
    res.mode = mode;

    // Copy assembly areas (already sorted by id in Graph::loadEvacJson)
    std::vector<AssemblyArea> areas = g.assemblyAreas;
    std::sort(areas.begin(), areas.end(), [](const AssemblyArea& a, const AssemblyArea& b) {
        return a.id < b.id;
    });

    const int numAreas = static_cast<int>(areas.size());
    const int numGroups = static_cast<int>(groups.size());

    std::vector<int> areaAssigned(numAreas, 0);
    int totalDemand = 0;
    for (const auto& grp : groups) {
        if (grp.count > 0) {
            totalDemand += grp.count;
        }
    }

    const auto revAdj = buildReversedAdjacency(g);

    if (mode == "nearest") {
        const MultiSourceEvacTable msTable =
            runMultiSourceReversedDijkstra(g, areas, evOpts, revAdj);

        int totalAssigned = 0;
        for (const auto& grp : groups) {
            if (grp.count <= 0) continue;
            const int u = grp.nodeIdx;
            if (u < 0 || u >= g.nodeCount() || msTable.bestAreaIdx[u] < 0 ||
                std::isinf(msTable.dist[u])) {
                continue;
            }

            const int aIdx = msTable.bestAreaIdx[u];
            const AssemblyArea& area = areas[aIdx];
            const double d = msTable.dist[u];

            std::vector<int> pathIndices;
            std::vector<std::string> pathIds;
            reconstructForwardEvacPath(g, u, msTable.nextHop, pathIndices, pathIds);

            EvacAssignment assign;
            assign.from = grp.fromId;
            assign.assemblyId = area.id;
            assign.assemblyName = area.name;
            assign.count = grp.count;
            assign.distance = d;
            assign.path = std::move(pathIds);
            if (g.nodes[u].isIndoor) {
                assign.exitNodeId = findExitNodeAlongPath(g, u, pathIndices);
            }

            res.assignments.push_back(std::move(assign));
            areaAssigned[aIdx] += grp.count;
            totalAssigned += grp.count;
            res.totalDistance += static_cast<double>(grp.count) * d;
            res.totalPathDistance += d;
        }
        res.unassigned = std::max(0, totalDemand - totalAssigned);
    } else {
        // Mode: "capacity" — Min-Cost Max-Flow via Successive Shortest Paths (Bellman-Ford / SPFA)
        // Step 1: Compute shortest evacuation distance & nextHop from all nodes to each assembly area j
        std::vector<MultiSourceEvacTable> perAreaTables(numAreas);
        for (int j = 0; j < numAreas; ++j) {
            std::vector<AssemblyArea> singleArea = {areas[j]};
            perAreaTables[j] = runMultiSourceReversedDijkstra(g, singleArea, evOpts, revAdj);
        }

        // Step 2: Build directed bipartite flow network
        // Nodes: 0 = SOURCE, 1..numGroups = Groups, 1+numGroups..numGroups+numAreas = Areas, SINK = numGroups+numAreas+1
        const int source = 0;
        const int sink = 1 + numGroups + numAreas;
        const int vCount = sink + 1;

        struct FlowEdge {
            int to;
            int rev;
            int cap;
            int flow;
            double cost;
        };

        std::vector<std::vector<FlowEdge>> flowAdj(vCount);
        auto addFlowEdge = [&](int u, int v, int cap, double cost) -> int {
            const int fwdIdx = static_cast<int>(flowAdj[u].size());
            const int revIdx = static_cast<int>(flowAdj[v].size());
            flowAdj[u].push_back(FlowEdge{v, revIdx, cap, 0, cost});
            flowAdj[v].push_back(FlowEdge{u, fwdIdx, 0, 0, -cost});
            return fwdIdx;
        };

        // Record (groupIdx, areaIdx, edgeIdxInGroupAdj) to extract positive flows after MCMF
        struct GroupAreaEdgeRef {
            int groupIdx;
            int areaIdx;
            int edgeIdx;
        };
        std::vector<GroupAreaEdgeRef> groupAreaEdges;

        for (int i = 0; i < numGroups; ++i) {
            if (groups[i].count <= 0) continue;
            const int gNode = 1 + i;
            addFlowEdge(source, gNode, groups[i].count, 0.0);

            const int u = groups[i].nodeIdx;
            if (u < 0 || u >= g.nodeCount()) continue;

            for (int j = 0; j < numAreas; ++j) {
                const double d = perAreaTables[j].dist[u];
                if (std::isinf(d) || perAreaTables[j].bestAreaIdx[u] < 0) continue;
                const int aNode = 1 + numGroups + j;
                const int eIdx = addFlowEdge(gNode, aNode, groups[i].count, d);
                groupAreaEdges.push_back(GroupAreaEdgeRef{i, j, eIdx});
            }
        }

        for (int j = 0; j < numAreas; ++j) {
            const int cap = std::max(0, areas[j].capacity);
            if (cap > 0) {
                const int aNode = 1 + numGroups + j;
                addFlowEdge(aNode, sink, cap, 0.0);
            }
        }

        // Step 3: Successive Shortest Paths using SPFA (Bellman-Ford queue)
        int totalFlow = 0;
        while (true) {
            std::vector<double> dist(vCount, kInf);
            std::vector<int> parentNode(vCount, -1);
            std::vector<int> parentEdge(vCount, -1);
            std::vector<bool> inQueue(vCount, false);
            std::queue<int> q;

            dist[source] = 0.0;
            q.push(source);
            inQueue[source] = true;

            while (!q.empty()) {
                const int u = q.front();
                q.pop();
                inQueue[u] = false;

                for (size_t eIdx = 0; eIdx < flowAdj[u].size(); ++eIdx) {
                    const FlowEdge& e = flowAdj[u][eIdx];
                    if (e.cap - e.flow <= 0) continue;
                    const double cand = dist[u] + e.cost;
                    if (cand + 1e-11 < dist[e.to]) {
                        dist[e.to] = cand;
                        parentNode[e.to] = u;
                        parentEdge[e.to] = static_cast<int>(eIdx);
                        if (!inQueue[e.to]) {
                            q.push(e.to);
                            inQueue[e.to] = true;
                        }
                    }
                }
            }

            if (std::isinf(dist[sink])) {
                break; // No more augmenting paths
            }

            // Find bottleneck residual capacity along augmenting path
            int push = std::numeric_limits<int>::max();
            for (int cur = sink; cur != source; cur = parentNode[cur]) {
                const int p = parentNode[cur];
                const int idx = parentEdge[cur];
                push = std::min(push, flowAdj[p][idx].cap - flowAdj[p][idx].flow);
            }

            if (push <= 0) break;

            // Augment flow along path
            for (int cur = sink; cur != source; cur = parentNode[cur]) {
                const int p = parentNode[cur];
                const int idx = parentEdge[cur];
                const int revIdx = flowAdj[p][idx].rev;
                flowAdj[p][idx].flow += push;
                flowAdj[cur][revIdx].flow -= push;
            }
            totalFlow += push;
        }

        // Step 4: Extract assignments from positive flow edges
        for (const auto& ref : groupAreaEdges) {
            const int gNode = 1 + ref.groupIdx;
            const FlowEdge& e = flowAdj[gNode][ref.edgeIdx];
            if (e.flow <= 0) continue;

            const EvacGroup& grp = groups[ref.groupIdx];
            const AssemblyArea& area = areas[ref.areaIdx];
            const MultiSourceEvacTable& areaTable = perAreaTables[ref.areaIdx];
            const int u = grp.nodeIdx;
            const double d = areaTable.dist[u];

            std::vector<int> pathIndices;
            std::vector<std::string> pathIds;
            reconstructForwardEvacPath(g, u, areaTable.nextHop, pathIndices, pathIds);

            EvacAssignment assign;
            assign.from = grp.fromId;
            assign.assemblyId = area.id;
            assign.assemblyName = area.name;
            assign.count = e.flow;
            assign.distance = d;
            assign.path = std::move(pathIds);
            if (g.nodes[u].isIndoor) {
                assign.exitNodeId = findExitNodeAlongPath(g, u, pathIndices);
            }

            res.assignments.push_back(std::move(assign));
            areaAssigned[ref.areaIdx] += e.flow;
            res.totalDistance += static_cast<double>(e.flow) * d;
            res.totalPathDistance += d;
        }

        res.unassigned = std::max(0, totalDemand - totalFlow);
    }

    // Sort assignments deterministically by (from, assemblyId) so output order is
    // 100% reproducible across platforms and independent of augmentation order.
    std::sort(res.assignments.begin(), res.assignments.end(),
              [](const EvacAssignment& a, const EvacAssignment& b) {
                  if (a.from != b.from) return a.from < b.from;
                  if (a.assemblyId != b.assemblyId) return a.assemblyId < b.assemblyId;
                  return a.count > b.count;
              });

    // Populate assemblyLoad (already sorted by area.id) and compute overload metrics
    res.assemblyLoad.reserve(numAreas);
    for (int j = 0; j < numAreas; ++j) {
        const int assigned = areaAssigned[j];
        const int cap = areas[j].capacity;
        res.assemblyLoad.push_back(AssemblyLoadEntry{
            areas[j].id,
            areas[j].name,
            assigned,
            cap
        });
        res.maxAssemblyLoad = std::max(res.maxAssemblyLoad, assigned);
        if (assigned > cap) {
            res.overloadedAreasCount++;
        }
    }

    return res;
}

// ----------------------------------------------------------------------------
// 10.3 Evacuation Mode Comparison (Nearest vs. Capacity-Constrained)
// ----------------------------------------------------------------------------

/**
 * Algorithm: Evacuation Mode Comparator (Nearest vs. Capacity-Constrained)
 * What it does:
 *   Runs both Multi-Source Reversed Dijkstra (`mode: "nearest"`) and Min-Cost
 *   Max-Flow (`mode: "capacity"`) on the identical evacuee population, blocked
 *   hazards, and lift constraints, comparing total evacuation distance,
 *   maximum assembly area load, and overloaded assembly area count side by side.
 * Time Complexity:
 *   O(A * (V + E) log V + F * V_f * E_f) combined across both modes.
 * Where the app uses it:
 *   Emergency Evacuation Comparison panel (`call("evacuationCompare")`) and
 *   the terminal CLI.
 */
inline std::pair<EvacResult, EvacResult> compareEvacuationModes(
    const Graph& g,
    const std::vector<EvacGroup>& groups,
    const EvacOptions& evOpts) {
    EvacResult nearestRes = runEvacuation(g, "nearest", groups, evOpts);
    EvacResult capacityRes = runEvacuation(g, "capacity", groups, evOpts);
    return {std::move(nearestRes), std::move(capacityRes)};
}

// ============================================================================
// SECTION 11: Turn-by-Turn Directions, GPS Progress & Live Rerouting
// ============================================================================

// ----------------------------------------------------------------------------
// 11.1 Polyline Bearing Calculation, Turn Classification & Landmark Maneuvers
// ----------------------------------------------------------------------------

/**
 * Algorithm: Turn-by-Turn Directions Generator (Polyline Bearings & Turn Classifier)
 * What it does:
 *   Converts a computed path of outdoor and indoor graph vertices into a sequence
 *   of human-readable navigation maneuvers (`"start"`, `"straight"`, `"slight-left"`,
 *   `"left"`, `"sharp-left"`, `"slight-right"`, `"right"`, `"sharp-right"`,
 *   `"enter-building"`, `"stairs-up"`, `"stairs-down"`, `"lift"`, `"arrive"`).
 *   Computes compass bearings along oriented edge `geometry` polylines, classifies
 *   turns by signed bearing delta (`|delta| < 25 deg` = straight, merging consecutive
 *   straight segments), attaches the nearest campus landmark within 40 m of each
 *   turn point, and replaces all raw node IDs with human-readable landmark,
 *   building, floor, and room names.
 * Time Complexity:
 *   O(P * L + G) time, where P is path vertex count, L is landmark count (for
 *   40 m proximity lookup), and G is total edge geometry points along the path.
 * Where the app uses it:
 *   Turn-by-turn navigation card deck (`call("directions")`), live rerouting
 *   (`call("reroute")`), and the `directions` CLI command.
 */
struct Maneuver {
    std::string type;       // "start"|"straight"|"slight-left"|"left"|"sharp-left"|"slight-right"|"right"|"sharp-right"|"enter-building"|"stairs-up"|"stairs-down"|"lift"|"arrive"
    std::string text;       // Human-readable instruction (never uses raw node IDs)
    double distanceM = 0.0; // Distance in meters covered by this maneuver
    std::string atNodeId;   // Graph node ID where the maneuver begins
    double lat = 0.0;
    double lng = 0.0;
    std::string landmark;   // Optional nearest landmark name within 40 m
    double cumDistanceAtStartM = 0.0; // Cumulative distance from route start where this maneuver triggers
};

/**
 * Computes initial compass bearing in degrees [0, 360) from (lat1, lng1) to (lat2, lng2)
 * using a symmetric local tangent-plane projection (0 = North, 90 = East, 180 = South, 270 = West).
 * Guaranteed symmetric under endpoint reversal: bearing(B, A) == (bearing(A, B) + 180) mod 360.
 */
inline double computeBearingDegrees(double lat1, double lng1, double lat2, double lng2) {
    const double midLatRad = ((lat1 + lat2) * 0.5) * (kPi / 180.0);
    const double dy = (lat2 - lat1) * (kPi / 180.0) * kEarthRadiusMeters;
    const double dx = (lng2 - lng1) * (kPi / 180.0) * kEarthRadiusMeters * std::cos(midLatRad);
    if (std::abs(dx) < 1e-12 && std::abs(dy) < 1e-12) {
        return 0.0;
    }
    double deg = std::atan2(dx, dy) * (180.0 / kPi);
    if (deg < 0.0) deg += 360.0;
    if (deg >= 360.0) deg -= 360.0;
    return deg;
}

/**
 * Computes the signed turn angle in (-180, +180] degrees from `inBearing` to `outBearing`.
 * Positive values indicate clockwise (right) turns; negative values indicate counter-clockwise (left) turns.
 */
inline double computeSignedTurnDegrees(double inBearing, double outBearing) {
    double diff = std::fmod(outBearing - inBearing, 360.0);
    if (diff <= -180.0) diff += 360.0;
    if (diff > 180.0) diff -= 360.0;
    return diff;
}

/**
 * Classifies a signed bearing change (degrees) into a maneuver type string.
 * |delta| < 25 deg -> "straight"
 * 25..55 deg       -> "slight-left" / "slight-right"
 * 55..125 deg      -> "left" / "right"
 * > 125 deg        -> "sharp-left" / "sharp-right"
 */
inline std::string classifyTurnType(double signedTurnDeg) {
    const double absDeg = std::abs(signedTurnDeg);
    if (absDeg < 25.0) {
        return "straight";
    }
    const bool isRight = (signedTurnDeg > 0.0);
    if (absDeg < 55.0) {
        return isRight ? "slight-right" : "slight-left";
    }
    if (absDeg <= 125.0) {
        return isRight ? "right" : "left";
    }
    return isRight ? "sharp-right" : "sharp-left";
}

inline std::string turnVerbPhrase(const std::string& turnType) {
    if (turnType == "slight-left") return "Bear slightly left";
    if (turnType == "left") return "Turn left";
    if (turnType == "sharp-left") return "Turn sharply left";
    if (turnType == "slight-right") return "Bear slightly right";
    if (turnType == "right") return "Turn right";
    if (turnType == "sharp-right") return "Turn sharply right";
    return "Continue straight";
}

/**
 * Finds the nearest landmark name within `maxMeters` (default 40 m) of `(lat, lng)`.
 * Breaks ties deterministically by landmark ID. Returns empty string if none within range.
 */
inline std::string findNearestLandmarkWithin(const Graph& g, double lat, double lng,
                                             double maxMeters = 40.0) {
    std::string bestName;
    std::string bestId;
    double bestDist = maxMeters + 1e-9;

    for (const auto& lm : g.landmarks) {
        if (lm.name.empty() || lm.nodeId.empty()) continue;
        const int nIdx = g.getNodeIndex(lm.nodeId);
        if (nIdx < 0 || !g.nodes[nIdx].hasCoords) continue;
        const double d = haversineMeters(lat, lng, g.nodes[nIdx].lat, g.nodes[nIdx].lng);
        if (d <= maxMeters) {
            if (bestName.empty() || d + 1e-9 < bestDist ||
                (std::abs(d - bestDist) <= 1e-9 && lm.id < bestId)) {
                bestDist = d;
                bestName = lm.name;
                bestId = lm.id;
            }
        }
    }

    if (!bestName.empty()) {
        return bestName;
    }

    // Fallback: check named outdoor nodes (e.g. gates or assembly zones) within maxMeters
    for (const auto& n : g.nodes) {
        if (n.isIndoor || !n.hasCoords || n.name.empty()) continue;
        const double d = haversineMeters(lat, lng, n.lat, n.lng);
        if (d <= maxMeters) {
            if (bestName.empty() || d + 1e-9 < bestDist ||
                (std::abs(d - bestDist) <= 1e-9 && n.id < bestId)) {
                bestDist = d;
                bestName = n.name;
                bestId = n.id;
            }
        }
    }

    return bestName;
}

/**
 * Produces a human-readable location name for `nodeIdx` that NEVER exposes raw
 * node IDs (like "n12" or "b-csit:f0_cn_1").
 */
inline std::string describeHumanNodeLocation(const Graph& g, int nodeIdx) {
    if (nodeIdx < 0 || nodeIdx >= g.nodeCount()) return "campus walkway";
    const Node& n = g.nodes[nodeIdx];

    if (n.isIndoor) {
        std::string bName = n.buildingName;
        if (bName.empty() && !n.buildingId.empty()) {
            auto it = g.buildingNames.find(n.buildingId);
            if (it != g.buildingNames.end()) bName = it->second;
        }
        if (bName.empty()) bName = "building";

        const std::string fl = g.floorLabel(nodeIdx);
        if (!n.name.empty()) {
            return n.name + " (" + bName + ", " + fl + ")";
        }
        if (n.kind == "entrance") return "Main Entrance (" + bName + ", " + fl + ")";
        if (n.kind == "exit") return "Emergency Exit (" + bName + ", " + fl + ")";
        if (n.kind == "stairs") return "Staircase (" + bName + ", " + fl + ")";
        if (n.kind == "lift") return "Elevator (" + bName + ", " + fl + ")";
        return fl + " corridor (" + bName + ")";
    }

    if (!n.name.empty()) {
        return n.name;
    }
    auto lmIt = g.nodeToLandmarkNames.find(n.id);
    if (lmIt != g.nodeToLandmarkNames.end() && !lmIt->second.empty()) {
        return lmIt->second.front();
    }
    if (n.hasCoords) {
        const std::string near40 = findNearestLandmarkWithin(g, n.lat, n.lng, 40.0);
        if (!near40.empty()) {
            return near40;
        }
        const std::string nearAny = findNearestLandmarkWithin(g, n.lat, n.lng, 2000.0);
        if (!nearAny.empty()) {
            return "walkway near " + nearAny;
        }
    }
    return "campus walkway";
}

/**
 * Returns the oriented sequence of `[lat, lng]` points for directed edge `(u -> v)`.
 * Uses `e.geometry` when present (orienting it from `u` to `v`), or falls back
 * to the straight segment `[(u.lat, u.lng), (v.lat, v.lng)]`.
 */
inline std::vector<std::pair<double, double>> getOrientedEdgeGeometry(
    const Graph& g, int u, int v, const Edge* e) {
    std::vector<std::pair<double, double>> pts;
    const Node& nu = g.nodes[u];
    const Node& nv = g.nodes[v];

    if (e && e->geometry.size() >= 2 && !nu.isIndoor && !nv.isIndoor) {
        pts = e->geometry;
        if (nu.hasCoords && nv.hasCoords) {
            const double dFrontU = haversineMeters(pts.front().first, pts.front().second, nu.lat, nu.lng);
            const double dBackU = haversineMeters(pts.back().first, pts.back().second, nu.lat, nu.lng);
            if (dBackU + 1e-6 < dFrontU) {
                std::reverse(pts.begin(), pts.end());
            }
            // Pin exact node endpoints so consecutive edges stitch seamlessly and symmetrically
            pts.front() = {nu.lat, nu.lng};
            pts.back() = {nv.lat, nv.lng};
        }
        return pts;
    }

    pts.push_back({nu.lat, nu.lng});
    pts.push_back({nv.lat, nv.lng});
    return pts;
}

/**
 * Computes the incoming compass bearing arriving at `v` along edge `(u -> v)`
 * using its oriented geometry, and the outgoing compass bearing departing `u`
 * along edge `(u -> v)` using its oriented geometry.
 */
inline double getEdgeOutgoingBearing(const Graph& g, int u, int v, const Edge* e) {
    const auto pts = getOrientedEdgeGeometry(g, u, v, e);
    const auto [lat0, lng0] = pts.front();
    for (size_t i = 1; i < pts.size(); ++i) {
        if (haversineMeters(lat0, lng0, pts[i].first, pts[i].second) > 0.25) {
            return computeBearingDegrees(lat0, lng0, pts[i].first, pts[i].second);
        }
    }
    return computeBearingDegrees(pts.front().first, pts.front().second,
                                 pts.back().first, pts.back().second);
}

inline double getEdgeIncomingBearing(const Graph& g, int u, int v, const Edge* e) {
    const auto pts = getOrientedEdgeGeometry(g, u, v, e);
    const auto [latEnd, lngEnd] = pts.back();
    for (size_t i = pts.size() - 1; i > 0; --i) {
        const auto [latPrev, lngPrev] = pts[i - 1];
        if (haversineMeters(latPrev, lngPrev, latEnd, lngEnd) > 0.25) {
            return computeBearingDegrees(latPrev, lngPrev, latEnd, lngEnd);
        }
    }
    return computeBearingDegrees(pts.front().first, pts.front().second,
                                 pts.back().first, pts.back().second);
}

/**
 * Generates the full list of turn-by-turn maneuvers for a sequence of graph node
 * indices `pathIndices`.
 */
inline std::vector<Maneuver> computeDirectionsForPath(
    const Graph& g,
    const std::vector<int>& pathIndices,
    const RouteOptions& opts = RouteOptions{}) {
    std::vector<Maneuver> maneuvers;
    if (pathIndices.empty()) {
        return maneuvers;
    }

    const int startIdx = pathIndices.front();
    const int destIdx = pathIndices.back();
    if (startIdx < 0 || startIdx >= g.nodeCount() || destIdx < 0 || destIdx >= g.nodeCount()) {
        return maneuvers;
    }

    // 1. Emit initial "start" maneuver
    {
        Maneuver startM;
        startM.type = "start";
        startM.atNodeId = g.nodes[startIdx].id;
        startM.lat = g.nodes[startIdx].lat;
        startM.lng = g.nodes[startIdx].lng;
        startM.distanceM = 0.0;
        startM.cumDistanceAtStartM = 0.0;
        if (!g.nodes[startIdx].isIndoor && g.nodes[startIdx].hasCoords) {
            startM.landmark = findNearestLandmarkWithin(g, startM.lat, startM.lng, 40.0);
        } else if (g.nodes[startIdx].isIndoor) {
            startM.landmark = g.nodes[startIdx].buildingName;
        }
        startM.text = "Start at " + describeHumanNodeLocation(g, startIdx);
        maneuvers.push_back(std::move(startM));
    }

    double cumDistM = 0.0;
    const size_t numEdges = (pathIndices.size() >= 2) ? (pathIndices.size() - 1) : 0;

    auto resolveEdge = [&](int u, int v) -> std::pair<const Edge*, double> {
        const Edge* e = findTraversedEdge(g, u, v, opts);
        if (!e) {
            for (const auto& cand : g.adj[u]) {
                if (cand.to == v) {
                    e = &cand;
                    break;
                }
            }
        }
        double w = e ? e->w : 0.0;
        if (!e && g.nodes[u].hasCoords && g.nodes[v].hasCoords) {
            w = haversineMeters(g.nodes[u].lat, g.nodes[u].lng, g.nodes[v].lat, g.nodes[v].lng);
        }
        return {e, w};
    };

    size_t i = 0;
    while (i < numEdges) {
        const int u = pathIndices[i];
        const int v = pathIndices[i + 1];
        const Node& nu = g.nodes[u];
        const Node& nv = g.nodes[v];
        const auto [e, w] = resolveEdge(u, v);

        // Case A: Outdoor <-> Indoor building transition ("enter-building")
        if (nu.isIndoor != nv.isIndoor) {
            const int indoorIdx = nu.isIndoor ? u : v;
            const Node& indNode = g.nodes[indoorIdx];
            std::string bName = indNode.buildingName;
            if (bName.empty() && !indNode.buildingId.empty()) {
                auto it = g.buildingNames.find(indNode.buildingId);
                if (it != g.buildingNames.end()) bName = it->second;
            }
            if (bName.empty()) bName = "building";
            const std::string entName = indNode.name.empty() ? "Main Entrance" : indNode.name;

            Maneuver m;
            m.type = "enter-building";
            m.atNodeId = indNode.id;
            m.lat = nu.hasCoords ? nu.lat : nv.lat;
            m.lng = nu.hasCoords ? nu.lng : nv.lng;
            m.distanceM = w;
            m.cumDistanceAtStartM = cumDistM;
            m.landmark = bName;
            if (!nu.isIndoor && nv.isIndoor) {
                m.text = "Enter " + bName + " through " + entName + " (" + g.floorLabel(v) + ")";
            } else {
                m.text = "Exit " + bName + " through " + entName + " to outdoor walkway";
            }
            maneuvers.push_back(std::move(m));
            cumDistM += w;
            ++i;
            continue;
        }

        // Case B: Indoor segment (stairs-up, stairs-down, lift, or indoor floor corridor walk)
        if (nu.isIndoor && nv.isIndoor) {
            const std::string edgeKind = e ? e->kind : "walk";
            std::string bName = nu.buildingName;
            if (bName.empty() && !nu.buildingId.empty()) {
                auto it = g.buildingNames.find(nu.buildingId);
                if (it != g.buildingNames.end()) bName = it->second;
            }
            if (bName.empty()) bName = "building";

            if (edgeKind == "stairs" || edgeKind == "lift") {
                const int startVertIdx = u;
                const double startCum = cumDistM;
                double vertDist = 0.0;
                int endVertIdx = u;
                while (i < numEdges) {
                    const int cu = pathIndices[i];
                    const int cv = pathIndices[i + 1];
                    if (!g.nodes[cu].isIndoor || !g.nodes[cv].isIndoor) break;
                    const auto [ce, cw] = resolveEdge(cu, cv);
                    const std::string ck = ce ? ce->kind : "walk";
                    if (ck != edgeKind) break;
                    vertDist += cw;
                    cumDistM += cw;
                    endVertIdx = cv;
                    ++i;
                }

                const int startFl = g.nodes[startVertIdx].floor;
                const int endFl = g.nodes[endVertIdx].floor;
                Maneuver m;
                m.atNodeId = g.nodes[startVertIdx].id;
                m.lat = g.nodes[startVertIdx].lat;
                m.lng = g.nodes[startVertIdx].lng;
                m.distanceM = vertDist;
                m.cumDistanceAtStartM = startCum;
                m.landmark = bName;

                if (edgeKind == "lift") {
                    m.type = "lift";
                    m.text = "Take the lift from " + g.floorLabel(startVertIdx) +
                             " to " + g.floorLabel(endVertIdx) + " in " + bName;
                } else if (endFl >= startFl) {
                    m.type = "stairs-up";
                    m.text = "Take the stairs up from " + g.floorLabel(startVertIdx) +
                             " to " + g.floorLabel(endVertIdx) + " in " + bName;
                } else {
                    m.type = "stairs-down";
                    m.text = "Take the stairs down from " + g.floorLabel(startVertIdx) +
                             " to " + g.floorLabel(endVertIdx) + " in " + bName;
                }
                maneuvers.push_back(std::move(m));
                continue;
            } else {
                // Consecutive indoor corridor walk edges on the same floor
                const int startWalkIdx = u;
                const int walkFloor = nu.floor;
                const double startCum = cumDistM;
                double walkDist = 0.0;
                int endWalkIdx = u;
                while (i < numEdges) {
                    const int cu = pathIndices[i];
                    const int cv = pathIndices[i + 1];
                    if (!g.nodes[cu].isIndoor || !g.nodes[cv].isIndoor) break;
                    const auto [ce, cw] = resolveEdge(cu, cv);
                    const std::string ck = ce ? ce->kind : "walk";
                    if (ck != "walk" || g.nodes[cv].floor != walkFloor) break;
                    walkDist += cw;
                    cumDistM += cw;
                    endWalkIdx = cv;
                    ++i;
                }

                Maneuver m;
                m.type = "straight";
                m.atNodeId = g.nodes[startWalkIdx].id;
                m.lat = g.nodes[startWalkIdx].lat;
                m.lng = g.nodes[startWalkIdx].lng;
                m.distanceM = walkDist;
                m.cumDistanceAtStartM = startCum;
                m.landmark = bName;
                m.text = "Walk along " + g.floorLabel(startWalkIdx) + " in " + bName +
                         " toward " + describeHumanNodeLocation(g, endWalkIdx) +
                         " (" + formatMeters(walkDist) + " m)";
                maneuvers.push_back(std::move(m));
                continue;
            }
        }

        // Case C: Contiguous outdoor run of edges pathIndices[runStart .. runEnd]
        size_t runEnd = i;
        while (runEnd < numEdges &&
               !g.nodes[pathIndices[runEnd]].isIndoor &&
               !g.nodes[pathIndices[runEnd + 1]].isIndoor) {
            ++runEnd;
        }

        // Process outdoor edges k = i .. runEnd - 1
        // The first outdoor edge in the run begins a "straight" maneuver; subsequent outdoor
        // edges either merge into the current maneuver if |turnAngle| < 25 deg, or start a
        // new turn maneuver ("slight-left", "left", "sharp-left", "slight-right", "right", "sharp-right").
        for (size_t k = i; k < runEnd; ++k) {
            const int curU = pathIndices[k];
            const int curV = pathIndices[k + 1];
            const auto [curEdge, curW] = resolveEdge(curU, curV);

            if (k == i) {
                // Start of outdoor run -> emit "straight" maneuver at curU
                Maneuver m;
                m.type = "straight";
                m.atNodeId = g.nodes[curU].id;
                m.lat = g.nodes[curU].lat;
                m.lng = g.nodes[curU].lng;
                m.distanceM = curW;
                m.cumDistanceAtStartM = cumDistM;
                m.landmark = findNearestLandmarkWithin(g, m.lat, m.lng, 40.0);
                if (!m.landmark.empty()) {
                    m.text = "Continue straight past " + m.landmark + " for " + formatMeters(m.distanceM) + " m";
                } else {
                    m.text = "Continue straight for " + formatMeters(m.distanceM) + " m";
                }
                maneuvers.push_back(std::move(m));
            } else {
                const int prevU = pathIndices[k - 1];
                const auto [prevEdge, prevW] = resolveEdge(prevU, curU);
                (void)prevW;

                const double inBearing = getEdgeIncomingBearing(g, prevU, curU, prevEdge);
                const double outBearing = getEdgeOutgoingBearing(g, curU, curV, curEdge);
                const double signedDelta = computeSignedTurnDegrees(inBearing, outBearing);
                const std::string turnType = classifyTurnType(signedDelta);

                if (turnType == "straight") {
                    // Merge consecutive straight outdoor segment into the active outdoor maneuver
                    Maneuver& prevM = maneuvers.back();
                    prevM.distanceM += curW;
                    if (prevM.type == "straight") {
                        if (!prevM.landmark.empty()) {
                            prevM.text = "Continue straight past " + prevM.landmark +
                                         " for " + formatMeters(prevM.distanceM) + " m";
                        } else {
                            prevM.text = "Continue straight for " + formatMeters(prevM.distanceM) + " m";
                        }
                    } else {
                        const std::string verb = turnVerbPhrase(prevM.type);
                        if (!prevM.landmark.empty()) {
                            prevM.text = verb + " at " + prevM.landmark +
                                         " and continue for " + formatMeters(prevM.distanceM) + " m";
                        } else {
                            prevM.text = verb + " and continue for " + formatMeters(prevM.distanceM) + " m";
                        }
                    }
                } else {
                    // Emit turn maneuver at node curU
                    Maneuver m;
                    m.type = turnType;
                    m.atNodeId = g.nodes[curU].id;
                    m.lat = g.nodes[curU].lat;
                    m.lng = g.nodes[curU].lng;
                    m.distanceM = curW;
                    m.cumDistanceAtStartM = cumDistM;
                    m.landmark = findNearestLandmarkWithin(g, m.lat, m.lng, 40.0);

                    const std::string verb = turnVerbPhrase(turnType);
                    if (!m.landmark.empty()) {
                        m.text = verb + " at " + m.landmark + " and continue for " + formatMeters(m.distanceM) + " m";
                    } else {
                        m.text = verb + " and continue for " + formatMeters(m.distanceM) + " m";
                    }
                    maneuvers.push_back(std::move(m));
                }
            }

            cumDistM += curW;
        }

        i = runEnd;
    }

    // Final "arrive" maneuver at destination
    {
        Maneuver arriveM;
        arriveM.type = "arrive";
        arriveM.atNodeId = g.nodes[destIdx].id;
        arriveM.lat = g.nodes[destIdx].lat;
        arriveM.lng = g.nodes[destIdx].lng;
        arriveM.distanceM = 0.0;
        arriveM.cumDistanceAtStartM = cumDistM;
        if (!g.nodes[destIdx].isIndoor && g.nodes[destIdx].hasCoords) {
            arriveM.landmark = findNearestLandmarkWithin(g, arriveM.lat, arriveM.lng, 40.0);
        } else if (g.nodes[destIdx].isIndoor) {
            arriveM.landmark = g.nodes[destIdx].buildingName;
        }
        arriveM.text = "Arrive at " + describeHumanNodeLocation(g, destIdx);
        maneuvers.push_back(std::move(arriveM));
    }

    return maneuvers;
}

// ----------------------------------------------------------------------------
// 11.2 GPS Polyline Segment Projection, Off-Route Detection & Noise Filtering
// ----------------------------------------------------------------------------

/**
 * Algorithm: GPS Polyline Segment Projection & Noise-Filtered Route Progress
 * What it does:
 *   Constructs the detailed metric route polyline (expanding each outdoor edge's
 *   oriented `geometry` waypoints and scaling sub-segments to match edge weight `w`),
 *   projects the user's live GPS `(lat, lng)` onto every polyline segment in a
 *   local flat-earth metric frame, and selects the best segment (biasing toward
 *   forward segments `>= lastIndex`). Computes `distanceAlongM`, `remainingM`,
 *   `nextManeuverIndex`, `distanceToNextM`, `offRouteDistanceM`, `offRoute`
 *   (`offRouteDistanceM > max(25 m, 1.5 * accuracyM)`), and `arrived`. Filters
 *   GPS noise so progress never jumps backward by more than 15 m (and stays
 *   monotonic non-decreasing when `lastIndex` is tracked).
 * Time Complexity:
 *   O(S + M) time per GPS fix, where S is the number of polyline sub-segments
 *   and M is the number of maneuvers along the route.
 * Where the app uses it:
 *   Live "Navigate With Me" GPS tracker (`call("progress")`) and `progress` CLI command.
 */
struct PolylineSegment {
    double latA = 0.0;
    double lngA = 0.0;
    double latB = 0.0;
    double lngB = 0.0;
    double startCumDistM = 0.0;
    double weightM = 0.0;
    int edgeIndex = 0; // Index of graph edge along pathIndices [0 .. path.size()-2]
};

struct DetailedRoutePolyline {
    std::vector<PolylineSegment> segments;
    double totalDistanceM = 0.0;
    std::vector<double> edgeStartCumDistM;
    uint64_t pathHash = 0;
};

inline DetailedRoutePolyline buildDetailedRoutePolyline(
    const Graph& g,
    const std::vector<int>& pathIndices,
    const RouteOptions& opts = RouteOptions{}) {
    DetailedRoutePolyline poly;

    // Compute deterministic FNV-1a hash of pathIndices to identify the active route
    uint64_t h = 14695981039346656037ULL;
    for (int idx : pathIndices) {
        h ^= static_cast<uint64_t>(static_cast<uint32_t>(idx));
        h *= 1099511628211ULL;
    }
    poly.pathHash = h;

    if (pathIndices.size() < 2) {
        poly.edgeStartCumDistM.push_back(0.0);
        return poly;
    }

    double cumDist = 0.0;
    for (size_t i = 0; i + 1 < pathIndices.size(); ++i) {
        poly.edgeStartCumDistM.push_back(cumDist);
        const int u = pathIndices[i];
        const int v = pathIndices[i + 1];
        if (u < 0 || v < 0 || u >= g.nodeCount() || v >= g.nodeCount()) continue;

        const Edge* e = findTraversedEdge(g, u, v, opts);
        if (!e) {
            for (const auto& cand : g.adj[u]) {
                if (cand.to == v) {
                    e = &cand;
                    break;
                }
            }
        }
        double edgeW = e ? e->w : 0.0;
        if (!e && g.nodes[u].hasCoords && g.nodes[v].hasCoords) {
            edgeW = haversineMeters(g.nodes[u].lat, g.nodes[u].lng, g.nodes[v].lat, g.nodes[v].lng);
        }

        const auto pts = getOrientedEdgeGeometry(g, u, v, e);
        if (pts.size() <= 2) {
            PolylineSegment seg;
            seg.latA = pts.front().first;
            seg.lngA = pts.front().second;
            seg.latB = pts.back().first;
            seg.lngB = pts.back().second;
            seg.startCumDistM = cumDist;
            seg.weightM = edgeW;
            seg.edgeIndex = static_cast<int>(i);
            poly.segments.push_back(seg);
            cumDist += edgeW;
        } else {
            std::vector<double> rawLengths(pts.size() - 1, 0.0);
            double rawSum = 0.0;
            for (size_t k = 0; k + 1 < pts.size(); ++k) {
                rawLengths[k] = haversineMeters(pts[k].first, pts[k].second,
                                                pts[k + 1].first, pts[k + 1].second);
                rawSum += rawLengths[k];
            }
            for (size_t k = 0; k + 1 < pts.size(); ++k) {
                const double frac = (rawSum > 1e-9)
                                        ? (rawLengths[k] / rawSum)
                                        : (1.0 / static_cast<double>(pts.size() - 1));
                const double subW = edgeW * frac;
                PolylineSegment seg;
                seg.latA = pts[k].first;
                seg.lngA = pts[k].second;
                seg.latB = pts[k + 1].first;
                seg.lngB = pts[k + 1].second;
                seg.startCumDistM = cumDist;
                seg.weightM = subW;
                seg.edgeIndex = static_cast<int>(i);
                poly.segments.push_back(seg);
                cumDist += subW;
            }
        }
    }
    poly.edgeStartCumDistM.push_back(cumDist);
    poly.totalDistanceM = cumDist;
    return poly;
}

/**
 * Projects a GPS point `(lat, lng)` onto a single segment `(latA, lngA) -> (latB, lngB)`,
 * returning `(perpendicularDistanceM, fractionTIn0To1, projectedLat, projectedLng)`.
 */
inline void projectPointOntoSegment(double lat, double lng,
                                    double latA, double lngA,
                                    double latB, double lngB,
                                    double& outPerpDistM,
                                    double& outT,
                                    double& outProjLat,
                                    double& outProjLng) {
    const double midLatRad = ((latA + latB) * 0.5) * (kPi / 180.0);
    const double cosLat = std::cos(midLatRad);

    const double bx = (lngB - lngA) * (kPi / 180.0) * kEarthRadiusMeters * cosLat;
    const double by = (latB - latA) * (kPi / 180.0) * kEarthRadiusMeters;
    const double qx = (lng - lngA) * (kPi / 180.0) * kEarthRadiusMeters * cosLat;
    const double qy = (lat - latA) * (kPi / 180.0) * kEarthRadiusMeters;

    const double lenSq = bx * bx + by * by;
    if (lenSq < 1e-12) {
        outT = 0.0;
        outPerpDistM = std::hypot(qx, qy);
        outProjLat = latA;
        outProjLng = lngA;
        return;
    }

    double t = (qx * bx + qy * by) / lenSq;
    t = std::max(0.0, std::min(1.0, t));
    outT = t;

    const double dx = qx - t * bx;
    const double dy = qy - t * by;
    outPerpDistM = std::hypot(dx, dy);
    outProjLat = latA + t * (latB - latA);
    outProjLng = lngA + t * (lngB - lngA);
}

struct ProgressStateTracker {
    uint64_t pathHash = 0;
    double lastDistanceAlongM = 0.0;
    int lastSegmentIndex = 0;
    bool valid = false;
};

inline ProgressStateTracker& globalProgressTracker() {
    static ProgressStateTracker tracker;
    return tracker;
}

struct ProgressResult {
    double distanceAlongM = 0.0;
    double remainingM = 0.0;
    int nextManeuverIndex = 0;
    double distanceToNextM = 0.0;
    bool offRoute = false;
    double offRouteDistanceM = 0.0;
    bool arrived = false;
    int matchedIndex = 0;
    double snappedLat = 0.0;
    double snappedLng = 0.0;
};

inline ProgressResult computeRouteProgress(const Graph& g,
                                           const std::vector<int>& pathIndices,
                                           double lat,
                                           double lng,
                                           double accuracyM,
                                           int lastIndex,
                                           bool hasExplicitLastIndex,
                                           double explicitLastAlongM = -1.0) {
    ProgressResult res;
    if (pathIndices.empty()) {
        return res;
    }

    const DetailedRoutePolyline poly = buildDetailedRoutePolyline(g, pathIndices);
    const std::vector<Maneuver> maneuvers = computeDirectionsForPath(g, pathIndices);
    const double totalDist = poly.totalDistanceM;

    if (poly.segments.empty()) {
        const int u = pathIndices.front();
        res.offRouteDistanceM = haversineMeters(lat, lng, g.nodes[u].lat, g.nodes[u].lng);
        const double threshold = std::max(25.0, 1.5 * std::max(0.0, accuracyM));
        res.offRoute = (res.offRouteDistanceM > threshold);
        res.arrived = !res.offRoute;
        res.snappedLat = g.nodes[u].lat;
        res.snappedLng = g.nodes[u].lng;
        return res;
    }

    ProgressStateTracker& tracker = globalProgressTracker();
    const bool sameRouteAsPrev = (tracker.valid && tracker.pathHash == poly.pathHash);

    // Determine reference previous progress distance along the route
    double refAlongM = 0.0;
    bool hasReference = false;
    int refSegIdx = 0;

    if (explicitLastAlongM >= 0.0) {
        refAlongM = explicitLastAlongM;
        hasReference = true;
    } else if (hasExplicitLastIndex && lastIndex >= 0) {
        hasReference = true;
        // `lastIndex` may refer to a graph path edge/node index or a polyline segment index
        if (static_cast<size_t>(lastIndex) < poly.edgeStartCumDistM.size()) {
            refAlongM = poly.edgeStartCumDistM[static_cast<size_t>(lastIndex)];
        } else if (static_cast<size_t>(lastIndex) < poly.segments.size()) {
            refAlongM = poly.segments[static_cast<size_t>(lastIndex)].startCumDistM;
        }
        if (sameRouteAsPrev && lastIndex >= tracker.lastSegmentIndex) {
            refAlongM = std::max(refAlongM, tracker.lastDistanceAlongM);
        }
        refSegIdx = lastIndex;
    } else if (sameRouteAsPrev) {
        refAlongM = tracker.lastDistanceAlongM;
        refSegIdx = tracker.lastSegmentIndex;
    }

    // Evaluate all polyline segments; when `lastIndex` is provided, prefer forward segments
    // (`edgeIndex >= lastIndex` or `segIdx >= lastIndex`) unless a backward segment is much closer.
    int bestSeg = 0;
    double bestScore = kInf;
    double bestPerpDist = kInf;
    double bestAlong = 0.0;
    double bestProjLat = poly.segments[0].latA;
    double bestProjLng = poly.segments[0].lngA;

    for (size_t s = 0; s < poly.segments.size(); ++s) {
        const auto& seg = poly.segments[s];
        double perpDist = 0.0;
        double t = 0.0;
        double pLat = 0.0;
        double pLng = 0.0;
        projectPointOntoSegment(lat, lng, seg.latA, seg.lngA, seg.latB, seg.lngB,
                                perpDist, t, pLat, pLng);

        const double candAlong = seg.startCumDistM + t * seg.weightM;
        double score = perpDist;

        if (hasExplicitLastIndex && lastIndex >= 0) {
            // Bias toward forward segments relative to lastIndex
            if (seg.edgeIndex < refSegIdx && static_cast<int>(s) < refSegIdx) {
                score += 12.0;
            }
            if (candAlong + 15.0 < refAlongM) {
                score += 20.0;
            }
        }

        if (score + 1e-9 < bestScore) {
            bestScore = score;
            bestSeg = static_cast<int>(s);
            bestPerpDist = perpDist;
            bestAlong = candAlong;
            bestProjLat = pLat;
            bestProjLng = pLng;
        }
    }

    // Also compute the true minimum perpendicular distance across all segments for accurate offRoute detection
    double trueMinPerpDist = bestPerpDist;
    for (size_t s = 0; s < poly.segments.size(); ++s) {
        const auto& seg = poly.segments[s];
        double perpDist = 0.0, t = 0.0, pLat = 0.0, pLng = 0.0;
        projectPointOntoSegment(lat, lng, seg.latA, seg.lngA, seg.latB, seg.lngB,
                                perpDist, t, pLat, pLng);
        trueMinPerpDist = std::min(trueMinPerpDist, perpDist);
    }

    double clampedAlong = bestAlong;
    if (hasReference) {
        // When `lastIndex` (or `lastDistanceAlongM`) is explicitly passed, never move progress backward
        clampedAlong = std::max(clampedAlong, refAlongM);
    } else if (sameRouteAsPrev && bestAlong < tracker.lastDistanceAlongM) {
        // Without explicit `lastIndex`, if the point is a noisy reading behind the previous
        // position (and not a fresh reset to the exact start of the route at 0.0 m), prevent
        // backward jump.
        const double backwardDelta = tracker.lastDistanceAlongM - bestAlong;
        if (bestAlong > 1.0 && backwardDelta <= 45.0) {
            clampedAlong = tracker.lastDistanceAlongM;
        }
    }

    clampedAlong = std::max(0.0, std::min(totalDist, clampedAlong));
    const double remaining = std::max(0.0, totalDist - clampedAlong);

    const double offRouteThreshold = std::max(25.0, 1.5 * std::max(0.0, accuracyM));
    const bool isOffRoute = (trueMinPerpDist > offRouteThreshold);
    const double arrivalTolerance = std::min(10.0, std::max(1.5, totalDist * 0.08));
    const bool hasArrived = (!isOffRoute && remaining <= arrivalTolerance);

    // Find nextManeuverIndex and distanceToNextM
    int nextManIdx = static_cast<int>(maneuvers.size()) > 0
                         ? static_cast<int>(maneuvers.size()) - 1
                         : 0;
    double distToNext = remaining;
    for (size_t m = 1; m < maneuvers.size(); ++m) {
        if (maneuvers[m].cumDistanceAtStartM > clampedAlong + 0.5 || m + 1 == maneuvers.size()) {
            nextManIdx = static_cast<int>(m);
            distToNext = std::max(0.0, maneuvers[m].cumDistanceAtStartM - clampedAlong);
            break;
        }
    }
    if (hasArrived && !maneuvers.empty()) {
        nextManIdx = static_cast<int>(maneuvers.size()) - 1;
        distToNext = 0.0;
    }

    // Determine the matched edge/segment index (advancing to the next edge when at a junction vertex)
    int matchedEdgeIdx = poly.segments[bestSeg].edgeIndex;
    if (bestSeg + 1 < static_cast<int>(poly.segments.size()) &&
        clampedAlong >= poly.segments[bestSeg + 1].startCumDistM - 1e-4) {
        matchedEdgeIdx = poly.segments[bestSeg + 1].edgeIndex;
    }
    if (hasExplicitLastIndex && lastIndex > matchedEdgeIdx &&
        lastIndex < static_cast<int>(pathIndices.size())) {
        matchedEdgeIdx = lastIndex;
    }

    // Update tracker for subsequent calls on the same route
    tracker.valid = true;
    tracker.pathHash = poly.pathHash;
    tracker.lastDistanceAlongM = clampedAlong;
    tracker.lastSegmentIndex = matchedEdgeIdx;

    res.distanceAlongM = clampedAlong;
    res.remainingM = hasArrived ? 0.0 : remaining;
    res.nextManeuverIndex = nextManIdx;
    res.distanceToNextM = distToNext;
    res.offRoute = isOffRoute;
    res.offRouteDistanceM = trueMinPerpDist;
    res.arrived = hasArrived;
    res.matchedIndex = matchedEdgeIdx;
    res.snappedLat = bestProjLat;
    res.snappedLng = bestProjLng;
    return res;
}

// ----------------------------------------------------------------------------
// 11.3 Live GPS Graph Snapping & Rerouting
// ----------------------------------------------------------------------------

/**
 * Algorithm: GPS Graph Node / Edge-Polyline Snapper & Live Rerouter
 * What it does:
 *   Projects an arbitrary off-route GPS coordinate `(lat, lng)` onto all
 *   traversable outdoor graph nodes and edge `geometry` polylines to identify
 *   the nearest accessible entry point on the campus footpath network, then
 *   computes both a new optimal route (`computeRoute`) and turn-by-turn
 *   maneuvers (`computeDirectionsForPath`) to the destination `to`.
 * Time Complexity:
 *   O((V + E) log V + G) time, where G is total outdoor edge geometry points.
 * Where the app uses it:
 *   Automatic off-route recovery (`call("reroute", {from: {lat, lng}, to, accessible})`).
 */
struct RerouteSnapResult {
    int snappedNodeIdx = -1;
    std::string snappedNodeId;
    double snappedLat = 0.0;
    double snappedLng = 0.0;
    double snapDistanceM = 0.0;
    RouteResult route;
    std::vector<Maneuver> maneuvers;
};

inline RerouteSnapResult snapAndRerouteFromGps(const Graph& g,
                                               double lat,
                                               double lng,
                                               int toIdx,
                                               const RouteOptions& opts) {
    RerouteSnapResult out;
    if (toIdx < 0 || toIdx >= g.nodeCount()) {
        out.route.error = "Invalid destination node for reroute";
        return out;
    }

    // 1. Find closest non-blocked outdoor graph node
    int bestNodeIdx = -1;
    double bestNodeDistM = kInf;
    for (int u = 0; u < g.nodeCount(); ++u) {
        const Node& n = g.nodes[u];
        if (n.isIndoor || !n.hasCoords || opts.isNodeBlocked(u)) continue;
        const double d = haversineMeters(lat, lng, n.lat, n.lng);
        if (bestNodeIdx < 0 || d + 1e-9 < bestNodeDistM ||
            (std::abs(d - bestNodeDistM) <= 1e-9 && n.id < g.nodes[bestNodeIdx].id)) {
            bestNodeDistM = d;
            bestNodeIdx = u;
        }
    }

    // 2. Also project onto all traversable outdoor edge geometries to see if an edge interior is closer
    int bestEdgeU = -1;
    int bestEdgeV = -1;
    double bestEdgePerpM = kInf;
    double bestEdgeProjLat = lat;
    double bestEdgeProjLng = lng;

    for (int u = 0; u < g.nodeCount(); ++u) {
        if (g.nodes[u].isIndoor || opts.isNodeBlocked(u)) continue;
        for (const auto& e : g.adj[u]) {
            if (g.nodes[e.to].isIndoor || !g.canTraverse(u, e, opts)) continue;
            const auto pts = getOrientedEdgeGeometry(g, u, e.to, &e);
            for (size_t k = 0; k + 1 < pts.size(); ++k) {
                double perp = 0.0, t = 0.0, pLat = 0.0, pLng = 0.0;
                projectPointOntoSegment(lat, lng, pts[k].first, pts[k].second,
                                        pts[k + 1].first, pts[k + 1].second,
                                        perp, t, pLat, pLng);
                if (perp + 1e-9 < bestEdgePerpM) {
                    bestEdgePerpM = perp;
                    bestEdgeU = u;
                    bestEdgeV = e.to;
                    bestEdgeProjLat = pLat;
                    bestEdgeProjLng = pLng;
                }
            }
        }
    }

    // Candidate start nodes to evaluate: closest node, plus endpoints of closest edge
    std::vector<int> candidates;
    if (bestNodeIdx >= 0) candidates.push_back(bestNodeIdx);
    if (bestEdgeU >= 0 && std::find(candidates.begin(), candidates.end(), bestEdgeU) == candidates.end()) {
        candidates.push_back(bestEdgeU);
    }
    if (bestEdgeV >= 0 && std::find(candidates.begin(), candidates.end(), bestEdgeV) == candidates.end()) {
        candidates.push_back(bestEdgeV);
    }

    int chosenStart = bestNodeIdx;
    RouteResult chosenRoute;
    double bestTotalObj = kInf;

    for (int cand : candidates) {
        RouteResult r = computeRoute(g, cand, toIdx, opts);
        if (!r.found) continue;
        const double walkToCand = haversineMeters(lat, lng, g.nodes[cand].lat, g.nodes[cand].lng);
        const double obj = walkToCand + r.distance;
        if (!chosenRoute.found || obj + 1e-9 < bestTotalObj) {
            bestTotalObj = obj;
            chosenStart = cand;
            chosenRoute = std::move(r);
        }
    }

    if (chosenStart >= 0) {
        out.snappedNodeIdx = chosenStart;
        out.snappedNodeId = g.nodes[chosenStart].id;
        if (bestEdgePerpM < bestNodeDistM) {
            out.snappedLat = bestEdgeProjLat;
            out.snappedLng = bestEdgeProjLng;
            out.snapDistanceM = bestEdgePerpM;
        } else {
            out.snappedLat = g.nodes[chosenStart].lat;
            out.snappedLng = g.nodes[chosenStart].lng;
            out.snapDistanceM = bestNodeDistM;
        }
    }

    out.route = std::move(chosenRoute);
    if (out.route.found) {
        out.maneuvers = computeDirectionsForPath(g, out.route.pathIndices, opts);
    }
    return out;
}

// ============================================================================
// SECTION 12: Multi-Algorithm Benchmark Comparator
// ============================================================================

/**
 * Algorithm: Multi-Algorithm Benchmark Comparator
 * What it does:
 *   Executes Dijkstra, A*, BFS, Bellman-Ford, and Floyd-Warshall on the same
 *   `(from, to)` query and records path distance, nodes visited, and execution
 *   time in both microseconds (`timeUs`) and milliseconds (`timeMs`).
 * Time Complexity:
 *   O((V + E) log V + V * E + V_out^3) combined across all 5 algorithms.
 * Where the app uses it:
 *   Algorithm Comparison Drawer in the web UI and the `compare` CLI command.
 */
inline json compareAlgorithms(const Graph& g, int from, int to, const RouteOptions& baseOpts) {
    // Fixed algorithm evaluation sequence and deterministic JSON object output
    // to guarantee identical benchmark output structure across platforms.
    const std::vector<std::string> algos = {"dijkstra", "astar", "bfs", "bellmanford", "floyd"};
    json results = json::object();

    // Ensure Floyd table is pre-warmed or measured cleanly
    cachedFloydTable(g, baseOpts, false);

    for (const auto& algoName : algos) {
        RouteOptions opts = baseOpts;
        opts.algo = algoName;
        opts.maxTrace = 0;

        const auto t0 = std::chrono::high_resolution_clock::now();
        const RouteResult r = computeRoute(g, from, to, opts, false);
        const auto t1 = std::chrono::high_resolution_clock::now();
        const double elapsedUs =
            std::chrono::duration<double, std::micro>(t1 - t0).count();
        const double elapsedMs = elapsedUs / 1000.0;

        json entry = {
            {"found", r.found},
            {"distance", r.found ? r.distance : -1.0},
            {"timeUs", elapsedUs},
            {"timeMs", elapsedMs},
            {"visitedCount", r.visitedCount},
            {"nodesVisited", r.visitedCount},
            {"hops", r.path.empty() ? 0 : static_cast<int>(r.path.size()) - 1},
            {"negativeCycle", r.negativeCycle}
        };
        results[algoName] = std::move(entry);
    }

    return json{{"results", results}};
}

// ============================================================================
// SECTION 12: WASM / Native JSON Dispatcher — call(fn, argsJson)
// ============================================================================

namespace detail {

inline Graph& globalGraph() {
    static Graph g;
    return g;
}

inline RouteLRUCache& globalRouteCache() {
    static RouteLRUCache cache(128);
    return cache;
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

    auto parseBlockedEdgeEntry = [&](const json& ej) {
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
    };

    for (const char* key : {"avoid", "blocked", "blockedNodes"}) {
        if (!args.contains(key)) continue;
        const auto& val = args[key];
        if (val.is_array()) {
            for (const auto& item : val) {
                parseBlockedItem(item);
            }
        } else if (val.is_object()) {
            // Support structured blocked: {nodes: [...], edges: [[a, b], ...]}
            if (val.contains("nodes") && val["nodes"].is_array()) {
                for (const auto& item : val["nodes"]) {
                    parseBlockedItem(item);
                }
            }
            if (val.contains("edges") && val["edges"].is_array()) {
                for (const auto& ej : val["edges"]) {
                    parseBlockedEdgeEntry(ej);
                }
            }
        }
    }

    if (args.contains("blockedEdges") && args["blockedEdges"].is_array()) {
        for (const auto& ej : args["blockedEdges"]) {
            parseBlockedEdgeEntry(ej);
        }
    }

    return opts;
}

inline int resolveEndpointIndex(const Graph& g, const std::string& id) {
    const int direct = g.getNodeIndex(id);
    if (direct >= 0) return direct;
    auto lmIt = g.landmarkToEntranceNode.find(id);
    if (lmIt != g.landmarkToEntranceNode.end()) {
        return g.getNodeIndex(lmIt->second);
    }
    return -1;
}

inline EvacOptions parseEvacOptions(const Graph& g, const json& args) {
    EvacOptions evOpts;
    evOpts.routeOpts = parseRouteOptions(g, args);
    evOpts.disableLifts = args.value("disableLifts", true);
    return evOpts;
}

inline std::vector<EvacGroup> parseEvacGroups(const Graph& g, const json& args) {
    std::vector<EvacGroup> groups;
    if (!args.contains("people") || !args["people"].is_array()) {
        return groups;
    }

    // Aggregate identical `at` locations if passed multiple times while preserving deterministic order
    std::unordered_map<std::string, size_t> seenIdx;
    for (const auto& pj : args["people"]) {
        if (!pj.is_object()) continue;
        const std::string atId = pj.value("at", pj.value("from", pj.value("nodeId", "")));
        const int count = pj.value("count", 0);
        if (atId.empty() || count <= 0) continue;
        const int nodeIdx = resolveEndpointIndex(g, atId);

        auto it = seenIdx.find(atId);
        if (it == seenIdx.end()) {
            seenIdx[atId] = groups.size();
            groups.push_back(EvacGroup{atId, nodeIdx, count});
        } else {
            groups[it->second].count += count;
        }
    }
    return groups;
}

inline json serializeEvacResultJson(const EvacResult& r) {
    json assignmentsJson = json::array();
    for (const auto& a : r.assignments) {
        json item = {
            {"from", a.from},
            {"assemblyId", a.assemblyId},
            {"assemblyName", a.assemblyName},
            {"count", a.count},
            {"distance", a.distance},
            {"path", a.path}
        };
        if (!a.exitNodeId.empty()) {
            item["exitNodeId"] = a.exitNodeId;
        }
        assignmentsJson.push_back(std::move(item));
    }

    json loadJson = json::array();
    for (const auto& l : r.assemblyLoad) {
        loadJson.push_back({
            {"id", l.id},
            {"name", l.name},
            {"assigned", l.assigned},
            {"capacity", l.capacity}
        });
    }

    return json{
        {"mode", r.mode},
        {"assignments", std::move(assignmentsJson)},
        {"unassigned", r.unassigned},
        {"assemblyLoad", std::move(loadJson)},
        {"totalDistance", r.totalDistance},
        {"flowCost", r.totalDistance},
        {"totalPathDistance", r.totalPathDistance},
        {"maxAssemblyLoad", r.maxAssemblyLoad},
        {"overloadedAreasCount", r.overloadedAreasCount}
    };
}

inline std::string serializeRouteResult(const RouteResult& r) {
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
        {"visitedCount", r.visitedCount},
        {"negativeCycle", r.negativeCycle}
    };
    if (r.negativeCycle && !r.error.empty()) {
        out["error"] = r.error;
    }
    return out.dump();
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
    globalRouteCache().resetAll(globalRouteCache().capacity());
    globalProgressTracker() = ProgressStateTracker{};

    json res = {
        {"status", "ok"},
        {"nodeCount", g.nodeCount()},
        {"edgeCount", g.logicalEdgeCount},
        {"indoorBuildings", g.indoorBuildingCount},
        {"landmarkCount", static_cast<int>(g.landmarks.size())},
        {"assemblyAreaCount", static_cast<int>(g.assemblyAreas.size())},
        {"buildingExitCount", static_cast<int>(g.buildingExits.size())}
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
    const std::string normAlgo = toLowerCopy(opts.algo.empty() ? "dijkstra" : opts.algo);
    const uint64_t bHash = opts.blockedSetHash();

    std::ostringstream keyOss;
    keyOss << fromIdx << "|" << toIdx << "|" << normAlgo << "|"
           << (opts.accessibleOnly ? 1 : 0) << "|" << bHash;
    const std::string cacheKey = keyOss.str();

    RouteResult cachedRes;
    if (globalRouteCache().get(cacheKey, bHash, cachedRes)) {
        return serializeRouteResult(cachedRes);
    }

    const RouteResult r = computeRoute(g, fromIdx, toIdx, opts);
    if (!r.error.empty() && !r.negativeCycle) {
        return makeErrorJson(r.error);
    }

    globalRouteCache().put(cacheKey, bHash, r);
    return serializeRouteResult(r);
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

inline std::string handleSearch(const std::string& argsJson) {
    const json args = argsJson.empty() ? json::object() : json::parse(argsJson);
    const Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }

    const std::string query = args.value("query", "");
    const int limit = args.value("limit", 10);
    const auto matched = g.searchTrie.search(query, limit);

    json results = json::array();
    for (const auto& item : matched) {
        json entry = {
            {"id", item.id},
            {"label", item.label},
            {"name", item.label},
            {"kind", item.kind},
            {"type", item.kind},
            {"nodeId", item.nodeId}
        };
        if (!item.buildingId.empty()) {
            entry["buildingId"] = item.buildingId;
        }
        if (!item.shortName.empty()) {
            entry["short"] = item.shortName;
        }
        if (!item.number.empty()) {
            entry["number"] = item.number;
        }
        results.push_back(std::move(entry));
    }

    return json{{"results", std::move(results)}}.dump();
}

inline std::string handleCacheStats(const std::string& argsJson) {
    const json args = argsJson.empty() ? json::object() : json::parse(argsJson);
    RouteLRUCache& cache = globalRouteCache();

    if (args.value("reset", false) || args.value("clear", false)) {
        const size_t newCap = args.value("capacity", args.value("maxSize", cache.capacity()));
        cache.resetAll(newCap);
    } else if (args.contains("capacity") || args.contains("maxSize")) {
        const size_t newCap = args.value("capacity", args.value("maxSize", cache.capacity()));
        cache.setCapacity(newCap);
    }

    json res = {
        {"hits", cache.hits()},
        {"misses", cache.misses()},
        {"size", cache.size()},
        {"capacity", cache.capacity()},
        {"evictions", cache.evictions()},
        {"invalidations", cache.invalidations()},
        {"keys", cache.keysMRUFirst()}
    };
    return res.dump();
}

inline std::string handleAllPairs(const std::string& argsJson) {
    const json args = argsJson.empty() ? json::object() : json::parse(argsJson);
    const Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }

    const RouteOptions opts = parseRouteOptions(g, args);
    return computeAllPairsMatrixJson(g, opts).dump();
}

inline std::string handleMST(const std::string& argsJson) {
    const json args = argsJson.empty() ? json::object() : json::parse(argsJson);
    const Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }

    const std::string algo = toLowerCopy(args.value("algo", "kruskal"));
    MSTResult mst;
    if (algo == "kruskal" || algo.empty()) {
        mst = runKruskalMST(g);
    } else if (algo == "prim") {
        mst = runPrimMST(g);
    } else {
        return makeErrorJson("Unknown MST algorithm: " + algo);
    }

    json edgesJson = json::array();
    for (const auto& e : mst.edges) {
        std::string aId = g.nodes[e.graphU].id;
        std::string bId = g.nodes[e.graphV].id;
        if (bId < aId) std::swap(aId, bId);
        edgesJson.push_back({
            {"a", aId},
            {"b", bId},
            {"w", e.w}
        });
    }

    // Sort MST edge listing deterministically by endpoints (a, b) so output order
    // does not depend on Prim/Kruskal discovery order or platform container hashes.
    std::sort(edgesJson.begin(), edgesJson.end(), [](const json& e1, const json& e2) {
        if (e1["a"] != e2["a"]) return e1["a"] < e2["a"];
        return e1["b"] < e2["b"];
    });

    json out = {
        {"algo", mst.algo},
        {"totalWeight", mst.totalWeight},
        {"totalLength", mst.totalWeight},
        {"edgeCount", static_cast<int>(mst.edges.size())},
        {"edges", std::move(edgesJson)}
    };
    return out.dump();
}

inline std::string handleTSP(const std::string& argsJson) {
    const json args = json::parse(argsJson);
    const Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }

    if (!args.contains("stops") || !args["stops"].is_array() || args["stops"].empty()) {
        return makeErrorJson("'stops' must be a non-empty array of node or landmark IDs");
    }

    std::vector<std::string> stopIds;
    std::vector<int> stopIndices;
    for (const auto& item : args["stops"]) {
        if (!item.is_string()) {
            return makeErrorJson("Each stop in 'stops' must be a string ID");
        }
        const std::string sid = item.get<std::string>();
        const int idx = resolveEndpointIndex(g, sid);
        if (idx < 0) {
            return makeErrorJson("Unknown stop ID in TSP: " + sid);
        }
        stopIds.push_back(sid);
        stopIndices.push_back(idx);
    }

    const std::string algo = args.value("algo", "dp");
    const bool returnToStart = args.value("returnToStart", false);
    const RouteOptions baseOpts = parseRouteOptions(g, args);

    const TSPResult r = runTSP(g, stopIds, stopIndices, algo, returnToStart, baseOpts);
    if (!r.error.empty()) {
        return makeErrorJson(r.error);
    }

    json out = {
        {"found", r.found},
        {"algo", r.algo},
        {"returnToStart", r.returnToStart},
        {"order", r.orderedStops},
        {"orderedStops", r.orderedStops},
        {"totalDistance", r.totalDistance},
        {"dpDistance", r.dpDistance},
        {"nnDistance", r.nnDistance},
        {"heuristicGapPercent", r.heuristicGapPercent},
        {"path", r.fullPath}
    };
    return out.dump();
}

inline std::string handleCriticalPoints(const std::string& argsJson) {
    (void)argsJson;
    const Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }

    const CriticalPointsResult cp = runTarjanCriticalPoints(g);
    json bridgesArr = json::array();
    for (const auto& [a, b] : cp.bridges) {
        bridgesArr.push_back(json::array({a, b}));
    }

    json out = {
        {"articulationPoints", cp.articulationPoints},
        {"bridges", std::move(bridgesArr)},
        {"nodes", cp.nodeDetails},
        {"edges", cp.edgeDetails},
        {"landmarkNames", cp.landmarkNames}
    };
    return out.dump();
}

inline void ensureEvacDataLoadedIfNeeded(Graph& g, const json& args) {
    if (args.is_object() && (args.contains("assemblyAreas") || args.contains("buildingExits"))) {
        if (args.contains("assemblyAreas")) {
            g.assemblyAreas.clear();
        }
        if (args.contains("buildingExits")) {
            g.buildingExits.clear();
            g.buildingExitNodeIds.clear();
        }
        g.loadEvacJson(args);
        return;
    }
    if (g.assemblyAreas.empty()) {
        namespace fs = std::filesystem;
        std::error_code ec;
        const fs::path evacFile = fs::path(Graph::resolveDataDirectory("data")) / "evac.json";
        if (fs::exists(evacFile, ec) && fs::is_regular_file(evacFile, ec)) {
            g.loadEvacJson(Graph::readJsonFile(evacFile));
        }
    }
}

inline std::string handleEvacuate(const std::string& argsJson) {
    const json args = argsJson.empty() ? json::object() : json::parse(argsJson);
    Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }
    ensureEvacDataLoadedIfNeeded(g, args);

    const std::string mode = args.value("mode", "nearest");
    const EvacOptions evOpts = parseEvacOptions(g, args);
    const std::vector<EvacGroup> groups = parseEvacGroups(g, args);

    const EvacResult res = runEvacuation(g, mode, groups, evOpts);
    return serializeEvacResultJson(res).dump();
}

inline std::string handleNearestAssembly(const std::string& argsJson) {
    const json args = argsJson.empty() ? json::object() : json::parse(argsJson);
    Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }
    ensureEvacDataLoadedIfNeeded(g, args);

    const std::string fromId = args.value("from", args.value("at", ""));
    if (fromId.empty()) {
        return makeErrorJson("'from' node ID is required for nearestAssembly");
    }
    const int fromIdx = resolveEndpointIndex(g, fromId);
    if (fromIdx < 0) {
        return makeErrorJson("Unknown 'from' node ID: " + fromId);
    }

    const EvacOptions evOpts = parseEvacOptions(g, args);
    std::vector<AssemblyArea> areas = g.assemblyAreas;
    std::sort(areas.begin(), areas.end(), [](const AssemblyArea& a, const AssemblyArea& b) {
        return a.id < b.id;
    });

    const auto revAdj = buildReversedAdjacency(g);
    const MultiSourceEvacTable msTable = runMultiSourceReversedDijkstra(g, areas, evOpts, revAdj);

    if (msTable.bestAreaIdx[fromIdx] < 0 || std::isinf(msTable.dist[fromIdx])) {
        json unreachableOut = {
            {"found", false},
            {"from", fromId},
            {"assemblyId", ""},
            {"assemblyName", ""},
            {"distance", -1.0},
            {"path", json::array()}
        };
        return unreachableOut.dump();
    }

    const int aIdx = msTable.bestAreaIdx[fromIdx];
    const AssemblyArea& area = areas[aIdx];
    const double d = msTable.dist[fromIdx];

    std::vector<int> pathIndices;
    std::vector<std::string> pathIds;
    reconstructForwardEvacPath(g, fromIdx, msTable.nextHop, pathIndices, pathIds);

    RouteResult stepFormatted;
    stepFormatted.found = true;
    stepFormatted.distance = d;
    stepFormatted.pathIndices = pathIndices;
    buildStepsFromPathIndices(g, evOpts.routeOpts, stepFormatted);

    json out = {
        {"found", true},
        {"from", fromId},
        {"assemblyId", area.id},
        {"assemblyName", area.name},
        {"nodeId", area.nodeId},
        {"capacity", area.capacity},
        {"distance", d},
        {"path", pathIds},
        {"steps", stepFormatted.steps}
    };
    if (g.nodes[fromIdx].isIndoor) {
        const std::string exitId = findExitNodeAlongPath(g, fromIdx, pathIndices);
        if (!exitId.empty()) {
            out["exitNodeId"] = exitId;
        }
    }
    return out.dump();
}

inline std::string handleEvacuationCompare(const std::string& argsJson) {
    const json args = argsJson.empty() ? json::object() : json::parse(argsJson);
    Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }
    ensureEvacDataLoadedIfNeeded(g, args);

    const EvacOptions evOpts = parseEvacOptions(g, args);
    const std::vector<EvacGroup> groups = parseEvacGroups(g, args);

    const auto [nearestRes, capacityRes] = compareEvacuationModes(g, groups, evOpts);
    json nearestJson = serializeEvacResultJson(nearestRes);
    json capacityJson = serializeEvacResultJson(capacityRes);

    json out = {
        {"nearest", std::move(nearestJson)},
        {"capacity", std::move(capacityJson)},
        {"totalDistance", {
            {"nearest", nearestRes.totalDistance},
            {"capacity", capacityRes.totalDistance}
        }},
        {"maxAssemblyLoad", {
            {"nearest", nearestRes.maxAssemblyLoad},
            {"capacity", capacityRes.maxAssemblyLoad}
        }},
        {"overloadedAreasCount", {
            {"nearest", nearestRes.overloadedAreasCount},
            {"capacity", capacityRes.overloadedAreasCount}
        }}
    };
    return out.dump();
}

/**
 * Extracts a sequence of graph node indices from `args`, supporting:
 *   1. `{route: {path: [...]}}` or `{route: ["n1", "n2", ...]}`
 *   2. `{path: ["n1", "n2", ...]}`
 *   3. `{from, to, algo?, accessible?, avoid?}` (computes route on the fly)
 */
inline bool resolvePathIndicesFromArgs(const Graph& g, const json& args,
                                       std::vector<int>& outPathIndices,
                                       RouteOptions& outOpts,
                                       std::string& outError) {
    outPathIndices.clear();
    outError.clear();
    outOpts = parseRouteOptions(g, args);

    auto extractFromPathArray = [&](const json& arr) -> bool {
        if (!arr.is_array()) return false;
        for (const auto& item : arr) {
            if (!item.is_string()) continue;
            const int idx = resolveEndpointIndex(g, item.get<std::string>());
            if (idx < 0) {
                outError = "Unknown node ID in route path: " + item.get<std::string>();
                return false;
            }
            outPathIndices.push_back(idx);
        }
        return true;
    };

    if (args.contains("route")) {
        const auto& rVal = args["route"];
        if (rVal.is_object()) {
            if (rVal.contains("found") && rVal["found"].is_boolean() && !rVal["found"].get<bool>()) {
                return true; // Unreachable route -> empty path
            }
            if (rVal.contains("path") && rVal["path"].is_array()) {
                return extractFromPathArray(rVal["path"]);
            }
        } else if (rVal.is_array()) {
            return extractFromPathArray(rVal);
        }
    }

    if (args.contains("path") && args["path"].is_array()) {
        return extractFromPathArray(args["path"]);
    }

    if (args.contains("from") && args.contains("to") &&
        args["from"].is_string() && args["to"].is_string()) {
        const std::string fromId = args["from"].get<std::string>();
        const std::string toId = args["to"].get<std::string>();
        const int fromIdx = resolveEndpointIndex(g, fromId);
        const int toIdx = resolveEndpointIndex(g, toId);
        if (fromIdx < 0) {
            outError = "Unknown 'from' node ID: " + fromId;
            return false;
        }
        if (toIdx < 0) {
            outError = "Unknown 'to' node ID: " + toId;
            return false;
        }
        const RouteResult r = computeRoute(g, fromIdx, toIdx, outOpts);
        if (r.found) {
            outPathIndices = r.pathIndices;
        }
        return true;
    }

    outError = "Either 'route' (with 'path') or 'from'/'to' must be provided";
    return false;
}

inline json serializeManeuversArray(const std::vector<Maneuver>& maneuvers) {
    json arr = json::array();
    for (const auto& m : maneuvers) {
        json item = {
            {"type", m.type},
            {"text", m.text},
            {"distanceM", m.distanceM},
            {"atNodeId", m.atNodeId},
            {"lat", m.lat},
            {"lng", m.lng}
        };
        if (!m.landmark.empty()) {
            item["landmark"] = m.landmark;
        }
        arr.push_back(std::move(item));
    }
    return arr;
}

inline std::string handleDirections(const std::string& argsJson) {
    const json args = argsJson.empty() ? json::object() : json::parse(argsJson);
    const Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }

    std::vector<int> pathIndices;
    RouteOptions opts;
    std::string err;
    if (!resolvePathIndicesFromArgs(g, args, pathIndices, opts, err)) {
        return makeErrorJson(err);
    }

    const std::vector<Maneuver> maneuvers = computeDirectionsForPath(g, pathIndices, opts);
    double totalDistM = 0.0;
    for (const auto& m : maneuvers) {
        totalDistM += m.distanceM;
    }

    json out = {
        {"maneuvers", serializeManeuversArray(maneuvers)},
        {"totalDistanceM", totalDistM}
    };
    return out.dump();
}

inline std::string handleProgress(const std::string& argsJson) {
    const json args = argsJson.empty() ? json::object() : json::parse(argsJson);
    const Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }

    if (!args.contains("lat") || !args.contains("lng") ||
        !args["lat"].is_number() || !args["lng"].is_number()) {
        return makeErrorJson("'lat' and 'lng' numeric coordinates are required for progress");
    }

    std::vector<int> pathIndices;
    RouteOptions opts;
    std::string err;
    if (!resolvePathIndicesFromArgs(g, args, pathIndices, opts, err)) {
        return makeErrorJson(err);
    }

    const double lat = args["lat"].get<double>();
    const double lng = args["lng"].get<double>();
    const double accuracyM = args.value("accuracyM", args.value("accuracy", 0.0));
    const bool hasLastIndex = args.contains("lastIndex") && args["lastIndex"].is_number_integer();
    const int lastIndex = hasLastIndex ? args["lastIndex"].get<int>() : -1;
    const double explicitLastAlongM =
        (args.contains("lastDistanceAlongM") && args["lastDistanceAlongM"].is_number())
            ? args["lastDistanceAlongM"].get<double>()
            : -1.0;

    const ProgressResult prog = computeRouteProgress(
        g, pathIndices, lat, lng, accuracyM, lastIndex, hasLastIndex, explicitLastAlongM);

    json out = {
        {"distanceAlongM", prog.distanceAlongM},
        {"remainingM", prog.remainingM},
        {"nextManeuverIndex", prog.nextManeuverIndex},
        {"distanceToNextM", prog.distanceToNextM},
        {"offRoute", prog.offRoute},
        {"offRouteDistanceM", prog.offRouteDistanceM},
        {"arrived", prog.arrived},
        {"lastIndex", prog.matchedIndex},
        {"snappedLat", prog.snappedLat},
        {"snappedLng", prog.snappedLng}
    };
    return out.dump();
}

inline std::string handleReroute(const std::string& argsJson) {
    const json args = argsJson.empty() ? json::object() : json::parse(argsJson);
    const Graph& g = globalGraph();
    if (g.nodeCount() == 0) {
        return makeErrorJson("Graph is not loaded");
    }

    const std::string toId = args.value("to", "");
    if (toId.empty()) {
        return makeErrorJson("'to' node or landmark ID is required for reroute");
    }
    const int toIdx = resolveEndpointIndex(g, toId);
    if (toIdx < 0) {
        return makeErrorJson("Unknown 'to' node ID: " + toId);
    }

    double fromLat = 0.0;
    double fromLng = 0.0;
    bool hasGps = false;

    if (args.contains("from") && args["from"].is_object()) {
        const auto& fObj = args["from"];
        if (fObj.contains("lat") && fObj.contains("lng") &&
            fObj["lat"].is_number() && fObj["lng"].is_number()) {
            fromLat = fObj["lat"].get<double>();
            fromLng = fObj["lng"].get<double>();
            hasGps = true;
        }
    } else if (args.contains("lat") && args.contains("lng") &&
               args["lat"].is_number() && args["lng"].is_number()) {
        fromLat = args["lat"].get<double>();
        fromLng = args["lng"].get<double>();
        hasGps = true;
    } else if (args.contains("from") && args["from"].is_string()) {
        const int fIdx = resolveEndpointIndex(g, args["from"].get<std::string>());
        if (fIdx >= 0 && g.nodes[fIdx].hasCoords) {
            fromLat = g.nodes[fIdx].lat;
            fromLng = g.nodes[fIdx].lng;
            hasGps = true;
        }
    }

    if (!hasGps) {
        return makeErrorJson("reroute requires 'from: {lat, lng}' coordinates");
    }

    const RouteOptions opts = parseRouteOptions(g, args);
    const RerouteSnapResult rr = snapAndRerouteFromGps(g, fromLat, fromLng, toIdx, opts);

    // Reset progress tracker for the newly rerouted path
    globalProgressTracker() = ProgressStateTracker{};

    json routeJson = json::parse(serializeRouteResult(rr.route));
    json maneuversArr = serializeManeuversArray(rr.maneuvers);

    json out = {
        {"found", rr.route.found},
        {"distance", rr.route.distance},
        {"path", rr.route.path},
        {"steps", rr.route.steps},
        {"snappedNodeId", rr.snappedNodeId},
        {"snappedLat", rr.snappedLat},
        {"snappedLng", rr.snappedLng},
        {"snapDistanceM", rr.snapDistanceM},
        {"route", std::move(routeJson)},
        {"maneuvers", maneuversArr},
        {"directions", {{"maneuvers", std::move(maneuversArr)}}}
    };
    return out.dump();
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
        } else if (functionName == "search") {
            buffer = navcore::detail::handleSearch(args);
        } else if (functionName == "cacheStats") {
            buffer = navcore::detail::handleCacheStats(args);
        } else if (functionName == "allPairs") {
            buffer = navcore::detail::handleAllPairs(args);
        } else if (functionName == "mst") {
            buffer = navcore::detail::handleMST(args);
        } else if (functionName == "tsp") {
            buffer = navcore::detail::handleTSP(args);
        } else if (functionName == "criticalPoints") {
            buffer = navcore::detail::handleCriticalPoints(args);
        } else if (functionName == "evacuate") {
            buffer = navcore::detail::handleEvacuate(args);
        } else if (functionName == "nearestAssembly") {
            buffer = navcore::detail::handleNearestAssembly(args);
        } else if (functionName == "evacuationCompare") {
            buffer = navcore::detail::handleEvacuationCompare(args);
        } else if (functionName == "directions") {
            buffer = navcore::detail::handleDirections(args);
        } else if (functionName == "progress") {
            buffer = navcore::detail::handleProgress(args);
        } else if (functionName == "reroute") {
            buffer = navcore::detail::handleReroute(args);
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
// SECTION 14: Optional Terminal CLI Runner (#ifdef NAVCORE_CLI)
// ============================================================================

#ifdef NAVCORE_CLI
int main(int argc, char* argv[]) {
    using json = nlohmann::json;

    if (argc < 2) {
        std::cerr << "Usage:\n"
                  << "  navcore_cli ping\n"
                  << "  navcore_cli route <from> <to> [dijkstra|astar|bfs|bellmanford|floyd] [--accessible] [--data <dirOrFile>]\n"
                  << "  navcore_cli compare <from> <to> [--accessible] [--data <dirOrFile>]\n"
                  << "  navcore_cli search <query> [limit] [--data <dirOrFile>]\n"
                  << "  navcore_cli cacheStats [--data <dirOrFile>]\n"
                  << "  navcore_cli allPairs [--data <dirOrFile>]\n"
                  << "  navcore_cli mst [kruskal|prim] [--data <dirOrFile>]\n"
                  << "  navcore_cli tsp <stop1> <stop2> [stop3 ...] [--algo dp|nn] [--return] [--data <dirOrFile>]\n"
                  << "  navcore_cli criticalPoints [--data <dirOrFile>]\n"
                  << "  navcore_cli nearestAssembly <from> [--allow-lifts] [--data <dirOrFile>]\n"
                  << "  navcore_cli evacuate [nearest|capacity] [node:count ...] [--allow-lifts] [--data <dirOrFile>]\n"
                  << "  navcore_cli evacuationCompare [node:count ...] [--allow-lifts] [--data <dirOrFile>]\n"
                  << "  navcore_cli directions <from> <to> [--accessible] [--data <dirOrFile>]\n"
                  << "  navcore_cli progress <from> <to> <lat> <lng> [--accessible] [--data <dirOrFile>]\n"
                  << "  navcore_cli reroute <lat> <lng> <to> [--accessible] [--data <dirOrFile>]\n";
        return 1;
    }

    const std::string cmd = argv[1];
    if (cmd == "ping") {
        std::cout << call("ping", "{}") << "\n";
        return 0;
    }

    std::string dataTarget = "data";
    bool accessible = false;
    bool returnToStart = false;
    bool disableLifts = true;
    std::string algoOverride;
    std::vector<std::string> positional;

    for (int i = 2; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--accessible" || arg == "--step-free") {
            accessible = true;
        } else if (arg == "--return" || arg == "--return-to-start") {
            returnToStart = true;
        } else if (arg == "--allow-lifts" || arg == "--enable-lifts") {
            disableLifts = false;
        } else if (arg == "--algo" && i + 1 < argc) {
            algoOverride = argv[++i];
        } else if (arg == "--data" && i + 1 < argc) {
            dataTarget = argv[++i];
        } else {
            positional.push_back(arg);
        }
    }

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

    auto buildEvacPeopleJson = [&](size_t startIdx) -> json {
        json people = json::array();
        for (size_t i = startIdx; i < positional.size(); ++i) {
            const std::string& token = positional[i];
            const auto lastColon = token.rfind(':');
            if (lastColon != std::string::npos && lastColon > 0) {
                const std::string tail = token.substr(lastColon + 1);
                bool allDigits = !tail.empty();
                for (unsigned char c : tail) {
                    if (!std::isdigit(c)) {
                        allDigits = false;
                        break;
                    }
                }
                if (allDigits) {
                    const std::string atId = token.substr(0, lastColon);
                    const int cnt = std::atoi(tail.c_str());
                    if (!atId.empty() && cnt > 0) {
                        people.push_back({{"at", atId}, {"count", cnt}});
                    }
                }
            }
        }
        if (people.empty()) {
            // Default campus evacuation demo scenario (1,600 people across academic buildings)
            people = json::array({
                {{"at", "b-library:204"}, {"count", 450}},
                {{"at", "b-library:101"}, {"count", 350}},
                {{"at", "b-csit:201"}, {"count", 450}},
                {{"at", "b-auditorium:g01"}, {"count", 350}}
            });
        }
        return people;
    };

    if (cmd == "route") {
        if (positional.size() < 2) {
            std::cerr << "Error: 'route' requires <from> and <to> arguments.\n";
            return 1;
        }
        const std::string algo = !algoOverride.empty()
                                     ? algoOverride
                                     : ((positional.size() >= 3) ? positional[2] : "dijkstra");
        json routeArgs = {
            {"from", positional[0]},
            {"to", positional[1]},
            {"algo", algo},
            {"accessible", accessible}
        };
        std::cout << json::parse(call("route", routeArgs.dump().c_str())).dump(2) << "\n";
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
        std::cout << json::parse(call("compare", cmpArgs.dump().c_str())).dump(2) << "\n";
        return 0;
    } else if (cmd == "search") {
        if (positional.empty()) {
            std::cerr << "Error: 'search' requires a <query> argument.\n";
            return 1;
        }
        const int limit = (positional.size() >= 2) ? std::atoi(positional[1].c_str()) : 10;
        json searchArgs = {
            {"query", positional[0]},
            {"limit", limit > 0 ? limit : 10}
        };
        std::cout << json::parse(call("search", searchArgs.dump().c_str())).dump(2) << "\n";
        return 0;
    } else if (cmd == "cacheStats") {
        std::cout << json::parse(call("cacheStats", "{}")).dump(2) << "\n";
        return 0;
    } else if (cmd == "allPairs") {
        std::cout << json::parse(call("allPairs", "{}")).dump(2) << "\n";
        return 0;
    } else if (cmd == "mst") {
        const std::string mstAlgo = !algoOverride.empty()
                                        ? algoOverride
                                        : (positional.empty() ? "kruskal" : positional[0]);
        json mstArgs = {{"algo", mstAlgo}};
        std::cout << json::parse(call("mst", mstArgs.dump().c_str())).dump(2) << "\n";
        return 0;
    } else if (cmd == "tsp") {
        if (positional.size() < 2) {
            std::cerr << "Error: 'tsp' requires at least 2 stop IDs.\n";
            return 1;
        }
        json tspArgs = {
            {"stops", positional},
            {"algo", algoOverride.empty() ? "dp" : algoOverride},
            {"returnToStart", returnToStart},
            {"accessible", accessible}
        };
        std::cout << json::parse(call("tsp", tspArgs.dump().c_str())).dump(2) << "\n";
        return 0;
    } else if (cmd == "criticalPoints") {
        std::cout << json::parse(call("criticalPoints", "{}")).dump(2) << "\n";
        return 0;
    } else if (cmd == "nearestAssembly") {
        const std::string fromNode = positional.empty() ? "b-library:204" : positional[0];
        json naArgs = {
            {"from", fromNode},
            {"disableLifts", disableLifts}
        };
        std::cout << json::parse(call("nearestAssembly", naArgs.dump().c_str())).dump(2) << "\n";
        return 0;
    } else if (cmd == "evacuate") {
        std::string mode = "nearest";
        size_t startIdx = 0;
        if (!positional.empty() && (positional[0] == "nearest" || positional[0] == "capacity")) {
            mode = positional[0];
            startIdx = 1;
        } else if (!algoOverride.empty()) {
            mode = algoOverride;
        }
        json evacArgs = {
            {"mode", mode},
            {"disableLifts", disableLifts},
            {"blocked", {{"nodes", json::array()}, {"edges", json::array()}}},
            {"people", buildEvacPeopleJson(startIdx)}
        };
        std::cout << json::parse(call("evacuate", evacArgs.dump().c_str())).dump(2) << "\n";
        return 0;
    } else if (cmd == "evacuationCompare") {
        json cmpArgs = {
            {"disableLifts", disableLifts},
            {"blocked", {{"nodes", json::array()}, {"edges", json::array()}}},
            {"people", buildEvacPeopleJson(0)}
        };
        std::cout << json::parse(call("evacuationCompare", cmpArgs.dump().c_str())).dump(2) << "\n";
        return 0;
    } else if (cmd == "directions") {
        const std::string fromId = positional.size() >= 1 ? positional[0] : "b-csit:201";
        const std::string toId   = positional.size() >= 2 ? positional[1] : "n1";
        json dirArgs = {
            {"from", fromId},
            {"to", toId},
            {"algo", algoOverride.empty() ? "dijkstra" : algoOverride},
            {"accessible", accessible}
        };
        std::cout << json::parse(call("directions", dirArgs.dump().c_str())).dump(2) << "\n";
        return 0;
    } else if (cmd == "progress") {
        const std::string fromId = positional.size() >= 1 ? positional[0] : "b-csit:201";
        const std::string toId   = positional.size() >= 2 ? positional[1] : "n1";
        double lat = 24.9333;
        double lng = 67.1103;
        if (positional.size() >= 4) {
            try {
                lat = std::stod(positional[2]);
                lng = std::stod(positional[3]);
            } catch (...) {}
        }
        json routeArgs = {
            {"from", fromId},
            {"to", toId},
            {"algo", algoOverride.empty() ? "dijkstra" : algoOverride},
            {"accessible", accessible}
        };
        const auto routeRes = json::parse(call("route", routeArgs.dump().c_str()));
        json progArgs = {
            {"route", routeRes},
            {"lat", lat},
            {"lng", lng}
        };
        std::cout << json::parse(call("progress", progArgs.dump().c_str())).dump(2) << "\n";
        return 0;
    } else if (cmd == "reroute") {
        double lat = 24.9333;
        double lng = 67.1103;
        std::string toId = "b-library";
        if (positional.size() >= 2) {
            try {
                lat = std::stod(positional[0]);
                lng = std::stod(positional[1]);
            } catch (...) {}
        }
        if (positional.size() >= 3) {
            toId = positional[2];
        }
        json rerouteArgs = {
            {"from", {{"lat", lat}, {"lng", lng}}},
            {"to", toId},
            {"accessible", accessible}
        };
        std::cout << json::parse(call("reroute", rerouteArgs.dump().c_str())).dump(2) << "\n";
        return 0;
    } else {
        std::cerr << "Unknown CLI command: " << cmd << "\n";
        return 1;
    }
}
#endif // NAVCORE_CLI
