import type {
  AppInfo,
  CleanupReport,
  CleanupScan,
  CleanupTarget,
  DnsLookupResult,
  InstalledApp,
  LogBatch,
  LogEntry,
  LogExport,
  LogQuery,
  LogSource,
  NetworkInterface,
  PluginCatalog,
  PluginInfo,
  PluginMarketEntry,
  PortCheckResult,
  ProcessInfo,
  QuickAction,
  QuickActionResult,
  ScheduledTask,
  ServiceInfo,
  StartupItem,
  SystemDiagnostics,
  SystemSnapshot,
  UpdateCheck,
} from "./types";

const GB = 1024 ** 3;

const cores = Array.from({ length: 16 }, (_, index) => {
  const base = [18, 26, 12, 41, 8, 33, 22, 15, 47, 9, 27, 36, 5, 19, 29, 13];
  return base[index % base.length];
});

export function mockSnapshot(): SystemSnapshot {
  const now = Math.floor(Date.now() / 1000);
  return {
    hostname: "OPS-WS-042",
    osName: "Windows 11 Pro",
    osVersion: "24H2 (26100.4351)",
    kernelVersion: "10.0.26100",
    arch: "x86_64",
    uptimeSecs: 3 * 86400 + 7 * 3600 + 42 * 60,
    bootTime: now - (3 * 86400 + 7 * 3600 + 42 * 60),
    cpuBrand: "Intel Core i7-13700H",
    physicalCores: 12,
    logicalCores: 16,
    cpuUsage: 23.8,
    perCoreUsage: cores.map((value) => value + Math.random() * 6),
    memoryTotal: 32 * GB,
    memoryUsed: 18.4 * GB,
    swapTotal: 8 * GB,
    swapUsed: 1.6 * GB,
    disks: [
      {
        name: "System",
        mountPoint: "C:\\",
        fileSystem: "NTFS",
        total: 953 * GB,
        available: 411 * GB,
        removable: false,
      },
      {
        name: "Work",
        mountPoint: "D:\\",
        fileSystem: "NTFS",
        total: 1907 * GB,
        available: 1288 * GB,
        removable: false,
      },
      {
        name: "Backup",
        mountPoint: "E:\\",
        fileSystem: "exFAT",
        total: 465 * GB,
        available: 92 * GB,
        removable: true,
      },
    ],
    isElevated: true,
  };
}

let processSeed = [
  { pid: 4, name: "System", user: "SYSTEM", cpu: 0.1, mem: 0.2, status: "运行中" },
  { pid: 412, name: "MsMpEng.exe", user: "SYSTEM", cpu: 3.2, mem: 0.4, status: "运行中" },
  { pid: 1024, name: "explorer.exe", user: "青衫", cpu: 1.4, mem: 0.3, status: "运行中" },
  { pid: 2216, name: "Code.exe", user: "青衫", cpu: 8.7, mem: 1.9, status: "运行中" },
  { pid: 3112, name: "Docker Desktop.exe", user: "青衫", cpu: 2.1, mem: 0.8, status: "运行中" },
  { pid: 4088, name: "chrome.exe", user: "青衫", cpu: 6.3, mem: 2.4, status: "运行中" },
  { pid: 5210, name: "postgres.exe", user: "NETWORK SERVICE", cpu: 0.8, mem: 0.5, status: "运行中" },
  { pid: 6024, name: "sshd.exe", user: "SYSTEM", cpu: 0.2, mem: 0.1, status: "运行中" },
  { pid: 7012, name: "opsdeck.exe", user: "青衫", cpu: 0.4, mem: 0.2, status: "运行中" },
];

export function mockProcesses(): ProcessInfo[] {
  return processSeed.map((item, index) => ({
    pid: item.pid,
    name: item.name,
    exe: `C:\\Program Files\\QingshanToolbox\\${item.name}`,
    command: `${item.name} --service`,
    cpuUsage: item.cpu,
    memory: Math.round(item.mem * GB),
    virtualMemory: Math.round(item.mem * 2.2 * GB),
    status: item.status,
    user: item.user,
    startTime: Math.floor(Date.now() / 1000) - 3600 * (index + 1),
  }));
}

