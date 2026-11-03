import type { DevopsClient, PageKey, Settings } from "./types";

export interface PageProps {
  client: DevopsClient;
  settings: Settings;
  onNavigate: (page: PageKey) => void;
  /** 页面里改设置（比如填 GitHub 令牌）时回写到顶层，和设置页保存走同一条路 */
  onSettings?: (next: Settings) => void;
}
