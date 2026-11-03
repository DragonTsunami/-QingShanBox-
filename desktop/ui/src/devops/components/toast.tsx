import { useEffect, useState } from "react";

export type ToastTone = "default" | "warn";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

let seq = 0;
let items: ToastItem[] = [];
const listeners = new Set<(next: ToastItem[]) => void>();

function emit(): void {
  for (const listener of listeners) listener(items);
}

/** 轻量提示：右下角浮层，2.6 秒后自动消失。 */
export function showToast(message: string, tone: ToastTone = "default"): void {
  const id = ++seq;
  items = [...items, { id, message, tone }];
  emit();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, 2600);
}

export function Toaster() {
  const [list, setList] = useState<ToastItem[]>(items);

  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  if (list.length === 0) return null;
  return (
    <div className="wb-toast-wrap" role="status" aria-live="polite">
      {list.map((item) => (
        <div key={item.id} className={item.tone === "warn" ? "wb-toast warn" : "wb-toast"}>
          {item.message}
        </div>
      ))}
    </div>
  );
}
