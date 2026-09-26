using System;

namespace Mahima.Api.v3.clean.Services
{
    public static class MinistryMessageFactory
    {
        public static string Build(string messageType, DateTime nowLocal, string? languageCode)
        {
            return NormalizeLanguage(languageCode) switch
            {
                "hi" => BuildHindi(messageType, nowLocal),
                "pa" => BuildPunjabi(messageType, nowLocal),
                _ => Build(messageType, nowLocal)
            };
        }

        public static string Build(string messageType, DateTime nowLocal)
        {
            switch (NormalizeMessageType(messageType))
            {
                case "daily-word":
                    return BuildDailyWord(nowLocal);
                case "welcome":
                    return "Jai Masih. Welcome to a new day. May the Lord bless your home, your work, your family, and every conversation today. Walk in faith, humility, and love.";
                case "night-prayer":
                    return BuildNightPrayer(nowLocal);
                case "sunday-service-reminder":
                    return "Sunday Church Reminder: Jai Masih family, join us this morning at 10:00 AM for worship and fellowship. Come prepared in prayer - see you at church!";
                default:
                    return string.Empty;
            }
        }

        public static string BuildNewUserWelcome(string? displayName)
        {
            var name = string.IsNullOrWhiteSpace(displayName) ? "new member" : displayName.Trim();
            return
                $"AI Counseller Welcome\n\n" +
                $"English:\nJai Masih, {name}. Welcome to the Mahima Ministry family. May your home be filled with peace, your faith grow stronger every day, and your journey with Christ be full of grace.\n\n" +
                $"Hindi:\nजय मसीह, {name}. महिमा मिनिस्ट्री परिवार में आपका स्वागत है। प्रभु आपके घर में शांति दे, आपके विश्वास को हर दिन बढ़ाए, और मसीह के साथ आपकी यात्रा अनुग्रह से भरी रहे।\n\n" +
                $"Punjabi:\nਜੈ ਮਸੀਹ, {name}. ਮਹਿਮਾ ਮਿਨਿਸਟਰੀ ਪਰਿਵਾਰ ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ। ਪ੍ਰਭੂ ਤੁਹਾਡੇ ਘਰ ਵਿੱਚ ਸ਼ਾਂਤੀ ਦੇਵੇ, ਤੁਹਾਡੇ ਵਿਸ਼ਵਾਸ ਨੂੰ ਹਰ ਰੋਜ਼ ਮਜ਼ਬੂਤ ਕਰੇ, ਅਤੇ ਮਸੀਹ ਨਾਲ ਤੁਹਾਡਾ ਸਫ਼ਰ ਕਿਰਪਾ ਨਾਲ ਭਰਿਆ ਰਹੇ।";
        }

        private static string BuildHindi(string messageType, DateTime nowLocal)
        {
            switch (NormalizeMessageType(messageType))
            {
                case "daily-word":
                    return BuildDailyWordHindi(nowLocal);
                case "welcome":
                    return "जय मसीह। नए दिन में आपका स्वागत है। प्रभु आपके घर, काम, परिवार और हर बातचीत को आशीष दे। आज विश्वास, नम्रता और प्रेम में चलें।";
                case "night-prayer":
                    return BuildNightPrayerHindi(nowLocal);
                case "sunday-service-reminder":
                    return "रविवार सेवा स्मरण: जय मसीह परिवार, आज सुबह 10:00 बजे आराधना और संगति के लिए हमारे साथ जुड़ें। प्रार्थना सहित तैयार होकर आएं - कलीसिया में मिलते हैं!";
                default:
                    return Build(messageType, nowLocal);
            }
        }

        private static string BuildPunjabi(string messageType, DateTime nowLocal)
        {
            switch (NormalizeMessageType(messageType))
            {
                case "daily-word":
                    return BuildDailyWordPunjabi(nowLocal);
                case "welcome":
                    return "ਜੈ ਮਸੀਹ। ਨਵੇਂ ਦਿਨ ਵਿੱਚ ਤੁਹਾਡਾ ਸੁਆਗਤ ਹੈ। ਪ੍ਰਭੂ ਤੁਹਾਡੇ ਘਰ, ਕੰਮ, ਪਰਿਵਾਰ ਅਤੇ ਹਰ ਗੱਲਬਾਤ ਨੂੰ ਆਸੀਸ ਦੇਵੇ। ਅੱਜ ਵਿਸ਼ਵਾਸ, ਨਿਮਰਤਾ ਅਤੇ ਪਿਆਰ ਵਿੱਚ ਚੱਲੋ।";
                case "night-prayer":
                    return BuildNightPrayerPunjabi(nowLocal);
                case "sunday-service-reminder":
                    return "ਐਤਵਾਰ ਸੇਵਾ ਯਾਦ ਦਿਹਾਣੀ: ਜੈ ਮਸੀਹ ਪਰਿਵਾਰ, ਅੱਜ ਸਵੇਰੇ 10:00 ਵਜੇ ਆਰਾਧਨਾ ਅਤੇ ਸੰਗਤ ਲਈ ਸਾਡੇ ਨਾਲ ਜੁੜੋ। ਪ੍ਰਾਰਥਨਾ ਸਹਿਤ ਤਿਆਰ ਹੋ ਕੇ ਆਓ - ਕਲੀਸਿਆ ਵਿੱਚ ਮਿਲਦੇ ਹਾਂ!";
                default:
                    return Build(messageType, nowLocal);
            }
        }

