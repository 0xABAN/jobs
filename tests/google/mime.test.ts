import assert from "node:assert/strict";
import { test } from "node:test";

import { bodyText } from "../../src/google/mime.ts";

function encoded(text: string): { data: string } {
  return { data: Buffer.from(text).toString("base64url") };
}

test("the plain-text part wins over the HTML one", () => {
  const message = { parts: [
    { mimeType: "text/html", body: encoded("<p>HTML</p>") },
    { mimeType: "text/plain", body: encoded("Plain\n text") },
  ] };

  assert.equal(bodyText(message), "Plain text");
});

test("HTML becomes text without tags, styles, or entities", () => {
  const html = "<style>p { color: red }</style><p>We&rsquo;ve received&nbsp;your application &amp; resume &#x2713;</p>";

  assert.equal(bodyText({ mimeType: "text/html", body: encoded(html) }), " We’ve received your application & resume ✓ ");
});
