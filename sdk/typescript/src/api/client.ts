/**
 * AgentMem gRPC client — connects to the Rust gRPC server.
 *
 * Used by both the dashboard (via API calls) and the CLI.
 * Currently scaffolded with type definitions; real gRPC-web
 * wiring comes in a later phase.
 */

// ── Types matching the proto definitions ────────────────────────────────────

export interface RememberRequest {
  namespace: string;
  text: string;
}

export interface RememberResponse {
  doc_id: number;
}

export interface LogEpisodeRequest {
  namespace: string;
  action: string;
  result_summary: string;
}

export interface LogEpisodeResponse {
  timestamp_ns: number;
  action_uuid: string;
}

export interface GetEpisodesRequest {
  namespace: string;
  limit: number;
}

export interface EpisodeEntry {
  action: string;
  result_summary: string;
  timestamp_ns: number;
  action_uuid: string;
}

export interface GetEpisodesResponse {
  episodes: EpisodeEntry[];
}

export interface SetKvRequest {
  namespace: string;
  key: string;
  value: Uint8Array;
}

export interface GetKvRequest {
  namespace: string;
  key: string;
}

export interface GetKvResponse {
  found: boolean;
  value: Uint8Array;
}

// ── Client class ────────────────────────────────────────────────────────────

export class AgentMemClient {
  private serverUrl: string;

  constructor(serverUrl: string = "localhost:50051") {
    this.serverUrl = serverUrl;
  }

  /**
   * Store a semantic memory.
   * TODO: Wire to real gRPC when grpc-web is integrated.
   */
  async remember(
    namespace: string,
    text: string
  ): Promise<RememberResponse> {
    const resp = await fetch("/api/remember", {
      method: "POST",
      body: JSON.stringify({ namespace, text }),
      headers: { "Content-Type": "application/json" },
    });
    return resp.json();
  }

  async logEpisode(
    namespace: string,
    action: string,
    resultSummary: string
  ): Promise<LogEpisodeResponse> {
    const resp = await fetch("/api/log_episode", {
      method: "POST",
      body: JSON.stringify({ namespace, action, result_summary: resultSummary }),
      headers: { "Content-Type": "application/json" },
    });
    return resp.json();
  }

  async getEpisodes(
    namespace: string,
    limit: number = 10
  ): Promise<GetEpisodesResponse> {
    const resp = await fetch(`/api/get_episodes?namespace=${namespace}&limit=${limit}`);
    return resp.json();
  }

  async setKv(
    namespace: string,
    key: string,
    value: Uint8Array
  ): Promise<void> {
    await fetch("/api/set_kv", {
      method: "POST",
      body: JSON.stringify({ namespace, key, value: Array.from(value) }),
      headers: { "Content-Type": "application/json" },
    });
  }

  async getKv(
    namespace: string,
    key: string
  ): Promise<GetKvResponse> {
    const resp = await fetch(`/api/get_kv?namespace=${namespace}&key=${key}`);
    const data = await resp.json();
    return { ...data, value: new Uint8Array(data.value || []) };
  }

  // Added missing recall method for the UI
  async recall(
    namespace: string,
    query: string,
    topK: number = 5
  ): Promise<any> {
    const resp = await fetch("/api/recall", {
      method: "POST",
      body: JSON.stringify({ namespace, query, top_k: topK }),
      headers: { "Content-Type": "application/json" },
    });
    return resp.json();
  }
}
