use crate::log::Logger;
use crate::model::{Node, data_str, node_type};
use anyhow::{Context, Result, bail};
use serde_json::{Map, Value, json};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub struct Runtime<'a> {
    cwd: &'a Path,
    scratch: &'a Path,
    log: &'a Logger,
}

pub struct NodeResult {
    pub output: Value,
    pub variables: Map<String, Value>,
}

impl<'a> Runtime<'a> {
    pub fn new(cwd: &'a Path, scratch: &'a Path, log: &'a Logger) -> Self {
        Self { cwd, scratch, log }
    }

    pub fn cwd(&self) -> &'a Path {
        self.cwd
    }

    pub fn execute(
        &self,
        node: &Node,
        input: &Value,
        variables: &mut Map<String, Value>,
    ) -> Result<NodeResult> {
        let kind = node_type(node);
        let code = resolve_secrets(data_str(node, "code"), self.log)?;
        let timeout = node
            .data
            .get("timeout")
            .and_then(value_u64)
            .map(Duration::from_secs);
        match kind {
            "javascript" | "jsbackend" => self.javascript(&code, input, variables, timeout),
            "python" => self.python(&code, input, variables, timeout),
            "powershell" => self.powershell(&code, input, variables, timeout),
            "batch" => self.batch(&code, input, variables, timeout),
            "shell" | "bash" => self.shell(&code, input, variables, timeout),
            "groovy" => self.groovy(&code, input, variables, timeout),
            "comment" => Ok(NodeResult {
                output: input.clone(),
                variables: variables.clone(),
            }),
            _ => bail!("unsupported node type on this runner: {kind}"),
        }
    }

    pub fn eval_condition(
        &self,
        expression: &str,
        input: &Value,
        variables: &Map<String, Value>,
    ) -> bool {
        let script = format!(
            "const input={}; const ninput=(typeof input==='string' && input.trim()!=='' && !isNaN(+input))?+input:input; const __vars__={}; for(const [k,v] of Object.entries(__vars__)) globalThis[k]=v; process.exit(({})?0:1);",
            input,
            Value::Object(variables.clone()),
            expression.trim().trim_end_matches(';')
        );
        Command::new(node_command())
            .arg("-e")
            .arg(script)
            .current_dir(self.cwd)
            .status()
            .is_ok_and(|s| s.success())
    }

    fn javascript(
        &self,
        code: &str,
        input: &Value,
        vars: &mut Map<String, Value>,
        timeout: Option<Duration>,
    ) -> Result<NodeResult> {
        let files = Sidecars::new(self.scratch, "js", "mjs")?;
        let code = rewrite_static_imports(code, |specifier| self.resolve_node_import(specifier));
        let declarations = vars
            .keys()
            .map(|n| format!("let {n}=__variables[{}];", json!(n)))
            .collect::<Vec<_>>()
            .join("\n");
        let captures = vars
            .keys()
            .map(|n| format!("__variables[{}]={n};", json!(n)))
            .collect::<Vec<_>>()
            .join("\n");
        let script = format!(
            r#"import fs from 'node:fs';
const input={input}; const __variables={vars}; {declarations}
let output=null; let __returned;
try {{ __returned=await(async()=>{{ {code} }})(); if(__returned!==undefined) output=__returned; }}
finally {{ {captures} fs.writeFileSync({vars_path},JSON.stringify(__variables)); }}
fs.writeFileSync({output_path},JSON.stringify(output));
"#,
            input = input,
            vars = Value::Object(vars.clone()),
            vars_path = json!(files.vars),
            output_path = json!(files.output)
        );
        fs::write(&files.script, script)?;
        self.finish_process(
            Command::new(node_command()).arg(&files.script),
            &files,
            timeout,
            vars,
        )
    }

    fn python(
        &self,
        code: &str,
        input: &Value,
        vars: &mut Map<String, Value>,
        timeout: Option<Duration>,
    ) -> Result<NodeResult> {
        let files = Sidecars::new(self.scratch, "py", "py")?;
        let loads = vars
            .keys()
            .map(|n| format!("{n} = __variables.get({})", json!(n)))
            .collect::<Vec<_>>()
            .join("\n");
        let entries = vars
            .keys()
            .map(|n| format!("{}: {n}", json!(n)))
            .collect::<Vec<_>>()
            .join(",");
        let script = format!(
            r#"import json
input=json.loads({input})
__variables=json.loads({vars})
{loads}
output=None
{code}
with open({vars_path},'w',encoding='utf-8') as f: json.dump({{{entries}}},f)
with open({output_path},'w',encoding='utf-8') as f: json.dump(output,f)
"#,
            input = json!(input.to_string()),
            vars = json!(Value::Object(vars.clone()).to_string()),
            vars_path = json!(files.vars),
            output_path = json!(files.output)
        );
        fs::write(&files.script, script)?;
        self.finish_process(
            Command::new("python").arg(&files.script),
            &files,
            timeout,
            vars,
        )
    }

    fn powershell(
        &self,
        code: &str,
        input: &Value,
        vars: &mut Map<String, Value>,
        timeout: Option<Duration>,
    ) -> Result<NodeResult> {
        let files = Sidecars::new(self.scratch, "ps", "ps1")?;
        fs::write(&files.vars, Value::Object(vars.clone()).to_string())?;
        let loads = vars
            .keys()
            .map(|n| format!("${n}=$__variables.{}", n))
            .collect::<Vec<_>>()
            .join("\n");
        let captures = vars
            .keys()
            .map(|n| format!("'{}'=${n}", n.replace('\'', "''")))
            .collect::<Vec<_>>()
            .join(";");
        let script = format!(
            "$__variables=Get-Content -Raw -LiteralPath {vp}|ConvertFrom-Json\n{loads}\n$env:INPUT={input}\n$env:OUTPUT={op}\n{code}\n@{{{captures}}}|ConvertTo-Json -Depth 50|Set-Content -LiteralPath {vp}\n",
            vp = ps_quote(&files.vars),
            op = ps_quote(&files.output),
            input = ps_quote_text(&string_input(input))
        );
        fs::write(&files.script, script)?;
        let shell = if cfg!(windows) {
            "powershell.exe"
        } else {
            "pwsh"
        };
        self.finish_process(
            Command::new(shell)
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                ])
                .arg(&files.script),
            &files,
            timeout,
            vars,
        )
    }

    fn batch(
        &self,
        code: &str,
        input: &Value,
        vars: &mut Map<String, Value>,
        timeout: Option<Duration>,
    ) -> Result<NodeResult> {
        if !cfg!(windows) {
            bail!("batch nodes are only supported on Windows");
        }
        let files = Sidecars::new(self.scratch, "bat", "bat")?;
        let envs = scalar_env(vars, "set ", "=");
        let script = format!(
            "@echo off\r\n{envs}\r\nset INPUT={}\r\nset OUTPUT={}\r\n{code}\r\n",
            string_input(input),
            files.output.display()
        );
        fs::write(&files.script, script)?;
        self.finish_process(
            Command::new("cmd.exe").arg("/c").arg(&files.script),
            &files,
            timeout,
            vars,
        )
    }

    fn shell(
        &self,
        code: &str,
        input: &Value,
        vars: &mut Map<String, Value>,
        timeout: Option<Duration>,
    ) -> Result<NodeResult> {
        if cfg!(windows) {
            bail!("shell nodes are not supported on Windows; use PowerShell or Batch");
        }
        let files = Sidecars::new(self.scratch, "sh", "sh")?;
        let envs = scalar_env(vars, "export ", "=");
        let script = format!(
            "#!/usr/bin/env bash\nset -e\n{envs}\nexport INPUT={}\nexport OUTPUT={}\n{code}\n",
            sh_quote(&string_input(input)),
            sh_quote(&files.output.to_string_lossy())
        );
        fs::write(&files.script, script)?;
        self.finish_process(
            Command::new("bash").arg(&files.script),
            &files,
            timeout,
            vars,
        )
    }

    fn groovy(
        &self,
        code: &str,
        input: &Value,
        vars: &mut Map<String, Value>,
        timeout: Option<Duration>,
    ) -> Result<NodeResult> {
        let files = Sidecars::new(self.scratch, "groovy", "groovy")?;
        let loads = vars
            .keys()
            .map(|n| format!("def {n}=__variables[{}]", json!(n)))
            .collect::<Vec<_>>()
            .join("\n");
        let captures = vars
            .keys()
            .map(|n| format!("{}:{n}", json!(n)))
            .collect::<Vec<_>>()
            .join(",");
        let script = format!(
            "import groovy.json.*\ndef input=new JsonSlurper().parseText({})\ndef __variables=new JsonSlurper().parseText({})\n{loads}\ndef output=null\n{code}\nnew File({}).text=JsonOutput.toJson([{captures}])\nnew File({}).text=JsonOutput.toJson(output)\n",
            json!(input.to_string()),
            json!(Value::Object(vars.clone()).to_string()),
            json!(files.vars),
            json!(files.output)
        );
        fs::write(&files.script, script)?;
        if command_available("groovy", "--version") {
            self.finish_process(
                Command::new("groovy").arg(&files.script),
                &files,
                timeout,
                vars,
            )
        } else {
            let jar = self.resolve_groovy_jar().context(
                "groovy command is unavailable and groovyExec.jar was not found; place it beside runner.exe or set GROOVY_JAR",
            )?;
            self.log.info(&format!(
                "groovy command unavailable; using java -jar {}",
                jar.display()
            ));
            self.finish_process(
                Command::new("java")
                    .arg("-jar")
                    .arg(jar)
                    .arg(&files.script)
                    .arg("lib"),
                &files,
                timeout,
                vars,
            )
        }
    }

    fn resolve_node_import(&self, specifier: &str) -> Option<String> {
        if specifier.starts_with('.')
            || specifier.starts_with('/')
            || specifier.starts_with("file:")
            || specifier.starts_with("node:")
            || specifier.starts_with("http:")
            || specifier.starts_with("https:")
            || specifier.starts_with("data:")
        {
            return None;
        }

        let mut anchors = vec![self.cwd.to_path_buf()];
        for name in [
            "ORCHESTRATOR_WORK_DIR",
            "ORCHESTRATOR_EXECUTION_DIR",
            "ORCHESTRATOR_NODE_MODULES",
        ] {
            if let Some(value) = std::env::var_os(name) {
                let path = PathBuf::from(value);
                anchors.push(
                    path.parent()
                        .filter(|_| path.file_name().is_some_and(|n| n == "node_modules"))
                        .unwrap_or(&path)
                        .to_path_buf(),
                );
            }
        }
        for ancestor in self.cwd.ancestors() {
            anchors.push(ancestor.join("orchestrator-worker"));
            anchors.push(ancestor.join("orchestrator-webpanel/server"));
            anchors.push(ancestor.join("orchestrator-webpanel/client"));
        }
        anchors.retain(|path| path.exists());
        anchors.dedup();

        let resolver = r#"const {createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const spec=process.argv[1], anchors=JSON.parse(process.argv[2]);
for(const anchor of anchors){try{const resolved=createRequire(path.join(anchor,'noop.js')).resolve(spec);process.stdout.write(pathToFileURL(resolved).href);process.exit(0)}catch{}}
process.exit(1);"#;
        let anchor_json = serde_json::to_string(&anchors).ok()?;
        let output = Command::new(node_command())
            .arg("-e")
            .arg(resolver)
            .arg(specifier)
            .arg(anchor_json)
            .current_dir(self.cwd)
            .output()
            .ok()?;
        output
            .status
            .success()
            .then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
            .filter(|value| !value.is_empty())
    }

    fn resolve_groovy_jar(&self) -> Option<PathBuf> {
        let mut candidates = Vec::new();
        if let Some(value) = std::env::var_os("GROOVY_JAR") {
            candidates.push(PathBuf::from(value));
        }
        candidates.push(self.cwd.join("groovyExec.jar"));
        for ancestor in self.cwd.ancestors() {
            candidates.push(ancestor.join("orchestrator-worker/groovyExec.jar"));
        }
        candidates.into_iter().find(|path| path.is_file())
    }

    fn finish_process(
        &self,
        command: &mut Command,
        files: &Sidecars,
        timeout: Option<Duration>,
        current_variables: &mut Map<String, Value>,
    ) -> Result<NodeResult> {
        let process_result = run_streamed(command, self.cwd, timeout, self.log);
        let variables = read_value(&files.vars)
            .ok()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        current_variables.extend(variables.clone());
        let output = process_result.and_then(|stdout| {
            if files.output.exists() {
                read_value(&files.output)
            } else if stdout.trim().is_empty() {
                Ok(Value::Null)
            } else {
                serde_json::from_str(stdout.trim())
                    .or_else(|_| Ok(Value::String(stdout.trim().to_owned())))
            }
        });
        files.cleanup();
        Ok(NodeResult {
            output: output?,
            variables,
        })
    }
}

