# Mahima password hash generator

Copy this entire folder to the server, then run:

```bash
cd /path/to/mahima-password-fix
dotnet run
```

The command self-verifies the ASP.NET Identity-compatible hash and prints a
complete SQL transaction. Copy and execute that exact transaction without
editing the hash.

PostgreSQL must report `UPDATE 1`. Sign in as `SambitR` using the generated
`TEMP_PASSWORD`, then change it immediately. Never paste the temporary password
or hash into chat, screenshots, source control, or deployment logs.