        private static string BuildDailyWord(DateTime nowLocal)
        {
            var verse = VerseFor(nowLocal);
            return
                $"Daily Word - {verse.ReferenceEn}\n" +
                $"\"{verse.TextEn}\"\n" +
                $"Reflection: {verse.ReflectionEn}\n" +
                $"AI Counseller Morning Sermon: This morning, do not leave this word as a line on a screen. Carry it into your first decision, your first conversation, and your first burden. Christ is not only giving instruction; He is forming your heart for today.\n" +
                $"Prayer: Lord, help us live this word today. Amen.";
        }

        private static string BuildNightPrayer(DateTime nowLocal)
        {
            var verse = VerseFor(nowLocal);
            return
                $"Night Prayer - {verse.ReferenceEn}\n" +
                $"\"{verse.TextEn}\"\n" +
                $"AI Counseller Night Sermon: As this day closes, place both your victories and your failures before Jesus. The Lord who watched over you in the morning is still faithful at night. Rest with a clean heart and rise again under mercy.\n" +
                $"Prayer: Lord Jesus, thank You for carrying us through this day. Forgive our shortcomings, heal our hearts, protect every family, and give peaceful sleep. Amen.";
        }

        private static string BuildDailyWordHindi(DateTime nowLocal)
        {
            var verse = VerseFor(nowLocal);
            return
                $"आज का वचन - {verse.ReferenceHi}\n" +
                $"\"{verse.TextHi}\"\n" +
                $"मनन: {verse.ReflectionHi}\n" +
                $"AI Counseller सुबह का छोटा संदेश: आज इस वचन को केवल पढ़कर न छोड़ें। इसे अपने पहले निर्णय, पहली बातचीत और पहली चिंता में साथ लेकर चलें। मसीह केवल शिक्षा नहीं देते, वह आज के लिए आपका हृदय तैयार करते हैं।\n" +
                $"प्रार्थना: प्रभु, आज हमें आपके वचन में चलना सिखाएँ। आमीन।";
        }

        private static string BuildNightPrayerHindi(DateTime nowLocal)
        {
            var verse = VerseFor(nowLocal);
            return
                $"रात्रि प्रार्थना - {verse.ReferenceHi}\n" +
                $"\"{verse.TextHi}\"\n" +
                $"AI Counseller रात का छोटा संदेश: दिन समाप्त होते समय अपनी जीत और अपनी कमियाँ दोनों यीशु के सामने रख दें। जिस प्रभु ने सुबह आपको संभाला, वही रात में भी विश्वासयोग्य है। साफ मन से विश्राम करें और नई दया के साथ उठें।\n" +
                $"प्रार्थना: प्रभु यीशु, आज हमें संभालने के लिए धन्यवाद। हमारी कमियों को क्षमा करें, हमारे मनों को चंगा करें, हर परिवार की रक्षा करें और शांतिपूर्ण नींद दें। आमीन।";
        }

        private static string BuildDailyWordPunjabi(DateTime nowLocal)
        {
            var verse = VerseFor(nowLocal);
            return
                $"ਅੱਜ ਦਾ ਵਚਨ - {verse.ReferencePa}\n" +
                $"\"{verse.TextPa}\"\n" +
                $"ਵਿਚਾਰ: {verse.ReflectionPa}\n" +
                $"AI Counseller ਸਵੇਰ ਦਾ ਛੋਟਾ ਸੁਨੇਹਾ: ਅੱਜ ਇਸ ਵਚਨ ਨੂੰ ਸਿਰਫ਼ ਪੜ੍ਹ ਕੇ ਨਾ ਛੱਡੋ। ਇਸ ਨੂੰ ਆਪਣੇ ਪਹਿਲੇ ਫੈਸਲੇ, ਪਹਿਲੀ ਗੱਲਬਾਤ ਅਤੇ ਪਹਿਲੀ ਚਿੰਤਾ ਵਿੱਚ ਨਾਲ ਲੈ ਕੇ ਚੱਲੋ। ਮਸੀਹ ਸਿਰਫ਼ ਸਿਖਾਉਂਦਾ ਨਹੀਂ, ਉਹ ਅੱਜ ਲਈ ਤੁਹਾਡਾ ਦਿਲ ਤਿਆਰ ਕਰਦਾ ਹੈ।\n" +
                $"ਪ੍ਰਾਰਥਨਾ: ਪ੍ਰਭੂ, ਅੱਜ ਸਾਨੂੰ ਆਪਣੇ ਵਚਨ ਵਿੱਚ ਤੁਰਨਾ ਸਿਖਾਓ। ਆਮੀਨ।";
        }

