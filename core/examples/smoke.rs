use agentmem_core::AgentMemEmbedder;

fn main() {
    // Empty model_path → stub mode (deterministic hash-based embeddings)
    let e = AgentMemEmbedder::new("");
    assert_eq!(e.dim(), 384);

    let v1 = e.embed_text("hello world").expect("embed");
    assert_eq!(v1.len(), 384);

    // Stub mode: different text → different vector
    let v2 = e.embed_text("goodbye world").expect("embed");
    assert_ne!(v1, v2, "different texts must produce different embeddings");

    // Same text → same vector (deterministic)
    let v3 = e.embed_text("hello world").expect("embed");
    assert_eq!(v1, v3, "same text must produce identical embeddings");

    // L2 norm should be ~1.0 (normalized)
    let norm: f32 = v1.iter().map(|x| x * x).sum::<f32>().sqrt();
    assert!((norm - 1.0).abs() < 0.01, "vector should be L2-normalized, got norm={norm}");

    println!("dim: {}", e.dim());
    println!("first 4 dims: {:?}", &v1[..4]);
    println!("L2 norm: {norm}");
    println!("✓ smoke test passed");
}
