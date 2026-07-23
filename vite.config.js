import { defineConfig } from "vite";

const articleRoutes = new Set(["/field", "/sound", "/engineering"]);

function rewriteArticleRoute(request) {
  if (!request.url) return;

  const queryStart = request.url.indexOf("?");
  const pathname = queryStart === -1 ? request.url : request.url.slice(0, queryStart);
  if (!articleRoutes.has(pathname)) return;

  const query = queryStart === -1 ? "" : request.url.slice(queryStart);
  request.url = `${pathname}.html${query}`;
}

function cleanArticleRoutes() {
  const install = (server) => {
    server.middlewares.use((request, _response, next) => {
      rewriteArticleRoute(request);
      next();
    });
  };

  return {
    name: "confluon-clean-article-routes",
    configureServer: install,
    configurePreviewServer: install,
  };
}

export default defineConfig({
  plugins: [cleanArticleRoutes()],
});
