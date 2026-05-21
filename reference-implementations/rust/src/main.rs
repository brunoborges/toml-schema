use std::env;
use std::io::{self};
use std::process::ExitCode;

use toml_schema::cli;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().skip(1).collect();
    let stdout = io::stdout();
    let stderr = io::stderr();
    ExitCode::from(cli::run(&args, &mut stdout.lock(), &mut stderr.lock()))
}
