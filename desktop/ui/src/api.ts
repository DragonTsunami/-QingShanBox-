import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  CleanupReport,
  CleanupScan,
  DnsLookupResult,
  InstalledApp,
  LogBatch,
  LogEntry,
  LogExport,
  LogQuery,
  LogSource,
  NetworkInterface,
  PluginCatalog,
  PluginMarketEntry,
  PortCheckResult,
  ProcessInfo,
  QuickAction,
  QuickActionResult,
  ScheduledTask,
  ServiceAction,
  ServiceInfo,
  StartupItem,
  SystemDiagnostics,
  SystemSnapshot,
  UpdateCheck,
} from "./types";
import {
  mockAppInfo,
  mockCleanupScan,
  mockClearLogs,
  mockDiagnostics,
  mockDiagnosticActions,
  mockExportDiagnostics,
  mockExportLogs,
  mockInterfaces,
  mockInstallPlugin,
  mockInstallPluginFromPath,
  mockInstalledApps,
  mockLogSources,
  mockOpenPluginDirectory,
  mockPluginCatalog,
  mockPluginMarket,
  mockProcesses,
  mockQueryLogs,
  mockRemovePlugin,
  mockRescanPlugins,
  mockRunCleanup,
  mockRunDiagnosticAction,
  mockScheduledTasks,
  mockServices,
  mockSetPluginEnabled,
  mockSetStartupEnabled,
  mockSetTaskEnabled,
  mockSnapshot,
  mockStartupItems,
  mockCheckPort,
  mockResolve,
  mockUninstallSoftware,
  mockUpdateCheck,
} from "./mock";

/** The UI also runs in a plain browser (`npm run dev`) for design work. */
export const isDesktopRuntime =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export async function systemSnapshot(): Promise<SystemSnapshot> {
  if (!isDesktopRuntime) return mockSnapshot();
  return call<SystemSnapshot>("system_snapshot");
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  if (!isDesktopRuntime) return mockProcesses();
  return call<ProcessInfo[]>("process_list");
}

export async function killProcess(pid: number, force = false): Promise<void> {
  if (!isDesktopRuntime) {
    mockProcesses().find((process) => process.pid === pid);
    return;
  }
  await call<void>("process_kill", { pid, force });
}

export async function listServices(): Promise<ServiceInfo[]> {
  if (!isDesktopRuntime) return mockServices();
  return call<ServiceInfo[]>("service_list");
}

export async function applyServiceAction(
  name: string,
  action: ServiceAction,
): Promise<ServiceInfo> {
  if (!isDesktopRuntime) {
    const service = mockServices().find((item) => item.name === name);
    if (!service) throw new Error("未找到服务");
    return { ...service, status: action === "stop" ? "stopped" : "running" };
  }
  return call<ServiceInfo>("service_action", { name, action });
}

export async function listInterfaces(): Promise<NetworkInterface[]> {
  if (!isDesktopRuntime) return mockInterfaces();
  return call<NetworkInterface[]>("network_interfaces");
}

export async function checkPort(
  host: string,
  port: number,
  timeoutMs = 1500,
): Promise<PortCheckResult> {
  if (!isDesktopRuntime) return mockCheckPort(host, port);
  return call<PortCheckResult>("network_check_port", { host, port, timeoutMs });
}

export async function resolveHost(host: string): Promise<DnsLookupResult> {
  if (!isDesktopRuntime) return mockResolve(host);
  return call<DnsLookupResult>("network_resolve", { host });
}

export async function appInfo(): Promise<AppInfo> {
  if (!isDesktopRuntime) return mockAppInfo();
  return call<AppInfo>("app_info");
}

export async function relaunchAsAdmin(): Promise<void> {
  if (!isDesktopRuntime) return;
  await call<void>("relaunch_as_admin");
}

export async function setWindowTheme(dark: boolean): Promise<void> {
  if (!isDesktopRuntime) return;
  await call<void>("set_window_theme", { dark });
}

export async function logSources(): Promise<LogSource[]> {
  if (!isDesktopRuntime) return mockLogSources();
  return call<LogSource[]>("log_sources");
}

export async function queryLogs(query: LogQuery): Promise<LogBatch> {
  if (!isDesktopRuntime) return mockQueryLogs(query);
  return call<LogBatch>("logs_query", { query });
}

export async function exportLogs(entries: LogEntry[]): Promise<LogExport> {
  if (!isDesktopRuntime) return mockExportLogs(entries);
  return call<LogExport>("logs_export", { entries });
}

export async function clearLogs(source: string): Promise<void> {
  if (!isDesktopRuntime) return mockClearLogs(source);
  await call<void>("logs_clear", { source });
}

