const REPLY_TIMEOUT_MS = 30_000;
const COMMAND_ID = 1;

export async function cdp(endpoint: string, method: string, params: object): Promise<any> {
  const socket = new WebSocket(endpoint);

  try {
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Chrome did not answer ${method} in time`)), REPLY_TIMEOUT_MS);

      socket.addEventListener("open", () => socket.send(JSON.stringify({ id: COMMAND_ID, method, params })));
      socket.addEventListener("message", (event) => {
        const reply = JSON.parse(String(event.data));
        if (reply.id === COMMAND_ID) {
          clearTimeout(timeout);
          resolve(reply);
        }
      });
      socket.addEventListener("error", () => {
        clearTimeout(timeout);
        reject(new Error(`Could not reach Chrome's DevTools at ${endpoint}`));
      });
    });
  } finally {
    socket.close();
  }
}
