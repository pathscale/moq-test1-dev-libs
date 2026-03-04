import {
  Accessor,
  Component,
  For,
  Show,
  createEffect,
  createSignal,
} from "solid-js";
import * as Moq from "@moq/lite";

import { DebugPanel } from "./DebugPanel";
import { RELAY_OPTIONS } from "./helpers";
import { useTestSession } from "./hooks/useTestSession";
import {
  WatchOverlayShowcase,
  WatchWebComponentShowcase,
} from "./WatchShowcases";
import "@moq/publish/element";
import "@moq/publish/ui";

type MoqElement = HTMLElement & {
  connection: Moq.Connection.Reload;
  url: string | URL | undefined;
  name: string | undefined;
};

function SectionCard(props: {
  title: string;
  subtitle: string;
  enabled: Accessor<boolean>;
  setEnabled: (next: boolean) => void;
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
        <label class="inline-flex items-center gap-2 rounded-full border border-gray-700 bg-gray-950 px-3 py-1 text-sm text-gray-200">
          <input
            type="checkbox"
            checked={props.enabled()}
            onInput={(event) => props.setEnabled(event.currentTarget.checked)}
          />
          Enabled
        </label>
      </div>
      <Show when={props.enabled()}>{props.children}</Show>
    </section>
  );
}

