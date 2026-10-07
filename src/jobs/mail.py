"""Move automated job-application mail to Gmail's Trash: receipts, security codes, and account checks.

Every application leaves a "thank you for applying" receipt, and many leave a security-code or
account-verification email, which buries the mail Adam needs to read. Once no run can still be
reading them, ``clean_confirmations`` trashes those, and only those:

- a receipt, code, or verification email from an automated sender,
- naming a company in the tracker, so mail from his bank or a graduate school never qualifies,
- with no sign of a decision, a request, or an invitation, so rejections, assessments, and
  interview invites stay,
- and not a reply, a forward, or starred.

Trashed mail stays recoverable in Gmail's Trash for 30 days. The cleanup has its own refresh
token, ``.mcp/gmail-cleanup-token.json``, with the ``gmail.modify`` scope (which can trash but
never permanently delete); the apply agents' Gmail tools keep their read-only token.
"""

import base64
import hashlib
import html
import http.server
import json
import os
import plistlib
import re
import secrets
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from dataclasses import dataclass
from pathlib import Path

from jobs.config import REPO_ROOT, STATE_DIR
from jobs.google import TOKEN_URL, access_token, client
from jobs.lock import locked
from jobs.sheets import Sheet

TOKEN = REPO_ROOT / ".mcp/gmail-cleanup-token.json"
SCOPE = "https://www.googleapis.com/auth/gmail.modify"
API = "https://gmail.googleapis.com/gmail/v1/users/me"

# Gmail's per-user quota resets each minute; these waits span more than one.
RETRY_WAITS = [2, 4, 8, 16, 32]

# Mail younger than this stays: a running agent reads its code or receipt within a few minutes.
GRACE_MINUTES = 15

# How often the apply command cleans, at most, and how often the scheduled cleanup runs.
CLEAN_EVERY_MINUTES = 10
CLEANED_STAMP = STATE_DIR / "mail-cleaned"
SCHEDULE_LABEL = "dev.jobs.clean-mail"
SCHEDULE_PLIST = Path.home() / f"Library/LaunchAgents/{SCHEDULE_LABEL}.plist"

# Narrows the search to candidates; ``classify`` decides.
SEARCH = ('-in:trash -is:starred (subject:(application OR applying OR applied OR resume OR "security code" OR verify '
          'OR verification OR "candidate account" OR "thank you" OR thanks OR received OR submitted OR interest))')

RECEIPT = re.compile(
    r"thank(s| you) for (applying|your application|your interest|submitting)|application (was |has been )?(received|submitted)"
    r"|(we('ve| have)?) (received|got) (it|your)|successfully submitted|received your (application|resume)"
    r"|your application (to|for) .* (has been|was) (received|submitted)", re.I)
CODE = re.compile(r"security code for your application|verify your (candidate account|email)|confirm your email"
                  r"|reset your password for your candidate account", re.I)
JOB_CONTEXT = re.compile(r"appl(y|ying|ied|ication)|resume|candida|position|role\b|career", re.I)

# Requests for a step and invitations keep a message wherever they appear.
ACTION = re.compile(
    r"schedule (a|an|your) (call|chat|time)|(book|pick|select|choose) a time|calendly"
    # Receipts "invite you to learn more about" a company; invitations ask for a step.
    r"|invit(e|ing) you to (an? |our )?(interview|chat|call|meet|speak|complete|take|schedule|next)"
    r"|invitation to (an? )?(interview|assessment|chat|call)|interview invitation"
    r"|codesignal|hackerrank|codility|karat|coderpad|coding (challenge|test|exercise)|take-?home"
    r"|action required|additional (info|information) (is )?requested|complete (your|the) (assessment|profile|application)"
    r"|offer letter|next round|phone screen", re.I)

# Decisions keep a message too, but receipts mention them in hedged sentences ("If other candidates
# are better aligned, you may not hear from us"; "you may receive a coding assessment"), so these are
# looked for only in sentences that are not hedged.
DECISION = re.compile(
    r"unfortunately|not (to |be )?(move|moving|proceed|proceeding) forward|won'?t be (moving|proceeding)"
    r"|decided (not )?to|regret|other candidates|(have|has|were|was) not (been )?selected|chosen to|not the right fit"
    r"|position has been filled|no longer (considering|available)|assessment", re.I)
HEDGED = re.compile(r"^\W*if\b|\bif (you|we|your|there|it)\b|\b(may|might) (receive|be (contacted|asked|invited)|not hear|hear)",
                    re.I)

AUTOMATED_SENDER = re.compile(
    r"no-?reply|do-?not-?reply|donotreply|notifications?@|greenhouse-mail\.io|ashbyhq\.com|myworkday(jobs)?\.com"
    r"|workday\.com|eightfold\.ai|workablemail\.com|icims\.com|smartrecruiters|successfactors|oraclecloud\.com"
    r"|jobvite|gem\.com|recruiting|careers|talent|hiring|campus|university|early-?careers|jobs@|apply@", re.I)
