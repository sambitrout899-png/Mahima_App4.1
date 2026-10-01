import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CloudSun, ExternalLink, Globe2, MapPin, Megaphone, Newspaper, Quote, Radio, RefreshCw, ShieldAlert, Sparkles, Zap } from "lucide-react";
import { apiFetch } from "../utils/fetch-auth-shim";

const CACHE_KEY = "mahima_today_update_v3";
const CACHE_MAX_AGE_MS = 20 * 60 * 1000;

function hasLiveUpdateData(data) {
  return Boolean(
    data?.location?.label ||
      data?.location?.timezone ||
      data?.weather ||
      data?.christianUpdate?.summary ||
      data?.christianUpdate?.articles?.length ||
      data?.israelWatch?.length
  );
}


function getCachedUpdate() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
    if (!cached?.savedAt || Date.now() - Number(cached.savedAt) > CACHE_MAX_AGE_MS) return null;
    return hasLiveUpdateData(cached.data) ? cached.data : null;
  } catch {
    return null;
  }
}

function setCachedUpdate(data) {
  try {
    if (hasLiveUpdateData(data)) localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {}
}

function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: CACHE_MAX_AGE_MS, timeout: 7000 }
    );
  });
}

function roundValue(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Math.round(Number(value));
}

function articleTitle(article) {
  return String(article?.title || article?.Title || article?.headline || "").trim();
}

function articleUrl(article) {
  return String(article?.url || article?.Url || "").trim();
}

function articleSource(article) {
  return String(article?.source || article?.Source || "").trim();
}

function articleCategory(article) {
  return String(article?.category || article?.Category || "").trim();
}

function articleTone(article) {
  const tone = String(article?.tone || article?.Tone || "").trim().toLowerCase();
  if (tone) return tone;
  const category = articleCategory(article).toLowerCase();
  if (category.includes("sensitive")) return "alert";
  if (category.includes("meeting")) return "meeting";
  if (category.includes("word")) return "faith";
  if (category.includes("global")) return "global";
  return "news";
}

