import { CORS, mcpHandler } from "@/lib/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A person who opens the endpoint in a browser gets a page that says what it is; MCP clients get the protocol. */
async function get(req: Request) {
  if ((req.headers.get("accept") ?? "").includes("text/html")) {
    const url = `${new URL(req.url).origin}/api/mcp`;
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Routed MCP server</title>
<style>body{font:17px/1.55 system-ui,sans-serif;max-width:40em;margin:12vh auto;padding:0 20px;color:#16151b;background:#fbfbf9}code{background:#ecebef;padding:2px 6px;border-radius:4px}a{color:#1747d6}</style>
<h1>This is Routed's MCP server</h1>
<p>It speaks the Model Context Protocol over Streamable HTTP, so there is nothing to see in a browser. Add this address to an assistant that supports remote MCP servers, such as Claude, ChatGPT or VS Code:</p>
<p><code>${url}</code></p>
<p>Tools: <b>fan_map</b> (where an artist's fans over-index), <b>fan_profile</b> (who they are and what else they love), <b>route_tour</b> (a whole tour, about a minute) and <b>get_tour</b>.</p>
<p>Then ask: "Where should MJ Lenderman play in the UK?" or "Route 8 shows for Waxahatchee from Birmingham, AL."</p>
<p><a href="/">Routed home</a></p>`;
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  return mcpHandler(req);
}

const preflight = () => new Response(null, { status: 204, headers: CORS });

export { get as GET, mcpHandler as POST, mcpHandler as DELETE, preflight as OPTIONS };
