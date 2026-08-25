use crate::log::Logger;
use crate::model::{Node, ParsedFlow, data_str, node_type};
use crate::runtime::Runtime;
use anyhow::{Context, Result, bail};
use base64::Engine;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::Duration;

const MAX_STEPS: usize = 1000;

pub fn run(flow: ParsedFlow, cwd: &Path, input: Value, log: &Logger) -> Result<Value> {
    extract_artifacts(&flow, cwd, log)?;
    let scratch = cwd.join(".orchestrator-runner");
    let result = Executor::new(flow, cwd, &scratch, input, log)?.execute();
    let _ = fs::remove_dir(&scratch);
    result
}

struct Executor<'a> {
    parsed: ParsedFlow,
    runtime: Runtime<'a>,
    log: &'a Logger,
    flow_input: Value,
    variables: Map<String, Value>,
    results: HashMap<String, Value>,
    injected: HashMap<String, Value>,
    executed: HashSet<String>,
    executing: HashSet<String>,
    executed_at: HashMap<String, usize>,
    goto_decisions: HashMap<String, Vec<String>>,
    starter: Option<String>,
    tick: usize,
    last_executed: Option<String>,
    steps: usize,
}

impl<'a> Executor<'a> {
    fn new(
        parsed: ParsedFlow,
        cwd: &'a Path,
        scratch: &'a Path,
        flow_input: Value,
        log: &'a Logger,
    ) -> Result<Self> {
        let mut variables = Map::new();
        for node in &parsed.flow.nodes {
            if node_type(node) == "variable" {
                let key = sanitize(data_str(node, "label"));
                let raw = data_str(node, "value");
                variables.insert(
                    key,
                    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.into())),
                );
            }
        }
        let starter = parsed
            .flow
            .nodes
            .iter()
            .find(|n| n.data.get("isStarterNode").and_then(Value::as_bool) == Some(true))
            .map(|n| n.id.clone());
        Ok(Self {
            parsed,
            runtime: Runtime::new(cwd, scratch, log),
            log,
            flow_input,
            variables,
            results: HashMap::new(),
            injected: HashMap::new(),
            executed: HashSet::new(),
            executing: HashSet::new(),
            executed_at: HashMap::new(),
            goto_decisions: HashMap::new(),
            starter,
            tick: 0,
            last_executed: None,
            steps: 0,
        })
    }

    fn execute(mut self) -> Result<Value> {
        let entry = self.entry().context("no valid entry point found")?;
        self.log.flow(&format!(
            "{}: {} nodes, entry {entry}",
            if self.parsed.flow.name.is_empty() {
                "flow"
            } else {
                &self.parsed.flow.name
            },
            self.parsed.flow.nodes.len()
        ));
        self.step_to(&entry)?;
        Ok(self
            .last_executed
            .and_then(|id| self.results.remove(&id))
            .unwrap_or(Value::Null))
    }

    fn entry(&self) -> Option<String> {
        if self.starter.is_some() {
            return self.starter.clone();
        }
        if let Some(goto) = self
            .parsed
            .flow
            .nodes
            .iter()
            .filter(|n| node_type(n) == "goto")
            .min_by_key(|n| self.parsed.creation_index(&n.id))
        {
            return Some(self.root_of(&goto.id));
        }
        self.parsed
            .roots
            .iter()
            .min_by_key(|id| self.parsed.creation_index(id))
            .cloned()
    }

    fn root_of(&self, id: &str) -> String {
        let mut stack = vec![id.to_owned()];
        let mut seen = HashSet::new();
        let mut roots = Vec::new();
        while let Some(current) = stack.pop() {
            if !seen.insert(current.clone()) {
                continue;
            }
            let incoming = self.incoming(&current);
            if incoming.is_empty() {
                roots.push(current);
            } else {
                stack.extend(incoming.into_iter().map(|e| e.source));
            }
        }
        roots
            .into_iter()
            .min_by_key(|r| self.parsed.creation_index(r))
            .unwrap_or_else(|| id.to_owned())
    }

    fn step_to(&mut self, id: &str) -> Result<()> {
        self.steps += 1;
        if self.steps > MAX_STEPS {
            bail!("flow exceeded the {MAX_STEPS}-step safety limit");
        }
        let preds: Vec<String> = self.incoming(id).into_iter().map(|e| e.source).collect();
        let needs_refresh = preds.iter().any(|p| {
            self.executed_at.get(p).unwrap_or(&0) > self.executed_at.get(id).unwrap_or(&0)
        });
        self.ensure(id, needs_refresh, false)?;
        let node = match self.parsed.node_map.get(id).cloned() {
            Some(n) => n,
            None => return Ok(()),
        };
        if node_type(&node) == "goto"
            && let Some(targets) = self
                .goto_decisions
                .get(id)
                .cloned()
                .filter(|v| !v.is_empty())
        {
            for target in targets {
                self.ensure(&target, true, true)?;
                self.step_to(&target)?;
            }
            return Ok(());
        }
        for edge in self.outgoing(id) {
            self.step_to(&edge.target)?;
        }
        Ok(())
    }

    fn ensure(&mut self, id: &str, force: bool, skip_predecessors: bool) -> Result<()> {
        if self.executing.contains(id) || (self.executed.contains(id) && !force) {
            return Ok(());
        }
        let Some(node) = self.parsed.node_map.get(id).cloned() else {
            return Ok(());
        };
        self.executing.insert(id.into());
        if self.starter.as_deref() != Some(id) && !skip_predecessors {
            let preds: Vec<String> = self.incoming(id).into_iter().map(|e| e.source).collect();
            for pred in preds {
                self.ensure(&pred, false, false)?;
            }
        }
        let input = self.input_for(id);
        match node_type(&node) {
            "goto" => self.execute_goto(&node, &input),
            "variable" => {
                let raw = data_str(&node, "value");
                self.results.insert(
                    id.into(),
                    serde_json::from_str(raw).unwrap_or_else(|_| Value::String(raw.into())),
                );
            }
            "comment" => {
                self.results.insert(id.into(), input);
            }
            "flow" => {
                self.log.node(&format!("{} ({id})", label(&node)));
                let nested = ParsedFlow::parse(data_str(&node, "code").as_bytes())
                    .context("invalid nested flow")?;
                let output = run(nested, self.runtime_cwd(), input, self.log)?;
                self.results.insert(id.into(), output);
                self.last_executed = Some(id.into());
            }
            _ => self.execute_regular(&node, input)?,
        }
        if node_type(&node) != "goto"
            && node_type(&node) != "variable"
            && node_type(&node) != "comment"
        {
            self.last_executed = Some(id.into());
        }
        self.tick += 1;
        self.executed_at.insert(id.into(), self.tick);
        self.executed.insert(id.into());
        self.executing.remove(id);
        Ok(())
    }

    fn execute_regular(&mut self, node: &Node, input: Value) -> Result<()> {
        let id = &node.id;
        let on_error = data_str(node, "onError");
        let retry = node.data.get("retry").unwrap_or(&Value::Null);
        let max_attempts = if on_error == "retry" {
            retry
                .get("maxAttempts")
                .and_then(value_u64)
                .unwrap_or(3)
                .max(1)
        } else {
            1
        };
        let base_delay = retry
            .get("delayMs")
            .and_then(value_u64)
            .unwrap_or_else(|| retry.get("delaySec").and_then(value_u64).unwrap_or(1) * 1000);
        let backoff = retry
            .get("backoff")
            .and_then(Value::as_str)
            .unwrap_or("fixed");
        for attempt in 0..max_attempts {
            if attempt > 0 {
                let factor = match backoff {
                    "linear" => attempt,
                    "exponential" => 1 << (attempt - 1),
                    _ => 1,
                };
                let wait = base_delay * factor;
                self.log.warn(&format!(
                    "{} retry {attempt}/{} in {}ms",
                    label(node),
                    max_attempts - 1,
                    wait
                ));
                thread::sleep(Duration::from_millis(wait));
            }
            self.log
                .node(&format!("{} ({}) [{}]", label(node), id, node_type(node)));
            match self.runtime.execute(node, &input, &mut self.variables) {
                Ok(result) => {
                    for (k, v) in result.variables {
                        self.variables.insert(k, v);
                    }
                    self.log
                        .success(&format!("{} => {}", label(node), compact(&result.output)));
                    self.results.insert(id.clone(), result.output);
                    return Ok(());
                }
                Err(error) if attempt + 1 < max_attempts => {
                    self.log.warn(&format!("{} failed: {error:#}", label(node)))
                }
                Err(error) if on_error == "continue" => {
                    self.log
                        .warn(&format!("{} failed: {error:#} — continuing", label(node)));
                    self.results.insert(id.clone(), Value::Null);
                    return Ok(());
                }
                Err(error) => {
                    return Err(error).with_context(|| format!("node {} failed", label(node)));
                }
            }
        }
        unreachable!()
    }

    fn execute_goto(&mut self, node: &Node, input: &Value) {
        let mut selected = Vec::new();
        let mut forward = false;
        let mut expr = "";
        if let Some(rules) = node.data.get("conditions").and_then(Value::as_array) {
            for rule in rules {
                if let Some(candidate) = rule.get("expr").and_then(Value::as_str) {
                    let targets = targets(rule.get("goto"));
                    if !targets.is_empty()
                        && self
                            .runtime
                            .eval_condition(candidate, input, &self.variables)
                    {
                        selected = targets;
                        forward = rule
                            .get("forwardInput")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        expr = candidate;
                        break;
                    }
                }
            }
        }
        if forward {
            for target in &selected {
                self.injected.insert(target.clone(), input.clone());
            }
        }
        self.log.flow(&format!(
            "goto {} [{}] -> {}",
            label(node),
            expr,
            if selected.is_empty() {
                "no match".into()
            } else {
                selected.join(", ")
            }
        ));
        self.goto_decisions.insert(node.id.clone(), selected);
        self.results.insert(node.id.clone(), input.clone());
    }

    fn input_for(&self, id: &str) -> Value {
        if let Some(v) = self.injected.get(id) {
            return v.clone();
        }
        if self.starter.as_deref() == Some(id) {
            return self.flow_input.clone();
        }
        let preds: Vec<String> = self.incoming(id).into_iter().map(|e| e.source).collect();
        if preds.is_empty() {
            return self.flow_input.clone();
        }
        let values: Vec<Value> = preds
            .into_iter()
            .map(|p| self.results.get(&p).cloned().unwrap_or(Value::Null))
            .collect();
        if values.len() == 1 {
            values[0].clone()
        } else {
            Value::Array(values)
        }
    }
    fn incoming(&self, id: &str) -> Vec<crate::model::Edge> {
        self.parsed.incoming.get(id).cloned().unwrap_or_default()
    }
    fn outgoing(&self, id: &str) -> Vec<crate::model::Edge> {
        self.parsed.outgoing.get(id).cloned().unwrap_or_default()
    }
    fn runtime_cwd(&self) -> &Path {
        self.runtime.cwd()
    }
}