ATS_SENDER = re.compile(r"greenhouse-mail\.io|ashbyhq\.com|workday\.com|eightfold\.ai|workablemail\.com|icims\.com"
                        r"|smartrecruiters|successfactors|oraclecloud\.com|jobvite|gem\.com", re.I)

# Words dropped from tracker company names before matching, so "The D. E. Shaw Group" matches "deshaw".
COMPANY_FILLER = re.compile(r"\b(the|inc|incorporated|group|technologies|technology|industries|labs|systems|corporation"
                            r"|company|co|llc|ltd|holdings)\b", re.I)


@dataclass
class Message:
    id: str
    sender: str
    subject: str
    body: str
    received: float  # seconds since the epoch
    labels: list[str]


def classify(message: Message, companies: set[str], now: float, grace_minutes: float) -> str | None:
    """Return why ``message`` may be trashed ("receipt" or "code"), or ``None`` to keep it."""
    if now - message.received < grace_minutes * 60:
        return None  # a running agent may still read it
    if "STARRED" in message.labels or re.match(r"\s*(re|fwd?):", message.subject, re.I):
        return None
    if not AUTOMATED_SENDER.search(message.sender):
        return None

    text = f"{message.subject}\n{message.body}"
    if ACTION.search(text) or any(DECISION.search(s) for s in _sentences(text) if not HEDGED.search(s)):
        return None

    # Receipts name the company in the sender, the subject, or their opening lines.
    named = f"{message.sender} {message.subject} {message.body[:500]}".lower()
    if not any(re.search(company, named) for company in companies):
        return None

    if CODE.search(message.subject) and ("application" in message.subject.lower() or ATS_SENDER.search(message.sender)):
        return "code"
    if RECEIPT.search(text) and JOB_CONTEXT.search(text):
        return "receipt"
    return None


def _sentences(text: str) -> list[str]:
    return re.split(r"(?<=[.!?])\s+|\n+", text)


def tracker_companies(sheet_id: str) -> set[str]:
    """Return a pattern for each company in the tracker's ``Apps`` and ``Failed`` tabs (see ``company_pattern``)."""
    sheet = Sheet(sheet_id)
    names = [row.get("jobs", "") for row in sheet.rows("Apps")] + [row.get("Company", "") for row in sheet.rows("Failed")]
    return {pattern for name in names if (pattern := company_pattern(name))}


def company_pattern(name: str) -> str | None:
    """Return a regex that finds the company ``name`` as whole words in lowercase text, with or without the spaces
    and dots between them: "The D. E. Shaw Group" finds "D. E. Shaw" and "deshaw.com", and "Point72" finds
    "point72". ``None`` for names under three letters, which would match too much.
    """
    words = re.findall(r"[a-z0-9]+", COMPANY_FILLER.sub(" ", name.lower()))
    if len(re.sub(r"[0-9]", "", "".join(words))) < 3:
        return None
    return r"\b" + r"[\W_]*".join(words) + r"\b"


def clean_confirmations(sheet_id: str, *, grace_minutes: float, days: int = 2, dry_run: bool = False) -> list[dict]:
    """Trash the confirmations of the last ``days`` days that are at least ``grace_minutes`` old; return what qualified."""
    companies = tracker_companies(sheet_id)
    now = time.time()
    trashed = []
    for message in _search(f"newer_than:{days}d {SEARCH}"):
        reason = classify(message, companies, now, grace_minutes)
        if reason is None:
            continue
        if not dry_run:
            _call("POST", f"/messages/{message.id}/trash")
        trashed.append({"id": message.id, "reason": reason, "from": message.sender, "subject": message.subject})
    return trashed


def clean_now_and_then(sheet_id: str, *, grace_minutes: float) -> list[dict] | None:
    """Run ``clean_confirmations`` unless another process is at it or one ran in the last ``CLEAN_EVERY_MINUTES``.

    Returns what was trashed, or ``None`` when it did not run.
    """
    with locked(STATE_DIR / "mail.lock", wait=False) as lock:
        if lock is None:
            return None
        if CLEANED_STAMP.exists() and time.time() - CLEANED_STAMP.stat().st_mtime < CLEAN_EVERY_MINUTES * 60:
            return None

        trashed = clean_confirmations(sheet_id, grace_minutes=grace_minutes)
        CLEANED_STAMP.touch()
        return trashed