const serviceSeed: ServiceInfo[] = [
  {
    name: "Dnscache",
    displayName: "DNS Client",
    status: "running",
    startType: "auto",
    processId: 1288,
    canStop: true,
  },
  {
    name: "Docker",
    displayName: "Docker Desktop Service",
    status: "running",
    startType: "auto",
    processId: 3112,
    canStop: true,
  },
  {
    name: "MpsSvc",
    displayName: "Windows Defender Firewall",
    status: "running",
    startType: "auto",
    processId: 2210,
    canStop: true,
  },
  {
    name: "sshd",
    displayName: "OpenSSH SSH Server",
    status: "stopped",
    startType: "manual",
    processId: 0,
    canStop: true,
  },
  {
    name: "wuauserv",
    displayName: "Windows Update",
    status: "running",
    startType: "manual",
    processId: 1764,
    canStop: true,
  },
  {
    name: "Spooler",
    displayName: "Print Spooler",
    status: "stopped",
    startType: "auto",
    processId: 0,
    canStop: true,
  },
  {
    name: "WinRM",
    displayName: "Windows Remote Management",
    status: "running",
    startType: "auto",
    processId: 3308,
    canStop: true,
  },
  {
    name: "BITS",
    displayName: "Background Intelligent Transfer Service",
    status: "stopped",
    startType: "manual",
    processId: 0,
    canStop: true,
  },
];

export function mockServices(): ServiceInfo[] {
  return serviceSeed;
}

export function mockInterfaces(): NetworkInterface[] {
  return [
    {
      name: "以太网",
      mac: "8C-16-45-A2-19-7F",
      ipv4: ["192.168.10.42"],
      ipv6: ["fe80::5d2f:71a2:88c1:9e34"],
      isLoopback: false,
      isUp: true,
      totalReceived: 84 * GB,
      totalTransmitted: 21 * GB,
    },
    {
      name: "WLAN",
      mac: "D4-3B-04-11-8E-6C",
      ipv4: ["10.8.0.6"],
      ipv6: [],
      isLoopback: false,
      isUp: true,
      totalReceived: 12 * GB,
      totalTransmitted: 3.2 * GB,
    },
    {
      name: "vEthernet (Default Switch)",
      mac: "00-15-5D-01-2A-0B",
      ipv4: ["172.29.112.1"],
      ipv6: [],
      isLoopback: false,
      isUp: true,
      totalReceived: 2.4 * GB,
      totalTransmitted: 1.1 * GB,
    },
  ];
}

export async function mockCheckPort(host: string, port: number): Promise<PortCheckResult> {
  await new Promise((resolve) => setTimeout(resolve, 420));
  const open = port === 443 || port === 22 || port === 5432 || port === 8080;
  return {
    host,
    port,
    open,
    latencyMs: Math.round(8 + Math.random() * 40),
    error: open ? null : "连接被拒绝 (os error 10061)",
  };
}

export async function mockResolve(host: string): Promise<DnsLookupResult> {
  await new Promise((resolve) => setTimeout(resolve, 260));
  return {
    host,
    addresses: ["140.82.112.4", "140.82.113.4", "140.82.114.4"],
    latencyMs: 32,
    error: null,
  };
}

export function mockAppInfo(): AppInfo {
  return {
    name: "青衫工具箱",
    version: "1.0.0",
    coreVersion: "1.0.0",
    buildProfile: "debug",
    platform: "windows-gnu",
    isElevated: true,
  };
}

export function mockDiagnostics(): SystemDiagnostics {
  return {
    collectedAt: new Date().toLocaleString("zh-CN"),
    battery: {
      name: "DELL 71JF4 3-cell",
      chargePercent: 82,
      status: "已接通电源",
      estimatedMinutes: 186,
    },
    disks: [
      {
        name: "Samsung SSD 990 PRO 1TB",
        mediaType: "SSD",
        health: "Healthy",
        operationalStatus: "OK",
        sizeBytes: 1024 * GB,
      },
      {
        name: "WDC WD20EZBX-00AYRA0",
        mediaType: "HDD",
        health: "Healthy",
        operationalStatus: "OK",
        sizeBytes: 2 * 1024 * GB,
      },
    ],
    gpus: [
      {
        name: "NVIDIA GeForce RTX 4060 Laptop GPU",
        driverVersion: "32.0.15.6094",
        memoryBytes: 8 * 1024 * GB,
      },
      {
        name: "Intel(R) UHD Graphics",
        driverVersion: "31.0.101.5333",
        memoryBytes: 128 * 1024 * 1024,
      },
    ],
  };
}

