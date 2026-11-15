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
 *   SECTION 10: Multi-Algorithm Benchmark Comparator
 *              - Side-by-side timing (microseconds), visited count, and distance
 *
 *   SECTION 11: WASM / Native JSON Dispatcher — call(fn, argsJson)
 *              - Handlers: "ping", "load", "route", "compare", "search",
 *                "cacheStats", "allPairs", "mst", "tsp", "criticalPoints"
 *              - Exception-safe C ABI entry point & #ifdef __EMSCRIPTEN__ export
 *
 *   SECTION 12: Optional Terminal CLI Runner (#ifdef NAVCORE_CLI)
 *              - Terminal commands demonstrating every algorithm
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
                addEdge(a, b, w, kind, accessible, oneway, covered);
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
// SECTION 10: Multi-Algorithm Benchmark Comparator
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
// SECTION 11: WASM / Native JSON Dispatcher — call(fn, argsJson)
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

inline int resolveEndpointIndex(const Graph& g, const std::string& id) {
    const int direct = g.getNodeIndex(id);
    if (direct >= 0) return direct;
    auto lmIt = g.landmarkToEntranceNode.find(id);
    if (lmIt != g.landmarkToEntranceNode.end()) {
        return g.getNodeIndex(lmIt->second);
    }
    return -1;
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

    json res = {
        {"status", "ok"},
        {"nodeCount", g.nodeCount()},
        {"edgeCount", g.logicalEdgeCount},
        {"indoorBuildings", g.indoorBuildingCount},
        {"landmarkCount", static_cast<int>(g.landmarks.size())}
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
// SECTION 12: Optional Terminal CLI Runner (#ifdef NAVCORE_CLI)
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
                  << "  navcore_cli criticalPoints [--data <dirOrFile>]\n";
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
    std::string algoOverride;
    std::vector<std::string> positional;

    for (int i = 2; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg == "--accessible" || arg == "--step-free") {
            accessible = true;
        } else if (arg == "--return" || arg == "--return-to-start") {
            returnToStart = true;
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
    } else {
        std::cerr << "Unknown CLI command: " << cmd << "\n";
        return 1;
    }
}
#endif // NAVCORE_CLI
