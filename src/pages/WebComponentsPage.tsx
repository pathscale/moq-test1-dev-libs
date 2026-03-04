import { Show, createEffect, createSignal } from "solid-js";
import * as Moq from "@moq/lite";

import { useTestSession } from "../hooks/useTestSession";
import {
  SectionCard,
  TestShell,
} from "../components/TestShell";
import {
  WatchOverlayShowcase,
  WatchWebComponentShowcase,
} from "../scenarios/web-components/WatchShowcases";
import { applyTransportPolicy } from "../utils/transportPolicy";
import "@moq/publish/element";
import "@moq/publish/ui";

type MoqElement = HTMLElement & {
  connection: Moq.Connection.Reload;
  url: string | URL | undefined;
  name: string | undefined;
};

export function WebComponentsPage() {
  const session = useTestSession();
  const [showJsApi, setShowJsApi] = createSignal(true);
  const [showWebComponent, setShowWebComponent] = createSignal(true);
  const [showSolidOverlay, setShowSolidOverlay] = createSignal(true);
  let publishElement: MoqElement | undefined;

  createEffect(() => {
    const element = publishElement;
    if (!element) return;
    applyTransportPolicy(element.connection);
    element.url = session.resolvedSectionRelayUrl();
    element.name = session.localPublishPath();
  });

  return (
    <TestShell
      title="MoQ Web Components"
      subtitle="Current publish and watch harness using the official MoQ web components."
      session={session}
      debugPanel={{
        connectionStatus: session.connectionStatus,
        roomName: session.joinedRoomName,
        publishingAudio: () => undefined,
        speakerOn: () => undefined,
        participantCount: () =>
          session.participants().length + (session.joined() ? 1 : 0),
        pubRms: () => undefined,
        subRms: () => undefined,
        diagLog: session.diagLog,
      }}
    >
      <SectionCard
        title="Section A -> Web Component Publish"
        subtitle="Official <moq-publish> mounted in the existing join-driven harness."
        enabled={showJsApi}
        setEnabled={setShowJsApi}
      >
        <Show when={session.joined()}>
          <div class="space-y-4">
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
    </TestShell>
  );
}