export function mockDiagnosticActions(): QuickAction[] {
  return [
    {
      id: "flush-dns",
      name: "刷新 DNS 缓存",
      description: "解决域名解析异常、网页打不开等常见问题",
      requiresAdmin: false,
    },
    {
      id: "open-network-settings",
      name: "打开网络设置",
      description: "查看适配器、代理、VPN 和 DNS 配置",
      requiresAdmin: false,
    },
  ];
}

export function mockRunDiagnosticAction(id: string): QuickActionResult {
  return {
    action: id,
    message: id === "flush-dns" ? "DNS 缓存已刷新" : "已打开 Windows 网络设置",
  };
}

export function mockExportDiagnostics(markdown: string): string {
  return `C:\\Users\\mock\\AppData\\Roaming\\com.qingshan.toolbox\\reports\\qingshan-diagnostics-${markdown.length}.md`;
}

export function mockUpdateCheck(): UpdateCheck {
  return {
    currentVersion: "1.0.0",
    latestVersion: "1.0.0",
    available: false,
    releaseUrl: "https://github.com/DragonTsunami/qingshan-toolbox/releases/latest",
    publishedAt: null,
  };
}

const pluginSeed: PluginInfo[] = [
  {
    id: "qingshan.health-check",
    name: "健康巡检",
    version: "0.1.0",
    description: "基于当前采样检查内存、系统盘与权限状态。",
    author: "青衫工具箱",
    icon: "pulse",
    homepage: "https://github.com/DragonTsunami/qingshan-toolbox",
    tags: ["监控", "内置"],
    enabled: true,
    builtin: true,
    path: "C:\\Users\\青衫\\AppData\\Roaming\\com.qingshan.toolbox\\plugins\\qingshan.health-check\\plugin.json",
    widgets: [
      {
        id: "health",
        title: "今日健康巡检",
        kind: "health",
        body: "只读取概览快照，不产生额外系统调用。",
        items: [],
        links: [],
        health: {
          memoryMaxPercent: 85,
          systemDiskMaxPercent: 90,
          requireElevation: false,
        },
      },
    ],
  },
  {
    id: "qingshan.release-links",
    name: "版本与文档",
    version: "0.1.0",
    description: "把仓库、Release 与插件文档放到概览上。",
    author: "青衫工具箱",
    icon: "link",
    homepage: "https://github.com/DragonTsunami/qingshan-toolbox",
    tags: ["文档", "内置"],
    enabled: false,
    builtin: true,
    path: "C:\\Users\\青衫\\AppData\\Roaming\\com.qingshan.toolbox\\plugins\\qingshan.release-links\\plugin.json",
    widgets: [
      {
        id: "links",
        title: "项目入口",
        kind: "links",
        body: "从仓库、Release 和插件文档继续。",
        items: [],
        links: [
          {
            label: "GitHub 仓库",
            url: "https://github.com/DragonTsunami/qingshan-toolbox",
          },
          {
            label: "最新 Release",
            url: "https://github.com/DragonTsunami/qingshan-toolbox/releases/latest",
          },
          {
            label: "插件文档",
            url: "https://github.com/DragonTsunami/qingshan-toolbox/blob/main/docs/plugins.md",
          },
        ],
        health: null,
      },
    ],
  },
];

