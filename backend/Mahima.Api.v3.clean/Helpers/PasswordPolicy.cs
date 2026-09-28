using System;
using System.Linq;
using System.Security.Cryptography;

namespace Mahima.Api.v3.clean.Helpers
{
    // Shared strength check + generator for both the self-service change-password
    // endpoint and the admin "generate password" action.
    public static class PasswordPolicy
    {
        private const int MinLength = 8;

        // Excludes visually ambiguous characters (0/O, 1/l/I).
        private const string LowerChars = "abcdefghjkmnpqrstuvwxyz";
        private const string UpperChars = "ABCDEFGHJKMNPQRSTUVWXYZ";
        private const string DigitChars = "23456789";
        private const string SymbolChars = "!@#$%^&*-_=+?";

        public static bool IsStrong(string? password, out string error)
        {
            if (string.IsNullOrWhiteSpace(password) || password.Length < MinLength)
            {
                error = $"Password must be at least {MinLength} characters.";
                return false;
            }

            var classes = 0;
            if (password.Any(char.IsUpper)) classes++;
            if (password.Any(char.IsLower)) classes++;
            if (password.Any(char.IsDigit)) classes++;
            if (password.Any(c => !char.IsLetterOrDigit(c))) classes++;

            if (classes < 3)
            {
                error = "Password must include at least 3 of: uppercase letters, lowercase letters, digits, symbols.";
                return false;
            }

            error = "";
            return true;
        }

        public static string Generate(int length = 14)
        {
            length = Math.Max(length, MinLength);
            const string all = LowerChars + UpperChars + DigitChars + SymbolChars;
            var chars = new char[length];

            // Guarantee at least one of each required character class up front.
            chars[0] = PickRandom(LowerChars);
            chars[1] = PickRandom(UpperChars);
            chars[2] = PickRandom(DigitChars);
            chars[3] = PickRandom(SymbolChars);
            for (var i = 4; i < length; i++)
                chars[i] = PickRandom(all);

            // Fisher-Yates shuffle with a CSPRNG so the guaranteed classes aren't
            // always in the same first four positions.
            for (var i = chars.Length - 1; i > 0; i--)
            {
                var j = RandomNumberGenerator.GetInt32(i + 1);
                (chars[i], chars[j]) = (chars[j], chars[i]);
            }

            return new string(chars);
        }

        private static char PickRandom(string alphabet) => alphabet[RandomNumberGenerator.GetInt32(alphabet.Length)];
    }
}
