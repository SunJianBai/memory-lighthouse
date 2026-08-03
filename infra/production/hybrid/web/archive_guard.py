#!/usr/bin/env python3
"""Validate and extract the deliberately small OpenBMB Web release format.

The input is an uncompressed tar stream on stdin.  zstd decompression remains a
separate, memory-bounded OS process; this program owns all path and member-type
decisions and never asks tar(1) to write an untrusted member.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import stat
import sys
import tarfile
from dataclasses import dataclass
from pathlib import Path


MAX_MEMBERS = int(os.environ.get("OPENBMB_WEB_MAX_MEMBERS", "100000"))
MAX_EXPANDED_BYTES = int(
    os.environ.get("OPENBMB_WEB_MAX_EXPANDED_BYTES", str(1024 * 1024 * 1024))
)
MAX_MANIFEST_BYTES = 32 * 1024 * 1024
MAX_PATH_BYTES = 512
SAFE_COMPONENT = re.compile(r"^[A-Za-z0-9._@+-]+$")
MANIFEST_LINE = re.compile(
    rb"^([0-9a-f]{64})  (site/openBMB/[A-Za-z0-9._@+/-]+)$"
)
REGULAR_TYPES = {tarfile.REGTYPE, tarfile.AREGTYPE}
ALLOWED_TYPES = REGULAR_TYPES | {tarfile.DIRTYPE}
REQUIRED_ENTRYPOINTS = {
    "site/openBMB/index.html",
    "site/openBMB/admin/index.html",
}


class ArchiveRejected(RuntimeError):
    pass


@dataclass(frozen=True)
class ScanResult:
    file_count: int
    expanded_bytes: int
    manifest_entries: dict[str, str]


def reject(message: str) -> None:
    raise ArchiveRejected(message)


def canonical_member_path(member: tarfile.TarInfo) -> str:
    raw = member.name
    if not raw or "\\" in raw or raw.startswith("/"):
        reject(f"unsafe archive path: {raw!r}")
    if any(ord(char) < 32 or ord(char) == 127 for char in raw):
        reject(f"control character in archive path: {raw!r}")
    if len(raw.encode("utf-8")) > MAX_PATH_BYTES:
        reject(f"archive path is too long: {raw!r}")

    if member.isdir() and raw.endswith("/"):
        raw = raw[:-1]
    elif raw.endswith("/"):
        reject(f"non-directory member has a trailing slash: {raw!r}")

    parts = raw.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        reject(f"non-canonical archive path: {raw!r}")
    if any(not SAFE_COMPONENT.fullmatch(part) for part in parts):
        reject(f"unsupported archive path characters: {raw!r}")

    canonical = "/".join(parts)
    if canonical == "SHA256SUMS":
        if not member.isfile():
            reject("SHA256SUMS must be a regular file")
        return canonical
    if canonical == "site":
        if not member.isdir():
            reject("site must be a directory")
        return canonical
    if canonical == "site/openBMB" or canonical.startswith("site/openBMB/"):
        return canonical
    reject(f"archive root may contain only SHA256SUMS and site/: {canonical!r}")


def parse_manifest(data: bytes, archive_files: set[str]) -> dict[str, str]:
    if not data or len(data) > MAX_MANIFEST_BYTES or not data.endswith(b"\n"):
        reject("SHA256SUMS must be non-empty, newline-terminated, and bounded")

    entries: dict[str, str] = {}
    for line_number, line in enumerate(data.splitlines(), start=1):
        match = MANIFEST_LINE.fullmatch(line)
        if match is None:
            reject(f"invalid SHA256SUMS line {line_number}")
        digest = match.group(1).decode("ascii")
        path = match.group(2).decode("ascii")
        parts = path.split("/")
        if any(part in {"", ".", ".."} for part in parts):
            reject(f"non-canonical manifest path on line {line_number}")
        if path in entries:
            reject(f"duplicate SHA256SUMS path: {path}")
        entries[path] = digest

    expected_files = archive_files - {"SHA256SUMS"}
    if set(entries) != expected_files:
        missing = sorted(expected_files - set(entries))[:3]
        extra = sorted(set(entries) - expected_files)[:3]
        reject(f"SHA256SUMS/file set mismatch (missing={missing}, extra={extra})")
    missing_entrypoints = REQUIRED_ENTRYPOINTS - set(entries)
    if missing_entrypoints:
        reject(f"required SPA entrypoints missing: {sorted(missing_entrypoints)}")
    return entries


def safe_output_path(destination: Path, member_path: str) -> Path:
    # member_path was already restricted to canonical safe components.  This
    # additional commonpath assertion makes that invariant explicit at the IO seam.
    output = destination.joinpath(*member_path.split("/"))
    if os.path.commonpath((str(destination), str(output))) != str(destination):
        reject(f"member escaped extraction root: {member_path}")
    return output


def create_parent_directories(destination: Path, output: Path) -> None:
    relative_parent = output.parent.relative_to(destination)
    cursor = destination
    for part in relative_parent.parts:
        cursor = cursor / part
        try:
            cursor.mkdir(mode=0o700)
        except FileExistsError:
            metadata = cursor.lstat()
            if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
                reject(f"extraction parent is not a real directory: {cursor}")


def scan_stream(destination: Path | None) -> ScanResult:
    seen: set[str] = set()
    files: set[str] = set()
    directories: set[str] = set()
    file_hashes: dict[str, str] = {}
    manifest_data: bytes | None = None
    expanded_bytes = 0
    member_count = 0

    try:
        archive = tarfile.open(fileobj=sys.stdin.buffer, mode="r|")
    except tarfile.TarError as error:
        reject(f"tar stream could not be opened: {error}")

    try:
        for member in archive:
            member_count += 1
            if member_count > MAX_MEMBERS:
                reject(f"archive has more than {MAX_MEMBERS} members")
            if member.type not in ALLOWED_TYPES or member.issym() or member.islnk():
                reject(f"links and special members are forbidden: {member.name!r}")
            if getattr(member, "sparse", None):
                reject(f"sparse members are forbidden: {member.name!r}")
            if member.mode & 0o7000 or member.mode & 0o022:
                reject(f"unsafe mode on archive member: {member.name!r}")

            member_path = canonical_member_path(member)
            if member_path in seen:
                reject(f"duplicate archive member: {member_path}")
            seen.add(member_path)

            if member.isdir():
                directories.add(member_path)
                if destination is not None:
                    output = safe_output_path(destination, member_path)
                    create_parent_directories(destination, output)
                    try:
                        output.mkdir(mode=0o700)
                    except FileExistsError:
                        metadata = output.lstat()
                        if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(
                            metadata.st_mode
                        ):
                            reject(f"directory member collides with a file: {member_path}")
                continue

            expanded_bytes += member.size
            if member.size < 0 or expanded_bytes > MAX_EXPANDED_BYTES:
                reject("archive expanded size exceeds the configured limit")
            files.add(member_path)
            source = archive.extractfile(member)
            if source is None:
                reject(f"regular member could not be read: {member_path}")

            capture_manifest = member_path == "SHA256SUMS"
            if capture_manifest and member.size > MAX_MANIFEST_BYTES:
                reject("SHA256SUMS exceeds its size limit")

            output_handle = None
            hasher = hashlib.sha256() if member_path.startswith("site/") else None
            captured = bytearray() if capture_manifest else None
            try:
                if destination is not None:
                    output = safe_output_path(destination, member_path)
                    create_parent_directories(destination, output)
                    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
                    flags |= getattr(os, "O_NOFOLLOW", 0)
                    descriptor = os.open(output, flags, 0o600)
                    output_handle = os.fdopen(descriptor, "wb")

                remaining = member.size
                while remaining:
                    chunk = source.read(min(1024 * 1024, remaining))
                    if not chunk:
                        reject(f"truncated regular member: {member_path}")
                    remaining -= len(chunk)
                    if output_handle is not None:
                        output_handle.write(chunk)
                    if hasher is not None:
                        hasher.update(chunk)
                    if captured is not None:
                        captured.extend(chunk)
                if source.read(1):
                    reject(f"member exceeded its declared size: {member_path}")
                if output_handle is not None:
                    output_handle.flush()
                    os.fsync(output_handle.fileno())
            finally:
                source.close()
                if output_handle is not None:
                    output_handle.close()

            if hasher is not None:
                file_hashes[member_path] = hasher.hexdigest()
            if captured is not None:
                manifest_data = bytes(captured)
    except (tarfile.TarError, OSError) as error:
        reject(f"archive read failed: {error}")
    finally:
        archive.close()

    if manifest_data is None:
        reject("archive is missing SHA256SUMS")
    if "site" not in seen:
        reject("archive is missing the top-level site directory")

    # Refuse file/directory prefix collisions before trusting the extracted tree.
    for file_path in files:
        components = file_path.split("/")
        for index in range(1, len(components)):
            if "/".join(components[:index]) in files:
                reject(f"regular file is used as a parent directory: {file_path}")
    if files & directories:
        reject("an archive path is both a regular file and a directory")

    manifest_entries = parse_manifest(manifest_data, files)
    if destination is not None:
        for path, expected in manifest_entries.items():
            actual = file_hashes.get(path)
            if actual != expected:
                reject(f"content checksum mismatch: {path}")
        harden_tree(destination)

    return ScanResult(
        file_count=len(files) - 1,
        expanded_bytes=expanded_bytes,
        manifest_entries=manifest_entries,
    )


def harden_tree(destination: Path) -> None:
    paths = sorted(destination.rglob("*"), key=lambda path: len(path.parts), reverse=True)
    for path in paths:
        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            reject(f"unexpected symlink after extraction: {path}")
        if stat.S_ISREG(metadata.st_mode):
            path.chmod(0o444)
            descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        elif stat.S_ISDIR(metadata.st_mode):
            path.chmod(0o555)
            fsync_directory(path)
        else:
            reject(f"unexpected special file after extraction: {path}")
    fsync_directory(destination)


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def command_inspect() -> None:
    result = scan_stream(None)
    print(
        f"archive-ok files={result.file_count} expanded_bytes={result.expanded_bytes}",
        flush=True,
    )


def command_extract(destination_text: str) -> None:
    destination = Path(destination_text)
    if not destination.is_absolute():
        reject("extraction destination must be absolute")
    metadata = destination.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or stat.S_ISLNK(metadata.st_mode):
        reject("extraction destination must be a real directory")
    if any(destination.iterdir()):
        reject("extraction destination must be empty")
    result = scan_stream(destination)
    print(
        f"extract-ok files={result.file_count} expanded_bytes={result.expanded_bytes}",
        flush=True,
    )


def command_fsync(path_text: str) -> None:
    path = Path(path_text)
    if not path.is_absolute():
        reject("fsync path must be absolute")
    metadata = path.lstat()
    if stat.S_ISLNK(metadata.st_mode):
        reject("refusing to fsync a symlink")
    if stat.S_ISDIR(metadata.st_mode):
        fsync_directory(path)
        return
    if stat.S_ISREG(metadata.st_mode):
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        return
    reject("fsync path must be a regular file or directory")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("inspect")
    extract = subparsers.add_parser("extract")
    extract.add_argument("destination")
    fsync = subparsers.add_parser("fsync")
    fsync.add_argument("path")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        if args.command == "inspect":
            command_inspect()
        elif args.command == "extract":
            command_extract(args.destination)
        else:
            command_fsync(args.path)
    except (ArchiveRejected, FileNotFoundError) as error:
        print(f"archive rejected: {error}", file=sys.stderr)
        return 65
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
