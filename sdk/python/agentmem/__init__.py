"""
agentmem — Persistent, queryable memory for AI agents.

Three memory types, one SDK:
  - **Semantic** (vector search): facts and knowledge the agent "knows"
  - **Episodic** (append-only log): what the agent "did"
  - **Structured** (key-value): exact data that must not be approximated

Quick start::

    from agentmem import Memory

    mem = Memory(namespace="research-assistant")

    # Semantic memory
    mem.remember("User prefers JSON output over CSV", tags=["preference"])

    # Episodic memory
    mem.log_episode(action="searched_pubmed", result_summary="Found 23 papers")

    # Structured memory
    mem.set("last_run_config", {"J": 8, "Q": 16})
    config = mem.get("last_run_config")
"""

__version__ = "0.1.0"

from agentmem.memory import Memory

__all__ = [
    "__version__",
    "Memory",
]
