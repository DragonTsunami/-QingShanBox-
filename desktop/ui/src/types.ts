export interface DiskInfo {
  name: string;
  mountPoint: string;
  fileSystem: string;
  total: number;
  available: number;
  removable: boolean;
}

export interface SystemSnapshot {
  hostname: string;
  osName: string;
  osVersion: string;
  kernelVersion: string;
  arch: string;
  uptimeSecs: number;
  bootTime: number;
  cpuBrand: string;
  physicalCores: number;
  logicalCores: number;
  cpuUsage: number;
  perCoreUsage: number[];
  memoryTotal: number;
  memoryUsed: number;
  swapTotal: number;
  swapUsed: number;
  disks: DiskInfo[];
  isElevated: boolean;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  exe: string | null;
  command: string;
  cpuUsage: number;
  memory: number;
  virtualMemory: number;
  status: string;
  user: string | null;
  startTime: number;
}

export type ServiceStatus =
  | "running"
  | "stopped"
  | "startpending"
  | "stoppending"
  | "paused"
  | "pausepending"
  | "continuepending"
  | "unknown";

export type ServiceAction = "start" | "stop" | "restart";

export interface ServiceInfo {
  name: string;
  displayName: string;
  status: ServiceStatus;
  startType: string;
  processId: number;
  canStop: boolean;
}

export interface NetworkInterface {
  name: string;
  mac: string;
  ipv4: string[];
  ipv6: string[];
  isLoopback: boolean;
  isUp: boolean;
  totalReceived: number;
  totalTransmitted: number;
}

export interface PortCheckResult {
  host: string;
  port: number;
  open: boolean;
  latencyMs: number;
  error: string | null;
}

export interface DnsLookupResult {
  host: string;
  addresses: string[];
  latencyMs: number;
  error: string | null;
}

export interface AppInfo {
  name: string;
  version: string;
  coreVersion: string;
  buildProfile: string;
  platform: string;
  isElevated: boolean;
}

export type PluginWidgetKind = "note" | "checklist" | "links" | "health";

export interface PluginLink {
  label: string;
  url: string;
}

export interface PluginHealthRule {
  memoryMaxPercent: number;
  systemDiskMaxPercent: number;
  requireElevation: boolean;
}

export interface PluginWidget {
  id: string;
  title: string;
  kind: PluginWidgetKind;
  body: string;
  items: string[];
  links: PluginLink[];
  health: PluginHealthRule | null;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon: string | null;
  homepage: string | null;
  tags: string[];
  enabled: boolean;
  builtin: boolean;
  path: string;
  widgets: PluginWidget[];
}

export interface PluginCatalog {
  directory: string;
  plugins: PluginInfo[];
  warnings: string[];
}

export interface PluginMarketEntry {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string | null;
  icon: string | null;
  tags: string[];
  installed: boolean;
  official: boolean;
}

export type LogSourceKind = "eventlog" | "file";

export type LogLevel =
  | "critical"
  | "error"
  | "warning"
  | "information"
  | "verbose"
  | "unknown";

export interface LogSource {
  id: string;
  name: string;
  kind: LogSourceKind;
  description: string;
  available: boolean;
}

export interface LogField {
  name: string;
  value: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  channel: string;
  provider: string;
  eventId: number;
  message: string;
  computer: string;
  user: string | null;
  fields: LogField[];
}

export interface LogQuery {
  source: string;
  level: LogLevel | null;
  keyword: string;
  limit: number;
  days: number;
}

export interface LogBatch {
  source: string;
  entries: LogEntry[];
  scanned: number;
  total: number;
  truncated: boolean;
}

export interface LogExport {
  path: string;
  count: number;
}

export type CleanupCategory = "temp" | "browser" | "windows" | "recycle";

export interface CleanupTarget {
  id: string;
  name: string;
  path: string;
  category: CleanupCategory;
  requiresAdmin: boolean;
  available: boolean;
  bytes: number;
  files: number;
  note: string;
}

export interface CleanupScan {
  targets: CleanupTarget[];
  totalBytes: number;
  totalFiles: number;
  scannedAt: number;
}

export interface CleanupOutcome {
  id: string;
  name: string;
  freedBytes: number;
  removedFiles: number;
  errors: string[];
}

export interface CleanupReport {
  outcomes: CleanupOutcome[];
  freedBytes: number;
  removedFiles: number;
  errors: string[];
}

export type StartupScope = "user" | "machine";
export type StartupLocation = "registryrun" | "startupfolder";

export interface StartupItem {
  id: string;
  name: string;
  command: string;
  location: StartupLocation;
  scope: StartupScope;
  enabled: boolean;
  editable: boolean;
}

export interface ScheduledTask {
  id: string;
  name: string;
  path: string;
  state: string;
  description: string;
  author: string;
  enabled: boolean;
}

export type SoftwareScope = "user" | "machine";
export type SoftwareKind = "application" | "driver" | "runtime" | "other";

export interface InstalledApp {
  id: string;
  kind: SoftwareKind;
  name: string;
  version: string;
  publisher: string;
  installDate: string;
  installLocation: string;
  uninstallString: string;
  scope: SoftwareScope;
  registryView: string;
  icon?: string | null;
  lastUsed?: number | null;
}

export interface BatteryInfo {
  name: string;
  chargePercent: number | null;
  status: string;
  estimatedMinutes: number | null;
}

export interface DiskHealth {
  name: string;
  mediaType: string;
  health: string;
  operationalStatus: string;
  sizeBytes: number;
}

export interface GpuInfo {
  name: string;
  driverVersion: string;
  memoryBytes: number;
}

export interface SystemDiagnostics {
  collectedAt: string;
  battery: BatteryInfo | null;
  disks: DiskHealth[];
  gpus: GpuInfo[];
}

export interface QuickAction {
  id: string;
  name: string;
  description: string;
  requiresAdmin: boolean;
}

export interface QuickActionResult {
  action: string;
  message: string;
}

export interface UpdateCheck {
  currentVersion: string;
  latestVersion: string | null;
  available: boolean;
  releaseUrl: string | null;
  publishedAt: string | null;
}

export type PageKey =
  | "plugins"
  | "overview"
  | "diagnostics"
  | "processes"
  | "services"
  | "network"
  | "logs"
  | "cleanup"
  | "startup"
  | "software"
  | "settings";
