import React, { useState } from "react";
import { MemoryExplorer } from "./components/MemoryExplorer";
import { EpisodeTimeline } from "./components/EpisodeTimeline";
import { KvInspector } from "./components/KvInspector";

type Tab = "semantic" | "episodic" | "structured";

const TABS: { id: Tab; label: string; icon: string; color: string }[] = [
  { id: "semantic", label: "Semantic Memory", icon: "🧠", color: "var(--accent-purple)" },
  { id: "episodic", label: "Episode Timeline", icon: "📜", color: "var(--accent-blue)" },
  { id: "structured", label: "Structured KV", icon: "🔑", color: "var(--accent-emerald)" },
];

export function App() {
  const [activeTab, setActiveTab] = useState<Tab>("semantic");
  const [namespace, setNamespace] = useState("research-assistant");
  const [serverUrl, setServerUrl] = useState("localhost:50051");

  return (
    <div style={styles.container}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>
            <span style={styles.logoIcon}>◆</span>
            <h1 style={styles.logoText}>AgentMem</h1>
            <span style={styles.badge}>Explorer</span>
          </div>
          <p style={styles.tagline}>Memory Explorer Dashboard</p>
        </div>
        <div style={styles.headerRight}>
          <div style={styles.inputGroup}>
            <label style={styles.inputLabel}>Namespace</label>
            <input
              style={styles.input}
              value={namespace}
              onChange={(e) => setNamespace(e.target.value)}
              placeholder="agent namespace"
            />
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.inputLabel}>Server</label>
            <input
              style={styles.input}
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="localhost:50051"
            />
          </div>
          <div style={styles.statusDot} title="Server status" />
        </div>
      </header>

      {/* ── Tab Navigation ──────────────────────────────────────── */}
      <nav style={styles.nav}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tab,
              ...(activeTab === tab.id ? styles.tabActive : {}),
              borderBottomColor:
                activeTab === tab.id ? tab.color : "transparent",
            }}
          >
            <span style={styles.tabIcon}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      {/* ── Content ─────────────────────────────────────────────── */}
      <main style={styles.main}>
        {activeTab === "semantic" && (
          <MemoryExplorer namespace={namespace} serverUrl={serverUrl} />
        )}
        {activeTab === "episodic" && (
          <EpisodeTimeline namespace={namespace} serverUrl={serverUrl} />
        )}
        {activeTab === "structured" && (
          <KvInspector namespace={namespace} serverUrl={serverUrl} />
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer style={styles.footer}>
        <span style={styles.footerText}>
          AgentMem v0.1.0 — Three memory types, one SDK
        </span>
        <span style={styles.footerText}>
          🔗 Connected to {serverUrl}
        </span>
      </footer>
    </div>
  );
}

// ── Inline styles (no CSS framework dependency) ──────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    background: "var(--bg-primary)",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "20px 32px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    backdropFilter: "blur(20px)",
  },
  headerLeft: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
  },
  logo: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
  },
  logoIcon: {
    fontSize: "24px",
    background: "var(--gradient-purple)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  logoText: {
    fontSize: "22px",
    fontWeight: 700,
    letterSpacing: "-0.02em",
    color: "var(--text-primary)",
  },
  badge: {
    fontSize: "11px",
    fontWeight: 600,
    padding: "2px 8px",
    borderRadius: "20px",
    background: "rgba(139, 92, 246, 0.15)",
    color: "var(--accent-purple)",
    letterSpacing: "0.05em",
    textTransform: "uppercase" as const,
  },
  tagline: {
    fontSize: "13px",
    color: "var(--text-muted)",
  },
  inputGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  inputLabel: {
    fontSize: "10px",
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
  input: {
    background: "var(--bg-tertiary)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    padding: "6px 12px",
    color: "var(--text-primary)",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    outline: "none",
    width: "180px",
    transition: "border-color 0.2s",
  },
  statusDot: {
    width: "10px",
    height: "10px",
    borderRadius: "50%",
    background: "var(--accent-emerald)",
    boxShadow: "0 0 8px rgba(16, 185, 129, 0.5)",
    marginTop: "16px",
  },
  nav: {
    display: "flex",
    gap: "0",
    padding: "0 32px",
    background: "var(--bg-secondary)",
    borderBottom: "1px solid var(--border)",
  },
  tab: {
    padding: "14px 24px",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    color: "var(--text-secondary)",
    fontSize: "14px",
    fontWeight: 500,
    fontFamily: "var(--font-sans)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "all 0.2s",
  },
  tabActive: {
    color: "var(--text-primary)",
  },
  tabIcon: {
    fontSize: "16px",
  },
  main: {
    flex: 1,
    padding: "24px 32px",
    overflow: "auto",
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    padding: "12px 32px",
    borderTop: "1px solid var(--border)",
    background: "var(--bg-secondary)",
  },
  footerText: {
    fontSize: "12px",
    color: "var(--text-muted)",
  },
};
