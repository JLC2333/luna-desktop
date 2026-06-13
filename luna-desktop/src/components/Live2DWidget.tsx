import { useEffect } from "react";

interface Live2DWidgetProps {
  visible: boolean;
}

/** 通过 body class 切换看板娘显示/隐藏 */
export default function Live2DWidget({ visible }: Live2DWidgetProps) {
  useEffect(() => {
    if (visible) {
      document.body.classList.add("waifu-active");
    } else {
      document.body.classList.remove("waifu-active");
    }
  }, [visible]);

  return null;
}

// 扩展 window 类型
declare global {
  interface Window {
    _l2dApp?: any;
    _initLive2D?: () => Promise<void>;
  }
}
