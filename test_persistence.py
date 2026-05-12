"""
AgentMem Persistence Test
=========================
1. Insert 50 memories into the gRPC server
2. Kill the server process
3. Restart the server
4. Recall memories -- verify data survived the crash
"""

import sys
import os
import time
import subprocess
import signal

sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "sdk", "python"))

from agentmem import Memory

NAMESPACE = "persistence-test"
SERVER_URL = "localhost:50051"
MODEL_PATH = r"c:\Users\muska\OneDrive\Desktop\external\AgentMem\deps\models\bge-small-en-v1.5.onnx"
DB_PATH = r"c:\Users\muska\OneDrive\Desktop\external\AgentMem\data\agentmem_db"
SERVER_EXE = r"c:\Users\muska\OneDrive\Desktop\external\AgentMem\core\target\release\agentmem-server.exe"

def separator(title: str):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}\n")

def wait_for_server(url, timeout=15):
    """Wait until the gRPC server is accepting connections."""
    import grpc
    start = time.time()
    while time.time() - start < timeout:
        try:
            channel = grpc.insecure_channel(url)
            grpc.channel_ready_future(channel).result(timeout=2)
            channel.close()
            return True
        except Exception:
            time.sleep(0.5)
    return False

def kill_server():
    """Kill the agentmem-server process."""
    import subprocess
    result = subprocess.run(
        ["taskkill", "/F", "/IM", "agentmem-server.exe"],
        capture_output=True, text=True
    )
    print(f"  Kill result: {result.stdout.strip()}")
    time.sleep(1)

def start_server():
    """Start the agentmem-server process in background."""
    env = os.environ.copy()
    env["AGENTMEM_MODEL_PATH"] = MODEL_PATH
    env["AGENTMEM_DB_PATH"] = DB_PATH
    proc = subprocess.Popen(
        [SERVER_EXE],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    print(f"  Started server PID={proc.pid}")
    return proc

def main():
    separator("PERSISTENCE TEST: 50 Memories -> Kill -> Restart -> Recall")

    # ---- Phase 1: Insert 50 memories ----
    separator("Phase 1: Inserting 50 memories")
    
    mem = Memory(namespace=NAMESPACE, mode="server", server_url=SERVER_URL)
    
    topics = [
        "machine learning", "neural networks", "gradient descent",
        "transformers", "attention mechanism", "BERT model",
        "GPT architecture", "reinforcement learning", "Q-learning",
        "convolutional networks", "recurrent networks", "LSTM cells",
        "batch normalization", "dropout regularization", "learning rate",
        "backpropagation", "loss functions", "cross entropy",
        "softmax activation", "ReLU activation", "sigmoid function",
        "data augmentation", "transfer learning", "fine tuning",
        "embedding layers", "word2vec model", "GloVe embeddings",
        "tokenization", "beam search", "greedy decoding",
        "encoder decoder", "self attention", "multi head attention",
        "positional encoding", "layer normalization", "residual connections",
        "knowledge distillation", "model pruning", "quantization",
        "federated learning", "differential privacy", "adversarial training",
        "GAN networks", "VAE models", "diffusion models",
        "contrastive learning", "CLIP model", "vision transformers",
        "object detection", "semantic segmentation", "image classification",
    ]
    
    doc_ids = []
    for i, topic in enumerate(topics):
        text = f"Memory #{i}: The concept of {topic} is fundamental to modern AI research and applications."
        doc_id = mem.remember(text)
        doc_ids.append(doc_id)
        if (i + 1) % 10 == 0:
            print(f"  Inserted {i+1}/50 memories (latest doc_id={doc_id})")
    
    print(f"\n  [OK] All 50 memories inserted! doc_ids: {doc_ids[0]}..{doc_ids[-1]}")

    # Quick sanity check before killing
    print("\n  Sanity check before kill:")
    results = mem.recall("attention mechanism in transformers", top_k=3)
    for i, text in enumerate(results):
        print(f"    [{i+1}] {text[:70]}...")

    # ---- Phase 2: Kill the server ----
    separator("Phase 2: KILLING the server")
    
    # Close the gRPC channel first
    if mem._channel:
        mem._channel.close()
        mem._channel = None
    
    kill_server()
    print("  [OK] Server killed!")
    time.sleep(2)

    # ---- Phase 3: Restart the server ----
    separator("Phase 3: RESTARTING the server")
    
    proc = start_server()
    
    print("  Waiting for server to be ready...")
    if wait_for_server(SERVER_URL):
        print("  [OK] Server is back online!")
    else:
        print("  [FAIL] Server did not come back up in time!")
        proc.kill()
        sys.exit(1)

    # ---- Phase 4: Recall memories ----
    separator("Phase 4: RECALLING memories after restart")
    
    # Create a fresh Memory instance
    mem2 = Memory(namespace=NAMESPACE, mode="server", server_url=SERVER_URL)
    
    test_queries = [
        ("attention mechanism in transformers", "attention"),
        ("gradient descent optimization", "gradient"),
        ("image classification and object detection", "object detection"),
        ("generative adversarial networks", "GAN"),
        ("recurrent neural networks and LSTM", "LSTM"),
    ]
    
    all_passed = True
    for query, expected in test_queries:
        results = mem2.recall(query, top_k=3)
        found = any(expected.lower() in r.lower() for r in results)
        status = "[PASS]" if found else "[FAIL]"
        if not found:
            all_passed = False
        
        print(f"  {status} Query: \"{query}\"")
        for i, text in enumerate(results):
            marker = ">>>" if expected.lower() in text.lower() else "   "
            print(f"         {marker} [{i+1}] {text[:70]}...")
        print()

    # ---- Summary ----
    separator("PERSISTENCE TEST RESULT")
    
    if all_passed:
        print("  *** ALL QUERIES RETURNED CORRECT RESULTS AFTER RESTART! ***")
        print("  RocksDB persistence + HNSW index restoration: VERIFIED!")
        print("  The data survived a hard kill and full server restart.")
    else:
        print("  SOME QUERIES FAILED -- Persistence may have issues.")
    
    # Clean up: kill the server we started
    proc.terminate()
    print("\n  Server terminated. Test complete.")

if __name__ == "__main__":
    main()
