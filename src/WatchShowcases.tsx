import { Accessor, Show } from "solid-js";
import "@moq/watch/element";
import "@moq/watch/ui";

interface SharedWatchProps {
  relayUrl: Accessor<string | undefined>;
  watchName: Accessor<string | undefined>;
  enabled: Accessor<boolean>; 
}

function BlackPlaceholder() {
  return (
    <div class="flex min-h-64 w-full items-center justify-center bg-black text-sm text-gray-500">
      Not connected
    </div>
  );
}

function WatchTargetSummary(props: SharedWatchProps) {
  return (
    <div class="space-y-2 text-xs text-gray-400">
      <div>
        <span class="text-gray-500">Relay:</span> {props.relayUrl() || "invalid"}
      </div>
      <div>
        <span class="text-gray-500">Watch name:</span>{" "}
        {props.watchName() || "missing"}
      </div>
    </div>
  );
}

export function WatchWebComponentShowcase(props: SharedWatchProps) {
  return (
    <div class="space-y-3">
      <p class="text-sm text-gray-400">
        Bare custom element. No app-managed subscribe logic.
      </p>
      <WatchTargetSummary {...props} />
      <Show
        when={props.relayUrl() && props.watchName() && props.enabled()}
        fallback={<BlackPlaceholder />} 
      >
        <div class="overflow-hidden rounded-md border border-gray-800 bg-black">
          <moq-watch
            url={props.relayUrl()}
            name={props.watchName()}
            class="block min-h-64 w-full"
          >
            <canvas class="h-full w-full bg-black" />
          </moq-watch>
        </div>
      </Show>
    </div>
  );
}

export function WatchOverlayShowcase(props: SharedWatchProps) {
  return (
    <div class="space-y-3">
      <p class="text-sm text-gray-400">
        Solid-powered official overlay from <code>@moq/watch/ui</code>.
      </p>
      <WatchTargetSummary {...props} />
      <Show
        when={props.relayUrl() && props.watchName() && props.enabled()}
        fallback={<BlackPlaceholder />}
      >
        <div class="overflow-hidden rounded-md border border-gray-800 bg-black">
          <moq-watch-ui class="block">
            <moq-watch
              url={props.relayUrl()}
              name={props.watchName()}
              class="block min-h-64 w-full"
            >
              <canvas class="h-full w-full bg-black" />
            </moq-watch>
          </moq-watch-ui>
        </div>
      </Show>
    </div>
  );
}
