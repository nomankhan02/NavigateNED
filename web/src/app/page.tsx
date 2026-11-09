"use client";

import { useEffect, useState } from "react";
import { pingCore, loadGraphIntoCore, PingResponse, LoadResponse } from "@/core/navcore";
import styles from "@/styles/page.module.css";

export default function Home() {
  const [pingRes, setPingRes] = useState<PingResponse | null>(null);
  const [loadRes, setLoadRes] = useState<LoadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function init() {
      try {
        setLoading(true);
        // Call C++ ping
        const p = await pingCore();
        setPingRes(p);

        // Load 4-node sample graph
        const l = await loadGraphIntoCore("/data/sample/graph.json");
        setLoadRes(l);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }

    init();
  }, []);

  return (
    <main className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>NavigateNED Foundation Test</h1>
        <p className={styles.subtitle}>
          Campus Navigation System (DSA Course Project) &mdash; WebAssembly Runtime Bridge
        </p>
      </header>

      {loading && (
        <div className={styles.card}>
          <p>Initializing WebAssembly core and loading sample graph...</p>
        </div>
      )}

      {error && (
        <div className={styles.card}>
          <div className={styles.cardTitle}>Initialization Error</div>
          <p className={styles.codeBlock}>{error}</p>
        </div>
      )}

      {pingRes && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>WASM Core Status</h2>
          <p>
            Status: <span className={`${styles.badge} ${styles.badgeSuccess}`}>{pingRes.status}</span>
          </p>
          <pre className={styles.codeBlock}>{JSON.stringify(pingRes, null, 2)}</pre>
        </section>
      )}

      {loadRes && (
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Sample Graph Ingestion (4 Nodes)</h2>
          <p>
            Status: <span className={`${styles.badge} ${styles.badgeSuccess}`}>{loadRes.status}</span>
            {loadRes.nodeCount !== undefined && ` &mdash; Nodes Loaded: ${loadRes.nodeCount}`}
          </p>
          <pre className={styles.codeBlock}>{JSON.stringify(loadRes, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}

