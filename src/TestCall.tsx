import {
  Component,
  createSignal,
  createEffect,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { useParams } from "@solidjs/router";
import * as Moq from "@moq/lite";
import * as Publish from "@moq/publish";
import * as Watch from "@moq/watch";
import { Signal, Effect } from "@moq/signals";
import solid from "@moq/signals/solid";
import { createAccessor } from "@moq/signals/solid";

// --- Stream Name Helpers ---

function getCountryCode(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const region = new Intl.Locale(navigator.language).region;
    if (region) return region.toLowerCase();
    const continent = tz.split("/")[0]?.toLowerCase() ?? "xx";
    return continent.slice(0, 2);
  } catch {
    return "xx";
  }
}

function getOrCreateStreamName(): string {
  const key = "moq-test-stream-name";
  const stored = localStorage.getItem(key);
  if (stored) return stored;
  const country = getCountryCode();
  const id = crypto.randomUUID().slice(0, 6);
  const name = `${country}-${id}`;
  localStorage.setItem(key, name);
  return name;
}

// --- Diagnostic Event Log ---

interface DiagEvent {
  t: number;
  tag: string;
  msg: string;
}

const T0 = performance.now();
function diagTime(): number {
  return Math.round(performance.now() - T0);
}

// --- Remote Participant ---

interface RemoteParticipant {
  id: string;
  broadcast: Watch.Broadcast;
  sync: Watch.Sync;
  videoSource: Watch.Video.Source;
  videoDecoder: Watch.Video.Decoder;
  audioSource: Watch.Audio.Source;
  audioDecoder: Watch.Audio.Decoder;
}

// --- VideoCanvas ---

function VideoCanvas(props: {
  frame: () => VideoFrame | undefined;
  flip?: boolean;
}) {
  let canvasRef!: HTMLCanvasElement;

  createEffect(() => {
    const frameRaw = props.frame();
    if (!frameRaw || !canvasRef) return;
    const frame = frameRaw.clone();
    const w = frame.displayWidth;
    const h = frame.displayHeight;
    if (canvasRef.width !== w || canvasRef.height !== h) {
      canvasRef.width = w;
      canvasRef.height = h;
    }
    const ctx = canvasRef.getContext("2d");
    if (!ctx) {
      frame.close();
      return;
    }
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (props.flip) {
      ctx.scale(-1, 1);
      ctx.drawImage(frame, -w, 0, w, h);
    } else {
      ctx.drawImage(frame, 0, 0, w, h);
    }
    ctx.restore();
    frame.close();
  });

  return (
    <canvas ref={canvasRef} class="w-full h-full object-cover bg-black" />
  );
}

// --- Component ---

