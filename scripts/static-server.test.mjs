import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startStaticServer } from "./static-server.mjs";

test("static server maps clean routes, MIME types, and a custom 404", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "confluon-static-"));
  writeFileSync(join(root, "index.html"), "<main>field</main>");
  writeFileSync(join(root, "field.html"), "<main>article</main>");
  writeFileSync(join(root, "404.html"), "<main>missing</main>");
  const { server, url } = await startStaticServer(root, {
    cleanRoutes: { "/": "index.html", "/field": "field.html" },
    notFoundFile: "404.html",
  });
  context.after(() => {
    server.closeAllConnections();
    server.close();
    rmSync(root, { recursive: true, force: true });
  });

  const article = await fetch(new URL("/field", url));
  assert.equal(article.status, 200);
  assert.match(article.headers.get("content-type"), /^text\/html/);
  assert.equal(await article.text(), "<main>article</main>");

  const missing = await fetch(new URL("/absent", url));
  assert.equal(missing.status, 404);
  assert.equal(await missing.text(), "<main>missing</main>");
});

test("static server rejects paths outside its root", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "confluon-static-"));
  writeFileSync(join(root, "index.html"), "ok");
  const { server, url } = await startStaticServer(root);
  context.after(() => {
    server.closeAllConnections();
    server.close();
    rmSync(root, { recursive: true, force: true });
  });

  const response = await fetch(`${url}%2e%2e%2fpackage.json`);
  assert.equal(response.status, 404);
});
