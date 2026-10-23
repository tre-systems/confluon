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

export default defineConfig(() => {
  const sentryRelease = process.env.SENTRY_RELEASE || process.env.GITHUB_SHA;
  const sentryOrg = process.env.SENTRY_ORG;
  const sentryProject = process.env.SENTRY_PROJECT;
  const sentryUploadEnabled = Boolean(
    process.env.SENTRY_DSN &&
      process.env.SENTRY_AUTH_TOKEN &&
      sentryOrg &&
      sentryProject &&
      sentryRelease,
  );
  const plugins = [cleanArticleRoutes()];

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
    plugins,
    build: {
      manifest: true,
      sourcemap: sentryUploadEnabled ? "hidden" : false,
    },
  };
});
