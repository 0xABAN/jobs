from jobs import captcha


def test_tasks_match_capsolver_task_types():
    recaptcha = {"kind": "recaptcha_v2", "url": "https://a", "sitekey": "k", "enterprise": True, "invisible": True}
    assert captcha.task_for(recaptcha) == {"type": "ReCaptchaV2EnterpriseTaskProxyLess", "websiteURL": "https://a",
                                           "websiteKey": "k", "isInvisible": True}

    turnstile = {"kind": "turnstile", "url": "https://a", "sitekey": "0x4AA"}
    assert captcha.task_for(turnstile) == {"type": "AntiTurnstileTaskProxyLess", "websiteURL": "https://a", "websiteKey": "0x4AA"}


def test_finds_turnstile_by_its_frame_when_page_scripts_cannot_see_it(monkeypatch):
    monkeypatch.setattr(captcha, "_evaluate", lambda target, expression: None)  # closed shadow root: nothing in the DOM
    page = {"id": "P", "type": "page", "url": "https://jobs.example.com/apply"}
    frame = {"id": "F", "parentId": "P", "type": "iframe",
             "url": "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/f/av0/rch/x/0x4AAAAKEY/light/new/normal"}

    found, target = captcha._find([page, frame])

    assert found == {"kind": "turnstile", "url": page["url"], "sitekey": "0x4AAAAKEY"}
    assert target is page