fn targets(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::String(s)) if !s.is_empty() => vec![s.clone()],
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect(),
        _ => Vec::new(),
    }
}
fn value_u64(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str()?.parse().ok())
}
fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}
fn label(node: &Node) -> &str {
    let value = data_str(node, "label");
    if value.is_empty() { &node.id } else { value }
}
fn compact(value: &Value) -> String {
    let text = value.to_string();
    if text.len() > 200 {
        format!("{}...", &text[..200])
    } else {
        text
    }
}

fn extract_artifacts(flow: &ParsedFlow, cwd: &Path, log: &Logger) -> Result<()> {
    for artifact in &flow.flow.artifacts {
        let rel = Path::new(&artifact.name);
        if rel.is_absolute()
            || rel.components().any(|c| {
                matches!(
                    c,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            bail!("unsafe artifact path: {}", artifact.name);
        }
        let target: PathBuf = cwd.join(rel);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&artifact.data)
            .with_context(|| format!("invalid base64 artifact {}", artifact.name))?;
        fs::write(&target, bytes)?;
        log.info(&format!("extracted artifact {}", artifact.name));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sanitizes_variable_names() {
        assert_eq!(sanitize("batch size"), "batch_size");
    }
    #[test]
    fn accepts_single_and_multiple_goto_targets() {
        assert_eq!(targets(Some(&Value::String("a".into()))), vec!["a"]);
        assert_eq!(
            targets(Some(&serde_json::json!(["a", "b"]))),
            vec!["a", "b"]
        );
    }
}
