import {
  Accessor,
  Component,
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
} from "solid-js";
import { useParams } from "@solidjs/router";
import * as Moq from "@moq/lite";
import { createAccessor } from "@moq/signals/solid";

import { DebugPanel } from "./DebugPanel";
import {
  diagTime,
  getOrCreateRelayUrl,
  getOrCreateStreamName,
  RELAY_OPTIONS,
  normalizePath,
} from "./helpers";
import type { DiagEvent } from "./types";
import {
  WatchOverlayShowcase,
  WatchWebComponentShowcase,
} from "./WatchShowcases";
import "@moq/publish/element";
import "@moq/publish/ui";

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
  const [diagLog, setDiagLog] = createSignal<DiagEvent[]>([]);
  const log = (tag: string, msg: string) => {
    const evt = { t: diagTime(), tag, msg };
    console.log(`[${evt.t}ms] [${tag}] ${msg}`);
    setDiagLog((prev) => [evt, ...prev].slice(0, 50));
  };

  const params = useParams<{ streamName?: string }>();
  const urlStream = () =>
    params.streamName?.toLowerCase().replace(/[^a-z0-9-]/g, "");

  const [roomName, setRoomName] = createSignal(
    urlStream() || getOrCreateStreamName(),
  );
  const [relayUrl, setRelayUrl] = createSignal(getOrCreateRelayUrl());
  const [watchPathOverride, setWatchPathOverride] = createSignal("");

  const handleNameChange = (value: string) => {
    const clean = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setRoomName(clean);
    localStorage.setItem("moq-test-stream-name", clean);
  };

  const handleRelayUrlChange = (value: string) => {
    setRelayUrl(value);
    localStorage.setItem("moq-relay-url", value);
    window.location.reload();
  };

  const connection = new Moq.Connection.Reload({
    enabled: false,
    websocket: {
      enabled: false,
    },
  });
  const connectionStatus = createAccessor(connection.status);
  const establishedConnection = createAccessor(connection.established);
  const broadcastId = crypto.randomUUID().slice(0, 8);

  const [joinConfig, setJoinConfig] = createSignal<{
    relayUrl: string;
    roomName: string;
  }>();
  const joinedRoomName = () => joinConfig()?.roomName ?? roomName();
  const joinedRelayUrl = () => joinConfig()?.relayUrl ?? relayUrl();

  const getRoomPrefix = (name: string) => `anon/${name}`;
  const getPublishName = (prefix: string) => `${prefix}/${broadcastId}`;

  const joinedRelayPath = () => getRoomPrefix(joinedRoomName());
  const localPublishPath = () => getPublishName(joinedRelayPath());

  const [participants, setParticipants] = createSignal<string[]>([]);

  const resolvedWatchName = () => {
    const override = normalizePath(watchPathOverride());
    if (override) return override;
    const remote = participants()[0];
    return remote ?? localPublishPath();
  };

  const resolvedSectionRelayUrl = () => {
    try {
      return new URL(joinedRelayUrl()).toString();
    } catch {
      return undefined;
    }
  };

  const addParticipant = (path: string) => {
    setParticipants((prev) => {
      if (prev.includes(path)) return prev;
      return [...prev, path];
    });
  };

  const removeParticipant = (path: string) => {
    setParticipants((prev) => prev.filter((participant) => participant !== path));
  };

  createEffect(() => {
    const conn = establishedConnection();
    if (!conn || !joinConfig()) return;

    const prefixText = joinedRelayPath();
    const localPath = localPublishPath();
    const prefix = Moq.Path.from(prefixText);
    const announced = conn.announced(prefix);
    let closed = false;

    log("announced", `listening on prefix: ${prefixText}`);

    onCleanup(() => {
      closed = true;
      announced.close();
    });

    void (async () => {
      try {
        for (;;) {
          const update = await announced.next();
          if (!update) {
            log("announced", "loop ended");
            break;
          }

          const path = String(update.path);
          log("announced", `event active=${update.active} path=${path}`);

          if (path === localPath) {
            log("announced", `ignoring local broadcast: ${path}`);
            continue;
          }

          if (update.active) {
            addParticipant(path);
            log("announced", `remote active: ${path}`);
          } else {
            removeParticipant(path);
            log("announced", `remote inactive: ${path}`);
          }
        }
      } catch (error) {
        if (!closed) {
          log("announced", `ERROR: ${error}`);
        }
      }
    })();
  });

  const [joined, setJoined] = createSignal(false);
  const [joining, setJoining] = createSignal(false);
  const [showJsApi, setShowJsApi] = createSignal(true);
  const [showWebComponent, setShowWebComponent] = createSignal(true);
  const [showSolidOverlay, setShowSolidOverlay] = createSignal(true);

  const handleJoin = () => {
    setJoining(true);

    const currentRelayUrl = relayUrl().trim();
    const currentRoomName = roomName().trim();
    if (!currentRelayUrl || !currentRoomName) {
      log("conn", "relay URL and room are required");
      setJoining(false);
      return;
    }

    let url: URL;
    try {
      url = new URL(currentRelayUrl);
    } catch {
      log("conn", "invalid relay URL");
      setJoining(false);
      return;
    }

    const relayPath = getRoomPrefix(currentRoomName);
    const publishName = getPublishName(relayPath);

    setParticipants([]);
    setJoinConfig({ relayUrl: currentRelayUrl, roomName: currentRoomName });
    connection.url.set(url);
    connection.enabled.set(true);

    log("conn", `join room prefix: ${relayPath}`);
    log("conn", `join publish name: ${publishName}`);
    log("conn", "connection enabled");

    setJoined(true);
    setJoining(false);
  };

  const handleLeave = () => {
    connection.url.set(undefined);
    connection.enabled.set(false);
    setParticipants([]);
    setJoinConfig(undefined);
    setJoined(false);
    log("conn", "disconnected");
  };

  const handleBeforeUnload = () => {
    log("conn", "beforeunload -> leave");
    handleLeave();
  };

  window.addEventListener("beforeunload", handleBeforeUnload);

  onCleanup(() => {
    window.removeEventListener("beforeunload", handleBeforeUnload);
    handleLeave();
    connection.close();
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
                value={relayUrl()}
                onChange={(event) =>
                  handleRelayUrlChange(event.currentTarget.value)
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
                value={roomName()}
                onInput={(event) => handleNameChange(event.currentTarget.value)}
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
              value={watchPathOverride()}
              onInput={(event) => setWatchPathOverride(event.currentTarget.value)}
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
                {resolvedSectionRelayUrl() || "invalid relay URL"}
              </div>
            </div>
            <div class="rounded border border-gray-800 bg-gray-950/70 p-3">
              <div class="text-gray-500">Resolved watch name</div>
              <div class="break-all pt-1 text-gray-200">
                {resolvedWatchName()}
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
            when={joined()}
            fallback={
              <button
                class="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 font-medium hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={handleJoin}
                disabled={joining()}
              >
                <Show when={joining()}>
                  <span class="loading loading-spinner loading-sm" />
                </Show>
                {joining() ? "Connecting..." : "Join"}
              </button>
            }
          >
            <div class="space-y-4">
              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="rounded bg-red-600 px-4 py-2 text-sm font-medium hover:bg-red-700"
                  onClick={handleLeave}
                >
                  Leave
                </button>
              </div>

              <div class="grid gap-3 text-xs text-gray-400 md:grid-cols-2">
                <div class="rounded border border-gray-800 bg-gray-950/70 p-3">
                  <div class="text-gray-500">Active room path</div>
                  <div class="break-all pt-1 text-gray-200">
                    {joinedRelayPath()}
                  </div>
                </div>
                <div class="rounded border border-gray-800 bg-gray-950/70 p-3">
                  <div class="text-gray-500">Local publish path</div>
                  <div class="break-all pt-1 text-gray-200">
                    {localPublishPath()}
                  </div>
                </div>
              </div>

              <div class="overflow-hidden rounded-md border border-gray-800 bg-black">
                <moq-publish-ui class="block">
                  <moq-publish
                    url={resolvedSectionRelayUrl()}
                    name={localPublishPath()}
                    class="block min-h-64 w-full"
                  >
                    <video muted autoplay class="h-full w-full bg-black" />
                  </moq-publish>
                </moq-publish-ui>
              </div>

              <DebugPanel
                connectionStatus={connectionStatus}
                roomName={joinedRoomName}
                publishingAudio={() => undefined}
                speakerOn={() => undefined}
                participantCount={() =>
                  participants().length + (joined() ? 1 : 0)
                }
                pubRms={() => undefined}
                subRms={() => undefined}
                diagLog={diagLog}
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
            enabled={joined}
            relayUrl={resolvedSectionRelayUrl}
            watchName={resolvedWatchName}
          />
        </SectionCard>

        <SectionCard
          title="Section C -> SolidJS Overlay"
          subtitle="Official Solid-powered watch UI layered over the same <moq-watch> target."
          enabled={showSolidOverlay}
          setEnabled={setShowSolidOverlay}
        >
          <WatchOverlayShowcase
            enabled={joined}
            relayUrl={resolvedSectionRelayUrl}
            watchName={resolvedWatchName}
          />
        </SectionCard>
      </div>
    </div>
  );
};
