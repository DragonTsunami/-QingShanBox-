// Hide the console window on release builds; keep it for local diagnostics.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    qingshan_workbench_lib::run();
}
