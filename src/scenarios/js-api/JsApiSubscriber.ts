import * as Moq from "@moq/lite";
import { Effect, Signal } from "@moq/signals";
import * as Watch from "@moq/watch";
import { createSignal } from "solid-js";

import type { RemoteParticipant } from "../../types";

type LogFn = (tag: string, msg: string) => void;

export function createJsApiSubscriber(props: {
  connection: Moq.Connection.Reload;
  log: LogFn;
}) {
  const [participants, setParticipants] = createSignal<RemoteParticipant[]>([]);
  const [speakerOn, setSpeakerOn] = createSignal(false);
  const [subRms, setSubRms] = createSignal(0);
  const audioOutputEnabled = Signal.from(false);
  const subscribedParticipants = new Map<string, RemoteParticipant>();

  const closeParticipant = (participant: RemoteParticipant) => {
    participant.signals.close();
    participant.sync.close();
    participant.videoDecoder.close();
    participant.videoSource.close();
    participant.audioDecoder.close();
    participant.audioSource.close();
    participant.broadcast.close();
  };

  const removeParticipant = (pathString: string) => {
    const removed = subscribedParticipants.get(pathString);

    if (!removed) {
      props.log("sub", `remove requested for unknown participant: ${pathString}`);
      return;
    }

    subscribedParticipants.delete(pathString);
    setParticipants((prev) =>
      prev.filter((participant) => participant.id !== pathString),
    );
    closeParticipant(removed);
    props.log("sub", `participant removed: ${pathString}`);
  };

  const subscribeToParticipant = (pathString: string) => {
    if (subscribedParticipants.has(pathString)) {
      props.log("sub", `already tracking participant: ${pathString}`);
      return;
    }

    const path = Moq.Path.from(pathString);
    const broadcast = new Watch.Broadcast({
      connection: props.connection.established,
      enabled: true,
      name: path,
      reload: true,
    });

    const sync = new Watch.Sync();
    const videoSource = new Watch.Video.Source(sync, { broadcast });
    const videoDecoder = new Watch.Video.Decoder(videoSource, { enabled: true });
    const audioSource = new Watch.Audio.Source(sync, { broadcast });
    const audioDecoder = new Watch.Audio.Decoder(audioSource, { enabled: true });

    const shortPath = pathString.slice(-20);
    const signals = new Effect();

    signals.effect((effect) => {
      const status = effect.get(broadcast.status);
      props.log("sub", `...${shortPath} status -> ${status}`);
    });
    signals.effect((effect) => {
      const audioCatalog = effect.get(audioSource.catalog);
      if (audioCatalog) {
        props.log("sub", `...${shortPath} audio catalog received`);
      }
    });
    signals.effect((effect) => {
      const videoCatalog = effect.get(videoSource.catalog);
      props.log(
        "video",
        `...${shortPath} video catalog: ${videoCatalog ? "received" : "none"}`,
      );
    });
    signals.effect((effect) => {
      const stalled = effect.get(videoDecoder.stalled);
      props.log("video", `...${shortPath} video decoder stalled: ${stalled}`);
    });

    let videoFrameCount = 0;
    signals.effect((effect) => {
      const frame = effect.get(videoDecoder.frame);
      if (!frame) return;
      videoFrameCount++;
      if (videoFrameCount === 1 || videoFrameCount % 100 === 0) {
        props.log(
          "video",
          `...${shortPath} video frame #${videoFrameCount} (${frame.displayWidth}x${frame.displayHeight})`,
        );
      }
    });

    signals.effect((effect) => {
      const root = effect.get(audioDecoder.root);
      if (!root) return;
      props.log(
        "audio",
        `...${shortPath} audio root available (ctx: ${root.context.state})`,
      );
    });

    let lastLoggedBytes = 0;
    signals.effect((effect) => {
      const stats = effect.get(audioDecoder.stats);
      if (!stats || stats.bytesReceived <= 0) return;
      const bytes = stats.bytesReceived;
      if (lastLoggedBytes === 0 || bytes - lastLoggedBytes >= 1024) {
        props.log("audio", `...${shortPath} audio bytes: ${bytes}`);
        lastLoggedBytes = bytes;
      }
    });

    let participantGain: GainNode | undefined;
    let participantAnalyser: AnalyserNode | undefined;

    signals.effect((effect) => {
      const root = effect.get(audioDecoder.root);
      if (!root) return;

      if (root.context.state === "suspended") {
        void (root.context as AudioContext).resume();
        props.log("audio", "resuming suspended AudioContext");
      }

      const gain = new GainNode(root.context, { gain: 0 });
      const analyser = new AnalyserNode(root.context, { fftSize: 2048 });
      root.connect(gain);
      gain.connect(analyser);
      analyser.connect(root.context.destination);
      participantGain = gain;
      participantAnalyser = analyser;
      props.log("audio", `wired gain+analyser for ...${shortPath}`);

      effect.cleanup(() => {
        analyser.disconnect();
        gain.disconnect();
        if (participantGain === gain) participantGain = undefined;
        if (participantAnalyser === analyser) participantAnalyser = undefined;
      });
    });

    signals.effect((effect) => {
      const speaker = effect.get(audioOutputEnabled);
      if (participantGain) {
        participantGain.gain.value = speaker ? 1.0 : 0.0;
        props.log("audio", `...${shortPath} gain -> ${speaker ? 1 : 0}`);
      }
    });

    videoSource.target.set({ pixels: 640 * 640 });

    const participant: RemoteParticipant = {
      id: pathString,
      broadcast,
      sync,
      videoSource,
      videoDecoder,
      audioSource,
      audioDecoder,
      signals,
      getAnalyser: () => participantAnalyser,
    };
    subscribedParticipants.set(pathString, participant);
    setParticipants((prev) => [...prev, participant]);

    props.log("sub", `subscribed to ${pathString}`);
  };

  const reconcile = (nextPaths: string[]) => {
    const next = [...new Set(nextPaths)];
    const current = [...subscribedParticipants.keys()];

    for (const path of next) {
      if (!subscribedParticipants.has(path)) {
        subscribeToParticipant(path);
      }
    }

    for (const path of current) {
      if (!next.includes(path)) {
        removeParticipant(path);
      }
    }
  };

  const clear = () => {
    for (const participant of subscribedParticipants.values()) {
      closeParticipant(participant);
    }
    subscribedParticipants.clear();
    setParticipants([]);
    setSubRms(0);
  };

  const toggleSpeaker = () => {
    const next = !speakerOn();
    setSpeakerOn(next);
    audioOutputEnabled.set(next);
    props.log("track", `speaker ${next ? "ON" : "OFF"}`);
  };

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
    let maxRms = 0;
    for (const participant of participants()) {
      const analyser = participant.getAnalyser();
      if (!analyser) continue;
      const rms = computeRms(analyser);
      if (rms > maxRms) {
        maxRms = rms;
      }
    }
    setSubRms(maxRms);
  }, 100);

  const close = () => {
    window.clearInterval(rmsInterval);
    clear();
  };

  return {
    clear,
    close,
    participants,
    reconcile,
    speakerOn,
    subRms,
    toggleSpeaker,
  };
}
