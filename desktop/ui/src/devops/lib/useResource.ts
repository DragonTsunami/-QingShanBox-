import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "./client";

export const RESOURCE_REFRESH_EVENT = "qingshan:resource-refresh";

export interface Resource<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  updatedAt: number | null;
}

/**
 * 统一的异步资源钩子：负责 loading / error / 手动刷新。
 * loader 用字符串签名做依赖，避免每帧新建函数导致无限请求。
 */
export function useResource<T>(loader: () => Promise<T>, signature: string): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    const handleRefresh = () => reload();
    window.addEventListener(RESOURCE_REFRESH_EVENT, handleRefresh);
    return () => window.removeEventListener(RESOURCE_REFRESH_EVENT, handleRefresh);
  }, [reload]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    loaderRef
      .current()
      .then((value) => {
        if (!alive) return;
        setData(value);
        setUpdatedAt(Date.now());
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(errorText(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [signature, tick]);

  return { data, loading, error, reload, updatedAt };
}
