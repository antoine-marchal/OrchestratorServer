use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Flow {
    #[serde(default)]
    pub name: String,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    #[serde(default)]
    pub artifacts: Vec<Artifact>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Node {
    pub id: String,
    #[serde(default)]
    pub data: Value,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Edge {
    pub source: String,
    pub target: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Artifact {
    pub name: String,
    pub data: String,
}

#[derive(Debug)]
pub struct ParsedFlow {
    pub flow: Flow,
    pub node_map: HashMap<String, Node>,
    pub incoming: HashMap<String, Vec<Edge>>,
    pub outgoing: HashMap<String, Vec<Edge>>,
    pub roots: Vec<String>,
}

impl ParsedFlow {
    pub fn parse(bytes: &[u8]) -> Result<Self> {
        let flow: Flow = serde_json::from_slice(bytes).context("invalid JSON in flow content")?;
        let mut node_map = HashMap::new();
        for node in &flow.nodes {
            if node.id.is_empty() {
                bail!("invalid flow content: a node has no id");
            }
            if node_map.insert(node.id.clone(), node.clone()).is_some() {
                bail!("invalid flow content: duplicate node id {}", node.id);
            }
        }
        let mut incoming: HashMap<String, Vec<Edge>> = HashMap::new();
        let mut outgoing: HashMap<String, Vec<Edge>> = HashMap::new();
        for edge in &flow.edges {
            incoming
                .entry(edge.target.clone())
                .or_default()
                .push(edge.clone());
            outgoing
                .entry(edge.source.clone())
                .or_default()
                .push(edge.clone());
        }
        let roots = flow
            .nodes
            .iter()
            .filter(|n| incoming.get(&n.id).is_none_or(Vec::is_empty))
            .map(|n| n.id.clone())
            .collect();
        Ok(Self {
            flow,
            node_map,
            incoming,
            outgoing,
            roots,
        })
    }

    pub fn creation_index(&self, id: &str) -> usize {
        self.flow
            .nodes
            .iter()
            .position(|n| n.id == id)
            .unwrap_or(usize::MAX)
    }
}

pub fn data_str<'a>(node: &'a Node, key: &str) -> &'a str {
    node.data.get(key).and_then(Value::as_str).unwrap_or("")
}

pub fn node_type(node: &Node) -> &str {
    data_str(node, "type")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_repository_demo_flow() {
        let demos = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../demo-flows");
        let mut count = 0;
        for entry in std::fs::read_dir(demos).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) == Some("or") {
                ParsedFlow::parse(&std::fs::read(path).unwrap()).unwrap();
                count += 1;
            }
        }
        assert!(count >= 6);
    }
}