export default function TodayUpdateCorner() {
  const initialCache = getCachedUpdate();
  const [data, setData] = useState(() => initialCache);
  const [loading, setLoading] = useState(!initialCache);
  const [error, setError] = useState("");

  const timezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch {
      return "";
    }
  }, []);

  async function loadUpdate({ force = false } = {}) {
    const cached = !force ? getCachedUpdate() : null;
    if (cached) {
      setData(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const position = await getPosition();
      const params = new URLSearchParams();
      if (timezone) params.set("timezone", timezone);
      if (position?.lat !== undefined && position?.lon !== undefined) {
        params.set("lat", String(position.lat));
        params.set("lon", String(position.lon));
      }
      if (force) params.set("refresh", "true");

      const suffix = params.toString() ? `?${params}` : "";
      const result = await apiFetch(`/today-updates${suffix}`, { timeoutMs: 22000 });
      setData(result);
      setCachedUpdate(result);
    } catch (err) {
      setError(err?.message || "Unable to load today's update.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const cached = getCachedUpdate();
      if (cached) return;
      await loadUpdate();
      if (cancelled) return;
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const weather = data?.weather;
  const location = data?.location?.label || data?.location?.timezone || "your area";
  const temp = roundValue(weather?.temperatureC);
  const feelsLike = roundValue(weather?.feelsLikeC);
  const articles = Array.isArray(data?.christianUpdate?.articles) ? data.christianUpdate.articles : [];
  const israelWatch = Array.isArray(data?.israelWatch) ? data.israelWatch : [];
  const faithItems = Array.isArray(data?.christianUpdate?.faithItems) ? data.christianUpdate.faithItems : [];
  const topArticle = articles.find((article) => articleUrl(article)) || israelWatch.find((article) => articleUrl(article));

  const tickerItems = useMemo(() => {
    const items = [];

    if (weather) {
      items.push({
        key: "weather",
        tone: "weather",
        label: `Local weather: ${temp ?? "--"} C, ${weather.summary || "weather update"} in ${location}${feelsLike !== null ? `, feels ${feelsLike} C` : ""}`,
      });
    } else {
      items.push({
        key: "weather-fallback",
        tone: "weather",
        label: loading ? "Finding your local weather and ministry context..." : "Enable location for local weather and regional Christian updates",
      });
    }

    const summary = String(data?.christianUpdate?.summary || "").trim();
    items.push({
      key: "summary",
      tone: "faith",
      label: loading && !data ? "Preparing today's Christian update..." : summary || "Christian update: keep watch for ministry news, prayer needs, and local church announcements today",
    });

    israelWatch.slice(0, 3).forEach((article, index) => {
      const title = articleTitle(article);
      if (!title) return;
      const source = articleSource(article);
      items.push({
        key: `israel-watch-${index}`,
        tone: "israel",
        label: `Israel watch: ${title}${source ? ` - ${source}` : ""}. Discern carefully; no dates or claims are implied.`,
        url: articleUrl(article),
      });
    });

    articles.slice(0, 12).forEach((article, index) => {
      const title = articleTitle(article);
      if (!title) return;
      const source = articleSource(article);
      const category = articleCategory(article);
      const tone = articleTone(article);
      items.push({
        key: `article-${index}`,
        tone,
        label: `${category ? `${category}: ` : ""}${title}${source ? ` - ${source}` : ""}`,
        url: articleUrl(article),
      });
    });

    faithItems.forEach((message, index) => {
      items.push({
        key: `faith-${index}`,
        tone: "quote",
        label: String(message).trim(),
      });
    });

    if (data?.generatedAtUtc) {
      const generatedAt = new Date(data.generatedAtUtc);
      if (!Number.isNaN(generatedAt.getTime())) items.push({
        key: "updated-at",
        tone: "faith",
        label: `Faith Wire refreshed ${generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      });
    }

    if (error) {
      items.push({
        key: "error",
        tone: "alert",
        label: `Update notice: ${error}`,
      });
    }

    return items.filter((item) => item.label);
  }, [articles, data, error, faithItems, feelsLike, israelWatch, loading, location, temp, weather]);

  const marqueeItems = tickerItems.length ? [...tickerItems, ...tickerItems] : [];

  return (
    <section className="today-ribbon" aria-label="Weather and Christian news updates">
      <div className="today-ribbon__glow" />
      <div className="today-ribbon__inner">
        <div className="today-ribbon__badge">
          <Radio className="h-4 w-4" />
          <span>Live Faith Wire</span>
        </div>

        <div className="today-ribbon__viewport">
          <div className="today-ribbon__track">
            {marqueeItems.map((item, index) => {
              const Icon = item.tone === "weather"
                ? CloudSun
                : item.tone === "news"
                  ? Newspaper
                  : item.tone === "global"
                    ? Globe2
                    : item.tone === "meeting"
                      ? CalendarDays
                      : item.tone === "faith"
                        ? Megaphone
                        : item.tone === "israel"
                          ? ShieldAlert
                          : item.tone === "quote"
                            ? Quote
                            : item.tone === "alert"
                              ? ShieldAlert
                              : Sparkles;
              const content = (
                <>
                  <span className={`today-ribbon__icon today-ribbon__icon--${item.tone}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="today-ribbon__text">{item.label}</span>
                  {item.url && <ExternalLink className="h-3.5 w-3.5 opacity-80" />}
                </>
              );

              return item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="today-ribbon__item"
                  key={`${item.key}-${index}`}
                >
                  {content}
                </a>
              ) : (
                <span className="today-ribbon__item" key={`${item.key}-${index}`}>
                  {content}
                </span>
              );
            })}
          </div>
        </div>

        <div className="today-ribbon__meta">
          <span className="today-ribbon__location" title={location}>
            <MapPin className="h-3.5 w-3.5" />
            <span>{location}</span>
          </span>

          {topArticle?.url && (
            <a className="today-ribbon__source" href={articleUrl(topArticle)} target="_blank" rel="noreferrer">
              Source
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}

          <button
            type="button"
            onClick={() => loadUpdate({ force: true })}
            className="today-ribbon__refresh"
            disabled={loading}
            aria-label="Refresh weather and Christian updates"
            title="Refresh updates"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
    </section>
  );
}
