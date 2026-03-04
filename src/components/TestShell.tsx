import { Accessor, Component, Show } from "solid-js";

import { DebugPanel, type DebugPanelProps } from "../DebugPanel";
import { useTestSession } from "../hooks/useTestSession";
import { TestControls } from "./TestControls";

type Session = ReturnType<typeof useTestSession>;

export function SectionCard(props: {
  title: string;
  subtitle: string;
  enabled?: Accessor<boolean>;
  setEnabled?: (next: boolean) => void;
  children: any;
}) {
  return (
    <section class="space-y-4 rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div class="space-y-1">
          <div class="text-xs font-medium uppercase tracking-[0.2em] text-blue-300">
            {props.title}
          </div>
          <p class="text-sm text-gray-400">{props.subtitle}</p>
        </div>
        <Show when={props.enabled && props.setEnabled}>
          <label class="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={props.enabled?.()}
              onInput={(event) => props.setEnabled?.(event.currentTarget.checked)}
            />
            Enabled
          </label>
        </Show>
      </div>
      <Show when={props.enabled ? props.enabled() : true}>{props.children}</Show>
    </section>
  );
}

export const TestShell: Component<{
  title: string;
  subtitle: string;
  controlsDescription?: string;
  session: Session;
  debugPanel: DebugPanelProps;
  children: any;
}> = (props) => {
  return (
    <div class="min-h-screen bg-gray-950 p-6 text-white">
      <div class="mx-auto max-w-6xl space-y-6">
        <div class="space-y-2">
          <h1 class="text-3xl font-bold">{props.title}</h1>
          <p class="max-w-3xl text-sm text-gray-400">{props.subtitle}</p>
        </div>

        <TestControls
          session={props.session}
          description={props.controlsDescription}
        />

        {props.children}

        <section class="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
          <DebugPanel {...props.debugPanel} />
        </section>
      </div>
    </div>
  );
};
