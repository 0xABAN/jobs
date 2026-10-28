import pytest

from jobs.sites import ats_board, banned


@pytest.mark.parametrize(("url", "expected"), [
    ("https://jobs.lever.co/acme/123", True),
    ("https://lever.co/", True),
    ("https://job-boards.greenhouse.io/acme/jobs/1", False),
    ("https://notlever.co/jobs/1", False),
])
def test_bans_lever_and_its_subdomains(url, expected):
    assert banned(url) is expected


@pytest.mark.parametrize(("url", "board"), [
    ("https://job-boards.greenhouse.io/stripe/jobs/8128745", ("greenhouse.io", "stripe")),
    ("https://job-boards.greenhouse.io/embed/job_app?for=Waymo&token=7", ("greenhouse.io", "waymo")),
    ("https://app.greenhouse.io/embed/job_app?token=8044334", ("greenhouse.io", "")),
    ("https://jobs.ashbyhq.com/openai/55150071", ("ashbyhq.com", "openai")),
    ("https://nvidia.wd5.myworkdayjobs.com/job/1", None),
])
def test_names_the_employers_board_on_shared_application_sites(url, board):
    assert ats_board(url) == board
