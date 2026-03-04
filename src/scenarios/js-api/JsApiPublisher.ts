import * as Moq from "@moq/lite";
import * as Publish from "@moq/publish";
import { Effect, Signal } from "@moq/signals";
import solid, { createAccessor } from "@moq/signals/solid";
import { createSignal } from "solid-js";

import { applyTransportPolicy } from "../../utils/transportPolicy";

type LogFn = (tag: string, msg: string) => void;

export function createJsApiPublisher(log: LogFn) {
  const connection = applyTransportPolicy(
    new Moq.Connection.Reload({
      enabled: false,
    }),
  );
  const connectionStatus = createAccessor(connection.status);

  const micEnabled = new Signal<boolean>(false);
  const broadcastVideoEnabled = Signal.from(false);

  const localVideoSource = new Publish.Source.Camera({
    enabled: false,
    constraints: {
      width: { ideal: 640 },
      height: { ideal: 640 },
      frameRate: { ideal: 60 },
      facingMode: { ideal: "user" },
      resizeMode: "none",
    },
  });

  const localAudioSource = new Publish.Source.Microphone({
    enabled: micEnabled,
    constraints: {
      channelCount: { ideal: 1, max: 2 },
      autoGainControl: { ideal: true },
      noiseSuppression: { ideal: true },
      echoCancellation: { ideal: true },
    },
  });

  const localBroadcast = new Publish.Broadcast({
    enabled: false,
    connection: connection.established,
    user: {
      enabled: true,
      name: Signal.from("User"),
    },
    video: {
      source: localVideoSource.source,
      hd: {
        enabled: broadcastVideoEnabled,
        config: { maxPixels: 640 * 640 },
      },
      sd: {
        enabled: broadcastVideoEnabled,
        config: { maxPixels: 320 * 320 },
      },
      flip: true,
    },
    audio: {
      enabled: micEnabled,
      volume: 1.0,
      source: localAudioSource.source,
    },
    location: {
      window: {
        enabled: true,
        handle: Math.random().toString(36).substring(2, 15),
      },
      peers: { enabled: true },
    },
    chat: { message: { enabled: true }, typing: { enabled: true } },
    preview: {
      enabled: true,
      info: { chat: false, typing: false, screen: false },
    },
  });

  const pubSignals = new Effect();
  pubSignals.effect((effect) => {
    const active = effect.get(localBroadcast.audio.active);
    log("pub", `encoder active: ${active}`);
  });
  pubSignals.effect((effect) => {
    const root = effect.get(localBroadcast.audio.root);
    log("pub", `encoder root: ${root ? "connected" : "none"}`);
  });
  pubSignals.effect((effect) => {
    const config = effect.get(localBroadcast.audio.config);
    log("pub", `encoder config: ${config ? config.codec : "none"}`);
  });

  const localFrame = solid(localBroadcast.video.frame);

  const [publishingVideo, setPublishingVideo] = createSignal(false);
  const [publishingAudio, setPublishingAudio] = createSignal(false);
  const [pubRms, setPubRms] = createSignal(0);

  let pubAnalyser: AnalyserNode | undefined;
  pubSignals.effect((effect) => {
    const root = effect.get(localBroadcast.audio.root);
    if (!root) return;
    pubAnalyser?.disconnect();
    pubAnalyser = new AnalyserNode(root.context, { fftSize: 2048 });
    root.connect(pubAnalyser);
    log("audio", "wired local publish analyser");
    effect.cleanup(() => {
      pubAnalyser?.disconnect();
      pubAnalyser = undefined;
    });
  });

  const rmsBuf = new Uint8Array(1024);
  const computeRms = (analyser: AnalyserNode): number => {
    analyser.getByteTimeDomainData(rmsBuf);
    let sum = 0;
    for (let i = 0; i < rmsBuf.length; i++) {
      const sample = (rmsBuf[i]! - 128) / 128;
      sum += sample * sample;
    }
    return Math.round(Math.sqrt(sum / rmsBuf.length) * 1000) / 1000;
  };

  const rmsInterval = window.setInterval(() => {
    if (pubAnalyser) {
      setPubRms(computeRms(pubAnalyser));
    } else {
      setPubRms(0);
    }
  }, 100);

  let startedRelayUrl: string | undefined;
  let startedPublishName: string | undefined;

  const start = (relayUrl: string, publishName: string) => {
    if (
      startedRelayUrl === relayUrl &&
      startedPublishName === publishName &&
      connection.enabled.peek()
    ) {
      return;
    }

    const url = new URL(relayUrl);
    connection.url.set(url);
    connection.enabled.set(true);
    localBroadcast.name.set(Moq.Path.from(publishName));
    localBroadcast.enabled.set(true);

    startedRelayUrl = relayUrl;
    startedPublishName = publishName;

    log("conn", `js-api relay: ${url.toString()}`);
    log("conn", `js-api publish name: ${publishName}`);
    log("announced", `announce requested: ${publishName}`);
    log("conn", "js-api publish connection enabled");
  };

  const stop = () => {
    if (
      !startedRelayUrl &&
      !startedPublishName &&
      !connection.enabled.peek() &&
      !localBroadcast.enabled.peek()
    ) {
      return;
    }

    broadcastVideoEnabled.set(false);
    micEnabled.set(false);
    localVideoSource.enabled.set(false);
    setPublishingVideo(false);
    setPublishingAudio(false);

    localBroadcast.enabled.set(false);
    localBroadcast.name.set(undefined);
    connection.url.set(undefined);
    connection.enabled.set(false);

    pubAnalyser?.disconnect();
    pubAnalyser = undefined;
    setPubRms(0);
    startedRelayUrl = undefined;
    startedPublishName = undefined;

    log("conn", "js-api publish disconnected");
  };

  const toggleVideo = () => {
    if (publishingVideo()) {
      broadcastVideoEnabled.set(false);
      setPublishingVideo(false);
      log("track", "video OFF");
      return;
    }

    localVideoSource.enabled.set(true);
    broadcastVideoEnabled.set(true);
    setPublishingVideo(true);
    log("track", "video ON");
  };

  const toggleAudio = () => {
    if (publishingAudio()) {
      micEnabled.set(false);
      setPublishingAudio(false);
      log("track", "mic OFF");
      return;
    }

    micEnabled.set(true);
    setPublishingAudio(true);
    log("track", "mic ON");
  };

  const close = () => {
    stop();
    window.clearInterval(rmsInterval);
    pubSignals.close();
    localVideoSource.close();
    localAudioSource.close();
    localBroadcast.close();
    connection.close();
  };

  return {
    close,
    connection,
    connectionStatus,
    localBroadcast,
    localFrame,
    publishingAudio,
    publishingVideo,
    pubRms,
    start,
    stop,
    toggleAudio,
    toggleVideo,
  };
}
