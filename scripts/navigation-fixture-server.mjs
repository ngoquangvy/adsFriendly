import http from "node:http";

const port = Number(process.env.NAVIGATION_FIXTURE_PORT || 9451);

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("cache-control", "no-store");

  if (url.pathname === "/ad") {
    response.end("<!doctype html><title>Fixture ad</title><h1>Advertisement</h1>");
    return;
  }

  const isClone =
    url.pathname === "/watch/continued" || url.searchParams.has("clone");
  const strongSequence = url.searchParams.has("strong");
  response.end(`<!doctype html>
    <meta charset="utf-8">
    <title>${isClone ? "Fixture video clone" : "Fixture video"}</title>
    <style>
      html, body { margin: 0; min-height: 100%; }
      button { position: fixed; left: 50%; top: 420px; transform: translate(-50%, -50%); width: 240px; height: 90px; }
    </style>
    <h1>Video page</h1>
    ${
      isClone
        ? "<p>Source page kept in the new tab.</p>"
        : `<button id="trigger">Play fixture</button>
           <script>
             document.getElementById("trigger").addEventListener("click", () => {
               window.open("http://localhost:${port}/${
                 strongSequence ? "watch?clone=1" : "watch/continued"
               }", "_blank");
               location.href = "http://127.0.0.1:${port}/ad";
             });
           </script>`
    }`);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Navigation fixture listening on ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
