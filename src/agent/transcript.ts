import { createReadStream, writeSync } from "node:fs";
import { createInterface } from "node:readline";

const NEWLINE = 0x0a;
const OPENING_BRACE = 0x7b;

export async function writeTimestamped(stdout: NodeJS.ReadableStream, transcript: number, launched: number): Promise<void> {
  let pending = Buffer.alloc(0);

  for await (const chunk of stdout) {
    pending = Buffer.concat([pending, chunk as Buffer]);

    let end: number;
    while ((end = pending.indexOf(NEWLINE)) !== -1) {
      const line = pending.subarray(0, end + 1);
      pending = pending.subarray(end + 1);

      if (line.toString("utf8").trim()) {
        writeSync(transcript, stamp(line, (performance.now() - launched) / 1000));
      }
    }
  }
}

export async function* events(transcript: string): AsyncGenerator<any> {
  const lines = createInterface({ input: createReadStream(transcript), crlfDelay: Infinity });

  for await (const line of lines) {
    if (line.trim()) {
      yield JSON.parse(line);
    }
  }
}

export async function finalMessage(transcript: string): Promise<string> {
  let final = "";

  for await (const event of events(transcript)) {
    if (event.type === "message_end" && event.message.role === "assistant") {
      final = messageText(event.message) || (event.message.errorMessage ?? "");
    }
  }

  return final;
}

function stamp(line: Buffer, seconds: number): Buffer {
  const fields = line[0] === OPENING_BRACE ? line.subarray(1) : line;
  return Buffer.concat([Buffer.from(`{"t":${seconds.toFixed(3)},`), fields]);
}

function messageText(message: { content: { type: string; text?: string }[] }): string {
  return message.content.filter((block) => block.type === "text").map((block) => block.text).join("");
}