        private static string BuildNightPrayerPunjabi(DateTime nowLocal)
        {
            var verse = VerseFor(nowLocal);
            return
                $"ਰਾਤ ਦੀ ਪ੍ਰਾਰਥਨਾ - {verse.ReferencePa}\n" +
                $"\"{verse.TextPa}\"\n" +
                $"AI Counseller ਰਾਤ ਦਾ ਛੋਟਾ ਸੁਨੇਹਾ: ਦਿਨ ਮੁੱਕਣ ਵੇਲੇ ਆਪਣੀਆਂ ਜਿੱਤਾਂ ਅਤੇ ਕਮੀਆਂ ਦੋਵੇਂ ਯਿਸੂ ਦੇ ਸਾਹਮਣੇ ਰੱਖ ਦਿਓ। ਜਿਸ ਪ੍ਰਭੂ ਨੇ ਸਵੇਰੇ ਤੁਹਾਡੀ ਸੰਭਾਲ ਕੀਤੀ, ਉਹ ਰਾਤ ਨੂੰ ਵੀ ਵਫ਼ਾਦਾਰ ਹੈ। ਸਾਫ਼ ਦਿਲ ਨਾਲ ਆਰਾਮ ਕਰੋ ਅਤੇ ਨਵੀਂ ਦਇਆ ਨਾਲ ਉੱਠੋ।\n" +
                $"ਪ੍ਰਾਰਥਨਾ: ਪ੍ਰਭੂ ਯਿਸੂ, ਅੱਜ ਸਾਨੂੰ ਸੰਭਾਲਣ ਲਈ ਧੰਨਵਾਦ। ਸਾਡੀਆਂ ਕਮੀਆਂ ਮਾਫ਼ ਕਰੋ, ਦਿਲਾਂ ਨੂੰ ਚੰਗਾ ਕਰੋ, ਹਰ ਪਰਿਵਾਰ ਦੀ ਰੱਖਿਆ ਕਰੋ ਅਤੇ ਸ਼ਾਂਤ ਨੀਂਦ ਦਿਓ। ਆਮੀਨ।";
        }

        private static string NormalizeMessageType(string? messageType) =>
            (messageType ?? string.Empty).Trim().ToLowerInvariant();

        private static string NormalizeLanguage(string? languageCode)
        {
            var lang = (languageCode ?? "en").Trim().ToLowerInvariant();
            if (lang.StartsWith("hi")) return "hi";
            if (lang.StartsWith("pa") || lang.StartsWith("pan") || lang.StartsWith("pun")) return "pa";
            return "en";
        }

        private static DailyVerse VerseFor(DateTime nowLocal) =>
            DailyVerses[Math.Abs(nowLocal.DayOfYear - 1) % DailyVerses.Length];

        private sealed class DailyVerse
        {
            public DailyVerse(
                string referenceEn,
                string referenceHi,
                string referencePa,
                string textEn,
                string reflectionEn,
                string textHi,
                string reflectionHi,
                string textPa,
                string reflectionPa)
            {
                ReferenceEn = referenceEn;
                ReferenceHi = referenceHi;
                ReferencePa = referencePa;
                TextEn = textEn;
                ReflectionEn = reflectionEn;
                TextHi = textHi;
                ReflectionHi = reflectionHi;
                TextPa = textPa;
                ReflectionPa = reflectionPa;
            }

            public string ReferenceEn { get; }
            public string ReferenceHi { get; }
            public string ReferencePa { get; }
            public string TextEn { get; }
            public string ReflectionEn { get; }
            public string TextHi { get; }
            public string ReflectionHi { get; }
            public string TextPa { get; }
            public string ReflectionPa { get; }
        }

