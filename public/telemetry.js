(() => {
  const config = window.CONFLUON_RUNTIME_CONFIG || {};
  if (!config.analyticsToken || navigator.doNotTrack === "1") return;

  const script = document.createElement("script");
  script.type = "module";
  script.src = `https://static.cloudflareinsights.com/beacon.min.js?token=${encodeURIComponent(
    config.analyticsToken,
  )}`;
  script.defer = true;
  document.head.appendChild(script);
})();
