"""Linux read-only deployment discovery. Emits only allowlisted path settings.

Does not print full environments, command lines, connection strings or file contents.
Candidate paths are not a complete storage inventory or proof of effective config.
"""
import json
import os
from pathlib import Path
import socket

allowed = {'Uploads__Root', 'ServerFiles__Root', 'MAHIMA_UPLOADS_ROOT',
           'MAHIMA_DOWNLOADS_ROOT', 'ASPNETCORE_CONTENTROOT', 'ASPNETCORE_WEBROOT',
           'ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT'}
report = {'host': socket.gethostname(), 'processes': [], 'configuration_files': [],
          'candidate_paths': [], 'notes': ['Discovery only; confirm effective paths before any file copy.']}
config_dirs = set()
paths = {'/var/www/mahima-uploads', '/var/www/mahima-downloads'}
for proc in Path('/proc').iterdir():
    if not proc.name.isdigit():
        continue
    try:
        args = (proc / 'cmdline').read_bytes().decode(errors='replace').split('\0')
        if not any('mahima' in a.lower() and (a.lower().endswith('.dll') or 'mahima.api' in a.lower()) for a in args):
            continue
        cwd = (proc / 'cwd').resolve(strict=True)
        env = {}
        for item in (proc / 'environ').read_bytes().decode(errors='replace').split('\0'):
            key, sep, value = item.partition('=')
            if sep and key in allowed:
                env[key] = value
                if key not in {'ASPNETCORE_ENVIRONMENT', 'DOTNET_ENVIRONMENT'} and value:
                    paths.add(str(Path(value) if Path(value).is_absolute() else cwd / value))
        report['processes'].append({'pid': int(proc.name), 'working_directory': str(cwd), 'path_settings': env})
        config_dirs.add(cwd)
        for arg in args:
            if arg.lower().endswith('.dll') and 'mahima' in arg.lower():
                assembly = Path(arg) if Path(arg).is_absolute() else cwd / arg
                config_dirs.add(assembly.parent)
        paths.update(str(cwd / suffix) for suffix in ('wwwroot/uploads', 'wwwroot/downloads', 'wwwroot/demo-captures'))
    except (OSError, PermissionError):
        continue

# Locate likely deployment roots even when the API is stopped; no recursive file reads.
for base in ('/var/www', '/opt', '/srv'):
    if not Path(base).is_dir():
        continue
    for directory, children, files in os.walk(base, followlinks=False):
        rel_depth = len(Path(directory).relative_to(base).parts)
        children[:] = [n for n in children if not n.startswith('.') and n not in {'node_modules', 'logs', 'backups'}] if rel_depth < 3 else []
        if any(n.startswith('appsettings') and n.endswith('.json') for n in files):
            config_dirs.add(Path(directory))
        if Path(directory).name in {'uploads', 'downloads', 'demo-captures', 'pastor-voice', 'mahima-uploads', 'mahima-downloads'}:
            paths.add(directory)
            children[:] = []

for directory in sorted(config_dirs):
    for file in sorted(directory.glob('appsettings*.json')):
        item = {'file': str(file), 'path_settings': {}}
        try:
            data = json.loads(file.read_text(encoding='utf-8-sig'))
            for section in ('Uploads', 'ServerFiles'):
                value = data.get(section, {}).get('Root') if isinstance(data.get(section), dict) else None
                if isinstance(value, str) and value.strip():
                    item['path_settings'][section + ':Root'] = value
                    paths.add(str(Path(value) if Path(value).is_absolute() else directory / value))
        except (OSError, ValueError):
            item['note'] = 'Could not parse; comments/nonstandard JSON or access may require manual inspection.'
        report['configuration_files'].append(item)
        paths.update(str(directory / suffix) for suffix in ('wwwroot/uploads', 'wwwroot/downloads', 'wwwroot/demo-captures'))
for value in sorted(paths):
    path = Path(value)
    try:
        report['candidate_paths'].append({'path': value, 'exists': path.exists(),
            'is_directory': path.is_dir(), 'resolved_path': str(path.resolve())})
    except OSError:
        report['candidate_paths'].append({'path': value, 'note': 'Could not inspect'})
if not report['processes']:
    report['notes'].append('No Mahima process identified; containerized or differently named deployments require further inspection.')
print(json.dumps(report, indent=2))
