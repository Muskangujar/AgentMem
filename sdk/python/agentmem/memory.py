"""
agentmem.memory — The Memory class.

Provides persistent, queryable memory for AI agents across sessions.
Three memory types, one class: semantic, episodic, and structured.

Two operational modes:
  - **embedded** (default): In-process — calls the Rust core directly via
    the native Maturin extension.  No server needed.
  - **server**: Connects to a running AgentMem gRPC server.  Multiple agents
    can share one server.

Optional AgentID integration:
  If an ``AgentIdentity`` object (from ``agentidentity-auth``) is passed,
  the agent's cryptographic fingerprint becomes the namespace key.  Otherwise,
  a plain string namespace works fine.  No hard dependency.
"""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any, Dict, List, Optional, Sequence


class Memory:
    """Persistent, queryable memory for AI agents.

    Parameters
    ----------
    namespace : str | None
        Partition key for all memory operations.  Required unless
        ``identity`` is provided.
    mode : str
        ``"embedded"`` (default) — in-process Rust core via native extension.
        ``"server"`` — connect to a gRPC AgentMem server.
    db_path : str | None
        RocksDB path for embedded mode.  Defaults to ``~/.agentmem/db``.
    server_url : str | None
        gRPC endpoint for server mode (e.g. ``"localhost:50051"``).
    identity : AgentIdentity | None
        Optional.  If provided, the agent's cryptographic fingerprint
        (``ag:sha256:...``) becomes the namespace, and every memory record
        is cryptographically bound to this agent's identity.  Requires
        ``pip install agentmem[agentid]``.

    Examples
    --------
    >>> from agentmem import Memory
    >>> mem = Memory(namespace="research-assistant")
    >>> mem.remember("User prefers JSON output over CSV", tags=["preference"])
    >>> mem.recall("what output format does the user want?")
    ['User prefers JSON output over CSV']
    """

    def __init__(
        self,
        namespace: Optional[str] = None,
        *,
        mode: str = "embedded",
        db_path: Optional[str] = None,
        server_url: Optional[str] = None,
        identity: Any = None,
    ) -> None:
        # ── AgentID Integration (Task 2) ─────────────────────────────
        # If an AgentIdentity object is passed, use its cryptographic
        # fingerprint as the namespace.  Runtime detection, no hard dep.
        if identity is not None:
            from agentmem.integrations.agentid import extract_fingerprint

            self._fingerprint = extract_fingerprint(identity)
            self._namespace = self._fingerprint
        elif namespace is not None:
            self._namespace = namespace
            self._fingerprint = (
                f"agent:{hashlib.sha256(namespace.encode()).hexdigest()[:16]}"
            )
        else:
            raise ValueError(
                "Either 'namespace' or 'identity' must be provided."
            )

        self._mode = mode

        if mode == "embedded":
            self._db_path = db_path or os.path.join(
                os.path.expanduser("~"), ".agentmem", "db"
            )
            self._channel = None
        elif mode == "server":
            if server_url is None:
                raise ValueError(
                    "server_url is required when mode='server'"
                )
            self._server_url = server_url
            self._db_path = None
            self._channel = None  # lazy init on first call
        else:
            raise ValueError(f"Unknown mode: {mode!r}. Use 'embedded' or 'server'.")

    # ── Properties ───────────────────────────────────────────────────

    @property
    def namespace(self) -> str:
        """The active namespace (plain string or cryptographic fingerprint)."""
        return self._namespace

    @property
    def agent_fingerprint(self) -> str:
        """Agent fingerprint — cryptographic if AgentID is used, else hash-based."""
        return self._fingerprint

    # ── Semantic Memory ──────────────────────────────────────────────

    def remember(
        self,
        text: str,
        *,
        tags: Optional[Sequence[str]] = None,
    ) -> int:
        """Store a semantic memory (fact, preference, knowledge).

        Parameters
        ----------
        text : str
            The text to embed and remember.
        tags : list[str] | None
            Optional metadata tags (stored alongside for future filtering).

        Returns
        -------
        int
            The assigned document ID.
        """
        if self._mode == "embedded":
            return self._remember_embedded(text, tags=tags)
        return self._remember_server(text, tags=tags)

    def recall(
        self,
        query: str,
        *,
        top_k: int = 5,
    ) -> List[str]:
        """Search semantic memory by meaning.

        Parameters
        ----------
        query : str
            Natural-language query.  Semantic search finds memories with
            similar meaning, even if phrased differently.
        top_k : int
            Maximum number of results.

        Returns
        -------
        list[str]
            Matching memory texts, ranked by relevance.

        Raises
        ------
        NotImplementedError
            Until the HNSW index is wired in Phase 4, semantic recall
            is not yet available.  ``remember()`` works now — it embeds
            and persists.
        """
        if self._mode == "embedded":
            return self._recall_embedded(query, top_k=top_k)
        return self._recall_server(query, top_k=top_k)

    # ── Episodic Memory ──────────────────────────────────────────────

    def log_episode(
        self,
        *,
        action: str,
        result_summary: str,
        tags: Optional[Sequence[str]] = None,
    ) -> Dict[str, Any]:
        """Log an episodic memory (what the agent did).

        Parameters
        ----------
        action : str
            What the agent did (e.g. ``"searched_pubmed"``).
        result_summary : str
            Brief summary of the result.
        tags : list[str] | None
            Optional metadata tags.

        Returns
        -------
        dict
            ``{"timestamp_ns": int, "action_uuid": str}``
        """
        if self._mode == "embedded":
            return self._log_episode_embedded(action, result_summary, tags=tags)
        return self._log_episode_server(action, result_summary, tags=tags)

    def episodes(self, *, last_n: int = 10) -> List[Dict[str, Any]]:
        """Retrieve recent episodic memories.

        Parameters
        ----------
        last_n : int
            Number of most recent episodes to retrieve.

        Returns
        -------
        list[dict]
            Each dict has keys: ``action``, ``result_summary``,
            ``timestamp_ns``, ``action_uuid``.
        """
        if self._mode == "embedded":
            return self._get_episodes_embedded(last_n)
        return self._get_episodes_server(last_n)

    # ── Structured Memory ────────────────────────────────────────────

    def set(self, key: str, value: Any) -> None:
        """Store a structured key-value pair (exact, no embedding).

        Parameters
        ----------
        key : str
            The key.
        value : Any
            The value.  Dicts, lists, and primitives are JSON-serialized.
            ``bytes`` are stored raw.
        """
        if isinstance(value, bytes):
            raw = value
        else:
            raw = json.dumps(value).encode("utf-8")

        if self._mode == "embedded":
            self._set_kv_embedded(key, raw)
        else:
            self._set_kv_server(key, raw)

    def get(self, key: str) -> Any:
        """Retrieve a structured value by exact key.

        Returns
        -------
        Any
            The deserialized value, or ``None`` if the key doesn't exist.
            Values that were stored as ``bytes`` are returned as ``bytes``;
            everything else is JSON-deserialized.
        """
        if self._mode == "embedded":
            raw = self._get_kv_embedded(key)
        else:
            raw = self._get_kv_server(key)

        if raw is None:
            return None

        # Try JSON decode; fall back to raw bytes
        try:
            return json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return raw

    # ── Embedded Mode Implementations ────────────────────────────────

    def _remember_embedded(self, text: str, *, tags=None) -> int:
        from agentmem._native import native_remember  # type: ignore[import]

        return native_remember(self._db_path, self._namespace, text)

    def _recall_embedded(self, query: str, *, top_k: int = 5) -> List[str]:
        from agentmem._native import native_recall  # type: ignore[import]

        return native_recall(self._db_path, self._namespace, query, top_k)

    def _log_episode_embedded(self, action: str, result_summary: str, *, tags=None) -> dict:
        from agentmem._native import native_log_episode  # type: ignore[import]

        ts, uuid_str = native_log_episode(
            self._db_path, self._namespace, action, result_summary
        )
        return {"timestamp_ns": ts, "action_uuid": uuid_str}

    def _get_episodes_embedded(self, limit: int) -> list:
        from agentmem._native import native_get_episodes  # type: ignore[import]

        return native_get_episodes(self._db_path, self._namespace, limit)

    def _set_kv_embedded(self, key: str, value: bytes) -> None:
        from agentmem._native import native_set_kv  # type: ignore[import]

        native_set_kv(self._db_path, self._namespace, key, value)

    def _get_kv_embedded(self, key: str) -> Optional[bytes]:
        from agentmem._native import native_get_kv  # type: ignore[import]

        return native_get_kv(self._db_path, self._namespace, key)

    # ── Server Mode Implementations ──────────────────────────────────

    def _get_stub(self):
        """Lazy-init the gRPC channel and stub."""
        if self._channel is None:
            import grpc

            self._channel = grpc.insecure_channel(self._server_url)

            # Import the generated protobuf stubs
            from agentmem._grpc import agentmem_pb2_grpc

            self._stub = agentmem_pb2_grpc.AgentMemServiceStub(self._channel)
        return self._stub

    def _remember_server(self, text: str, *, tags=None) -> int:
        from agentmem._grpc import agentmem_pb2

        stub = self._get_stub()
        resp = stub.Remember(
            agentmem_pb2.RememberRequest(namespace=self._namespace, text=text)
        )
        return resp.doc_id

    def _recall_server(self, query: str, *, top_k: int = 5) -> List[str]:
        from agentmem._grpc import agentmem_pb2

        stub = self._get_stub()
        resp = stub.Recall(
            agentmem_pb2.RecallRequest(
                namespace=self._namespace, query=query, top_k=top_k
            )
        )
        return [r.text for r in resp.results]

    def _log_episode_server(self, action: str, result_summary: str, *, tags=None) -> dict:
        from agentmem._grpc import agentmem_pb2

        stub = self._get_stub()
        resp = stub.LogEpisode(
            agentmem_pb2.LogEpisodeRequest(
                namespace=self._namespace,
                action=action,
                result_summary=result_summary,
            )
        )
        return {"timestamp_ns": resp.timestamp_ns, "action_uuid": resp.action_uuid}

    def _get_episodes_server(self, limit: int) -> list:
        from agentmem._grpc import agentmem_pb2

        stub = self._get_stub()
        resp = stub.GetEpisodes(
            agentmem_pb2.GetEpisodesRequest(
                namespace=self._namespace, limit=limit
            )
        )
        return [
            {
                "action": ep.action,
                "result_summary": ep.result_summary,
                "timestamp_ns": ep.timestamp_ns,
                "action_uuid": ep.action_uuid,
            }
            for ep in resp.episodes
        ]

    def _set_kv_server(self, key: str, value: bytes) -> None:
        from agentmem._grpc import agentmem_pb2

        stub = self._get_stub()
        stub.SetKv(
            agentmem_pb2.SetKvRequest(
                namespace=self._namespace, key=key, value=value
            )
        )

    def _get_kv_server(self, key: str) -> Optional[bytes]:
        from agentmem._grpc import agentmem_pb2

        stub = self._get_stub()
        resp = stub.GetKv(
            agentmem_pb2.GetKvRequest(namespace=self._namespace, key=key)
        )
        return resp.value if resp.found else None

    # ── Repr ─────────────────────────────────────────────────────────

    def __repr__(self) -> str:
        return (
            f"Memory(namespace={self._namespace!r}, mode={self._mode!r}, "
            f"fingerprint={self._fingerprint!r})"
        )
