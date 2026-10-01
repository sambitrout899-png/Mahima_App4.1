$ErrorActionPreference='Stop';$remote='root@187.127.157.35';$stage='rehearse-sermons';$db='mahima_v41_rehearsal_20260922_072500_351048'
& scp (Join-Path $PSScriptRoot "$stage.sql") "${remote}:/tmp/mahima-$stage.sql";if($LASTEXITCODE-ne 0){throw "$stage upload failed"}
& ssh $remote "sudo -u postgres psql -X -d $db -v ON_ERROR_STOP=1 -f /tmp/mahima-$stage.sql";if($LASTEXITCODE-ne 0){throw "$stage failed; no production database was targeted."}
