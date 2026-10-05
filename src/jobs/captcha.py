"""Solve the CAPTCHA blocking a page in a harness Chrome, through CapSolver.

The apply agent runs ``jobs captcha <port>`` when a CAPTCHA stops it. Its CUA tools cannot run
page JavaScript, so this module reaches the page through the Chrome DevTools Protocol on
``port``: it finds the CAPTCHA, has CapSolver solve it, and puts the token where the CAPTCHA's
widget would, then calls the page's callbacks as the widget does.
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request

from websockets.sync.client import connect

from jobs.config import env

CAPSOLVER = "https://api.capsolver.com"

# Runs in each frame and describes the reCAPTCHA or hCaptcha in it, or returns null. The sitekey
# comes from the widget iframe's URL, which also covers widgets that pages render from JavaScript.
DETECT = r"""(() => {
  const frames = [...document.querySelectorAll("iframe[src]")].map(frame => new URL(frame.src, location.href));
  const recaptcha = frames.find(url => /\/recaptcha\/(api2|enterprise)\/anchor/.test(url.pathname));
  if (recaptcha) {
    const scoreBased = [...document.scripts].some(s => /recaptcha\/(api|enterprise)\.js\?.*render=(?!explicit)/.test(s.src));
    return {kind: scoreBased ? "recaptcha_v3" : "recaptcha_v2", url: location.href, sitekey: recaptcha.searchParams.get("k"),
            enterprise: recaptcha.pathname.includes("enterprise"), invisible: recaptcha.searchParams.get("size") === "invisible"};
  }
  if (frames.some(url => url.hostname.endsWith("hcaptcha.com"))) return {kind: "hcaptcha"};
  return null;
})()"""

# Fills the response fields a solved widget would fill, then calls the callbacks it would call.
INJECT = r"""(token => {
  document.querySelectorAll('[name="g-recaptcha-response"], [name="cf-turnstile-response"]').forEach(field => field.value = token);
  const callbacks = new Set([...document.querySelectorAll("[data-callback]")].map(el => window[el.dataset.callback]));
  (function walk(node, depth) {  // reCAPTCHA keeps callbacks of JavaScript-rendered widgets in its config
    if (!node || typeof node !== "object" || depth > 5) return;
    for (const [key, value] of Object.entries(node)) {
      if (key === "callback") callbacks.add(typeof value === "function" ? value : window[value]);
      else walk(value, depth + 1);
    }
  })(window.___grecaptcha_cfg?.clients, 0);
  const called = [...callbacks].filter(callback => typeof callback === "function");
  called.forEach(callback => callback(token));
  return called.length;
})"""

UNSOLVABLE = {
    "hcaptcha": "hCaptcha is not solvable: CapSolver does not support it.",
    "recaptcha_v3": "This reCAPTCHA is an invisible score check with nothing to solve; submit, and follow any email verification.",
}


def solve(port: int) -> dict:
    """Solve the first CAPTCHA found in Chrome's frames and describe what happened; an ``error`` key means it was not solved."""
    captcha, target = _find(_targets(port))
    if captcha is None:
        return {"error": "No CAPTCHA found."}

    if captcha["kind"] in UNSOLVABLE:
        return {"captcha": captcha["kind"], "error": UNSOLVABLE[captcha["kind"]]}

    token = _capsolver(task_for(captcha))
    callbacks = _evaluate(target, f"{INJECT}({json.dumps(token)})")
    return {"captcha": captcha["kind"], "solved": True, "callbacks_called": callbacks}


def task_for(captcha: dict) -> dict:
    """Return the CapSolver task for a detected CAPTCHA; CapSolver's own proxies solve it."""
    task = {"websiteURL": captcha["url"], "websiteKey": captcha["sitekey"]}

    if captcha["kind"] == "turnstile":
        return {"type": "AntiTurnstileTaskProxyLess", **task}

    kind = "ReCaptchaV2EnterpriseTaskProxyLess" if captcha["enterprise"] else "ReCaptchaV2TaskProxyLess"
    return {"type": kind, **task, "isInvisible": captcha["invisible"]}


def _find(targets: list[dict]) -> tuple[dict | None, dict | None]:
    """Return the first CAPTCHA and the frame target that holds its widget, or ``(None, None)``."""
    for target in targets:
        if captcha := _evaluate(target, DETECT):
            return captcha, target

    # Turnstile renders into a closed shadow root that page scripts cannot see, but Chrome lists
    # its frame as a target whose URL holds the sitekey and whose parentId names the widget's page.
    for frame in targets:
        url = urllib.parse.urlparse(frame["url"])
        parent = next((t for t in targets if t["id"] == frame.get("parentId")), None)
        if url.hostname == "challenges.cloudflare.com" and parent:
            sitekey = next(part for part in url.path.split("/") if part.startswith("0x4"))
            return {"kind": "turnstile", "url": parent["url"], "sitekey": sitekey}, parent

    return None, None


def _targets(port: int) -> list[dict]:
    """Return Chrome's pages and cross-site frames, each with its own DevTools connection."""
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=10) as response:
        targets = json.load(response)

    return [t for t in targets if t["type"] in ("page", "iframe") and "webSocketDebuggerUrl" in t]


def _evaluate(target: dict, expression: str):
    """Evaluate ``expression`` in ``target`` and return its JSON value."""
    request = {"id": 1, "method": "Runtime.evaluate", "params": {"expression": expression, "returnByValue": True}}
    with connect(target["webSocketDebuggerUrl"], max_size=None) as socket:
        socket.send(json.dumps(request))
        while (reply := json.loads(socket.recv(timeout=30))).get("id") != 1:
            pass  # an event, not our reply

    if "exceptionDetails" in reply["result"]:
        raise RuntimeError(f"Page script failed: {reply['result']['exceptionDetails']['text']}")
    return reply["result"]["result"].get("value")


def _capsolver(task: dict) -> str:
    """Have CapSolver solve ``task`` and return the token, polling for up to two minutes."""
    key = env("CAPSOLVER_API_KEY")
    reply = _post("/createTask", {"clientKey": key, "task": task})
    task_id = reply.get("taskId")

    for _ in range(40):
        if reply.get("status") == "ready":
            solution = reply["solution"]
            return solution.get("gRecaptchaResponse") or solution["token"]

        time.sleep(3)
        reply = _post("/getTaskResult", {"clientKey": key, "taskId": task_id})

    raise TimeoutError("CapSolver did not solve the CAPTCHA within two minutes.")


def _post(path: str, body: dict) -> dict:
    request = urllib.request.Request(CAPSOLVER + path, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            reply = json.load(response)
    except urllib.error.HTTPError as error:  # CapSolver reports failures as 4xx replies with a JSON body
        reply = json.load(error)

    if reply.get("errorId"):
        raise RuntimeError(f"CapSolver {reply['errorCode']}: {reply.get('errorDescription')}")
    return reply
