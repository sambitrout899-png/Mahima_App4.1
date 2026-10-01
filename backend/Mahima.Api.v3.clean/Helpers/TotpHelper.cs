using System;
using System.Security.Cryptography;
using System.Text;

namespace Mahima.Api.v3.clean.Helpers
{
    /// <summary>
    /// Self-contained RFC 6238 TOTP (Time-based One-Time Password) implementation used for
    /// admin/staff multi-factor authentication. No external NuGet dependency required —
    /// standard Google Authenticator / Microsoft Authenticator / Authy apps are all compatible.
    /// </summary>
    public static class TotpHelper
    {
        private const int SecretByteLength = 20; // 160-bit secret, standard for TOTP
        private const int Digits = 6;
        private const int StepSeconds = 30;
        private const int AllowedDriftSteps = 1; // accept 1 step before/after to tolerate clock skew

        public static string GenerateSecret()
        {
            var bytes = RandomNumberGenerator.GetBytes(SecretByteLength);
            return Base32Encode(bytes);
        }

        public static string BuildOtpAuthUri(string secret, string accountLabel, string issuer)
        {
            var encodedIssuer = Uri.EscapeDataString(issuer);
            var encodedLabel = Uri.EscapeDataString(accountLabel);
            return $"otpauth://totp/{encodedIssuer}:{encodedLabel}?secret={secret}&issuer={encodedIssuer}&digits={Digits}&period={StepSeconds}&algorithm=SHA1";
        }

        public static bool VerifyCode(string base32Secret, string code)
        {
            if (string.IsNullOrWhiteSpace(base32Secret) || string.IsNullOrWhiteSpace(code)) return false;
            code = code.Trim();
            if (code.Length != Digits || !long.TryParse(code, out _)) return false;

            byte[] key;
            try { key = Base32Decode(base32Secret); }
            catch { return false; }

            var currentStep = DateTimeOffset.UtcNow.ToUnixTimeSeconds() / StepSeconds;
            for (var drift = -AllowedDriftSteps; drift <= AllowedDriftSteps; drift++)
            {
                var candidate = ComputeCode(key, currentStep + drift);
                if (candidate == code) return true;
            }
            return false;
        }

        public static string GenerateRecoveryCode()
        {
            // 10-character alphanumeric code, grouped for readability: XXXXX-XXXXX
            const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
            var bytes = RandomNumberGenerator.GetBytes(10);
            var sb = new StringBuilder(11);
            for (var i = 0; i < 10; i++)
            {
                if (i == 5) sb.Append('-');
                sb.Append(alphabet[bytes[i] % alphabet.Length]);
            }
            return sb.ToString();
        }

        private static string ComputeCode(byte[] key, long counter)
        {
            var counterBytes = BitConverter.GetBytes(counter);
            if (BitConverter.IsLittleEndian) Array.Reverse(counterBytes);

            using var hmac = new HMACSHA1(key);
            var hash = hmac.ComputeHash(counterBytes);

            var offset = hash[^1] & 0x0F;
            var binaryCode = ((hash[offset] & 0x7F) << 24)
                            | ((hash[offset + 1] & 0xFF) << 16)
                            | ((hash[offset + 2] & 0xFF) << 8)
                            | (hash[offset + 3] & 0xFF);

            var otp = binaryCode % (int)Math.Pow(10, Digits);
            return otp.ToString(new string('0', Digits));
        }

        private static string Base32Encode(byte[] data)
        {
            const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
            var sb = new StringBuilder((data.Length * 8 + 4) / 5);
            int bitBuffer = 0, bitsLeft = 0;
            foreach (var b in data)
            {
                bitBuffer = (bitBuffer << 8) | b;
                bitsLeft += 8;
                while (bitsLeft >= 5)
                {
                    sb.Append(alphabet[(bitBuffer >> (bitsLeft - 5)) & 0x1F]);
                    bitsLeft -= 5;
                }
            }
            if (bitsLeft > 0)
                sb.Append(alphabet[(bitBuffer << (5 - bitsLeft)) & 0x1F]);
            return sb.ToString();
        }

        private static byte[] Base32Decode(string base32)
        {
            const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
            base32 = base32.Trim().TrimEnd('=').ToUpperInvariant();
            var bytes = new byte[base32.Length * 5 / 8];
            int bitBuffer = 0, bitsLeft = 0, index = 0;
            foreach (var c in base32)
            {
                var value = alphabet.IndexOf(c);
                if (value < 0) continue; // skip invalid characters defensively
                bitBuffer = (bitBuffer << 5) | value;
                bitsLeft += 5;
                if (bitsLeft >= 8)
                {
                    bytes[index++] = (byte)((bitBuffer >> (bitsLeft - 8)) & 0xFF);
                    bitsLeft -= 8;
                }
            }
            return bytes;
        }
    }
}
