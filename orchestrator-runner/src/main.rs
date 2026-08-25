mod embedded;
mod executor;
mod log;
mod model;
mod runtime;

use anyhow::{Context, Result, bail};
use log::Logger;
use model::ParsedFlow;
use serde_json::Value;
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    if let Err(error) = real_main() {
        eprintln!("\x1b[31m[error]\x1b[0m {error:#}");
        std::process::exit(1);
    }
}

fn real_main() -> Result<()> {
    let log = Logger::new();
    let exe = env::current_exe().context("cannot locate runner executable")?;
    embedded::cleanup_backup(&exe);
    let cwd = exe
        .parent()
        .context("runner executable has no parent directory")?
        .to_path_buf();
    env::set_current_dir(&cwd)
        .with_context(|| format!("cannot use {} as execution directory", cwd.display()))?;
    let mut args = env::args_os();
    let _ = args.next();
    let first = args.next();
    if first.as_deref() == Some("--help".as_ref()) || first.as_deref() == Some("-h".as_ref()) {
        print_help();
        return Ok(());
    }
    if args.next().is_some() {
        bail!("usage: runner[.exe] [flow.or]");
    }
    let bytes = if let Some(path) = first {
        let path = PathBuf::from(path);
        let bytes = fs::read(&path).with_context(|| format!("cannot read {}", path.display()))?;
        ParsedFlow::parse(&bytes)?;
        embedded::embed(&exe, &bytes)?;
        log.info(&format!(
            "embedded {} into {}",
            path.display(),
            exe.display()
        ));
        bytes
    } else {
        embedded::read_embedded(&exe)?
            .context("no embedded flow; run runner.exe <flow.or> first")?
    };
    let flow = ParsedFlow::parse(&bytes)?;
    log.info(&format!("execution directory: {}", cwd.display()));
    let output = executor::run(flow, &cwd, Value::Null, &log)?;
    log.success(&format!(
        "flow completed: {}",
        serde_json::to_string_pretty(&output)?
    ));
    Ok(())
}

fn print_help() {
    println!(
        "orchestrator-runner\n\nUsage:\n  runner.exe flow.or   Execute and embed flow.or\n  runner.exe           Execute the last embedded flow\n\nSecrets are read from environment variables. NO_COLOR disables ANSI colors."
    );
}
