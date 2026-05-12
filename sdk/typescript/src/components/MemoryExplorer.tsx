import React, { useState, useEffect } from "react";
import { AgentMemClient } from "../api/client";

interface Props {
  namespace: string;
  serverUrl: string;
}

export function MemoryExplorer({ namespace, serverUrl }: Props) {
  const [query, setQuery] = useState("");
  const [newMemory, setNewMemory] = useState("");
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const client = new AgentMemClient(serverUrl);

  const handleStore = async () => {
    if (!newMemory) return;
    setLoading(true);
    await client.remember(namespace, newMemory);
    setNewMemory("");
    // Refresh results if possible (or just wait for next search)
    setLoading(false);
  };

  const handleSearch = async () => {
    if (!query) return;
    setLoading(true);
    const results = await client.recall(namespace, query);
    setMemories(results.results || []);
    setLoading(false);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>
          <span style={styles.icon}>🧠</span> Semantic Memory
        </h2>
        <p style={styles.subtitle}>
          Facts and knowledge — vector search finds memories by meaning
        </p>
      </div>

      {/* ── Remember Input ────────────────────────────────────── */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Remember</h3>
        <div style={styles.inputRow}>
          <input
            style={styles.input}
            value={newMemory}
            onChange={(e) => setNewMemory(e.target.value)}
            placeholder='mem.remember("User prefers JSON output over CSV")'
          />
          <button style={styles.button} onClick={handleStore} disabled={loading}>
            {loading ? "Storing..." : "Store"}
          </button>
        </div>
      </div>

      {/* ── Recall Search ─────────────────────────────────────── */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Recall</h3>
        <div style={styles.inputRow}>
          <input
            style={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='mem.recall("what output format does the user want?")'
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button style={{ ...styles.button, ...styles.buttonSecondary }} onClick={handleSearch} disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {/* ── Memory List ───────────────────────────────────────── */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>
          Search Results
          <span style={styles.count}>{memories.length}</span>
        </h3>
        <div style={styles.list}>
          {memories.map((mem, i) => (
            <div key={i} style={styles.memoryItem}>
              <div style={styles.memoryHeader}>
                <span style={styles.docId}>#{mem.doc_id}</span>
                <span style={styles.score}>Score: {mem.score.toFixed(4)}</span>
              </div>
              <p style={styles.memoryText}>{mem.text}</p>
            </div>
          ))}
          {memories.length === 0 && !loading && (
            <p style={styles.hint}>No results yet. Try searching for something above!</p>
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: "flex", flexDirection: "column", gap: "20px" },
  header: { marginBottom: "8px" },
  title: {
    fontSize: "20px",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  icon: { fontSize: "24px" },
  subtitle: { fontSize: "14px", color: "var(--text-secondary)", marginTop: "4px" },
  card: {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "20px",
    backdropFilter: "blur(12px)",
  },
  cardTitle: {
    fontSize: "14px",
    fontWeight: 600,
    color: "var(--text-secondary)",
    marginBottom: "12px",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  count: {
    fontSize: "11px",
    background: "rgba(139, 92, 246, 0.15)",
    color: "var(--accent-purple)",
    padding: "2px 8px",
    borderRadius: "12px",
    fontWeight: 600,
  },
  inputRow: { display: "flex", gap: "10px" },
  input: {
    flex: 1,
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "10px 16px",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    outline: "none",
  },
  button: {
    background: "var(--gradient-purple)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "10px 20px",
    color: "white",
    fontWeight: 600,
    fontSize: "13px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: "var(--font-sans)",
  },
  buttonSecondary: {
    background: "var(--gradient-blue)",
  },
  hint: {
    fontSize: "12px",
    color: "var(--accent-amber)",
    marginTop: "8px",
  },
  list: { display: "flex", flexDirection: "column", gap: "12px" },
  memoryItem: {
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "14px 16px",
    transition: "border-color 0.2s",
  },
  memoryHeader: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "6px",
  },
  docId: {
    fontFamily: "var(--font-mono)",
    fontSize: "12px",
    color: "var(--accent-purple)",
    fontWeight: 600,
  },
  timestamp: {
    fontSize: "12px",
    color: "var(--text-muted)",
  },
  memoryText: {
    fontSize: "14px",
    color: "var(--text-primary)",
    lineHeight: 1.5,
  },
  tags: { display: "flex", gap: "6px", marginTop: "8px" },
  tag: {
    fontSize: "11px",
    padding: "2px 8px",
    borderRadius: "10px",
    background: "rgba(59, 130, 246, 0.1)",
    color: "var(--accent-blue)",
    fontWeight: 500,
  },
};
