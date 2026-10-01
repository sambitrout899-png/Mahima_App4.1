export function currentMahimaUser() {
  try {
    for (const key of ["mahima_user", "mahima:user", "current_user", "user", "me"]) {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    }
  } catch {}
  return null;
}

export function chatBrandName(user = currentMahimaUser()) {
  const code = String(user?.tenantCountryCode || user?.countryCode || user?.CountryCode || "IN").trim().toUpperCase();
  return code === "IN" ? "Jai Masih" : "Praise The Lord";
}

export function chatNotificationTitle(user = currentMahimaUser()) {
  return chatBrandName(user) === "Jai Masih" ? "Jai Masih Di" : "Praise The Lord";
}
