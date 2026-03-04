import { Show } from "solid-js";

import { useTestSession } from "../hooks/useTestSession";
import {
  SectionCard,
  TestShell,
} from "../components/TestShell";
import { WatchOverlayShowcase } from "../scenarios/web-components/WatchShowcases";

export function SolidOverlayPage() {
  const session = useTestSession();

  return (
    <TestShell
      title="MoQ Solid Overlay"
      subtitle="Isolated test page for the Solid-powered MoQ watch overlay."
      session={session}
      debugPanel={{
        connectionStatus: session.connectionStatus,
        roomName: session.joinedRoomName,
        publishingAudio: () => undefined,
        speakerOn: () => undefined,
        participantCount: () => session.participants().length,
        pubRms: () => undefined,
        subRms: () => undefined,
        diagLog: session.diagLog,
      }}
    >
      <SectionCard
        title="Overlay Scenario"
        subtitle="Overlay-only watch page using the shared session state and announce discovery."
      >
        <Show when={session.joined()}>
          <div class="space-y-4">
            <WatchOverlayShowcase
              enabled={session.joined}
              relayUrl={session.resolvedSectionRelayUrl}
              watchName={session.resolvedWatchName}
            />
          </div>
        </Show>
      </SectionCard>
    </TestShell>
  );
}
