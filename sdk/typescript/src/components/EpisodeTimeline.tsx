import React, { useState, useEffect } from "react";
import { AgentMemClient } from "../api/client";

interface Props {
  namespace: string;
  serverUrl: string;
}

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
  const [episodes, setEpisodes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const client = new AgentMemClient(serverUrl);

  const fetchEpisodes = async () => {
    setLoading(true);
    try {
      const resp = await client.getEpisodes(namespace, lastN);
      setEpisodes(resp.episodes || []);
    } catch (e) {
      console.error("Failed to fetch episodes:", e);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchEpisodes();
  }, [namespace]);

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
        <button style={styles.refreshButton} onClick={fetchEpisodes} disabled={loading}>
          {loading ? "..." : "↻ Refresh"}
        </button>
      </div>

      {/* ── Timeline ──────────────────────────────────────────── */}
      <div style={styles.timeline}>
        {episodes.map((ep, i) => (
          <div key={i} style={styles.timelineItem}>
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
              {i < episodes.length - 1 && (
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
                  {ep.action_uuid?.slice(0, 8)}…
                </span>
              </div>
            </div>
          </div>
        ))}
        {episodes.length === 0 && !loading && (
          <p style={styles.hint}>No episodes found in this namespace.</p>
        )}
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
