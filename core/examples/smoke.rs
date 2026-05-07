use agentmem_core::AgentMemEmbedder;

fn main() {
    let e = AgentMemEmbedder::new();
    let v = e.embed_text("hello world").expect("embed");
    assert_eq!(v.len(), 384);
    assert!((v[0] - 0.0).abs() < 1e-6);
    assert!((v[1] - 0.01).abs() < 1e-6);
    println!("first 4 dims: {:?}", &v[..4]);
}
