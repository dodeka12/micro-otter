"""Tests for :mod:`micro_otter.tools.local_files`."""

from __future__ import annotations

from pathlib import Path

import pytest

from micro_otter.tools.local_files import (
    FS_MAX_ENTRIES,
    LocalFileError,
    list_directory,
    validate_destination_directory,
)


def _mkdir(parent: Path, *names: str) -> None:
    for name in names:
        (parent / name).mkdir(parents=True, exist_ok=True)


def _touch(parent: Path, *names: str) -> None:
    for name in names:
        (parent / name).parent.mkdir(parents=True, exist_ok=True)
        (parent / name).write_text("x")


def test_sorted_directories_first(tmp_path: Path) -> None:
    """Directories come first, then files, each group case-insensitively by name."""

    _touch(tmp_path, "b.txt", "A.txt", "z.zip")
    _mkdir(tmp_path, "sub", "Alpha")
    listing = list_directory(path=str(tmp_path))
    names = [entry["name"] for entry in listing["entries"]]
    assert names == ["Alpha", "sub", "A.txt", "b.txt", "z.zip"]


def test_extension_match_is_case_insensitive(tmp_path: Path) -> None:
    """``extensions=(\".zip\",)`` matches an uppercase ``.ZIP`` suffix."""

    _touch(tmp_path, "a.ZIP", "b.txt")
    listing = list_directory(path=str(tmp_path), extensions=(".zip",))
    assert [entry["name"] for entry in listing["entries"]] == ["a.ZIP"]


def test_show_hidden_off_hides_dotfiles(tmp_path: Path) -> None:
    """Hidden names are dropped unless ``show_hidden`` is set."""

    _touch(tmp_path, ".dotfile", "visible.txt")
    plain = list_directory(path=str(tmp_path))
    assert [entry["name"] for entry in plain["entries"]] == ["visible.txt"]
    with_hidden = list_directory(path=str(tmp_path), show_hidden=True)
    assert {entry["name"] for entry in with_hidden["entries"]} >= {".dotfile", "visible.txt"}


def test_empty_extensions_lists_files(tmp_path: Path) -> None:
    """An empty extension list means every file."""

    _touch(tmp_path, "a.zip", "b.bin", "c.txt")
    listing = list_directory(path=str(tmp_path))
    names = {entry["name"] for entry in listing["entries"]}
    assert names == {"a.zip", "b.bin", "c.txt"}


def test_symlinks_report_symlink_kind(tmp_path: Path) -> None:
    """A symlinked directory and file both report ``kind: \"symlink\"``."""

    real_dir = tmp_path / "real"
    real_dir.mkdir()
    (real_dir / "file.txt").write_text("x")
    (tmp_path / "link-dir").symlink_to(real_dir, target_is_directory=True)
    (tmp_path / "link-file").symlink_to(real_dir / "file.txt")
    listing = list_directory(path=str(tmp_path))
    kinds = {entry["name"]: entry["kind"] for entry in listing["entries"]}
    assert kinds["link-dir"] == "symlink"
    assert kinds["link-file"] == "symlink"


def test_parent_is_none_at_anchor() -> None:
    """The filesystem anchor lists ``parent`` as ``None``."""

    listing = list_directory(path="/")
    assert listing["parent"] is None


def test_relative_path_refuses(tmp_path: Path) -> None:
    """A relative path raises ``fs-path-invalid``."""

    with pytest.raises(LocalFileError) as exc:
        list_directory(path="relative/dir")
    assert exc.value.code == "fs-path-invalid"


def test_missing_path_refuses(tmp_path: Path) -> None:
    """A missing path raises ``fs-not-found``."""

    with pytest.raises(LocalFileError) as exc:
        list_directory(path=str(tmp_path / "missing"))
    assert exc.value.code == "fs-not-found"


def test_file_path_refuses(tmp_path: Path) -> None:
    """A file path raises ``fs-not-a-directory``."""

    target = tmp_path / "file.txt"
    target.write_text("x")
    with pytest.raises(LocalFileError) as exc:
        list_directory(path=str(target))
    assert exc.value.code == "fs-not-a-directory"


def test_over_cap_directory_refuses(tmp_path: Path) -> None:
    """A directory with more than the cap of entries raises ``fs-too-many-entries``."""

    for index in range(FS_MAX_ENTRIES + 1):
        (tmp_path / f"file-{index:04d}.txt").write_text("x")
    with pytest.raises(LocalFileError) as exc:
        list_directory(path=str(tmp_path))
    assert exc.value.code == "fs-too-many-entries"


class TestValidateDestinationDirectory:
    """The export write-target rule."""

    def test_accepts_a_temp_dir(self, tmp_path: Path) -> None:
        """A writable temp directory resolves."""

        assert validate_destination_directory(str(tmp_path)) == tmp_path.resolve()

    def test_rejects_relative(self) -> None:
        """A relative path raises ``fs-destination-not-absolute``."""

        with pytest.raises(LocalFileError) as exc:
            validate_destination_directory("relative/dir")
        assert exc.value.code == "fs-destination-not-absolute"

    def test_rejects_missing(self, tmp_path: Path) -> None:
        """A missing path raises ``fs-not-found``."""

        with pytest.raises(LocalFileError) as exc:
            validate_destination_directory(str(tmp_path / "missing"))
        assert exc.value.code == "fs-not-found"

    def test_rejects_a_file(self, tmp_path: Path) -> None:
        """A file path raises ``fs-not-a-directory``."""

        target = tmp_path / "file.txt"
        target.write_text("x")
        with pytest.raises(LocalFileError) as exc:
            validate_destination_directory(str(target))
        assert exc.value.code == "fs-not-a-directory"

    def test_rejects_a_symlink_to_a_directory(self, tmp_path: Path) -> None:
        """A symlink to a directory raises ``fs-not-a-directory``."""

        real = tmp_path / "real"
        real.mkdir()
        link = tmp_path / "link"
        link.symlink_to(real, target_is_directory=True)
        with pytest.raises(LocalFileError) as exc:
            validate_destination_directory(str(link))
        assert exc.value.code == "fs-not-a-directory"
