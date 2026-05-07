fn main() {
    let ort_include = "/Users/shekhawat/Desktop/agentmem/onnxruntime_mac/include";
    let ort_lib = if let Ok(dir) = std::env::var("ORT_LIB_DIR") {
        dir
    } else {
        "/Users/shekhawat/Desktop/agentmem/onnxruntime_mac/lib".to_string()
    };

    cxx_build::bridge("src/lib.rs")
        .file("cpp/embedder.cpp")
        .include(".")
        .include(ort_include)
        .flag_if_supported("-std=c++17")
        .flag_if_supported("-Wall")
        .compile("agentmem_embedder");

    println!("cargo:rustc-link-search=native={ort_lib}");
    println!("cargo:rustc-link-lib=onnxruntime");
    // Embed rpath so the dylib is found at runtime without DYLD_LIBRARY_PATH
    println!("cargo:rustc-link-arg=-rpath");
    println!("cargo:rustc-link-arg={ort_lib}");

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=cpp/embedder.h");
    println!("cargo:rerun-if-changed=cpp/embedder.cpp");
    println!("cargo:rerun-if-env-changed=ORT_LIB_DIR");
}
