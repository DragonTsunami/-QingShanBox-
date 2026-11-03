import { ClockCircleOutlined, CloudServerOutlined, DesktopOutlined, MoonOutlined, ReloadOutlined, SunOutlined } from "@ant-design/icons";
import { Button, Select, Tag, Tooltip } from "antd";
import { useEffect, useState } from "react";
import { REFRESH_INTERVALS } from "../preferences";

interface TopBarProps {
  title: string;
  subtitle: string;
  hostname: string | null;
  mode: "demo" | "agent";
  agentConnected: boolean | null;
  dark: boolean;
  onToggleTheme: () => void;
  refreshing: boolean;
  refreshInterval: number;
  onRefreshIntervalChange: (seconds: number) => void;
  onRefresh: () => void;
}

export default function TopBar({
  title,
  subtitle,
  hostname,
  mode,
  agentConnected,
  dark,
  onToggleTheme,
  refreshing,
  refreshInterval,
  onRefreshIntervalChange,
  onRefresh,
}: TopBarProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const modeTag =
    mode === "demo" ? (
      <Tag bordered={false} color="orange">
        演示数据
      </Tag>
    ) : agentConnected === false ? (
      <Tag bordered={false} color="red">
        agent 未连接
      </Tag>
    ) : (
      <Tag bordered={false} color="green">
        本地 agent
      </Tag>
    );

  return (
    <header className="topbar">
      <div className="topbar-copy">
        <div className="topbar-eyebrow">QINGSHAN / {title}</div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <div className="topbar-actions">
        {modeTag}
        <div className="host-pill">
          <span className="host-dot" />
          {mode === "agent" ? <CloudServerOutlined /> : <DesktopOutlined />}
          <span className="host-name">{hostname ?? "本机"}</span>
          <span className="host-time">
            {now.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <Tooltip title="页面数据的自动刷新间隔">
          <div className="refresh-interval">
            <ClockCircleOutlined />
            <Select
              aria-label="自动刷新间隔"
              variant="borderless"
              value={refreshInterval}
              onChange={onRefreshIntervalChange}
              options={REFRESH_INTERVALS.map((seconds) => ({
                value: seconds,
                label: `${seconds / 60} 分钟`,
              }))}
              popupMatchSelectWidth={false}
            />
          </div>
        </Tooltip>
        <Tooltip title={dark ? "切换到浅色主题" : "切换到深色主题"}>
          <Button
            className="theme-button"
            aria-label="切换主题"
            icon={dark ? <SunOutlined /> : <MoonOutlined />}
            onClick={onToggleTheme}
          />
        </Tooltip>
        <Tooltip title="重新采集当前页数据">
          <Button className="refresh-button" icon={<ReloadOutlined spin={refreshing} />} onClick={onRefresh}>
            刷新
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
