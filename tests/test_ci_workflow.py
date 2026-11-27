"""Contract tests for the CI workflow.

These assertions pin the shape of ``.github/workflows/ci.yml`` so the stable job
ids (the required status-check names), the repository guard that keeps a fork's
pull request from spending runner minutes, the least-privilege permissions, and
the packaging/docker gates
cannot drift silently. The ``windows`` job is pinned separately: it builds the exe
on demand only, because releases are assembled by hand.
"""

from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
CI = REPO_ROOT / ".github" / "workflows" / "ci.yml"

JOB_IDS = ("python", "web", "docs", "packaging", "docker", "windows")

# Automatic CI builds artifacts for this repository only. A fork's pull request
# runs the workflow but skips every job; `workflow_dispatch` runs them on demand.
PUBLIC_REPOSITORY = "dodeka12/micro-otter"
PUBLIC_REPO_GUARD = (
    f"github.repository == '{PUBLIC_REPOSITORY}' || github.event_name == 'workflow_dispatch'"
)

# The Windows exe is not built by automatic CI: a release is assembled by hand
# (`docs/workflow/release.md`), so the job runs on demand only. Its id stays in
# `JOB_IDS` because it is a required status-check name; a skipped job satisfies the
# check, while a removed job would leave every pull request waiting for a status.
WINDOWS_MANUAL_ONLY_GUARD = "github.event_name == 'workflow_dispatch'"
MANUAL_ONLY_JOB_IDS = ("windows",)


def _workflow() -> dict:
    # BaseLoader keeps `on`/`off`/`yes`/`no` as strings, so the GitHub Actions
    # `on:` trigger key is not parsed as the boolean `True` (YAML 1.1 gotcha).
    return yaml.load(CI.read_text(encoding="utf-8"), Loader=yaml.BaseLoader)


def _jobs() -> dict:
    return _workflow()["jobs"]


def _text() -> str:
    return CI.read_text(encoding="utf-8")


def test_job_ids_and_names_are_the_stable_set() -> None:
    jobs = _jobs()
    assert tuple(jobs) == JOB_IDS, f"job ids must be exactly {JOB_IDS}, got {tuple(jobs)}"
    for job_id in JOB_IDS:
        assert jobs[job_id]["name"] == job_id, f"{job_id}'s name must equal its id"


def test_every_automatic_job_is_scoped_to_the_published_repository() -> None:
    """A pull request from a fork must cost no runner minutes."""
    for job_id, job in _jobs().items():
        if job_id in MANUAL_ONLY_JOB_IDS:
            continue
        assert job.get("if") == PUBLIC_REPO_GUARD, (
            f"{job_id} must carry the public-repository guard {PUBLIC_REPO_GUARD!r}, "
            f"got {job.get('if')!r}"
        )


def test_manual_only_jobs_never_run_automatically() -> None:
    """The exe is built on demand only: a release is assembled by hand."""
    for job_id in MANUAL_ONLY_JOB_IDS:
        assert _jobs()[job_id].get("if") == WINDOWS_MANUAL_ONLY_GUARD, (
            f"{job_id} must run on `workflow_dispatch` only, " f"got {_jobs()[job_id].get('if')!r}"
        )


def test_workflow_is_least_privilege_and_publishes_nothing() -> None:
    workflow = _workflow()
    assert workflow["permissions"] == {"contents": "read"}, workflow.get("permissions")
    text = _text()
    assert "secrets." not in text, "no job may read a secret"
    for publish_action in (
        "softprops/action-gh-release",
        "actions/deploy-pages",
        "actions/upload-pages-artifact",
    ):
        assert publish_action not in text, f"ci.yml must not publish via {publish_action}"


def test_push_and_pull_request_scoping() -> None:
    workflow = _workflow()
    assert workflow["on"]["push"]["branches"] == ["main"]
    assert "paths-ignore" not in workflow["on"]["pull_request"], (
        "every pull request runs the jobs; a paths filter would skip a change set silently"
    )


def _step_runs(job_id: str) -> list[str]:
    return [step["run"] for step in _jobs()[job_id]["steps"] if "run" in step]


def _upload_path(job_id: str) -> str | None:
    for step in _jobs()[job_id]["steps"]:
        if step.get("uses") == "actions/upload-artifact@v4":
            return step["with"]["path"]
    return None


def test_packaging_job_builds_verifies_and_uploads_the_wheel() -> None:
    runs = _step_runs("packaging")
    assert "bash deploy/packaging/build-wheel.sh" in runs
    assert "bash deploy/packaging/verify-wheel.sh" in runs
    assert _upload_path("packaging") == "dist/*.whl"


def test_docker_job_builds_the_runtime_image_only() -> None:
    text = _text()
    assert "Dockerfile.runtime" in text
    assert "Dockerfile.compile" not in text, "CI must not build the compile image (manual/nightly)"


def test_windows_job_builds_and_uploads_the_exe_on_demand() -> None:
    text = _text()
    assert "build-exe.ps1" in text
    assert _upload_path("windows") == "dist/micro-otter.exe"


def test_ci_builds_no_firmware_image() -> None:
    """Firmware images are built by hand for a release (docs/workflow/release.md)."""
    text = _text()
    for build_marker in ("compile-runtime", "esptool", "firmware.bin", "firmware.import"):
        assert build_marker not in text, (
            f"ci.yml must not build firmware ({build_marker!r}); releases are " "assembled by hand"
        )


def test_docs_job_runs_the_link_gate_after_building_docs() -> None:
    steps = _jobs()["docs"]["steps"]
    names = [step["name"] for step in steps]
    build = names.index("Build docs")
    link = names.index("Check documentation links")
    upload = names.index("Upload docs site")
    assert build < link < upload, "link gate must run between Build docs and Upload docs site"
    assert steps[link]["run"] == "npm run check:docs-links"
    setup_node = [i for i, s in enumerate(steps) if s.get("uses") == "actions/setup-node@v4"]
    assert len(setup_node) == 1, "the docs job must have exactly one setup-node step"
    assert setup_node[0] < link, "setup-node must precede the link gate"
