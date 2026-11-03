import { describe, expect, it } from "vitest";
import {
  applyServiceAction,
  checkPort,
  clearLogs,
  exportLogs,
  isDesktopRuntime,
  listProcesses,
  installPlugin,
  listServices,
  logSources,
  openPluginDirectory,
  pluginCatalog,
  pluginMarket,
  queryLogs,
  removePlugin,
  resolveHost,
  rescanPlugins,
  setPluginEnabled,
  softwareList,
  systemSnapshot,
  uninstallSoftware,
} from "./api";

describe("browser mock contract", () => {
  it("detects the non-Tauri runtime", () => {
    expect(isDesktopRuntime).toBe(false);
  });

  it("returns the same snapshot shape as the Rust command", async () => {
    const snapshot = await systemSnapshot();
    expect(snapshot.hostname).toBe("OPS-WS-042");
    expect(snapshot.memoryTotal).toBeGreaterThan(snapshot.memoryUsed);
    expect(snapshot.disks.length).toBeGreaterThan(0);
    expect(snapshot.perCoreUsage.length).toBe(snapshot.logicalCores);
  });

  it("returns process and service collections", async () => {
    const processes = await listProcesses();
    const services = await listServices();

    expect(processes.length).toBeGreaterThan(0);
    expect(processes[0]).toHaveProperty("pid");
    expect(processes[0]).toHaveProperty("cpuUsage");
    expect(services.some((service) => service.status === "running")).toBe(true);
  });

  it("applies a service action in the mock store", async () => {
    const updated = await applyServiceAction("Dnscache", "stop");
    expect(updated.status).toBe("stopped");
  });

  it("returns port and DNS diagnostics", async () => {
    const port = await checkPort("127.0.0.1", 443);
    expect(port.open).toBe(true);
    expect(port.latencyMs).toBeGreaterThan(0);

    const dns = await resolveHost("github.com");
    expect(dns.addresses.length).toBeGreaterThan(0);
    expect(dns.error).toBeNull();
  });

  it("removes an app through the mock uninstall contract", async () => {
    const before = await softwareList();
    expect(before.length).toBeGreaterThan(0);
    await uninstallSoftware(before[0].id);
    const after = await softwareList();
    expect(after).toHaveLength(before.length - 1);
  });

  it("loads and toggles the declarative plugin catalog", async () => {    const catalog = await pluginCatalog();
    expect(catalog.plugins.some((plugin) => plugin.builtin)).toBe(true);
    expect(catalog.directory).toContain("plugins");

    const target = catalog.plugins.find((plugin) => plugin.id === "qingshan.release-links");
    expect(target?.enabled).toBe(false);

    const enabled = await setPluginEnabled("qingshan.release-links", true);
    expect(enabled.plugins.find((plugin) => plugin.id === "qingshan.release-links")?.enabled).toBe(
      true,
    );

    const rescanned = await rescanPlugins();
    expect(rescanned.plugins.find((plugin) => plugin.id === "qingshan.release-links")?.enabled).toBe(
      true,
    );

    await setPluginEnabled("qingshan.release-links", false);
    expect(await openPluginDirectory()).toContain("plugins");
  });

  it("installs and removes an optional plugin from the market", async () => {
    const market = await pluginMarket();
    const entry = market.find((plugin) => plugin.id === "qingshan.disk-cleanup");
    expect(entry?.installed).toBe(false);
    expect(entry?.official).toBe(true);

    const installed = await installPlugin("qingshan.disk-cleanup");
    expect(installed.plugins.some((plugin) => plugin.id === "qingshan.disk-cleanup")).toBe(true);

    const after = await removePlugin("qingshan.disk-cleanup");
    expect(after.plugins.some((plugin) => plugin.id === "qingshan.disk-cleanup")).toBe(false);
  });

  it("reads and filters Windows event logs", async () => {
    const sources = await logSources();
    expect(sources.map((source) => source.id)).toEqual(["application", "system", "security"]);

    const batch = await queryLogs({
      source: "application",
      level: "error",
      keyword: "",
      limit: 2000,
      days: 3,
    });
    expect(batch.source).toBe("application");
    expect(batch.entries.length).toBeGreaterThan(0);
    expect(batch.entries.every((entry) => entry.level === "error")).toBe(true);
    expect(batch.total).toBeGreaterThanOrEqual(batch.entries.length);

    const exported = await exportLogs(batch.entries);
    expect(exported.count).toBe(batch.entries.length);
    expect(exported.path).toContain("qingshan-logs-");

    await expect(clearLogs("application")).resolves.toBeUndefined();
    await expect(clearLogs("")).rejects.toThrow("日志来源不能为空");
  });
});
