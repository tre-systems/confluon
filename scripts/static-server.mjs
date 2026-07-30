import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
]);

export async function startStaticServer(
  directory,
  {
    cacheControl = "no-cache",
    cleanRoutes = {},
    notFoundFile = null,
  } = {},
) {
  const root = resolve(directory);
  const server = createServer((request, response) => {
    if (!["GET", "HEAD"].includes(request.method ?? "")) {
      response.writeHead(405, { Allow: "GET, HEAD" });
      response.end();
      return;
    }

    let path;
    let status = 200;
    try {
      const url = new URL(request.url ?? "/", "http://static.invalid");
      const pathname = decodeURIComponent(url.pathname);
      const requested = cleanRoutes[pathname] ?? pathname.replace(/^\/+/, "");
      path = resolveInside(root, requested);
      if (!statSync(path).isFile()) throw new Error("not a file");
    } catch {
      if (!notFoundFile) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      path = resolveInside(root, notFoundFile);
      status = 404;
    }

    response.writeHead(status, {
      "Cache-Control": cacheControl,
      "Content-Length": statSync(path).size,
      "Content-Type": CONTENT_TYPES.get(extname(path)) ?? "application/octet-stream",
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(path)
      .on("error", () => response.destroy())
      .pipe(response);
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Static server did not bind to a TCP port");
  }
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

function resolveInside(root, requested) {
  const path = resolve(root, requested);
  if (path !== root && !path.startsWith(root + sep)) {
    throw new Error("path escapes static root");
  }
  return path;
}