fn run_streamed(
    command: &mut Command,
    cwd: &Path,
    timeout: Option<Duration>,
    log: &Logger,
) -> Result<String> {
    let mut child = command
        .current_dir(cwd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("failed to start {:?}", command.get_program()))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out_thread = thread::spawn(move || read_pipe(stdout));
    let err_thread = thread::spawn(move || read_pipe(stderr));
    let started = Instant::now();
    let mut timed_out = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if timeout.is_some_and(|limit| started.elapsed() >= limit) {
            let _ = child.kill();
            timed_out = true;
            break child.wait()?;
        }
        thread::sleep(Duration::from_millis(25));
    };
    let stdout = out_thread.join().unwrap_or_default();
    let stderr = err_thread.join().unwrap_or_default();
    if !stdout.is_empty() {
        log.stdout(&stdout);
    }
    if !stderr.is_empty() {
        log.stderr(&stderr);
    }
    if timed_out {
        bail!("node timed out after {}s", timeout.unwrap().as_secs());
    }
    if !status.success() {
        let fallback = format!(
            "process exited with {}",
            status
                .code()
                .map_or_else(|| "no status".into(), |c| c.to_string())
        );
        bail!(
            "{}",
            if stderr.trim().is_empty() {
                fallback
            } else {
                stderr.trim().to_owned()
            }
        );
    }
    Ok(stdout)
}