export async function cleanupScan(): Promise<CleanupScan> {
  if (!isDesktopRuntime) return mockCleanupScan();
  return call<CleanupScan>("cleanup_scan");
}

export async function runCleanup(ids: string[]): Promise<CleanupReport> {
  if (!isDesktopRuntime) return mockRunCleanup(ids);
  return call<CleanupReport>("cleanup_run", { ids });
}

export async function startupItems(): Promise<StartupItem[]> {
  if (!isDesktopRuntime) return mockStartupItems();
  return call<StartupItem[]>("startup_items");
}

export async function setStartupEnabled(
  id: string,
  enabled: boolean,
): Promise<StartupItem[]> {
  if (!isDesktopRuntime) return mockSetStartupEnabled(id, enabled);
  return call<StartupItem[]>("startup_set_enabled", { id, enabled });
}

export async function scheduledTasks(): Promise<ScheduledTask[]> {
  if (!isDesktopRuntime) return mockScheduledTasks();
  return call<ScheduledTask[]>("scheduled_tasks");
}

export async function setTaskEnabled(
  id: string,
  enabled: boolean,
): Promise<ScheduledTask[]> {
  if (!isDesktopRuntime) return mockSetTaskEnabled(id, enabled);
  return call<ScheduledTask[]>("task_set_enabled", { id, enabled });
}

export async function softwareList(): Promise<InstalledApp[]> {
  if (!isDesktopRuntime) return mockInstalledApps();
  return call<InstalledApp[]>("software_list");
}

export async function uninstallSoftware(id: string): Promise<void> {
  if (!isDesktopRuntime) return mockUninstallSoftware(id);
  await call<void>("software_uninstall", { id });
}

export async function openAppsFeatures(): Promise<void> {
  if (!isDesktopRuntime) return;
  await call<void>("open_apps_features");
}

export async function pluginCatalog(): Promise<PluginCatalog> {
  if (!isDesktopRuntime) return mockPluginCatalog();
  return call<PluginCatalog>("plugin_catalog");
}

export async function rescanPlugins(): Promise<PluginCatalog> {
  if (!isDesktopRuntime) return mockRescanPlugins();
  return call<PluginCatalog>("plugin_rescan");
}

export async function setPluginEnabled(
  id: string,
  enabled: boolean,
): Promise<PluginCatalog> {
  if (!isDesktopRuntime) return mockSetPluginEnabled(id, enabled);
  return call<PluginCatalog>("plugin_set_enabled", { id, enabled });
}

export async function pluginMarket(): Promise<PluginMarketEntry[]> {
  if (!isDesktopRuntime) return mockPluginMarket();
  return call<PluginMarketEntry[]>("plugin_market");
}

export async function installPlugin(id: string): Promise<PluginCatalog> {
  if (!isDesktopRuntime) return mockInstallPlugin(id);
  return call<PluginCatalog>("plugin_install", { id });
}

export async function installPluginFromPath(path: string): Promise<PluginCatalog> {
  if (!isDesktopRuntime) return mockInstallPluginFromPath(path);
  return call<PluginCatalog>("plugin_install_from_path", { path });
}

export async function removePlugin(id: string): Promise<PluginCatalog> {
  if (!isDesktopRuntime) return mockRemovePlugin(id);
  return call<PluginCatalog>("plugin_remove", { id });
}

export async function openPluginDirectory(): Promise<string> {
  if (!isDesktopRuntime) return mockOpenPluginDirectory();
  return call<string>("plugin_open_directory");
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isDesktopRuntime) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await call<void>("open_external_url", { url });
}

export async function diagnosticsRead(): Promise<SystemDiagnostics> {
  if (!isDesktopRuntime) return mockDiagnostics();
  return call<SystemDiagnostics>("diagnostics_read");
}

export async function diagnosticsActions(): Promise<QuickAction[]> {
  if (!isDesktopRuntime) return mockDiagnosticActions();
  return call<QuickAction[]>("diagnostics_actions");
}

export async function runDiagnosticAction(id: string): Promise<QuickActionResult> {
  if (!isDesktopRuntime) return mockRunDiagnosticAction(id);
  return call<QuickActionResult>("diagnostics_run_action", { id });
}

export async function exportDiagnostics(markdown: string): Promise<string> {
  if (!isDesktopRuntime) return mockExportDiagnostics(markdown);
  return call<string>("diagnostics_export", { markdown });
}

export async function updateCheck(): Promise<UpdateCheck> {
  if (!isDesktopRuntime) return mockUpdateCheck();
  return call<UpdateCheck>("update_check");
}
