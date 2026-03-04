type TransportConnection = {
  websocket?: {
    enabled?: boolean;
  };
};

export function applyTransportPolicy<T extends TransportConnection>(
  connection: T,
): T {
  connection.websocket = {
    ...(connection.websocket ?? {}),
    enabled: false,
  };
  return connection;
}