fn read_pipe(mut pipe: impl Read) -> String {
    let mut text = String::new();
    let _ = pipe.read_to_string(&mut text);
    text
}
fn read_value(path: &Path) -> Result<Value> {
    let text = fs::read_to_string(path)
        .with_context(|| format!("runtime did not produce {}", path.display()))?;
    serde_json::from_str(&text).or_else(|_| Ok(Value::String(text.trim().to_owned())))
}
fn node_command() -> String {
    std::env::var("NODE_EXECUTABLE_PATH").unwrap_or_else(|_| "node".into())
}
fn command_available(command: &str, version_arg: &str) -> bool {
    Command::new(command)
        .arg(version_arg)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
}

fn rewrite_static_imports(code: &str, mut resolve: impl FnMut(&str) -> Option<String>) -> String {
    let mut sequence = 0_usize;
    code.lines()
        .map(|line| {
            let trimmed = line.trim();
            if !trimmed.starts_with("import ") || trimmed.starts_with("import(") {
                return line.to_owned();
            }
            let statement = trimmed.trim_end_matches(';').trim();
            let (clause, quoted) = if let Some((clause, source)) = statement[7..].split_once(" from ") {
                (Some(clause.trim()), source.trim())
            } else {
                (None, statement[7..].trim())
            };
            let Some(specifier) = unquote(quoted) else {
                return line.to_owned();
            };
            let target = resolve(specifier).unwrap_or_else(|| specifier.to_owned());
            let target = json!(target);
            let Some(clause) = clause else {
                return format!("await import({target});");
            };
            sequence += 1;
            let module = format!("__runner_esm_{sequence}");
            let binding = if clause.starts_with('{') && clause.ends_with('}') {
                let properties = clause[1..clause.len() - 1]
                    .split(',')
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(|item| item.replace(" as ", ": "))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "const {{ {properties} }} = ({module}.default && typeof {module}.default === 'object') ? {module}.default : {module};"
                )
            } else if let Some(namespace) = clause.strip_prefix("* as ") {
                format!("const {} = {module};", namespace.trim())
            } else if clause.contains(',') {
                let (default_name, rest) = clause.split_once(',').unwrap();
                let properties = rest
                    .trim()
                    .trim_start_matches('{')
                    .trim_end_matches('}')
                    .split(',')
                    .map(str::trim)
                    .filter(|item| !item.is_empty())
                    .map(|item| item.replace(" as ", ": "))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "const {} = {module}.default ?? {module}; const {{ {properties} }} = ({module}.default && typeof {module}.default === 'object') ? {module}.default : {module};",
                    default_name.trim()
                )
            } else {
                format!("const {clause} = {module}.default ?? {module};")
            };
            format!("const {module} = await import({target});\n{binding}")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn unquote(value: &str) -> Option<&str> {
    let first = value.as_bytes().first()?;
    let last = value.as_bytes().last()?;
    ((*first == b'\'' || *first == b'\"') && first == last && value.len() >= 2)
        .then(|| &value[1..value.len() - 1])
}
fn value_u64(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str()?.parse().ok())
}
fn string_input(v: &Value) -> String {
    v.as_str()
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| v.to_string())
}
fn scalar_env(vars: &Map<String, Value>, prefix: &str, separator: &str) -> String {
    vars.iter()
        .filter_map(|(k, v)| {
            if v.is_string() || v.is_number() {
                Some(format!("{prefix}{k}{separator}{}", string_input(v)))
            } else {
                None
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}
fn sh_quote(v: &str) -> String {
    format!("'{}'", v.replace('\'', "'\\''"))
}
fn ps_quote(path: &Path) -> String {
    ps_quote_text(&path.to_string_lossy())
}
fn ps_quote_text(v: &str) -> String {
    format!("'{}'", v.replace('\'', "''"))
}

fn resolve_secrets(code: &str, log: &Logger) -> Result<String> {
    let mut result = String::new();
    let mut rest = code;
    while let Some(start) = rest.find("${{ secrets.") {
        result.push_str(&rest[..start]);
        let tail = &rest[start + 12..];
        let Some(end) = tail.find(" }}") else {
            result.push_str(&rest[start..]);
            return Ok(result);
        };
        let name = tail[..end].trim();
        let value = std::env::var(name)
            .with_context(|| format!("missing secret environment variable {name}"))?;
        log.info(&format!("resolved secret {name} from the environment"));
        result.push_str(&value);
        rest = &tail[end + 3..];
    }
    result.push_str(rest);
    Ok(result)
}

struct Sidecars {
    script: PathBuf,
    output: PathBuf,
    vars: PathBuf,
}
impl Sidecars {
    fn new(root: &Path, stem: &str, extension: &str) -> Result<Self> {
        fs::create_dir_all(root)?;
        let id = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
        Ok(Self {
            script: root.join(format!("{stem}_{id}.{extension}")),
            output: root.join(format!("{stem}_{id}.output")),
            vars: root.join(format!("{stem}_{id}.variables.json")),
        })
    }
    fn cleanup(&self) {
        let _ = fs::remove_file(&self.script);
        let _ = fs::remove_file(&self.output);
        let _ = fs::remove_file(&self.vars);
    }
}

#[cfg(test)]
mod tests {
    use super::rewrite_static_imports;

    #[test]
    fn rewrites_named_static_import_for_async_wrapper() {
        let code = "import { chromium as browserType } from 'playwright';\noutput = browserType;";
        let rewritten =
            rewrite_static_imports(code, |name| Some(format!("file:///resolved/{name}.js")));
        assert!(rewritten.contains("await import(\"file:///resolved/playwright.js\")"));
        assert!(rewritten.contains("chromium: browserType"));
        assert!(!rewritten.contains("import {"));
    }
}
