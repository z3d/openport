import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const port = Number(process.argv[2] || process.env.PORT || 4174);
const root = path.resolve("dist");
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

async function resolveFile(url = "/") {
  const pathname = decodeURIComponent(new URL(url, "http://127.0.0.1").pathname);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.resolve(root, `.${requested}`);

  if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) {
    return null;
  }

  try {
    const fileStat = await stat(filePath);
    return fileStat.isDirectory() ? path.join(filePath, "index.html") : filePath;
  } catch {
    return path.join(root, "index.html");
  }
}

createServer(async (request, response) => {
  const filePath = await resolveFile(request.url);

  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type":
        mimeTypes.get(path.extname(filePath)) || "application/octet-stream"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Serving ${root} at http://127.0.0.1:${port}`);
});
