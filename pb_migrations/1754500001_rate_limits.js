/// <reference path="../pb_data/types.d.ts" />
//
// Rate limits recomendados (anti brute-force en login, anti-spam de signups
// y cap de los endpoints custom). Se pueden ajustar después desde el admin
// UI: Settings → Application → Rate limit.
//
// Nota: si PocketBase corre detrás de un reverse proxy (Coolify/Traefik,
// Nginx, Caddy), configurá "IP proxy headers" en Settings → Application para
// que los límites sean por IP real y no globales.
migrate((app) => {
  try {
    const settings = app.settings();
    settings.rateLimits.enabled = true;
    settings.rateLimits.rules = [
      { label: "*:auth", maxRequests: 2, duration: 3 },
      { label: "*:create", maxRequests: 20, duration: 5 },
      { label: "/api/batch", maxRequests: 3, duration: 1 },
      { label: "/api/", maxRequests: 300, duration: 10 },
      { label: "users:auth", maxRequests: 10, duration: 60 },
      { label: "users:create", maxRequests: 3, duration: 60 },
      { label: "/api/custom/", maxRequests: 60, duration: 60 },
    ];
    app.save(settings);
  } catch (e) {
    // No bloquear el arranque por esto: son defaults de conveniencia.
    console.log("[migration] rate limits not applied: " + e);
  }
}, (app) => {
  try {
    const settings = app.settings();
    settings.rateLimits.enabled = false;
    app.save(settings);
  } catch (_) {
    // ignore
  }
});