def schedule(every_minutes: int = 15) -> None:
    """Have launchd run ``jobs clean-mail`` every ``every_minutes`` minutes, so mail is cleaned between apply runs too.

    Its output goes to ``~/.jobs/mail-cleanup.log``. ``launchctl bootout gui/$UID/dev.jobs.clean-mail``
    and deleting ``SCHEDULE_PLIST`` stop it.
    """
    log = str(STATE_DIR / "mail-cleanup.log")
    SCHEDULE_PLIST.write_bytes(plistlib.dumps({
        "Label": SCHEDULE_LABEL,
        "ProgramArguments": [shutil.which("uv"), "run", "--project", str(REPO_ROOT), "jobs", "clean-mail"],
        "WorkingDirectory": str(REPO_ROOT),
        "StartInterval": every_minutes * 60,
        "RunAtLoad": True,
        "Umask": 0o077,  # the log holds subjects of Adam's mail
        "StandardOutPath": log,
        "StandardErrorPath": log,
    }))

    domain = f"gui/{os.getuid()}"
    subprocess.run(["launchctl", "bootout", f"{domain}/{SCHEDULE_LABEL}"], capture_output=True)  # replace any old one
    subprocess.run(["launchctl", "bootstrap", domain, str(SCHEDULE_PLIST)], check=True)


def authorize(email: str) -> None:
    """Have Adam grant the cleanup's Gmail scope in his browser, and save its refresh token to ``TOKEN``.

    Uses the Desktop client's loopback flow with PKCE; ``email`` preselects his account, and the
    granted account must be that one.
    """
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    replies = []

    class Callback(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            replies.append(urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query))
            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write("Gmail cleanup is authorized. You can close this tab.".encode())

        def log_message(self, *args):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), Callback)
    redirect = f"http://127.0.0.1:{server.server_port}"
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode({
        "client_id": client()["client_id"], "redirect_uri": redirect, "response_type": "code", "scope": SCOPE,
        "access_type": "offline", "prompt": "consent", "login_hint": email, "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
    })
    print(f"Opening Google's consent page; if no browser opens, visit:\n{url}", flush=True)
    webbrowser.open(url)
    while not replies:
        server.handle_request()

    reply = replies[0]
    if reply.get("state") != [state] or "code" not in reply:
        raise RuntimeError(f"Google did not grant access: {reply.get('error', reply)}")

    form = urllib.parse.urlencode({
        "client_id": client()["client_id"], "client_secret": client()["client_secret"], "code": reply["code"][0],
        "code_verifier": verifier, "grant_type": "authorization_code", "redirect_uri": redirect,
    }).encode()
    with urllib.request.urlopen(TOKEN_URL, form, timeout=30) as response:
        grant = json.load(response)
    if SCOPE not in grant.get("scope", "").split():
        raise RuntimeError(f"Google granted {grant.get('scope')!r}, not {SCOPE}")

    TOKEN.touch(mode=0o600)
    TOKEN.write_text(json.dumps({"refresh_token": grant["refresh_token"], "scope": grant["scope"]}))
    granted = _call("GET", "/profile")["emailAddress"]
    if granted.lower() != email.lower():
        TOKEN.unlink()
        raise RuntimeError(f"Access was granted for {granted}, not {email}; run it again and choose {email}")


def _search(query: str) -> list[Message]:
    ids, page = [], None
    while True:
        params = {"q": query, "maxResults": 500} | ({"pageToken": page} if page else {})
        found = _call("GET", "/messages?" + urllib.parse.urlencode(params))
        ids += [m["id"] for m in found.get("messages", [])]
        if not (page := found.get("nextPageToken")):
            break
    return [_message(i) for i in ids]


def _message(message_id: str) -> Message:
    data = _call("GET", f"/messages/{message_id}?format=full")
    headers = {h["name"].lower(): h["value"] for h in data["payload"].get("headers", [])}
    return Message(message_id, headers.get("from", ""), headers.get("subject", ""), _text(data["payload"]),
                   int(data["internalDate"]) / 1000, data.get("labelIds", []))


def _text(part: dict) -> str:
    """Return a message part's plain text, from HTML when it has no plain-text part."""
    if part.get("parts"):
        texts = [_text(p) for p in part["parts"]]
        return next((t for p, t in zip(part["parts"], texts) if p.get("mimeType") == "text/plain" and t), " ".join(texts))

    data = part.get("body", {}).get("data")
    if not data:
        return ""
    text = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", "replace")
    if part.get("mimeType") == "text/html":
        text = html.unescape(re.sub(r"<(style|script)[^>]*>.*?</\1>|<[^>]+>", " ", text, flags=re.S | re.I))
    return re.sub(r"\s+", " ", text)


def _call(method: str, path: str) -> dict:
    """Call the Gmail API, waiting out its per-minute quota: it answers 429, or 403 naming the quota.

    Trashing a message twice is harmless, so writes are retried too.
    """
    for wait in [*RETRY_WAITS, None]:
        request = urllib.request.Request(API + path, method=method, data=b"" if method == "POST" else None,
                                         headers={"Authorization": f"Bearer {access_token(TOKEN)}"})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            throttled = error.code == 429 or (error.code == 403 and re.search(r"(?i)quota|rate ?limit", error.read().decode()))
            if not throttled or wait is None:
                raise

            time.sleep(wait)