export const TestCall: Component = () => {
  const session = useTestSession();
  const [showJsApi, setShowJsApi] = createSignal(true);
  const [showWebComponent, setShowWebComponent] = createSignal(true);
  const [showSolidOverlay, setShowSolidOverlay] = createSignal(true);
  let publishElement: MoqElement | undefined;

  createEffect(() => {
    const element = publishElement;
    if (!element) return;
    element.connection.websocket = { enabled: false };
    element.url = session.resolvedSectionRelayUrl();
    element.name = session.localPublishPath();
  });

  return (
    <div class="min-h-screen bg-gray-950 p-6 text-white">
      <div class="mx-auto max-w-6xl space-y-6">
        <div class="space-y-2">
          <h1 class="text-3xl font-bold">MoQ Watch Comparison Harness</h1>
          <p class="max-w-3xl text-sm text-gray-400">
            Side-by-side comparisons for the official MoQ publish and watch web
            components inside the existing test harness.
          </p>
        </div>

        <section class="space-y-4 rounded-xl border border-gray-800 bg-gray-900/60 p-5">
          <div class="space-y-1">
            <div class="text-xs font-medium uppercase tracking-[0.2em] text-gray-400">
              Shared Controls
            </div>
            <p class="text-sm text-gray-400">
              Relay and room are shared across all three sections. Sections B and
              C can optionally watch an explicit broadcast path.
            </p>
          </div>

          <div class="grid gap-4 md:grid-cols-2">
            <div class="space-y-2">
              <label class="block text-sm font-medium text-gray-300">
                Relay URL
              </label>
              <select
                value={session.relayUrl()}
                onChange={(event) =>
                  session.handleRelayUrlChange(event.currentTarget.value)
                }
                class="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
              >
                <For each={RELAY_OPTIONS}>
                  {(relay) => <option value={relay.url}>{relay.name}</option>}
                </For>
              </select>
            </div>

            <div class="space-y-2">
              <label class="block text-sm font-medium text-gray-300">
                Room
              </label>
              <input
                type="text"
                value={session.roomName()}
                onInput={(event) =>
                  session.handleNameChange(event.currentTarget.value)
                }
                class="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
                placeholder="my-room"
              />
            </div>
          </div>

          <div class="space-y-2">
            <label class="block text-sm font-medium text-gray-300">
              Watch Path Override
            </label>
            <input
              type="text"
              value={session.watchPathOverride()}
              onInput={(event) =>
                session.setWatchPathOverride(event.currentTarget.value)
              }
              class="w-full rounded border border-gray-700 bg-gray-950 px-3 py-2 text-white focus:border-blue-500 focus:outline-none"
              placeholder="Optional: anon/my-room/participant-id"
            />
            <p class="text-xs text-gray-500">
              If empty, Sections B and C watch the first discovered remote
              participant, or the current local publish path.
            </p>
          </div>

          <div class="grid gap-3 text-xs text-gray-400 md:grid-cols-2">
            <div class="rounded border border-gray-800 bg-gray-950/70 p-3">
              <div class="text-gray-500">Resolved relay URL</div>
              <div class="break-all pt-1 text-gray-200">
                {session.resolvedSectionRelayUrl() || "invalid relay URL"}
              </div>
            </div>
            <div class="rounded border border-gray-800 bg-gray-950/70 p-3">
              <div class="text-gray-500">Resolved watch name</div>
              <div class="break-all pt-1 text-gray-200">
                {session.resolvedWatchName()}
              </div>
            </div>
          </div>
        </section>

        <SectionCard
          title="Section A -> Web Component Publish"
          subtitle="Official <moq-publish> mounted in the existing join-driven harness."
          enabled={showJsApi}
          setEnabled={setShowJsApi}
        >
          <Show
            when={session.joined()}
            fallback={
              <button
                class="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={session.handleJoin}
                disabled={session.joining()}
              >
                <Show when={session.joining()}>
                  <span class="loading loading-spinner loading-sm" />
                </Show>
                {session.joining() ? "Connecting..." : "Join"}
              </button>
            }
          >
            <div class="space-y-4">
              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="rounded bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-700"
                  onClick={session.handleLeave}
                >
                  Leave
                </button>
              </div>

              <div class="grid gap-3 text-xs text-gray-400 md:grid-cols-2">
                <div class="rounded border border-gray-800 bg-gray-950/70 p-3">
                  <div class="text-gray-500">Active room path</div>
                  <div class="break-all pt-1 text-gray-200">
                    {session.joinedRelayPath()}
                  </div>
                </div>
                <div class="rounded border border-gray-800 bg-gray-950/70 p-3">
                  <div class="text-gray-500">Local publish path</div>
                  <div class="break-all pt-1 text-gray-200">
                    {session.localPublishPath()}
                  </div>
                </div>
              </div>

              <div class="overflow-hidden rounded-md border border-gray-800 bg-black">
                <moq-publish-ui class="block">
                  <moq-publish
                    ref={(element) => {
                      publishElement = element as MoqElement;
                    }}
                    class="block min-h-64 w-full"
                  >
                    <video muted autoplay class="h-full w-full bg-black" />
                  </moq-publish>
                </moq-publish-ui>
              </div>

              <DebugPanel
                connectionStatus={session.connectionStatus}
                roomName={session.joinedRoomName}
                publishingAudio={() => undefined}
                speakerOn={() => undefined}
                participantCount={() =>
                  session.participants().length + (session.joined() ? 1 : 0)
                }
                pubRms={() => undefined}
                subRms={() => undefined}
                diagLog={session.diagLog}
              />
            </div>
          </Show>
        </SectionCard>

        <SectionCard
          title="Section B -> Web Component"
          subtitle="Official bare <moq-watch> element with relay URL + watch target wiring."
          enabled={showWebComponent}
          setEnabled={setShowWebComponent}
        >
          <WatchWebComponentShowcase
            enabled={session.joined}
            relayUrl={session.resolvedSectionRelayUrl}
            watchName={session.resolvedWatchName}
          />
        </SectionCard>

        <SectionCard
          title="Section C -> SolidJS Overlay"
          subtitle="Official Solid-powered watch UI layered over the same <moq-watch> target."
          enabled={showSolidOverlay}
          setEnabled={setShowSolidOverlay}
        >
          <WatchOverlayShowcase
            enabled={session.joined}
            relayUrl={session.resolvedSectionRelayUrl}
            watchName={session.resolvedWatchName}
          />
        </SectionCard>
      </div>
    </div>
  );
};
