export type MessagePart = { mimeType?: string; parts?: MessagePart[]; body?: { data?: string } };

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", lsquo: "\u2018", rsquo: "\u2019",
  ldquo: "\u201c", rdquo: "\u201d", ndash: "\u2013", mdash: "\u2014", hellip: "\u2026", bull: "\u2022",
  middot: "\u00b7", copy: "\u00a9", reg: "\u00ae", trade: "\u2122",
};

export function bodyText(part: MessagePart): string {
  if (part.parts?.length) {
    const texts = part.parts.map(bodyText);
    const plain = part.parts.findIndex((child, i) => child.mimeType === "text/plain" && texts[i]);
    return plain === -1 ? texts.join(" ") : texts[plain];
  }

  const data = part.body?.data;
  if (!data) {
    return "";
  }

  const content = Buffer.from(data, "base64url").toString("utf8");
  const text = part.mimeType === "text/html" ? htmlToText(content) : content;
  return text.replace(/\s+/g, " ");
}

export function htmlToText(html: string): string {
  return unescapeHtml(html.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>|<[^>]+>/gi, " "));
}

export function unescapeHtml(html: string): string {
  return html.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
    if (!name.startsWith("#")) {
      return ENTITIES[name.toLowerCase()] ?? entity;
    }

    const hex = name[1].toLowerCase() === "x";
    const code = hex ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
