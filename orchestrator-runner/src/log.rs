use std::io::IsTerminal;

pub struct Logger {
    color: bool,
}

impl Logger {
    pub fn new() -> Self {
        Self {
            color: std::io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none(),
        }
    }

    fn line(&self, code: &str, tag: &str, message: &str) {
        for line in message.trim_end_matches(['\r', '\n']).lines() {
            if self.color {
                println!("\x1b[{code}m{tag}\x1b[0m {line}");
            } else {
                println!("{tag} {line}");
            }
        }
    }

    pub fn info(&self, message: &str) {
        self.line("36", "[runner]", message);
    }
    pub fn flow(&self, message: &str) {
        self.line("35", "[flow]", message);
    }
    pub fn node(&self, message: &str) {
        self.line("34", "[node]", message);
    }
    pub fn stdout(&self, message: &str) {
        self.line("90", "[stdout]", message);
    }
    pub fn stderr(&self, message: &str) {
        self.line("31", "[stderr]", message);
    }
    pub fn success(&self, message: &str) {
        self.line("32", "[success]", message);
    }
    pub fn warn(&self, message: &str) {
        self.line("33", "[warning]", message);
    }
}
