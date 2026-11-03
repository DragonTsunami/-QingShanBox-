import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "antd";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort UI boundary. A rendering bug must not leave the operator with a
 * blank window; platform data is untouched because the frontend never mutates
 * it directly.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("青衫工具箱 UI crashed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="fatal-screen">
        <div className="fatal-card">
          <div className="fatal-mark">&gt;_</div>
          <div className="fatal-eyebrow">QINGSHAN TOOLBOX / UI FAULT</div>
          <h1>界面遇到异常</h1>
          <p>
            界面层已停止渲染，系统数据未被修改。请重新加载；若问题持续，请保留控制台信息并联系维护者。
          </p>
          <pre>{error.message}</pre>
          <Button type="primary" onClick={() => window.location.reload()}>
            重新加载
          </Button>
        </div>
      </div>
    );
  }
}
