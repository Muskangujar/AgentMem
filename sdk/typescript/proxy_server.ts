import { serve } from "bun";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import path from "path";

const PROTO_PATH = path.resolve(__dirname, "../../core/proto/agentmem.proto");
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const agentmem = grpc.loadPackageDefinition(packageDefinition).agentmem as any;
const client = new agentmem.AgentMemService(
  "localhost:50051",
  grpc.credentials.createInsecure()
);

const promisify = (method: string, args: any) => {
  return new Promise((resolve, reject) => {
    client[method](args, (err: any, response: any) => {
      if (err) reject(err);
      else resolve(response);
    });
  });
};

console.log("[proxy] Bun gRPC-HTTP bridge listening on port 3003");

serve({
  port: 3003,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      if (path === "/api/remember" && req.method === "POST") {
        const body = await req.json();
        const res = await promisify("Remember", body);
        return Response.json(res);
      }
      if (path === "/api/recall" && req.method === "POST") {
        const body = await req.json();
        const res = await promisify("Recall", body);
        return Response.json(res);
      }
      if (path === "/api/log_episode" && req.method === "POST") {
        const body = await req.json();
        const res = await promisify("LogEpisode", body);
        return Response.json(res);
      }
      if (path === "/api/get_episodes") {
        const namespace = url.searchParams.get("namespace");
        const limit = parseInt(url.searchParams.get("limit") || "10");
        const res = await promisify("GetEpisodes", { namespace, limit });
        return Response.json(res);
      }
      if (path === "/api/set_kv" && req.method === "POST") {
        const body = await req.json();
        const res = await promisify("SetKv", body);
        return Response.json(res);
      }
      if (path === "/api/get_kv") {
        const namespace = url.searchParams.get("namespace");
        const key = url.searchParams.get("key");
        const res = await promisify("GetKv", { namespace, key });
        return Response.json(res);
      }

      return new Response("Not Found", { status: 404 });
    } catch (e: any) {
      console.error(`[proxy] Error handling ${path}:`, e);
      return new Response(e.message, { status: 500 });
    }
  },
});
