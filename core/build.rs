fn main() {
    // ── ONNX Runtime paths (cross-platform) ─────────────────────────
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();

    let ort_include = std::env::var("ORT_INCLUDE_DIR").unwrap_or_else(|_| {
        // Auto-detect: check for Windows deps first, then Mac
        let win_path = format!("{manifest_dir}/../deps/onnxruntime-win-x64-1.17.3/include");
        let mac_path = format!("{manifest_dir}/../deps/onnxruntime_mac/include");
        if std::path::Path::new(&win_path).exists() {
            win_path
        } else if std::path::Path::new(&mac_path).exists() {
            mac_path
        } else {
            // Legacy fallback for original Mac setup
            "/Users/shekhawat/Desktop/agentmem/onnxruntime_mac/include".to_string()
        }
    });

    let ort_lib = std::env::var("ORT_LIB_DIR").unwrap_or_else(|_| {
        let win_path = format!("{manifest_dir}/../deps/onnxruntime-win-x64-1.17.3/lib");
        let mac_path = format!("{manifest_dir}/../deps/onnxruntime_mac/lib");
        if std::path::Path::new(&win_path).exists() {
            win_path
        } else if std::path::Path::new(&mac_path).exists() {
            mac_path
        } else {
            "/Users/shekhawat/Desktop/agentmem/onnxruntime_mac/lib".to_string()
        }
    });

    let mut build = cxx_build::bridge("src/lib.rs");
    build
        .file("cpp/embedder.cpp")
        .include(".")
        .include(&ort_include);

    // Platform-specific C++ flags
    if cfg!(target_os = "windows") {
        build.flag_if_supported("/std:c++17");
        build.flag_if_supported("/W3");
    } else {
        build.flag_if_supported("-std=c++17");
        build.flag_if_supported("-Wall");
    }

    build.compile("agentmem_embedder");

    println!("cargo:rustc-link-search=native={ort_lib}");
    println!("cargo:rustc-link-lib=onnxruntime");

    // Platform-specific runtime library path
    if cfg!(target_os = "macos") {
        println!("cargo:rustc-link-arg=-rpath");
        println!("cargo:rustc-link-arg={ort_lib}");
    }
    // On Windows, onnxruntime.dll must be in PATH or next to the binary

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=cpp/embedder.h");
    println!("cargo:rerun-if-changed=cpp/embedder.cpp");
    println!("cargo:rerun-if-env-changed=ORT_LIB_DIR");
    println!("cargo:rerun-if-env-changed=ORT_INCLUDE_DIR");

    // ── gRPC proto compilation (added for Phase 4 server) ───────────
    tonic_build::compile_protos("proto/agentmem.proto")
        .expect("failed to compile agentmem.proto");
    println!("cargo:rerun-if-changed=proto/agentmem.proto");
}
