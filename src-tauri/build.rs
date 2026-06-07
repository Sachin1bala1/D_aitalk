fn main() {
    // DuckDB (bundled, MinGW) needs libstdc++ and friends at link time.
    // We emit these here rather than in global rustflags so that the windows
    // crate (and the rest of the dep tree) can stay cached between rebuilds.
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu") {
        // DuckDB (bundled) uses std::call_once from libstdc++.
        // __once_callable / __once_call are NOT exported from libstdc++-6.dll,
        // so we must link libstdc++.a statically.
        println!("cargo:rustc-link-lib=static=stdc++");
        println!("cargo:rustc-link-lib=gcc_s");
        println!("cargo:rustc-link-lib=gcc");
    }
    tauri_build::build()
}
