"""Back up discovered candidate media roots; never modifies application files.

Linux/root only. Symlinks are archived as links, never followed. Missing roots and
links are reported for follow-up; this is not proof of full application coverage.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOTS = {
    'v40': ['/var/www/mahima-uploads', '/var/www/mahima-downloads', '/var/www/mahima-api/wwwroot'],
    'v41': ['/var/www/mahima-uploads', '/var/www/mahima-downloads', '/opt/mahima-api/wwwroot',
            '/var/www/mahima-api/wwwroot', '/var/www/mahima/downloads'],
}

def sha256(stream):
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        digest.update(chunk)
    return digest.hexdigest()

def main():
    if os.geteuid() != 0 or len(sys.argv) != 2 or sys.argv[1] not in ROOTS:
        raise SystemExit('Run as root: python3 backup-files.py v40|v41')
    version = sys.argv[1]
    os.umask(0o077)
    roots = [p for p in ROOTS[version] if os.path.lexists(p)]
    missing = sorted(set(ROOTS[version]) - set(roots))
    if not roots:
        raise SystemExit('No expected roots exist; nothing backed up.')
    parent = Path('/var/backups/mahima-migration')
    parent.mkdir(parents=True, exist_ok=True)
    estimate = 0
    for root in roots:
        if Path(root).is_symlink():
            continue
        for directory, _, files in os.walk(root, followlinks=False):
            for name in files:
                path = Path(directory) / name
                if not path.is_symlink() and path.is_file():
                    estimate += path.stat().st_size
    free = shutil.disk_usage(parent).free
    if free < estimate + 512 * 1024 * 1024:
        raise SystemExit(f'Insufficient conservative free-space allowance: estimated bytes={estimate}, free={free}. No archive created.')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    directory = Path(tempfile.mkdtemp(prefix=f'{version}-files-{stamp}-', dir=parent))
    archive = directory / 'media.tar.gz'
    print(f'Archiving {len(roots)} roots; estimated regular-file bytes={estimate}', flush=True)
    # GNU tar preserves links/owners/modes; no --dereference, --remove-files or extraction.
    # Any nonzero status (including files changing) aborts rather than claiming success.
    subprocess.run(['tar', '--acls', '--xattrs', '--numeric-owner', '-czf', str(archive),
                    '-C', '/', '--', *[r.lstrip('/') for r in roots]], check=True)
    counts = {'files': 0, 'file_bytes': 0, 'symlinks': 0, 'hardlinks': 0, 'other_entries': 0}
    with tarfile.open(archive, 'r|gz') as bundle, (directory / 'manifest.jsonl').open('w', encoding='utf-8') as manifest:
        for member in bundle:
            item = {'archive_path': member.name, 'size': member.size, 'mode': member.mode,
                    'uid': member.uid, 'gid': member.gid, 'mtime': member.mtime}
            if member.isfile():
                counts['files'] += 1
                counts['file_bytes'] += member.size
                with bundle.extractfile(member) as stream:
                    item['sha256'] = sha256(stream)
                item['kind'] = 'file'
            elif member.issym() or member.islnk():
                item['kind'] = 'symlink' if member.issym() else 'hardlink'
                counts['symlinks' if member.issym() else 'hardlinks'] += 1
                item['link_target'] = member.linkname
            else:
                item['kind'] = 'directory' if member.isdir() else 'other'
                counts['other_entries'] += 1
            manifest.write(json.dumps(item) + '\n')
    with archive.open('rb') as stream:
        archive_hash = sha256(stream)
    (directory / 'SHA256SUMS').write_text(f'{archive_hash}  media.tar.gz\n', encoding='utf-8')
    report = {'version': version, 'backup_directory': str(directory), 'included_roots': roots,
              'missing_roots': missing, 'archive_bytes': archive.stat().st_size, 'sha256': archive_hash,
              **counts, 'notes': ['Preliminary live file backup; not synchronized with the earlier database backup.',
                                  'Symlinks were not followed. Review links and missing paths before declaring coverage complete.',
                                  'No restore/extraction or cross-server media migration has occurred.']}
    (directory / 'summary.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    # Discovery collector reads this fixed, protected pointer only after success.
    pointer = Path(f'/tmp/mahima-{version}-file-backup-summary.json')
    if pointer.is_symlink():
        raise RuntimeError('Refusing to write a symlink summary path')
    pointer.write_text(json.dumps(report, indent=2), encoding='utf-8')
    pointer.chmod(0o600)
    print(json.dumps(report, indent=2))
    print(f'FILE_BACKUP_DIRECTORY={directory}')

if __name__ == '__main__':
    main()
