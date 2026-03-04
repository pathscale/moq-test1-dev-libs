import type { JSX } from "solid-js";

declare module "solid-js" {
  namespace JSX {
    interface IntrinsicElements {
      "moq-publish": {
        url?: string;
        name?: string;
        muted?: boolean;
        invisible?: boolean;
        source?: string;
        ref?: (element: HTMLElement) => void;
        class?: string;
        style?: string | JSX.CSSProperties;
        children?: JSX.Element;
      };
      "moq-publish-ui": {
        class?: string;
        style?: string | JSX.CSSProperties;
        children?: JSX.Element;
      };
      "moq-watch": {
        url?: string;
        name?: string;
        paused?: boolean;
        muted?: boolean;
        volume?: number | string;
        reload?: boolean;
        jitter?: number | string;
        ref?: (element: HTMLElement) => void;
        class?: string;
        style?: string | JSX.CSSProperties;
        children?: JSX.Element;
      };
      "moq-watch-ui": {
        class?: string;
        style?: string | JSX.CSSProperties;
        children?: JSX.Element;
      };
    }
  }
}
