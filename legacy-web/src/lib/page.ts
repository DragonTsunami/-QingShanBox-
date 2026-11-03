import type { DevopsClient, PageKey, Settings } from "./types";

export interface PageProps {
  client: DevopsClient;
  settings: Settings;
  onNavigate: (page: PageKey) => void;
}
