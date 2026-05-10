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
    console.log(
      `[agentmem] remember(namespace=${namespace}, text=${text.slice(0, 50)}...)`
    );
    // Placeholder — will use @grpc/grpc-js in production
    return { doc_id: 0 };
  }

  /**
   * Log an episodic event.
   */
  async logEpisode(
    namespace: string,
    action: string,
    resultSummary: string
  ): Promise<LogEpisodeResponse> {
    console.log(
      `[agentmem] logEpisode(namespace=${namespace}, action=${action})`
    );
    return {
      timestamp_ns: Date.now() * 1_000_000,
      action_uuid: crypto.randomUUID(),
    };
  }

  /**
   * Retrieve recent episodes.
   */
  async getEpisodes(
    namespace: string,
    limit: number = 10
  ): Promise<GetEpisodesResponse> {
    console.log(
      `[agentmem] getEpisodes(namespace=${namespace}, limit=${limit})`
    );
    return { episodes: [] };
  }

  /**
   * Set a structured key-value pair.
   */
  async setKv(
    namespace: string,
    key: string,
    value: Uint8Array
  ): Promise<void> {
    console.log(`[agentmem] setKv(namespace=${namespace}, key=${key})`);
  }

  /**
   * Get a structured value by key.
   */
  async getKv(
    namespace: string,
    key: string
  ): Promise<GetKvResponse> {
    console.log(`[agentmem] getKv(namespace=${namespace}, key=${key})`);
    return { found: false, value: new Uint8Array() };
  }
}
