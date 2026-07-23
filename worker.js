const CANONICAL_HOST = "confluon.tre.systems";
const LEGACY_HOST = "geno-5.tre.systems";

export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === LEGACY_HOST) {
      url.hostname = CANONICAL_HOST;
      url.protocol = "https:";
      url.port = "";
      return Response.redirect(url, 308);
    }

    return env.ASSETS.fetch(request);
  },
};
