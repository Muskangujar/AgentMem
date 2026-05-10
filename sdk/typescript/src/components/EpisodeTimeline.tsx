import React, { useState } from "react";

interface Props {
  namespace: string;
  serverUrl: string;
}

// Placeholder data — will be replaced with real gRPC calls
const SAMPLE_EPISODES = [
  {
    action: "searched_pubmed",
    result_summary: "Found 23 papers, 5 highly relevant",
    timestamp_ns: Date.now() * 1_000_000 - 120_000_000_000,
    action_uuid: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    tags: ["research", "pubmed"],
  },
  {
    action: "generated_summary",
    result_summary: "Synthesized 5 papers into 3-paragraph summary",
    timestamp_ns: Date.now() * 1_000_000 - 300_000_000_000,
    action_uuid: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    tags: ["writing"],
  },
  {
    action: "fetched_api_data",
    result_summary: "Retrieved EEG dataset metadata, 1.2GB available",
    timestamp_ns: Date.now() * 1_000_000 - 600_000_000_000,
    action_uuid: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    tags: ["data", "eeg"],
  },
  {
    action: "ran_jtfs_analysis",
    result_summary: "JTFS analysis complete, Q=16 optimal for alpha band",
    timestamp_ns: Date.now() * 1_000_000 - 3600_000_000_000,
    action_uuid: "d4e5f6a7-b8c9-0123-defa-234567890123",
    tags: ["analysis", "jtfs"],
  },
];

function formatTimestamp(ns: number): string {
  const ms = ns / 1_000_000;
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleDateString();
}

export function EpisodeTimeline({ namespace, serverUrl }: Props) {
  const [lastN, setLastN] = useState(10);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>
          <span style={styles.icon}>📜</span> Episode Timeline
        </h2>
        <p style={styles.subtitle}>
          What the agent did — append-only action log, time-ordered
        </p>
      </div>

      {/* ── Controls ──────────────────────────────────────────── */}
      <div style={styles.controls}>
        <div style={styles.controlGroup}>
          <label style={styles.controlLabel}>Show last</label>
          <input
            type="number"
            style={styles.numberInput}
            value={lastN}
            onChange={(e) => setLastN(Number(e.target.value))}
            min={1}
            max={100}
          />
          <span style={styles.controlLabel}>episodes</span>
        </div>
        <button style={styles.refreshButton}>↻ Refresh</button>
      </div>

      {/* ── Timeline ──────────────────────────────────────────── */}
      <div style={styles.timeline}>
        {SAMPLE_EPISODES.map((ep, i) => (
          <div key={ep.action_uuid} style={styles.timelineItem}>
            {/* Connector line */}
            <div style={styles.connector}>
              <div
                style={{
                  ...styles.dot,
                  background:
                    i === 0 ? "var(--accent-blue)" : "var(--text-muted)",
                  boxShadow:
                    i === 0
                      ? "0 0 10px rgba(59, 130, 246, 0.5)"
                      : "none",
                }}
              />
              {i < SAMPLE_EPISODES.length - 1 && (
                <div style={styles.line} />
              )}
            </div>

            {/* Content */}
            <div style={styles.episodeCard}>
              <div style={styles.episodeHeader}>
                <span style={styles.action}>{ep.action}</span>
                <span style={styles.time}>
                  {formatTimestamp(ep.timestamp_ns)}
                </span>
              </div>
              <p style={styles.summary}>{ep.result_summary}</p>
              <div style={styles.meta}>
                <span style={styles.uuid}>
                  {ep.action_uuid.slice(0, 8)}…
                </span>
                <div style={styles.tags}>
                  {ep.tags.map((tag) => (
                    <span key={tag} style={styles.tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
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
  controls: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
  },
  controlGroup: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  controlLabel: {
    fontSize: "13px",
    color: "var(--text-secondary)",
  },
  numberInput: {
    width: "60px",
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "6px 10px",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    outline: "none",
    textAlign: "center" as const,
  },
  refreshButton: {
    background: "none",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "6px 14px",
    color: "var(--text-secondary)",
    fontSize: "13px",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    transition: "all 0.2s",
  },
  timeline: {
    display: "flex",
    flexDirection: "column",
    gap: "0",
  },
  timelineItem: {
    display: "flex",
    gap: "16px",
  },
  connector: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "20px",
    flexShrink: 0,
  },
  dot: {
    width: "12px",
    height: "12px",
    borderRadius: "50%",
    marginTop: "18px",
    flexShrink: 0,
  },
  line: {
    width: "2px",
    flex: 1,
    background: "var(--border)",
    minHeight: "20px",
  },
  episodeCard: {
    flex: 1,
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    padding: "14px 18px",
    marginBottom: "8px",
    transition: "border-color 0.2s",
  },
  episodeHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "6px",
  },
  action: {
    fontFamily: "var(--font-mono)",
    fontSize: "14px",
    fontWeight: 600,
    color: "var(--accent-blue)",
  },
  time: {
    fontSize: "12px",
    color: "var(--text-muted)",
  },
  summary: {
    fontSize: "14px",
    color: "var(--text-primary)",
    lineHeight: 1.5,
  },
  meta: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: "8px",
  },
  uuid: {
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
    color: "var(--text-muted)",
  },
  tags: { display: "flex", gap: "6px" },
  tag: {
    fontSize: "11px",
    padding: "2px 8px",
    borderRadius: "10px",
    background: "rgba(59, 130, 246, 0.1)",
    color: "var(--accent-blue)",
    fontWeight: 500,
  },
};
