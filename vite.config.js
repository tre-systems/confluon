import { defineConfig } from "vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const articleRoutes = new Set(["/field", "/sound", "/engineering", "/privacy"]);

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

function itchHtml() {
  return {
    name: "confluon-itch-html",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html
          .replace('<html lang="en">', '<html lang="en" data-distribution="itch">')
          .replace("<title>Confluon</title>", "<title>Confluon — Field Current</title>")
          .replace(/^\s*<meta name="apple-mobile-web-app-[^>]+>\s*$/gmu, "")
          .replace(/^\s*<link rel="manifest"[^>]+>\s*$/gmu, "")
          .replace(/^\s*<link rel="apple-touch-icon"[^>]+>\s*$/gmu, "")
          .replace(/^\s*<link rel="icon"[^>]+>\s*$/gmu, "")
          .replace(/href="\/(field|engineering|sound|privacy)"/gu, 'href="https://confluon.com/$1"')
          .replace(/^\s*<script src="\/runtime-config\.js"><\/script>\s*$/gmu, "")
          .replace(/^\s*<script src="\/telemetry\.js"><\/script>\s*$/gmu, "")
          .replace(/^\s*<script type="module" src="\/pwa\.js"><\/script>\s*$/gmu, "");
      },
    },
  };
}

export default defineConfig(() => {
  const distribution = process.env.CONFLUON_DISTRIBUTION === "itch" ? "itch" : "web";
  const isItch = distribution === "itch";
  const sentryRelease = process.env.SENTRY_RELEASE || process.env.GITHUB_SHA;
  const sentryOrg = process.env.SENTRY_ORG;
  const sentryProject = process.env.SENTRY_PROJECT;
  const sentryUploadEnabled = Boolean(
    !isItch &&
      process.env.SENTRY_DSN &&
      process.env.SENTRY_AUTH_TOKEN &&
      sentryOrg &&
      sentryProject &&
      sentryRelease,
  );
  const plugins = [cleanArticleRoutes()];

  if (isItch) plugins.push(itchHtml());

  if (sentryUploadEnabled) {
    plugins.push(
      sentryVitePlugin({
        authToken: process.env.SENTRY_AUTH_TOKEN,
        org: sentryOrg,
        project: sentryProject,
        telemetry: false,
        release: {
          name: sentryRelease,
        },
        sourcemaps: {
          filesToDeleteAfterUpload: ["dist/assets/**/*.map"],
        },
      }),
    );
  }

  return {
    base: isItch ? "./" : "/",
    define: {
      __CONFLUON_DISTRIBUTION__: JSON.stringify(distribution),
    },
    plugins,
    publicDir: isItch ? false : "public",
    build: {
      manifest: true,
      sourcemap: sentryUploadEnabled ? "hidden" : false,
    },
  };
});
