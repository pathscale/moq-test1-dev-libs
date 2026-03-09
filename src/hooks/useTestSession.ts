import { useParams } from "@solidjs/router";
import * as Moq from "@moq/lite";
import { createAccessor } from "@moq/signals/solid";
import { createEffect, createSignal, onCleanup } from "solid-js";

import {
  diagTime,
  getOrCreateRelayUrl,
  getOrCreateStreamName,
  normalizePath,
} from "../helpers";
import type { DiagEvent } from "../types";
import { applyTransportPolicy } from "../utils/transportPolicy";

export function useTestSession() {
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
  const [joinConfig, setJoinConfig] = createSignal<{
    relayUrl: string;
    roomName: string;
  }>();
  const [joining, setJoining] = createSignal(false);
  const [joined, setJoined] = createSignal(false);
  const [participants, setParticipants] = createSignal<string[]>([]);

  const connection = applyTransportPolicy(
    new Moq.Connection.Reload({
      enabled: false,
    }),
  );
  const connectionStatus = createAccessor(connection.status);
  const establishedConnection = createAccessor(connection.established);
  const [overrideEstablished, setOverrideEstablished] = createSignal<
    (() => ReturnType<typeof connection.established.get>) | undefined
  >(undefined);

  const activeEstablished = () => {
    const override = overrideEstablished();
    return override ? override() : establishedConnection();
  };

  const useExternalConnection = (conn: Moq.Connection.Reload) => {
    setOverrideEstablished(() => createAccessor(conn.established));
  };
  const broadcastId = crypto.randomUUID().slice(0, 8);

  const joinedRoomName = () => joinConfig()?.roomName ?? roomName();
  const joinedRelayUrl = () => joinConfig()?.relayUrl ?? relayUrl();

  /**
   * URL / path split:
   *
   *   connection URL  = https://relay.example.com        (transport endpoint, no room)
   *   broadcast name  = anon/{room}/{participantId}       (full absolute path)
   *
   * The room segment lives exclusively in the broadcast name.
   * Never append the room to the connection URL — the relay would see it twice,
   * once as a URL path prefix and again inside the broadcast name.
   */
  const getRoomPrefix = (name: string) => `anon/${name}`;
  const getPublishName = (prefix: string) => `${prefix}/${broadcastId}`;
  const joinedRelayPath = () => getRoomPrefix(joinedRoomName());
  const localPublishPath = () => getPublishName(joinedRelayPath());

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
    setParticipants((prev) =>
      prev.filter((participant) => participant !== path),
    );
  };

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

    const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !isLocalhost) {
      log("conn", "relay URL must use https:// for WebTransport");
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

  createEffect(() => {
    const conn = activeEstablished();
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
        for (; ;) {
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

  return {
    connectionStatus,
    diagLog,
    handleJoin,
    handleLeave,
    handleNameChange,
    handleRelayUrlChange,
    joined,
    joinedRelayPath,
    joinedRelayUrl,
    joinedRoomName,
    joining,
    localPublishPath,
    log,
    participants,
    relayUrl,
    resolvedSectionRelayUrl,
    resolvedWatchName,
    roomName,
    setWatchPathOverride,
    useExternalConnection,
    watchPathOverride,
  };
}
