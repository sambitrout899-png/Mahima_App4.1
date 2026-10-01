$ErrorActionPreference = 'Stop'
$remote = 'root@187.127.157.35'
$db = 'mahima_v41_rehearsal_20260922_173119_361898'
& scp (Join-Path $PSScriptRoot 'recovery-rehearse-attendance.sql') "${remote}:/tmp/mahima-recovery-rehearse-attendance.sql"
if ($LASTEXITCODE -ne 0) { throw 'Attendance script upload failed' }
& ssh $remote "sudo -u postgres psql -X -d $db -v ON_ERROR_STOP=1 -f /tmp/mahima-recovery-rehearse-attendance.sql"
if ($LASTEXITCODE -ne 0) { throw 'Attendance recovery failed. Share output before rerunning.' }
