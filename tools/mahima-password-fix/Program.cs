using System.Security.Cryptography;
using Microsoft.AspNetCore.Identity;

var temporaryPassword =
    $"Root-{Convert.ToHexString(RandomNumberGenerator.GetBytes(8))}!a9";

var hasher = new PasswordHasher<object>();
var hashSubject = new object();
var passwordHash = hasher.HashPassword(hashSubject, temporaryPassword);
var verification = hasher.VerifyHashedPassword(
    hashSubject,
    passwordHash,
    temporaryPassword);

if (verification == PasswordVerificationResult.Failed)
{
    Console.Error.WriteLine("Generated password hash failed self-verification.");
    Environment.ExitCode = 1;
    return;
}

Console.WriteLine("Mahima root-account recovery values");
Console.WriteLine("Keep these values private and use them only once.");
Console.WriteLine();
Console.WriteLine($"TEMP_PASSWORD={temporaryPassword}");
Console.WriteLine($"PASSWORD_HASH={passwordHash}");
Console.WriteLine("SELF_VERIFIED=true");
Console.WriteLine();
Console.WriteLine("Run this exact SQL in mahima_db_3_0:");
Console.WriteLine();
Console.WriteLine("BEGIN;");
Console.WriteLine("UPDATE public.users");
Console.WriteLine($"SET passwordhash = '{passwordHash}'");
Console.WriteLine("WHERE id = '304c8fe2-494c-4a06-b581-61e22cf98bca'");
Console.WriteLine("  AND lower(trim(username)) = lower('SambitR')");
Console.WriteLine("  AND tenant_id = '00000000-0000-0000-0000-000000000001';");
Console.WriteLine("COMMIT;");