const optionalSeed: PluginInfo[] = [
  {
    id: "qingshan.disk-cleanup",
    name: "磁盘清理清单",
    version: "0.1.0",
    description: "把常见临时文件位置整理成巡检清单，打开目录后自行确认清理。",
    author: "青衫工具箱",
    icon: "shield",
    homepage: null,
    tags: ["运维", "清理"],
    enabled: false,
    builtin: false,
    path: "C:\\Users\\青衫\\AppData\\Roaming\\com.qingshan.toolbox\\plugins\\qingshan.disk-cleanup\\plugin.json",
    widgets: [
      {
        id: "cleanup",
        title: "磁盘清理清单",
        kind: "checklist",
        body: "只列出位置，不自动删除文件。",
        items: ["检查用户临时目录", "检查 Windows 更新缓存", "检查旧安装包"],
        links: [],
        health: null,
      },
    ],
  },
  {
    id: "qingshan.event-log",
    name: "事件日志入口",
    version: "0.1.0",
    description: "把 Windows 事件查看器与常用排障文档放到插件页。",
    author: "青衫工具箱",
    icon: "link",
    homepage: "https://learn.microsoft.com/windows-server/administration/windows-commands/wevtutil",
    tags: ["运维", "日志"],
    enabled: false,
    builtin: false,
    path: "C:\\Users\\青衫\\AppData\\Roaming\\com.qingshan.toolbox\\plugins\\qingshan.event-log\\plugin.json",
    widgets: [
      {
        id: "event-log-links",
        title: "事件日志入口",
        kind: "links",
        body: "打开事件查看器或查看微软官方文档。",
        items: [],
        links: [
          {
            label: "事件查看器文档",
            url: "https://learn.microsoft.com/windows-server/administration/windows-commands/eventvwr",
          },
          {
            label: "wevtutil 命令",
            url: "https://learn.microsoft.com/windows-server/administration/windows-commands/wevtutil",
          },
        ],
        health: null,
      },
    ],
  },
];

const pluginOverrides: Record<string, boolean> = {};
const installedOptional: PluginInfo[] = [];

function allPlugins(): PluginInfo[] {
  return [...pluginSeed, ...installedOptional];
}

export function mockPluginCatalog(): PluginCatalog {
  return {
    directory: "C:\\Users\\青衫\\AppData\\Roaming\\com.qingshan.toolbox\\plugins",
    plugins: allPlugins().map((plugin) => ({
      ...plugin,
      enabled: pluginOverrides[plugin.id] ?? plugin.enabled,
      tags: [...plugin.tags],
      widgets: plugin.widgets.map((widget) => ({
        ...widget,
        items: [...widget.items],
        links: widget.links.map((link) => ({ ...link })),
        health: widget.health ? { ...widget.health } : null,
      })),
    })),
    warnings: [],
  };
}

export async function mockSetPluginEnabled(
  id: string,
  enabled: boolean,
): Promise<PluginCatalog> {
  if (!allPlugins().some((plugin) => plugin.id === id)) {
    throw new Error(`未找到插件: ${id}`);
  }
  pluginOverrides[id] = enabled;
  return mockPluginCatalog();
}

export function mockPluginMarket(): PluginMarketEntry[] {
  const installed = new Set(allPlugins().map((plugin) => plugin.id));
  return [...pluginSeed, ...optionalSeed].map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    author: plugin.author,
    homepage: plugin.homepage,
    icon: plugin.icon,
    tags: [...plugin.tags],
    installed: installed.has(plugin.id),
    official: true,
  }));
}

export async function mockInstallPlugin(id: string): Promise<PluginCatalog> {
  const optional = optionalSeed.find((plugin) => plugin.id === id);
  if (!optional) {
    if (allPlugins().some((plugin) => plugin.id === id)) return mockPluginCatalog();
    throw new Error(`未找到插件: ${id}`);
  }
  if (!installedOptional.some((plugin) => plugin.id === id)) {
    installedOptional.push({
      ...optional,
      enabled: true,
      widgets: optional.widgets.map((widget) => ({
        ...widget,
        items: [...widget.items],
        links: widget.links.map((link) => ({ ...link })),
        health: widget.health ? { ...widget.health } : null,
      })),
    });
  }
  return mockPluginCatalog();
}

export async function mockInstallPluginFromPath(path: string): Promise<PluginCatalog> {
  if (!path.trim()) throw new Error("插件路径不能为空");
  const id = "local.demo";
  if (allPlugins().some((plugin) => plugin.id === id)) {
    throw new Error("插件 local.demo 已安装");
  }
  installedOptional.push({
    id,
    name: "本地示例插件",
    version: "0.1.0",
    description: `从 ${path.trim()} 安装的本地插件。`,
    author: "本地",
    icon: "note",
    homepage: null,
    tags: ["本地"],
    enabled: true,
    builtin: false,
    path: `${path.trim().replace(/[\\/]+$/, "")}\\plugin.json`,
    widgets: [
      {
        id: "local",
        title: "本地插件",
        kind: "note",
        body: "浏览器预览中的本地安装占位实现。",
        items: [],
        links: [],
        health: null,
      },
    ],
  });
  return mockPluginCatalog();
}

