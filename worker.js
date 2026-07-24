const CANONICAL_HOST = "confluon.com";
const REDIRECT_HOSTS = new Set([
  "www.confluon.com",
  "confluon.tre.systems",
  "geno-5.tre.systems",
]);

export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (REDIRECT_HOSTS.has(url.hostname)) {
      url.hostname = CANONICAL_HOST;
      url.protocol = "https:";
      url.port = "";
      return Response.redirect(url, 308);
    }

    return env.ASSETS.fetch(request);
  },
};
