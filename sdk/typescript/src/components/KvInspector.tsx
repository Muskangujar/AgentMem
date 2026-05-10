import React, { useState } from "react";

interface Props {
  namespace: string;
  serverUrl: string;
}

// Placeholder data — will be replaced with real gRPC calls
const SAMPLE_KV_PAIRS = [
  {
    key: "last_run_config",
    value: '{"J": 8, "Q": 16, "mode": "jtfs"}',
    type: "json",
  },
  {
    key: "user_id",
    value: '"usr_a1b2c3d4e5f6"',
    type: "string",
  },
  {
    key: "api_endpoint",
    value: '"https://api.pubmed.ncbi.nlm.nih.gov/v1"',
    type: "string",
  },
  {
    key: "session_count",
    value: "42",
    type: "number",
  },
];

export function KvInspector({ namespace, serverUrl }: Props) {
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [lookupKey, setLookupKey] = useState("");

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>
          <span style={styles.icon}>🔑</span> Structured KV
        </h2>
        <p style={styles.subtitle}>
          Exact key-value pairs — no embedding, no approximation
        </p>
      </div>

      {/* ── Set KV ────────────────────────────────────────────── */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Set Value</h3>
        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Key</label>
            <input
              style={styles.input}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="last_run_config"
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Value</label>
            <textarea
              style={styles.textarea}
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder='{"J": 8, "Q": 16}'
              rows={2}
            />
          </div>
          <button style={styles.button}>Set</button>
        </div>
      </div>

      {/* ── Get KV ────────────────────────────────────────────── */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>Get Value</h3>
        <div style={styles.inputRow}>
          <input
            style={styles.input}
            value={lookupKey}
            onChange={(e) => setLookupKey(e.target.value)}
            placeholder="Enter key to look up"
          />
          <button style={{ ...styles.button, ...styles.buttonSecondary }}>
            Get
          </button>
        </div>
      </div>

      {/* ── KV Table ──────────────────────────────────────────── */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>
          Stored Pairs
          <span style={styles.count}>{SAMPLE_KV_PAIRS.length}</span>
        </h3>
        <div style={styles.table}>
          <div style={styles.tableHeader}>
            <span style={styles.colKey}>Key</span>
            <span style={styles.colValue}>Value</span>
            <span style={styles.colType}>Type</span>
          </div>
          {SAMPLE_KV_PAIRS.map((pair) => (
            <div key={pair.key} style={styles.tableRow}>
              <span style={styles.keyCell}>{pair.key}</span>
              <span style={styles.valueCell}>{pair.value}</span>
              <span style={styles.typeCell}>
                <span
                  style={{
                    ...styles.typeBadge,
                    background:
                      pair.type === "json"
                        ? "rgba(139, 92, 246, 0.12)"
                        : pair.type === "string"
                          ? "rgba(59, 130, 246, 0.12)"
                          : "rgba(16, 185, 129, 0.12)",
                    color:
                      pair.type === "json"
                        ? "var(--accent-purple)"
                        : pair.type === "string"
                          ? "var(--accent-blue)"
                          : "var(--accent-emerald)",
                  }}
                >
                  {pair.type}
                </span>
              </span>
            </div>
          ))}
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
  subtitle: {
    fontSize: "14px",
    color: "var(--text-secondary)",
    marginTop: "4px",
  },
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
    background: "rgba(16, 185, 129, 0.15)",
    color: "var(--accent-emerald)",
    padding: "2px 8px",
    borderRadius: "12px",
    fontWeight: 600,
  },
  formGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  formGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  label: {
    fontSize: "11px",
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
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
  textarea: {
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "10px 16px",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    outline: "none",
    resize: "vertical" as const,
  },
  button: {
    background: "var(--gradient-emerald)",
    border: "none",
    borderRadius: "var(--radius-sm)",
    padding: "10px 20px",
    color: "white",
    fontWeight: 600,
    fontSize: "13px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: "var(--font-sans)",
    alignSelf: "flex-end",
  },
  buttonSecondary: {
    background: "var(--gradient-blue)",
  },
  table: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    borderRadius: "var(--radius-sm)",
    overflow: "hidden",
  },
  tableHeader: {
    display: "grid",
    gridTemplateColumns: "200px 1fr 80px",
    gap: "12px",
    padding: "8px 14px",
    background: "var(--bg-tertiary)",
    fontSize: "11px",
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  tableRow: {
    display: "grid",
    gridTemplateColumns: "200px 1fr 80px",
    gap: "12px",
    padding: "10px 14px",
    background: "var(--bg-tertiary)",
    borderTop: "1px solid var(--border)",
    transition: "background 0.15s",
  },
  colKey: {},
  colValue: {},
  colType: {},
  keyCell: {
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    color: "var(--accent-emerald)",
    fontWeight: 500,
  },
  valueCell: {
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  typeCell: {},
  typeBadge: {
    fontSize: "11px",
    padding: "2px 8px",
    borderRadius: "10px",
    fontWeight: 500,
  },
};