export async function mockRemovePlugin(id: string): Promise<PluginCatalog> {
  const index = installedOptional.findIndex((plugin) => plugin.id === id);
  if (index < 0) {
    if (pluginSeed.some((plugin) => plugin.id === id)) {
      throw new Error("内置插件不能移除");
    }
    throw new Error(`未找到插件: ${id}`);
  }
  installedOptional.splice(index, 1);
  delete pluginOverrides[id];
  return mockPluginCatalog();
}

export async function mockRescanPlugins(): Promise<PluginCatalog> {
  return mockPluginCatalog();
}

export function mockOpenPluginDirectory(): string {
  return mockPluginCatalog().directory;
}

const logSourceSeed: LogSource[] = [
  {
    id: "application",
    name: "应用程序",
    kind: "eventlog",
    description: "Windows Application 通道，含应用崩溃与安装事件",
    available: true,
  },
  {
    id: "system",
    name: "系统",
    kind: "eventlog",
    description: "Windows System 通道，含驱动、服务与内核事件",
    available: true,
  },
  {
    id: "security",
    name: "安全",
    kind: "eventlog",
    description: "Windows Security 通道，读取需要管理员权限",
    available: true,
  },
];

function logTime(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

const logSeed: LogEntry[] = [
  {
    id: "application-1000",
    timestamp: logTime(4),
    level: "error",
    channel: "Application",
    provider: "Application Error",
    eventId: 1000,
    message: "demo.exe · 0xc0000005 · 0x0000000000001234",
    computer: "OPS-WS-042",
    user: "S-1-5-21-1004",
    fields: [
      { name: "Faulting application", value: "demo.exe" },
      { name: "Exception code", value: "0xc0000005" },
      { name: "Fault offset", value: "0x0000000000001234" },
    ],
  },
  {
    id: "system-7036",
    timestamp: logTime(12),
    level: "information",
    channel: "System",
    provider: "Service Control Manager",
    eventId: 7036,
    message: "Docker Desktop Service 服务已进入正在运行状态。",
    computer: "OPS-WS-042",
    user: "S-1-5-18",
    fields: [
      { name: "Service", value: "Docker Desktop Service" },
      { name: "State", value: "running" },
    ],
  },
  {
    id: "system-7000",
    timestamp: logTime(28),
    level: "error",
    channel: "System",
    provider: "Service Control Manager",
    eventId: 7000,
    message: "Windows Update 服务启动失败，错误 1053。",
    computer: "OPS-WS-042",
    user: "S-1-5-18",
    fields: [
      { name: "Service", value: "wuauserv" },
      { name: "Error", value: "1053" },
    ],
  },
  {
    id: "application-1026",
    timestamp: logTime(41),
    level: "warning",
    channel: "Application",
    provider: ".NET Runtime",
    eventId: 1026,
    message: "托管运行时检测到未处理的异常，进程已终止。",
    computer: "OPS-WS-042",
    user: null,
    fields: [
      { name: "Application", value: "OpsAgent.exe" },
      { name: "Exception", value: "System.Net.Http.HttpRequestException" },
    ],
  },
  {
    id: "security-4624",
    timestamp: logTime(55),
    level: "information",
    channel: "Security",
    provider: "Microsoft-Windows-Security-Auditing",
    eventId: 4624,
    message: "已成功登录帐户。",
    computer: "OPS-WS-042",
    user: "S-1-5-21-1004",
    fields: [
      { name: "Logon type", value: "3" },
      { name: "Account", value: "OPS-WS-042\\ops" },
    ],
  },
  {
    id: "system-1074",
    timestamp: logTime(74),
    level: "information",
    channel: "System",
    provider: "User32",
    eventId: 1074,
    message: "系统已由用户启动关机流程。",
    computer: "OPS-WS-042",
    user: "S-1-5-21-1004",
    fields: [
      { name: "Process", value: "explorer.exe" },
      { name: "Reason", value: "其他 (计划内)" },
    ],
  },
  {
    id: "application-11707",
    timestamp: logTime(96),
    level: "verbose",
    channel: "Application",
    provider: "MsiInstaller",
    eventId: 11707,
    message: "产品 Qingshan Toolbox 安装成功。",
    computer: "OPS-WS-042",
    user: "S-1-5-21-1004",
    fields: [
      { name: "Product", value: "Qingshan Toolbox" },
      { name: "Version", value: "0.3.0" },
    ],
  },
  {
    id: "system-6008",
    timestamp: logTime(130),
    level: "warning",
    channel: "System",
    provider: "EventLog",
    eventId: 6008,
    message: "上一次系统关机是意外的。",
    computer: "OPS-WS-042",
    user: null,
    fields: [{ name: "Last shutdown", value: "2026-10-29T22:31:12Z" }],
  },
];

export function mockLogSources(): LogSource[] {
  return logSourceSeed;
}

export function mockQueryLogs(query: LogQuery): LogBatch {
  const keyword = query.keyword.trim().toLowerCase();
  const matched = logSeed.filter(
    (entry) =>
      (!query.level || entry.level === query.level) &&
      (!keyword ||
        [entry.message, entry.provider, entry.channel, entry.computer, String(entry.eventId)]
          .join(" ")
          .toLowerCase()
          .includes(keyword)),
  );
  const entries = matched.slice(0, query.limit);
  return {
    source: query.source,
    entries,
    scanned: logSeed.length,
    total: matched.length,
    truncated: matched.length > entries.length,
  };
}

export function mockExportLogs(entries: LogEntry[]): LogExport {
  if (entries.length === 0) throw new Error("没有可导出的日志");
  return {
    path: `C:\\Users\\青衫\\Downloads\\qingshan-logs-${Date.now()}.csv`,
    count: entries.length,
  };
}

export function mockClearLogs(source: string): void {
  if (!source) throw new Error("日志来源不能为空");
}

let cleanupTargets: CleanupTarget[] = [
  { id: "user-temp", name: "用户临时文件", path: "%TEMP%", category: "temp", requiresAdmin: false, available: true, bytes: 2.4 * GB, files: 12480, note: "应用解压与安装残留，可安全删除" },
  { id: "windows-temp", name: "Windows 临时目录", path: "C:\\Windows\\Temp", category: "temp", requiresAdmin: true, available: true, bytes: 1.1 * GB, files: 4210, note: "系统级临时文件，需要管理员权限" },
  { id: "edge-cache", name: "Edge 浏览器缓存", path: "%LOCALAPPDATA%\\Microsoft\\Edge\\User Data\\Default\\Cache", category: "browser", requiresAdmin: false, available: true, bytes: 860 * 1024 ** 2, files: 9820, note: "不影响收藏、密码与登录状态" },
  { id: "chrome-cache", name: "Chrome 浏览器缓存", path: "%LOCALAPPDATA%\\Google\\Chrome\\User Data\\Default\\Cache", category: "browser", requiresAdmin: false, available: true, bytes: 420 * 1024 ** 2, files: 5110, note: "仅清理缓存，不清理用户数据" },
  { id: "crash-dumps", name: "崩溃转储", path: "%LOCALAPPDATA%\\CrashDumps", category: "windows", requiresAdmin: false, available: true, bytes: 630 * 1024 ** 2, files: 14, note: "应用崩溃日志，排查完成后可删除" },
  { id: "windows-update", name: "Windows Update 缓存", path: "C:\\Windows\\SoftwareDistribution\\Download", category: "windows", requiresAdmin: true, available: true, bytes: 3.2 * GB, files: 1830, note: "已安装更新的下载缓存" },
  { id: "recycle-bin", name: "回收站", path: "回收站", category: "recycle", requiresAdmin: false, available: true, bytes: 4.8 * GB, files: 236, note: "清空后无法恢复，请确认" },
];

export function mockCleanupScan(): CleanupScan {
  const targets = cleanupTargets.map((target) => ({ ...target }));
  return {
    targets,
    totalBytes: targets.reduce((sum, target) => sum + target.bytes, 0),
    totalFiles: targets.reduce((sum, target) => sum + target.files, 0),
    scannedAt: Math.floor(Date.now() / 1000),
  };
}

export function mockRunCleanup(ids: string[]): CleanupReport {
  const selected = cleanupTargets.filter((target) => ids.includes(target.id));
  const outcomes = selected.map((target) => ({
    id: target.id,
    name: target.name,
    freedBytes: target.bytes,
    removedFiles: target.files,
    errors: [],
  }));
  cleanupTargets = cleanupTargets.map((target) =>
    ids.includes(target.id) ? { ...target, bytes: 0, files: 0 } : target,
  );
  return {
    outcomes,
    freedBytes: outcomes.reduce((sum, outcome) => sum + outcome.freedBytes, 0),
    removedFiles: outcomes.reduce((sum, outcome) => sum + outcome.removedFiles, 0),
    errors: [],
  };
}

let startupSeed: StartupItem[] = [
  { id: "run:user:Code", name: "Visual Studio Code", command: "\"C:\\Program Files\\Microsoft VS Code\\Code.exe\" --background", location: "registryrun", scope: "user", enabled: true, editable: true },
  { id: "run:user:Docker", name: "Docker Desktop", command: "\"C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe\" --autostart", location: "registryrun", scope: "user", enabled: true, editable: true },
  { id: "run:machine:SecurityHealth", name: "Windows 安全中心", command: "%windir%\\system32\\SecurityHealthSystray.exe", location: "registryrun", scope: "machine", enabled: true, editable: true },
  { id: "folder:user:OneDrive", name: "OneDrive", command: "%LOCALAPPDATA%\\Microsoft\\OneDrive\\OneDrive.exe /background", location: "startupfolder", scope: "user", enabled: false, editable: true },
];

export function mockStartupItems(): StartupItem[] {
  return startupSeed.map((item) => ({ ...item }));
}

export function mockSetStartupEnabled(id: string, enabled: boolean): StartupItem[] {
  startupSeed = startupSeed.map((item) => (item.id === id ? { ...item, enabled } : item));
  return mockStartupItems();
}

let taskSeed: ScheduledTask[] = [
  { id: "\\Microsoft\\Windows\\Defrag\\ScheduledDefrag", name: "ScheduledDefrag", path: "\\Microsoft\\Windows\\Defrag", state: "就绪", description: "驱动器碎片整理与优化", author: "Microsoft", enabled: true },
  { id: "\\Microsoft\\Windows\\UpdateOrchestrator\\Schedule Wake To Work", name: "Schedule Wake To Work", path: "\\Microsoft\\Windows\\UpdateOrchestrator", state: "就绪", description: "Windows 更新唤醒任务", author: "Microsoft", enabled: true },
  { id: "\\Qingshan\\NightlyInventory", name: "NightlyInventory", path: "\\Qingshan", state: "就绪", description: "夜间资产盘点与日志归档", author: "IT Operations", enabled: false },
];

export function mockScheduledTasks(): ScheduledTask[] {
  return taskSeed.map((task) => ({ ...task }));
}

export function mockSetTaskEnabled(id: string, enabled: boolean): ScheduledTask[] {
  taskSeed = taskSeed.map((task) => (task.id === id ? { ...task, enabled } : task));
  return mockScheduledTasks();
}

let softwareSeed: InstalledApp[] = [
  { id: "chrome", kind: "application", name: "Google Chrome", version: "130.0.6723.92", publisher: "Google LLC", installDate: "2026-09-18", installLocation: "C:\\Program Files\\Google\\Chrome\\Application", uninstallString: "C:\\Program Files\\Google\\Chrome\\Application\\setup.exe --uninstall", scope: "machine", registryView: "64-bit" },
  { id: "code", kind: "application", name: "Microsoft Visual Studio Code", version: "1.95.2", publisher: "Microsoft Corporation", installDate: "2026-10-02", installLocation: "C:\\Program Files\\Microsoft VS Code", uninstallString: "C:\\Program Files\\Microsoft VS Code\\unins000.exe", scope: "machine", registryView: "64-bit" },
  { id: "docker", kind: "application", name: "Docker Desktop", version: "4.35.1", publisher: "Docker Inc.", installDate: "2026-08-21", installLocation: "C:\\Program Files\\Docker\\Docker", uninstallString: "C:\\Program Files\\Docker\\Docker\\Docker Desktop Installer.exe uninstall", scope: "machine", registryView: "64-bit" },
  { id: "git", kind: "application", name: "Git", version: "2.55.0", publisher: "The Git Development Community", installDate: "2026-07-11", installLocation: "C:\\Program Files\\Git", uninstallString: "C:\\Program Files\\Git\\unins000.exe", scope: "machine", registryView: "64-bit" },
  { id: "node", kind: "application", name: "Node.js", version: "22.23.1", publisher: "OpenJS Foundation", installDate: "2026-09-01", installLocation: "C:\\Program Files\\nodejs", uninstallString: "MsiExec.exe /X{12345678-1234-1234-1234-123456789012}", scope: "machine", registryView: "64-bit" },
  { id: "postgres", kind: "application", name: "PostgreSQL 17", version: "17.2", publisher: "PostgreSQL Global Development Group", installDate: "2026-06-15", installLocation: "C:\\Program Files\\PostgreSQL\\17", uninstallString: "C:\\Program Files\\PostgreSQL\\17\\uninstall-postgresql.exe", scope: "machine", registryView: "64-bit" },
  { id: "rust", kind: "application", name: "Rustup", version: "1.99.1", publisher: "The Rust Project", installDate: "2026-10-20", installLocation: "C:\\Users\\Public\\.rustup", uninstallString: "C:\\Users\\Public\\.rustup\\uninstall.exe", scope: "user", registryView: "64-bit" },
  { id: "wechat", kind: "application", name: "微信", version: "4.0.1", publisher: "Tencent", installDate: "2026-10-05", installLocation: "C:\\Program Files\\Tencent\\WeChat", uninstallString: "C:\\Program Files\\Tencent\\WeChat\\Uninstall.exe", scope: "machine", registryView: "32-bit" },
  { id: "intel-graphics", kind: "driver", name: "Intel(R) Graphics Software & Drivers", version: "31.0.101.5382", publisher: "Intel Corporation", installDate: "2026-10-12", installLocation: "C:\\Program Files\\Intel\\Intel(R) Graphics Software & Drivers", uninstallString: "C:\\Program Files\\Intel\\Intel(R) Graphics Software & Drivers\\Uninstaller.exe --uninstaller", scope: "machine", registryView: "64-bit" },
  { id: "intel-dsa", kind: "driver", name: "Intel(R) Driver & Support Assistant", version: "25.2.0.6", publisher: "Intel Corporation", installDate: "2026-08-30", installLocation: "C:\\Program Files\\Intel\\Intel Driver && Support Assistant", uninstallString: "MsiExec.exe /X{2C633E0E-1F95-42CC-95D8-63C12DD9672F}", scope: "machine", registryView: "64-bit" },
  { id: "dotnet-runtime", kind: "runtime", name: "Microsoft .NET Runtime - 10.0.7 (x64)", version: "10.0.7", publisher: "Microsoft Corporation", installDate: "2026-09-10", installLocation: "C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App", uninstallString: "C:\\Program Files\\dotnet\\shared\\Microsoft.NETCore.App\\10.0.7\\dotnet-runtime.exe uninstall", scope: "machine", registryView: "64-bit" },
  { id: "vcpp-redist", kind: "runtime", name: "Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.44.35211", version: "14.44.35211", publisher: "Microsoft Corporation", installDate: "2026-07-12", installLocation: "", uninstallString: "MsiExec.exe /X{9A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D}", scope: "machine", registryView: "64-bit" },
  { id: "other-runtime", kind: "other", name: "Microsoft Windows Desktop Runtime - 10.0.7 (x64)", version: "10.0.7", publisher: "Microsoft Corporation", installDate: "2026-09-10", installLocation: "C:\\Program Files\\dotnet\\shared\\Microsoft.WindowsDesktop.App", uninstallString: "", scope: "machine", registryView: "64-bit" },
  { id: "other-oem", kind: "other", name: "OEM 系统组件", version: "1.0.0", publisher: "设备制造商", installDate: "2026-06-01", installLocation: "C:\\Program Files\\OEM", uninstallString: "", scope: "machine", registryView: "64-bit" },
];

export function mockInstalledApps(): InstalledApp[] {
  return softwareSeed.map((app) => ({ ...app }));
}

export function mockUninstallSoftware(id: string): void {
  softwareSeed = softwareSeed.filter((app) => app.id !== id);
}