        private static readonly DailyVerse[] DailyVerses =
        {
            new DailyVerse("John 3:16", "यूहन्ना 3:16", "ਯੂਹੰਨਾ 3:16", "For God so loved the world that He gave His one and only Son.", "Receive God's love and share it through one generous action.", "परमेश्वर ने संसार से ऐसा प्रेम किया कि उसने अपना इकलौता पुत्र दे दिया।", "परमेश्वर के प्रेम को ग्रहण करें और आज उदारता से बाँटें।", "ਪਰਮੇਸ਼ੁਰ ਨੇ ਸੰਸਾਰ ਨਾਲ ਇੰਨਾ ਪਿਆਰ ਕੀਤਾ ਕਿ ਉਸ ਨੇ ਆਪਣਾ ਇਕਲੌਤਾ ਪੁੱਤਰ ਦੇ ਦਿੱਤਾ।", "ਪਰਮੇਸ਼ੁਰ ਦਾ ਪਿਆਰ ਕਬੂਲ ਕਰੋ ਅਤੇ ਅੱਜ ਉਦਾਰਤਾ ਨਾਲ ਵੰਡੋ।"),
            new DailyVerse("Psalm 23:1", "भजन संहिता 23:1", "ਜ਼ਬੂਰ 23:1", "The Lord is my shepherd; I shall not want.", "Trust the Shepherd before you trust your worries.", "यहोवा मेरा चरवाहा है, मुझे घटी न होगी।", "अपनी चिंताओं से पहले अपने चरवाहे पर भरोसा करें।", "ਪ੍ਰਭੂ ਮੇਰਾ ਚਰਵਾਹਾ ਹੈ, ਮੈਨੂੰ ਘਾਟ ਨਹੀਂ ਹੋਵੇਗੀ।", "ਚਿੰਤਾਵਾਂ ਤੋਂ ਪਹਿਲਾਂ ਆਪਣੇ ਚਰਵਾਹੇ ਉੱਤੇ ਭਰੋਸਾ ਕਰੋ।"),
            new DailyVerse("Philippians 4:13", "फिलिप्पियों 4:13", "ਫਿਲਿੱਪੀਆਂ 4:13", "I can do all things through Christ who strengthens me.", "Begin the day from strength, not fear.", "मसीह जो मुझे सामर्थ्य देता है, उसमें मैं सब कर सकता हूँ।", "डर से नहीं, प्रभु की सामर्थ्य से दिन शुरू करें।", "ਮਸੀਹ ਜੋ ਮੈਨੂੰ ਤਾਕਤ ਦਿੰਦਾ ਹੈ, ਉਸ ਵਿੱਚ ਮੈਂ ਸਭ ਕੁਝ ਕਰ ਸਕਦਾ ਹਾਂ।", "ਡਰ ਨਾਲ ਨਹੀਂ, ਪ੍ਰਭੂ ਦੀ ਤਾਕਤ ਨਾਲ ਦਿਨ ਸ਼ੁਰੂ ਕਰੋ।"),
            new DailyVerse("Proverbs 3:5", "नीतिवचन 3:5", "ਕਹਾਉਤਾਂ 3:5", "Trust in the Lord with all your heart and lean not on your own understanding.", "Let prayer lead before planning.", "अपने सारे मन से प्रभु पर भरोसा रखो और अपनी समझ पर निर्भर न रहो।", "योजना से पहले प्रार्थना को आगे चलने दें।", "ਆਪਣੇ ਸਾਰੇ ਦਿਲ ਨਾਲ ਪ੍ਰਭੂ ਉੱਤੇ ਭਰੋਸਾ ਕਰ ਅਤੇ ਆਪਣੀ ਸਮਝ ਉੱਤੇ ਨਾ ਟਿਕ।", "ਯੋਜਨਾ ਤੋਂ ਪਹਿਲਾਂ ਪ੍ਰਾਰਥਨਾ ਨੂੰ ਅੱਗੇ ਚੱਲਣ ਦਿਓ।"),
            new DailyVerse("Isaiah 41:10", "यशायाह 41:10", "ਯਸਾਯਾਹ 41:10", "Do not fear, for I am with you.", "God's presence is stronger than today's pressure.", "मत डर, क्योंकि मैं तेरे साथ हूँ।", "आज के दबाव से अधिक सामर्थी परमेश्वर की उपस्थिति है।", "ਡਰ ਨਾ, ਕਿਉਂਕਿ ਮੈਂ ਤੇਰੇ ਨਾਲ ਹਾਂ।", "ਅੱਜ ਦੇ ਦਬਾਅ ਨਾਲੋਂ ਪਰਮੇਸ਼ੁਰ ਦੀ ਹਾਜ਼ਰੀ ਵੱਧ ਮਜ਼ਬੂਤ ਹੈ।"),
            new DailyVerse("Matthew 6:33", "मत्ती 6:33", "ਮੱਤੀ 6:33", "Seek first the kingdom of God and His righteousness.", "Put God's way first in one decision today.", "पहिले परमेश्वर के राज्य और उसकी धार्मिकता को खोजो।", "आज एक निर्णय में परमेश्वर के मार्ग को पहले रखें।", "ਪਹਿਲਾਂ ਪਰਮੇਸ਼ੁਰ ਦੇ ਰਾਜ ਅਤੇ ਉਸ ਦੀ ਧਰਮਿਕਤਾ ਨੂੰ ਲੱਭੋ।", "ਅੱਜ ਇੱਕ ਫੈਸਲੇ ਵਿੱਚ ਪਰਮੇਸ਼ੁਰ ਦੇ ਰਾਹ ਨੂੰ ਪਹਿਲਾਂ ਰੱਖੋ।"),
            new DailyVerse("Romans 8:28", "रोमियों 8:28", "ਰੋਮੀਆਂ 8:28", "In all things God works for the good of those who love Him.", "Even difficult seasons can become testimony in God's hands.", "जो परमेश्वर से प्रेम रखते हैं, उनके लिए वह सब बातों में भलाई करता है।", "कठिन समय भी परमेश्वर के हाथों में गवाही बन सकता है।", "ਜੋ ਪਰਮੇਸ਼ੁਰ ਨਾਲ ਪਿਆਰ ਕਰਦੇ ਹਨ, ਉਨ੍ਹਾਂ ਲਈ ਉਹ ਹਰ ਗੱਲ ਵਿੱਚ ਭਲਾਈ ਕਰਦਾ ਹੈ।", "ਮੁਸ਼ਕਲ ਸਮਾਂ ਵੀ ਪਰਮੇਸ਼ੁਰ ਦੇ ਹੱਥ ਵਿੱਚ ਗਵਾਹੀ ਬਣ ਸਕਦਾ ਹੈ।"),
            new DailyVerse("Psalm 119:105", "भजन संहिता 119:105", "ਜ਼ਬੂਰ 119:105", "Your word is a lamp to my feet and a light to my path.", "Take the next step God has already lit.", "तेरा वचन मेरे पांव के लिए दीपक और मेरे मार्ग के लिए ज्योति है।", "जिस कदम को परमेश्वर ने प्रकाशित किया है, उसे विश्वास से उठाएँ।", "ਤੇਰਾ ਵਚਨ ਮੇਰੇ ਪੈਰਾਂ ਲਈ ਦੀਵਾ ਅਤੇ ਮੇਰੇ ਰਾਹ ਲਈ ਚਾਨਣ ਹੈ।", "ਜੋ ਕਦਮ ਪਰਮੇਸ਼ੁਰ ਨੇ ਰੋਸ਼ਨ ਕੀਤਾ ਹੈ, ਉਹ ਵਿਸ਼ਵਾਸ ਨਾਲ ਚੁੱਕੋ।"),
            new DailyVerse("Joshua 1:9", "यहोशू 1:9", "ਯਹੋਸ਼ੂਆ 1:9", "Be strong and courageous. Do not be afraid.", "Courage grows when obedience becomes simple.", "हियाव बाँध और दृढ़ हो; भयभीत न हो।", "आज्ञाकारिता सरल होती है तो साहस बढ़ता है।", "ਮਜ਼ਬੂਤ ਅਤੇ ਹਿੰਮਤੀ ਹੋ; ਡਰ ਨਾ।", "ਜਦੋਂ ਆਗਿਆਕਾਰੀ ਸਾਦੀ ਬਣਦੀ ਹੈ, ਹਿੰਮਤ ਵਧਦੀ ਹੈ।"),
            new DailyVerse("1 Peter 5:7", "1 पतरस 5:7", "1 ਪਤਰਸ 5:7", "Cast all your anxiety on Him because He cares for you.", "Name your burden and hand it to Jesus in prayer.", "अपनी सारी चिंता उसी पर डाल दो, क्योंकि वह तुम्हारी सुधि रखता है।", "अपने बोझ को नाम से पुकारें और प्रार्थना में यीशु को सौंप दें।", "ਆਪਣੀ ਸਾਰੀ ਚਿੰਤਾ ਉਸ ਉੱਤੇ ਸੁੱਟ ਦਿਓ, ਕਿਉਂਕਿ ਉਹ ਤੁਹਾਡੀ ਸੰਭਾਲ ਕਰਦਾ ਹੈ।", "ਆਪਣਾ ਬੋਝ ਨਾਮ ਨਾਲ ਦੱਸੋ ਅਤੇ ਪ੍ਰਾਰਥਨਾ ਵਿੱਚ ਯਿਸੂ ਨੂੰ ਸੌਂਪ ਦਿਓ।"),
            new DailyVerse("Galatians 5:22", "गलातियों 5:22", "ਗਲਾਤੀਆਂ 5:22", "The fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faithfulness.", "Let the Spirit shape your tone today.", "आत्मा का फल प्रेम, आनन्द, शांति, धीरज, कृपा, भलाई और विश्वासयोग्यता है।", "आज पवित्र आत्मा को आपकी बोली और व्यवहार गढ़ने दें।", "ਆਤਮਾ ਦਾ ਫਲ ਪਿਆਰ, ਖੁਸ਼ੀ, ਸ਼ਾਂਤੀ, ਧੀਰਜ, ਦਇਆ, ਭਲਾਈ ਅਤੇ ਵਿਸ਼ਵਾਸਯੋਗਤਾ ਹੈ।", "ਅੱਜ ਪਵਿੱਤਰ ਆਤਮਾ ਨੂੰ ਤੁਹਾਡੀ ਬੋਲੀ ਅਤੇ ਵਿਹਾਰ ਬਣਾਉਣ ਦਿਓ।"),
            new DailyVerse("James 1:5", "याकूब 1:5", "ਯਾਕੂਬ 1:5", "If any of you lacks wisdom, you should ask God.", "Ask for wisdom before reacting.", "यदि किसी को बुद्धि की घटी हो तो वह परमेश्वर से माँगे।", "प्रतिक्रिया देने से पहले बुद्धि माँगें।", "ਜੇ ਕਿਸੇ ਨੂੰ ਬੁੱਧੀ ਦੀ ਘਾਟ ਹੋਵੇ ਤਾਂ ਉਹ ਪਰਮੇਸ਼ੁਰ ਤੋਂ ਮੰਗੇ।", "ਜਵਾਬ ਦੇਣ ਤੋਂ ਪਹਿਲਾਂ ਬੁੱਧੀ ਮੰਗੋ।"),
            new DailyVerse("2 Corinthians 5:7", "2 कुरिन्थियों 5:7", "2 ਕੁਰਿੰਥੀਆਂ 5:7", "We walk by faith, not by sight.", "Faith sees God's promise beyond the visible delay.", "हम देखी हुई वस्तुओं से नहीं, विश्वास से चलते हैं।", "विश्वास दिखाई देने वाली देरी से परे परमेश्वर की प्रतिज्ञा देखता है।", "ਅਸੀਂ ਵੇਖਣ ਨਾਲ ਨਹੀਂ, ਵਿਸ਼ਵਾਸ ਨਾਲ ਤੁਰਦੇ ਹਾਂ।", "ਵਿਸ਼ਵਾਸ ਦਿਖਾਈ ਦੇਣ ਵਾਲੀ ਦੇਰੀ ਤੋਂ ਪਰੇ ਪਰਮੇਸ਼ੁਰ ਦਾ ਵਾਅਦਾ ਵੇਖਦਾ ਹੈ।"),
            new DailyVerse("Colossians 3:23", "कुलुस्सियों 3:23", "ਕੁਲੁੱਸੀਆਂ 3:23", "Whatever you do, work at it with all your heart, as working for the Lord.", "Offer ordinary work as worship.", "जो कुछ करो, मन से करो, मानो प्रभु के लिए कर रहे हो।", "साधारण काम को भी आराधना की तरह अर्पित करें।", "ਜੋ ਕੁਝ ਕਰੋ, ਦਿਲੋਂ ਕਰੋ, ਜਿਵੇਂ ਪ੍ਰਭੂ ਲਈ ਕਰਦੇ ਹੋ।", "ਸਧਾਰਣ ਕੰਮ ਨੂੰ ਵੀ ਆਰਾਧਨਾ ਵਾਂਗ ਅਰਪਣ ਕਰੋ।"),
            new DailyVerse("Psalm 46:10", "भजन संहिता 46:10", "ਜ਼ਬੂਰ 46:10", "Be still, and know that I am God.", "Pause long enough to hear peace again.", "शांत हो जाओ और जानो कि मैं ही परमेश्वर हूँ।", "इतना ठहरें कि फिर से शांति सुनाई दे।", "ਚੁੱਪ ਰਹੋ ਅਤੇ ਜਾਣੋ ਕਿ ਮੈਂ ਹੀ ਪਰਮੇਸ਼ੁਰ ਹਾਂ।", "ਇੰਨਾ ਠਹਿਰੋ ਕਿ ਸ਼ਾਂਤੀ ਮੁੜ ਸੁਣਾਈ ਦੇਵੇ।"),
            new DailyVerse("Matthew 11:28", "मत्ती 11:28", "ਮੱਤੀ 11:28", "Come to me, all you who are weary and burdened, and I will give you rest.", "Do not carry alone what Jesus invites you to bring.", "हे सब थके और बोझ से दबे लोगो, मेरे पास आओ; मैं तुम्हें विश्राम दूँगा।", "जिस बोझ को यीशु बुलाते हैं, उसे अकेले न उठाएँ।", "ਹੇ ਸਾਰੇ ਥੱਕੇ ਅਤੇ ਬੋਝ ਹੇਠ ਦਬੇ ਹੋਏ ਲੋਕੋ, ਮੇਰੇ ਕੋਲ ਆਓ; ਮੈਂ ਤੁਹਾਨੂੰ ਆਰਾਮ ਦੇਵਾਂਗਾ।", "ਜਿਸ ਬੋਝ ਨੂੰ ਯਿਸੂ ਆਪਣੇ ਕੋਲ ਬੁਲਾਉਂਦਾ ਹੈ, ਉਹ ਇਕੱਲੇ ਨਾ ਚੁੱਕੋ।"),
            new DailyVerse("Ephesians 4:32", "इफिसियों 4:32", "ਅਫ਼ਸੀਆਂ 4:32", "Be kind and compassionate to one another, forgiving each other.", "Choose one act of mercy over one sharp word.", "एक दूसरे पर कृपालु और करुणामय बनो, और क्षमा करो।", "एक कठोर शब्द के बजाय दया का एक काम चुनें।", "ਇੱਕ ਦੂਜੇ ਉੱਤੇ ਦਇਆਵਾਨ ਅਤੇ ਕਰੁਣਾਮਈ ਬਣੋ, ਅਤੇ ਮਾਫ਼ ਕਰੋ।", "ਇੱਕ ਤਿੱਖੇ ਬੋਲ ਦੀ ਥਾਂ ਦਇਆ ਦਾ ਇੱਕ ਕੰਮ ਚੁਣੋ।"),
            new DailyVerse("Hebrews 11:1", "इब्रानियों 11:1", "ਇਬਰਾਨੀਆਂ 11:1", "Faith is confidence in what we hope for and assurance about what we do not see.", "Hold hope with steady hands.", "विश्वास आशा की वस्तुओं का भरोसा और अनदेखी बातों का प्रमाण है।", "आशा को स्थिर हाथों से थामे रहें।", "ਵਿਸ਼ਵਾਸ ਆਸ ਕੀਤੀਆਂ ਗੱਲਾਂ ਦਾ ਭਰੋਸਾ ਅਤੇ ਨਾ ਵੇਖੀਆਂ ਗੱਲਾਂ ਦਾ ਸਬੂਤ ਹੈ।", "ਆਸ ਨੂੰ ਮਜ਼ਬੂਤ ਹੱਥਾਂ ਨਾਲ ਫੜੀ ਰੱਖੋ।"),
            new DailyVerse("Psalm 34:8", "भजन संहिता 34:8", "ਜ਼ਬੂਰ 34:8", "Taste and see that the Lord is good.", "Look for one clear sign of God's goodness today.", "परख कर देखो कि यहोवा भला है।", "आज परमेश्वर की भलाई का एक स्पष्ट चिन्ह खोजें।", "ਚੱਖੋ ਅਤੇ ਵੇਖੋ ਕਿ ਪ੍ਰਭੂ ਭਲਾ ਹੈ।", "ਅੱਜ ਪਰਮੇਸ਼ੁਰ ਦੀ ਭਲਾਈ ਦਾ ਇੱਕ ਸਾਫ਼ ਨਿਸ਼ਾਨ ਲੱਭੋ।"),
            new DailyVerse("Micah 6:8", "मीका 6:8", "ਮੀਕਾਹ 6:8", "Act justly, love mercy, and walk humbly with your God.", "Let humility make your service beautiful.", "न्याय करो, दया से प्रेम रखो और अपने परमेश्वर के साथ नम्रता से चलो।", "नम्रता को आपकी सेवा की सुंदरता बनने दें।", "ਨਿਆਂ ਕਰ, ਦਇਆ ਨਾਲ ਪਿਆਰ ਕਰ ਅਤੇ ਆਪਣੇ ਪਰਮੇਸ਼ੁਰ ਨਾਲ ਨਿਮਰਤਾ ਨਾਲ ਤੁਰ।", "ਨਿਮਰਤਾ ਨੂੰ ਆਪਣੀ ਸੇਵਾ ਦੀ ਸੁੰਦਰਤਾ ਬਣਨ ਦਿਓ।"),
            new DailyVerse("John 14:27", "यूहन्ना 14:27", "ਯੂਹੰਨਾ 14:27", "Peace I leave with you; my peace I give you.", "Receive the peace of Christ before entering conflict.", "मैं तुम्हें शांति दिए जाता हूँ; अपनी शांति तुम्हें देता हूँ।", "संघर्ष में जाने से पहले मसीह की शांति ग्रहण करें।", "ਮੈਂ ਤੁਹਾਨੂੰ ਸ਼ਾਂਤੀ ਛੱਡਦਾ ਹਾਂ; ਆਪਣੀ ਸ਼ਾਂਤੀ ਤੁਹਾਨੂੰ ਦਿੰਦਾ ਹਾਂ।", "ਟਕਰਾਅ ਵਿੱਚ ਜਾਣ ਤੋਂ ਪਹਿਲਾਂ ਮਸੀਹ ਦੀ ਸ਼ਾਂਤੀ ਕਬੂਲ ਕਰੋ।"),
            new DailyVerse("Romans 12:12", "रोमियों 12:12", "ਰੋਮੀਆਂ 12:12", "Be joyful in hope, patient in affliction, faithful in prayer.", "Keep prayer steady even when answers feel slow.", "आशा में आनन्दित, क्लेश में धीरजवन्त और प्रार्थना में लगे रहो।", "उत्तर धीमे लगें तब भी प्रार्थना स्थिर रखें।", "ਆਸ ਵਿੱਚ ਖੁਸ਼, ਕਲੇਸ਼ ਵਿੱਚ ਧੀਰਜਵਾਨ ਅਤੇ ਪ੍ਰਾਰਥਨਾ ਵਿੱਚ ਲੱਗੇ ਰਹੋ।", "ਜਵਾਬ ਹੌਲੇ ਲੱਗਣ ਤਾਂ ਵੀ ਪ੍ਰਾਰਥਨਾ ਅਡੋਲ ਰੱਖੋ।"),
            new DailyVerse("Psalm 91:2", "भजन संहिता 91:2", "ਜ਼ਬੂਰ 91:2", "He is my refuge and my fortress, my God, in whom I trust.", "Run to God first, not last.", "वह मेरा शरणस्थान और गढ़ है, मेरा परमेश्वर जिस पर मैं भरोसा रखता हूँ।", "अंत में नहीं, सबसे पहले परमेश्वर की ओर दौड़ें।", "ਉਹ ਮੇਰਾ ਸ਼ਰਨਸਥਾਨ ਅਤੇ ਕਿਲ੍ਹਾ ਹੈ, ਮੇਰਾ ਪਰਮੇਸ਼ੁਰ ਜਿਸ ਉੱਤੇ ਮੈਂ ਭਰੋਸਾ ਕਰਦਾ ਹਾਂ।", "ਅੰਤ ਵਿੱਚ ਨਹੀਂ, ਸਭ ਤੋਂ ਪਹਿਲਾਂ ਪਰਮੇਸ਼ੁਰ ਵੱਲ ਦੌੜੋ।"),
            new DailyVerse("1 Thessalonians 5:16-18", "1 थिस्सलुनीकियों 5:16-18", "1 ਥੱਸਲੁਨੀਕੀਆਂ 5:16-18", "Rejoice always, pray continually, give thanks in all circumstances.", "Find one reason for thanks and let it reset your heart.", "सदा आनन्दित रहो, निरंतर प्रार्थना करो, हर परिस्थिति में धन्यवाद दो।", "धन्यवाद का एक कारण खोजें और उसे अपने हृदय को फिर से दिशा देने दें।", "ਸਦਾ ਖੁਸ਼ ਰਹੋ, ਨਿਰੰਤਰ ਪ੍ਰਾਰਥਨਾ ਕਰੋ, ਹਰ ਹਾਲਤ ਵਿੱਚ ਧੰਨਵਾਦ ਦਿਓ।", "ਧੰਨਵਾਦ ਦਾ ਇੱਕ ਕਾਰਨ ਲੱਭੋ ਅਤੇ ਉਸ ਨੂੰ ਦਿਲ ਮੁੜ ਸੈੱਟ ਕਰਨ ਦਿਓ।"),
            new DailyVerse("Mark 10:27", "मरकुस 10:27", "ਮਰਕੁਸ 10:27", "With man this is impossible, but not with God.", "Bring the impossible place to the God of possibility.", "मनुष्यों से यह असंभव है, पर परमेश्वर से नहीं।", "असंभव स्थान को संभावना के परमेश्वर के पास लाएँ।", "ਮਨੁੱਖਾਂ ਲਈ ਇਹ ਅਸੰਭਵ ਹੈ, ਪਰ ਪਰਮੇਸ਼ੁਰ ਲਈ ਨਹੀਂ।", "ਅਸੰਭਵ ਥਾਂ ਨੂੰ ਸੰਭਾਵਨਾ ਦੇ ਪਰਮੇਸ਼ੁਰ ਕੋਲ ਲਿਆਓ।"),
            new DailyVerse("2 Timothy 1:7", "2 तीमुथियुस 1:7", "2 ਤਿਮੋਥਿਉਸ 1:7", "God gave us a spirit not of fear but of power, love and self-control.", "Let love and self-control answer fear.", "परमेश्वर ने हमें भय की नहीं, सामर्थ्य, प्रेम और संयम की आत्मा दी है।", "भय का उत्तर प्रेम और संयम से दें।", "ਪਰਮੇਸ਼ੁਰ ਨੇ ਸਾਨੂੰ ਡਰ ਦੀ ਨਹੀਂ, ਤਾਕਤ, ਪਿਆਰ ਅਤੇ ਸੰਯਮ ਦੀ ਆਤਮਾ ਦਿੱਤੀ ਹੈ।", "ਡਰ ਦਾ ਜਵਾਬ ਪਿਆਰ ਅਤੇ ਸੰਯਮ ਨਾਲ ਦਿਓ।"),
            new DailyVerse("Psalm 37:5", "भजन संहिता 37:5", "ਜ਼ਬੂਰ 37:5", "Commit your way to the Lord; trust in Him and He will act.", "Commit the work, then walk faithfully.", "अपना मार्ग यहोवा पर छोड़ दे; उस पर भरोसा रख, वह कार्य करेगा।", "काम प्रभु को सौंपें और फिर विश्वासयोग्यता से चलें।", "ਆਪਣਾ ਰਾਹ ਪ੍ਰਭੂ ਨੂੰ ਸੌਂਪ; ਉਸ ਉੱਤੇ ਭਰੋਸਾ ਕਰ, ਉਹ ਕਰੇਗਾ।", "ਕੰਮ ਪ੍ਰਭੂ ਨੂੰ ਸੌਂਪੋ ਅਤੇ ਫਿਰ ਵਿਸ਼ਵਾਸਯੋਗਤਾ ਨਾਲ ਤੁਰੋ।"),
            new DailyVerse("John 15:5", "यूहन्ना 15:5", "ਯੂਹੰਨਾ 15:5", "I am the vine; you are the branches.", "Stay connected to Jesus before trying to produce fruit.", "मैं दाखलता हूँ, तुम डालियाँ हो।", "फल लाने से पहले यीशु से जुड़े रहें।", "ਮੈਂ ਅੰਗੂਰ ਦੀ ਬੇਲ ਹਾਂ, ਤੁਸੀਂ ਟਾਹਣੀਆਂ ਹੋ।", "ਫਲ ਲਿਆਉਣ ਤੋਂ ਪਹਿਲਾਂ ਯਿਸੂ ਨਾਲ ਜੁੜੇ ਰਹੋ।"),
            new DailyVerse("Matthew 5:16", "मत्ती 5:16", "ਮੱਤੀ 5:16", "Let your light shine before others.", "Let one visible act point someone toward God.", "तुम्हारा उजियाला लोगों के सामने चमके।", "एक दिखाई देने वाला अच्छा काम किसी को परमेश्वर की ओर दिखाए।", "ਤੁਹਾਡਾ ਚਾਨਣ ਲੋਕਾਂ ਦੇ ਸਾਹਮਣੇ ਚਮਕੇ।", "ਇੱਕ ਦਿਖਾਈ ਦੇਣ ਵਾਲਾ ਚੰਗਾ ਕੰਮ ਕਿਸੇ ਨੂੰ ਪਰਮੇਸ਼ੁਰ ਵੱਲ ਦਿਖਾਏ।"),
            new DailyVerse("Lamentations 3:23", "विलापगीत 3:23", "ਵਿਲਾਪ 3:23", "His mercies are new every morning.", "Start again under mercy, not shame.", "उसकी दयाएँ हर सुबह नई होती हैं।", "लज्जा के नीचे नहीं, दया के नीचे फिर से शुरू करें।", "ਉਸ ਦੀਆਂ ਦਇਆਵਾਂ ਹਰ ਸਵੇਰ ਨਵੀਆਂ ਹੁੰਦੀਆਂ ਹਨ।", "ਸ਼ਰਮ ਹੇਠ ਨਹੀਂ, ਦਇਆ ਹੇਠ ਮੁੜ ਸ਼ੁਰੂ ਕਰੋ।"),
            new DailyVerse("Romans 15:13", "रोमियों 15:13", "ਰੋਮੀਆਂ 15:13", "May the God of hope fill you with all joy and peace as you trust in Him.", "Let hope become today's atmosphere.", "आशा का परमेश्वर तुम्हें विश्वास में सारे आनन्द और शांति से भर दे।", "आशा को आज के वातावरण की तरह अपने चारों ओर फैलने दें।", "ਆਸ ਦਾ ਪਰਮੇਸ਼ੁਰ ਤੁਹਾਨੂੰ ਵਿਸ਼ਵਾਸ ਵਿੱਚ ਸਾਰੀ ਖੁਸ਼ੀ ਅਤੇ ਸ਼ਾਂਤੀ ਨਾਲ ਭਰ ਦੇਵੇ।", "ਆਸ ਨੂੰ ਅੱਜ ਦੇ ਮਾਹੌਲ ਵਾਂਗ ਆਪਣੇ ਆਲੇ ਦੁਆਲੇ ਫੈਲਣ ਦਿਓ।")
        };
    }
}
