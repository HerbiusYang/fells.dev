#!/usr/bin/env python3
"""Package an already built frontend and bind every byte to its Git revision."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dist', default='dist')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    if os.environ.get('SUPPORT_PORTAL_PATH'):
        raise SystemExit('Legacy SUPPORT_PORTAL_PATH must be unset for release builds')
    dist = Path(args.dist).resolve()
    output = Path(args.out).resolve()
    if not dist.is_dir() or output == dist or dist in output.parents:
        raise SystemExit('Expected a built dist and a separate artifact output directory')
    files = []
    for path in sorted(dist.rglob('*')):
        if path.is_symlink():
            raise SystemExit(f'Refusing symlink in build: {path.relative_to(dist)}')
        if path.is_file():
            files.append(path)
        elif not path.is_dir():
            raise SystemExit(f'Refusing non-regular build entry: {path.relative_to(dist)}')
    if not files or not (dist / 'index.html').is_file():
        raise SystemExit('Frontend build is empty or lacks index.html')
    private_pages = [f'{prefix}support/{suffix}index.html'
                     for prefix in ['', 'zh/', 'zh-hant/', 'ja/', 'ko/', 'es/']
                     for suffix in ['', 'desk/']]
    for relative in private_pages:
        path = dist / relative
        if not path.is_file() or 'noindex, nofollow, noarchive' not in path.read_text():
            raise SystemExit(f'Missing private support page or indexing policy: {relative}')
    output.mkdir(parents=True, exist_ok=True)
    manifest = {path.relative_to(dist).as_posix(): digest(path) for path in files}
    manifest_path = output / 'frontend-manifest.json'
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n')
    archive_path = output / 'frontend.tar.gz'
    # Only regular file entries; extraction creates parent directories itself.
    with tarfile.open(archive_path, 'w:gz', format=tarfile.USTAR_FORMAT) as archive:
        for path in files:
            info = archive.gettarinfo(str(path), arcname=path.relative_to(dist).as_posix())
            info.uid = info.gid = 0
            info.uname = info.gname = ''
            info.mode = 0o644
            info.mtime = 0
            if not info.isfile():
                raise SystemExit(f'Non-regular tar entry: {info.name}')
            with path.open('rb') as contents:
                archive.addfile(info, contents)
    proof = {
        'sourceCommit': command('git', 'rev-parse', 'HEAD'),
        'sourceTree': command('git', 'rev-parse', 'HEAD^{tree}'),
        'nodeVersion': command('node', '--version'),
        'pnpmVersion': command('pnpm', '--version'),
        'frontendArchiveSha256': digest(archive_path),
        'frontendManifestSha256': digest(manifest_path),
        'dependencyLockSha256': digest(Path('pnpm-lock.yaml')),
        'privatePageCount': len(private_pages),
        'fileCount': len(files),
        'supportPath': '/support/desk',
        'authMode': 'cloudflare-access',
        'legacyPortalBuildParameterUsed': False,
    }
    (output / 'frontend-build-proof.json').write_text(json.dumps(proof, indent=2, sort_keys=True) + '\n')
    print(json.dumps(proof, indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