export const TestCall: Component = () => {
  // Diagnostic log
  const [diagLog, setDiagLog] = createSignal<DiagEvent[]>([]);
  const log = (tag: string, msg: string) => {
    setDiagLog((prev) => [{ t: diagTime(), tag, msg }, ...prev].slice(0, 50));
  };

  // Stream name state
  const params = useParams<{ streamName?: string }>();
  const urlStream = () =>
    params.streamName?.toLowerCase().replace(/[^a-z0-9-]/g, "");
  const [roomName, setRoomName] = createSignal(
    urlStream() || getOrCreateStreamName(),
  );

  const handleNameChange = (value: string) => {
    const clean = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setRoomName(clean);
    localStorage.setItem("moq-test-stream-name", clean);
  };

  // Connection setup
  const connection = new Moq.Connection.Reload({ enabled: false });
  const connectionStatus = createAccessor(connection.status);

  // Unique broadcast path
  const broadcastId = crypto.randomUUID().slice(0, 8);

  // Shared signals for mic, video, and speaker
  const micEnabled = new Signal<boolean>(false);
  const broadcastVideoEnabled = Signal.from(false);
  const audioOutputEnabled = Signal.from(false);

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

  // Local video frame accessor
  const localFrame = solid(localBroadcast.video.frame);

  // Toggle state
  const [publishingVideo, setPublishingVideo] = createSignal(false);
  const [publishingAudio, setPublishingAudio] = createSignal(false);
  const [speakerOn, setSpeakerOn] = createSignal(false);

  const toggleVideo = () => {
    if (publishingVideo()) {
      broadcastVideoEnabled.set(false);
      setPublishingVideo(false);
      log("track", "video OFF");
    } else {
      localVideoSource.enabled.set(true);
      broadcastVideoEnabled.set(true);
      setPublishingVideo(true);
      log("track", "video ON");
    }
  };

  const toggleAudio = () => {
    if (publishingAudio()) {
      micEnabled.set(false);
      setPublishingAudio(false);
      log("track", "mic OFF");
    } else {
      micEnabled.set(true);
      setPublishingAudio(true);
      log("track", "mic ON");
    }
  };

  const toggleSpeaker = () => {
    const next = !speakerOn();
    setSpeakerOn(next);
    audioOutputEnabled.set(next);
    log("track", `speaker ${next ? "ON" : "OFF"}`);
  };

  // Remote participants state
  const [participants, setParticipants] = createSignal<RemoteParticipant[]>([]);
  let announcedEffect: Effect | undefined;

  // Join / Leave
  const [joined, setJoined] = createSignal(false);
  const [joining, setJoining] = createSignal(false);

  const handleJoin = () => {
    setJoining(true);
    const relayPath = "anon/" + roomName();
    connection.url.set(new URL("https://usc.cdn.moq.dev/" + relayPath));
    connection.enabled.set(true);

    const uniquePath = relayPath + "/" + broadcastId;
    localBroadcast.name.set(Moq.Path.from(uniquePath));
    localBroadcast.enabled.set(true);

    log("conn", "connection + broadcast enabled");
    setJoined(true);
    setJoining(false);

    // Start announced loop
    runAnnounced(relayPath);
  };

  const handleLeave = () => {
    // Close announced effect
    if (announcedEffect) {
      announcedEffect.close();
      announcedEffect = undefined;
    }

    // Disable tracks
    broadcastVideoEnabled.set(false);
    micEnabled.set(false);
    localVideoSource.enabled.set(false);
    setPublishingVideo(false);
    setPublishingAudio(false);

    // Disable broadcast + connection
    localBroadcast.enabled.set(false);
    connection.url.set(undefined);
    connection.enabled.set(false);

    // Close remote participants
    for (const p of participants()) {
      p.sync.close();
      p.videoDecoder.close();
      p.videoSource.close();
      p.audioDecoder.close();
      p.audioSource.close();
      p.broadcast.close();
    }
    setParticipants([]);

    setJoined(false);
    log("conn", "disconnected");
  };

  onCleanup(() => {
    handleLeave();
    localVideoSource.close();
    localAudioSource.close();
    localBroadcast.close();
    connection.close();
  });

  // --- Announced loop ---

  const runAnnounced = (streamPrefix: string) => {
    if (announcedEffect) {
      announcedEffect.close();
    }
    announcedEffect = new Effect();

    announcedEffect.effect((effect) => {
      const conn = effect.get(connection.established);
      if (!conn) {
        log("announced", "waiting for connection...");
        return;
      }
      log("announced", "connection available, starting listener");

      const prefix = Moq.Path.from(streamPrefix);
      const announced = conn.announced(prefix);
      effect.cleanup(() => announced.close());

      effect.spawn(async () => {
        log("announced", "loop started");
        try {
          for (;;) {
            const update = await announced.next();
            if (!update) {
              log("announced", "loop ended");
              break;
            }

            const localPath = localBroadcast.name.peek();
            if (String(update.path) === String(localPath)) {
              continue; // skip self
            }

            if (update.active) {
              log("announced", `REMOTE ACTIVE: ${update.path}`);
              subscribeToParticipant(String(update.path));
            } else {
              log("announced", `REMOTE INACTIVE: ${update.path}`);
            }
          }
        } catch (err) {
          log("announced", `ERROR: ${err}`);
        }
      });
    });
  };

  // --- Subscribe to participant ---

  const subscribeToParticipant = (pathString: string) => {
    if (participants().find((p) => p.id === pathString)) return;

    const path = Moq.Path.from(pathString);
    const broadcast = new Watch.Broadcast({
      connection: connection.established,
      enabled: true,
      name: path,
      reload: false,
    });

    const sync = new Watch.Sync();
    const videoSource = new Watch.Video.Source(sync, { broadcast });
    const videoDecoder = new Watch.Video.Decoder(videoSource, { enabled: true });
    const audioSource = new Watch.Audio.Source(sync, { broadcast });
    const audioDecoder = new Watch.Audio.Decoder(audioSource, { enabled: true });

    // Wire audio to speakers
    const signals = new Effect();
    signals.effect((eff) => {
      const root = eff.get(audioDecoder.root);
      if (!root) return;

      if (root.context.state === "suspended") {
        (root.context as AudioContext).resume();
        log("audio", "resuming suspended AudioContext");
      }

      const speaker = eff.get(audioOutputEnabled);
      const gain = new GainNode(root.context, {
        gain: speaker ? 1.0 : 0.0,
      });
      root.connect(gain);
      gain.connect(root.context.destination);
      log("audio", `wired gain (speaker=${speaker})`);
      eff.cleanup(() => gain.disconnect());
    });

    // Set initial video target
    videoSource.target.set({ pixels: 640 * 640 });

    setParticipants((prev) => [
      ...prev,
      {
        id: pathString,
        broadcast,
        sync,
        videoSource,
        videoDecoder,
        audioSource,
        audioDecoder,
      },
    ]);

    log("sub", `subscribed to ${pathString.slice(-20)}`);
  };

  // --- Pub RMS meter ---

  const [pubRms, setPubRms] = createSignal(0);
  const pubAnalyserBuf = new Uint8Array(1024);
  let pubAnalyser: AnalyserNode | undefined;

  const pubAudioRoot = createAccessor(localBroadcast.audio.root);
  createEffect(() => {
    const root = pubAudioRoot();
    if (!root) return;
    pubAnalyser = new AnalyserNode(root.context, { fftSize: 2048 });
    root.connect(pubAnalyser);
    onCleanup(() => {
      pubAnalyser?.disconnect();
      pubAnalyser = undefined;
    });
  });

  // --- Sub RMS meter ---

  const [subRms, setSubRms] = createSignal(0);
  let subAnalyser: AnalyserNode | undefined;
  const subAnalyserBuf = new Uint8Array(1024);

  // Watch for remote audio roots
  createEffect(() => {
    const ps = participants();
    for (const p of ps) {
      const rootAccessor = solid(p.audioDecoder.root);
      createEffect(() => {
        const root = rootAccessor();
        if (!root) return;
        const analyser = new AnalyserNode(root.context, { fftSize: 2048 });
        root.connect(analyser);
        subAnalyser = analyser;
        onCleanup(() => {
          analyser.disconnect();
          if (subAnalyser === analyser) subAnalyser = undefined;
        });
      });
    }
  });

  // --- RMS sampling interval ---

  const rmsInterval = setInterval(() => {
    if (pubAnalyser) {
      pubAnalyser.getByteTimeDomainData(pubAnalyserBuf);
      let sum = 0;
      for (let i = 0; i < pubAnalyserBuf.length; i++) {
        const s = (pubAnalyserBuf[i]! - 128) / 128;
        sum += s * s;
      }
      setPubRms(
        Math.round(Math.sqrt(sum / pubAnalyserBuf.length) * 1000) / 1000,
      );
    }
    if (subAnalyser) {
      subAnalyser.getByteTimeDomainData(subAnalyserBuf);
      let sum = 0;
      for (let i = 0; i < subAnalyserBuf.length; i++) {
        const s = (subAnalyserBuf[i]! - 128) / 128;
        sum += s * s;
      }
      setSubRms(
        Math.round(Math.sqrt(sum / subAnalyserBuf.length) * 1000) / 1000,
      );
    }
  }, 100);
  onCleanup(() => clearInterval(rmsInterval));

  // --- UI ---

  return (
    <div class="min-h-screen bg-gray-950 text-white p-6">
      <div class="max-w-5xl mx-auto space-y-6">
        {/* Title */}
        <div>
          <h1 class="text-2xl font-bold">MoQ Interop Test</h1>
          <p class="text-gray-400 text-sm">
            Test streaming via MoQ CDN relay
          </p>
        </div>

        {/* Stream name input */}
        <div class="space-y-2">
          <label class="block text-sm font-medium text-gray-400">
            Stream Name
          </label>
          <input
            type="text"
            value={roomName()}
            onInput={(e) => handleNameChange(e.currentTarget.value)}
            class="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-white focus:outline-none focus:border-blue-500"
            disabled={joined()}
          />
          <p class="text-xs text-gray-500">
            Connects via MoQ CDN (usc.cdn.moq.dev). Share this stream name
            with others to test together.
          </p>
        </div>

        {/* Join button (when not joined) */}
        <Show
          when={joined()}
          fallback={
            <button
              class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
          {/* Controls bar */}
          <div class="flex items-center gap-2">
            <button
              class={`px-4 py-2 rounded font-medium text-sm ${
                publishingAudio()
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-gray-700 hover:bg-gray-600"
              }`}
              onClick={toggleAudio}
            >
              Mic
            </button>
            <button
              class={`px-4 py-2 rounded font-medium text-sm ${
                publishingVideo()
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-gray-700 hover:bg-gray-600"
              }`}
              onClick={toggleVideo}
            >
              Cam
            </button>
            <button
              class={`px-4 py-2 rounded font-medium text-sm ${
                speakerOn()
                  ? "bg-green-600 hover:bg-green-700"
                  : "bg-gray-700 hover:bg-gray-600"
              }`}
              onClick={toggleSpeaker}
            >
              Spkr
            </button>
            <button
              class="px-4 py-2 bg-red-600 hover:bg-red-700 rounded font-medium text-sm"
              onClick={handleLeave}
            >
              Leave
            </button>
          </div>

          {/* Video grid */}
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Local tile */}
            <div class="relative aspect-video rounded-md overflow-hidden bg-gray-800">
              <Show
                when={publishingVideo()}
                fallback={
                  <div class="flex items-center justify-center h-full text-gray-500">
                    Video Paused
                  </div>
                }
              >
                <VideoCanvas frame={localFrame} flip />
              </Show>
              <div class="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs">
                You
              </div>
            </div>

            {/* Remote tiles */}
            <For each={participants()}>
              {(p) => {
                const remoteFrame = solid(p.videoDecoder.frame);
                return (
                  <div class="relative aspect-video rounded-md overflow-hidden bg-gray-800">
                    <VideoCanvas frame={remoteFrame} />
                    <div class="absolute bottom-2 left-2 bg-black/60 px-2 py-1 rounded text-xs">
                      Participant
                    </div>
                  </div>
                );
              }}
            </For>
          </div>

          {/* Debug panel */}
          <div class="font-mono text-sm space-y-4">
            {/* Status badges */}
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div class="bg-gray-900 border border-gray-700 rounded p-2">
                <div class="text-gray-500 text-xs">Connection</div>
                <div
                  class={
                    connectionStatus() === "connected"
                      ? "text-green-400"
                      : "text-yellow-400"
                  }
                >
                  {connectionStatus()}
                </div>
              </div>
              <div class="bg-gray-900 border border-gray-700 rounded p-2">
                <div class="text-gray-500 text-xs">Room</div>
                <div>{roomName()}</div>
              </div>
              <div class="bg-gray-900 border border-gray-700 rounded p-2">
                <div class="text-gray-500 text-xs">Mic</div>
                <div
                  class={publishingAudio() ? "text-green-400" : "text-red-400"}
                >
                  {publishingAudio() ? "ON" : "OFF"}
                </div>
              </div>
              <div class="bg-gray-900 border border-gray-700 rounded p-2">
                <div class="text-gray-500 text-xs">Speaker</div>
                <div
                  class={speakerOn() ? "text-green-400" : "text-red-400"}
                >
                  {speakerOn() ? "ON" : "OFF"}
                </div>
              </div>
              <div class="bg-gray-900 border border-gray-700 rounded p-2">
                <div class="text-gray-500 text-xs">Participants</div>
                <div>{participants().length}</div>
              </div>
            </div>

            {/* Pub mic RMS */}
            <div>
              <div class="text-xs text-gray-500 mb-1">
                Pub Mic RMS:{" "}
                <span
                  class={pubRms() > 0.01 ? "text-green-400" : "text-red-400"}
                >
                  {pubRms().toFixed(3)}
                </span>
              </div>
              <div class="bg-gray-900 rounded h-4 overflow-hidden">
                <div
                  class={`h-full transition-all duration-100 ${
                    pubRms() > 0.01 ? "bg-blue-500" : "bg-red-900/30"
                  }`}
                  style={{ width: `${Math.min(pubRms() * 500, 100)}%` }}
                />
              </div>
            </div>

            {/* Sub audio RMS */}
            <div>
              <div class="text-xs text-gray-500 mb-1">
                Sub Audio RMS:{" "}
                <span
                  class={subRms() > 0.01 ? "text-green-400" : "text-red-400"}
                >
                  {subRms().toFixed(3)}
                </span>
              </div>
              <div class="bg-gray-900 rounded h-4 overflow-hidden">
                <div
                  class={`h-full transition-all duration-100 ${
                    subRms() > 0.01 ? "bg-green-500" : "bg-red-900/30"
                  }`}
                  style={{ width: `${Math.min(subRms() * 500, 100)}%` }}
                />
              </div>
            </div>

            {/* Event log */}
            <div class="space-y-2">
              <h2 class="text-sm font-medium text-gray-400">Event Log</h2>
              <div class="bg-gray-900 border border-gray-700 rounded p-3 max-h-64 overflow-y-auto font-mono text-xs text-gray-400">
                <Show
                  when={diagLog().length > 0}
                  fallback={
                    <p class="text-gray-500 italic">No events yet.</p>
                  }
                >
                  <For each={diagLog()}>
                    {(event) => (
                      <div>
                        {event.t}ms [{event.tag}] {event.msg}
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
};
