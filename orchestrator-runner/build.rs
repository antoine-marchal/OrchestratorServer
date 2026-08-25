use std::env;

fn main() {
    println!("cargo:rerun-if-changed=assets/icon.ico");
    println!("cargo:rerun-if-changed=Cargo.toml");

    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }

    let package_version = env::var("CARGO_PKG_VERSION").expect("Cargo package version is missing");
    let numeric_version = numeric_version(&package_version);
    let copyright = "Copyright (c) 2026 Antoine Marchal";

    let mut resource = winresource::WindowsResource::new();
    resource
        .set_icon("assets/icon.ico")
        .set_language(0x0409)
        .set("FileDescription", "Orchestrator Standalone Flow Runner")
        .set("ProductName", "Orchestrator Runner")
        .set("CompanyName", "Antoine Marchal")
        .set("LegalCopyright", copyright)
        .set("OriginalFilename", "runner.exe")
        .set("InternalName", "orchestrator-runner")
        .set("FileVersion", &package_version)
        .set("ProductVersion", &package_version)
        .set(
            "Comments",
            "Executes and embeds standalone Orchestrator .or flows",
        )
        .set_version_info(winresource::VersionInfo::FILEVERSION, numeric_version)
        .set_version_info(winresource::VersionInfo::PRODUCTVERSION, numeric_version)
        .compile()
        .expect("failed to compile Windows icon and version resources");
}

fn numeric_version(version: &str) -> u64 {
    let mut parts = version
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| !part.is_empty())
        .filter_map(|part| part.parse::<u16>().ok());
    let major = parts.next().unwrap_or(0) as u64;
    let minor = parts.next().unwrap_or(0) as u64;
    let patch = parts.next().unwrap_or(0) as u64;
    let build = parts.next().unwrap_or(0) as u64;
    (major << 48) | (minor << 32) | (patch << 16) | build
}

#[cfg(test)]
mod tests {
    use super::numeric_version;

    #[test]
    fn encodes_windows_four_part_version() {
        assert_eq!(numeric_version("1.2.3"), 0x0001_0002_0003_0000);
    }
}
