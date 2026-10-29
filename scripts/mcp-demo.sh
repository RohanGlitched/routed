#!/usr/bin/env bash
# Routed as an MCP server, from a terminal: initialize, list the tools, then read the flagship tour book with
# get_tour (a stored read: no Qloo or model call). A plain GET /api/mcp answers 405; MCP over Streamable HTTP is
# JSON-RPC in POSTs, answered as server-sent events.
#
#   bash scripts/mcp-demo.sh                      # the live site, the flagship tour
#   bash scripts/mcp-demo.sh http://localhost:3800 8v4ce57nx6
set -euo pipefail
BASE="${1:-https://routed-tours.vercel.app}"
TOUR="${2:-8v4ce57nx6}"
URL="$BASE/api/mcp"

rpc() {
  curl -sS -X POST "$URL" \
    -H "content-type: application/json" \
    -H "accept: application/json, text/event-stream" \
    -d "$1" | sed -n 's/^data: //p'
}

echo "== initialize"
rpc '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"mcp-demo","version":"1.0"}}}' | head -c 400
echo
echo
echo "== tools/list"
rpc '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | grep -o '"name":"[a-z_]*"' | sed 's/"name"://'
echo
echo "== tools/call get_tour $TOUR"
rpc "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"get_tour\",\"arguments\":{\"tour\":\"$TOUR\"}}}" \
  | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{const j=JSON.parse(s);console.log(j.result.content.map((c)=>c.text).join("\n"))})'
