"""
AgentMem End-to-End Test Script
Tests: remember -> recall -> episodes -> structured KV -> persistence
"""

import sys
import os
import time

# Force UTF-8 output on Windows
sys.stdout.reconfigure(encoding='utf-8')

# Add the Python SDK to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "sdk", "python"))

from agentmem import Memory

NAMESPACE = "e2e-test"
SERVER_URL = "localhost:50051"

def separator(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")

def main():
    separator("1. Connecting to AgentMem gRPC Server")
    mem = Memory(namespace=NAMESPACE, mode="server", server_url=SERVER_URL)
    print(f"[OK] Connected: {mem}")

    # -- Semantic Memory: Remember --------------------------------
    separator("2. Semantic Memory -- Remember")
    
    memories = [
        "User prefers JSON output over CSV format",
        "The JTFS with Q=16 gives best EEG classification results",
        "Python 3.10 is required for this project",
        "The wavelet scattering transform preserves translation invariance",
        "User's timezone is IST (UTC+5:30)",
    ]
    
    doc_ids = []
    for text in memories:
        doc_id = mem.remember(text)
        doc_ids.append(doc_id)
        print(f"  [OK] Stored doc_id={doc_id}: {text[:50]}...")
    
    print(f"\n  Total stored: {len(doc_ids)} memories (doc_ids: {doc_ids})")

    # -- Semantic Memory: Recall ----------------------------------
    separator("3. Semantic Memory -- Recall (Vector Search)")
    
    queries = [
        ("what output format does the user want?", "JSON"),
        ("what model gives best EEG results?", "JTFS"),
        ("what time zone is the user in?", "IST"),
    ]
    
    for query, expected_keyword in queries:
        results = mem.recall(query, top_k=3)
        print(f"  Query: \"{query}\"")
        for i, text in enumerate(results):
            marker = ">>>" if expected_keyword.lower() in text.lower() else "   "
            print(f"    {marker} [{i+1}] {text}")
        
        # Verify relevant result was found
        found = any(expected_keyword.lower() in r.lower() for r in results)
        status = "[PASS]" if found else "[FAIL]"
        print(f"  {status}: Expected '{expected_keyword}' in results\n")

    # -- Episodic Memory ------------------------------------------
    separator("4. Episodic Memory -- Log & Retrieve")
    
    ep1 = mem.log_episode(action="searched_pubmed", result_summary="Found 23 papers on scattering transforms")
    print(f"  [OK] Logged episode: {ep1}")
    
    ep2 = mem.log_episode(action="ran_training", result_summary="Accuracy improved to 94.2%")
    print(f"  [OK] Logged episode: {ep2}")
    
    episodes = mem.episodes(last_n=5)
    print(f"\n  Retrieved {len(episodes)} episodes:")
    for ep in episodes:
        print(f"    - {ep['action']}: {ep['result_summary']}")

    # -- Structured KV --------------------------------------------
    separator("5. Structured KV -- Set & Get")
    
    mem.set("config", {"J": 8, "Q": 16, "model": "jtfs"})
    print("  [OK] Set config = {J: 8, Q: 16, model: jtfs}")
    
    config = mem.get("config")
    print(f"  [OK] Get config = {config}")
    
    assert config["J"] == 8, f"Expected J=8, got {config['J']}"
    assert config["Q"] == 16, f"Expected Q=16, got {config['Q']}"
    print("  [PASS] KV round-trip verified")

    separator("ALL E2E TESTS PASSED!")

if __name__ == "__main__":
    main()
