#!/usr/bin/env bun
/**
 * agentmem CLI — Command-line interface for AgentMem.
 *
 * Usage:
 *   bun run cli/index.ts remember <namespace> <text>
 *   bun run cli/index.ts episodes <namespace> [--last-n 10]
 *   bun run cli/index.ts set <namespace> <key> <value>
 *   bun run cli/index.ts get <namespace> <key>
 *   bun run cli/index.ts status
 *   bun run cli/index.ts dashboard
 */

import { AgentMemClient } from "../src/api/client";

const HELP = `
╔══════════════════════════════════════════════════════════════╗
║                     AgentMem CLI v0.1.0                      ║
║          Three memory types, one command line                ║
╚══════════════════════════════════════════════════════════════╝

USAGE:
  agentmem <command> [arguments]

COMMANDS:
  remember <namespace> <text>           Store a semantic memory
  episodes <namespace> [--last-n N]     Show recent episodes
  set <namespace> <key> <value>         Set a structured KV pair
  get <namespace> <key>                 Get a structured value
  status                                Check server connection
  dashboard                             Open memory explorer (coming soon)

OPTIONS:
  --server <url>     gRPC server address (default: localhost:50051)
  --help, -h         Show this help message

EXAMPLES:
  agentmem remember research-bot "User prefers JSON over CSV"
  agentmem episodes research-bot --last-n 5
  agentmem set research-bot last_config '{"Q": 16}'
  agentmem get research-bot last_config
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }

  const serverIdx = args.indexOf("--server");
  const serverUrl =
    serverIdx !== -1 ? args[serverIdx + 1] : "localhost:50051";
  const client = new AgentMemClient(serverUrl);

  const command = args[0];

  switch (command) {
    case "remember": {
      const namespace = args[1];
      const text = args[2];
      if (!namespace || !text) {
        console.error("Usage: agentmem remember <namespace> <text>");
        process.exit(1);
      }
      const result = await client.remember(namespace, text);
      console.log(`✓ Stored memory (doc_id: ${result.doc_id})`);
      break;
    }

    case "episodes": {
      const namespace = args[1];
      if (!namespace) {
        console.error("Usage: agentmem episodes <namespace> [--last-n N]");
        process.exit(1);
      }
      const lastNIdx = args.indexOf("--last-n");
      const lastN = lastNIdx !== -1 ? Number(args[lastNIdx + 1]) : 10;
      const result = await client.getEpisodes(namespace, lastN);

      if (result.episodes.length === 0) {
        console.log("No episodes found.");
      } else {
        console.log(`\n📜 Last ${result.episodes.length} episodes:\n`);
        for (const ep of result.episodes) {
          const time = new Date(ep.timestamp_ns / 1_000_000).toISOString();
          console.log(`  [${time}] ${ep.action}`);
          console.log(`    → ${ep.result_summary}`);
          console.log(`    ID: ${ep.action_uuid}\n`);
        }
      }
      break;
    }

    case "set": {
      const namespace = args[1];
      const key = args[2];
      const value = args[3];
      if (!namespace || !key || !value) {
        console.error("Usage: agentmem set <namespace> <key> <value>");
        process.exit(1);
      }
      await client.setKv(namespace, key, new TextEncoder().encode(value));
      console.log(`✓ Set ${key}`);
      break;
    }

    case "get": {
      const namespace = args[1];
      const key = args[2];
      if (!namespace || !key) {
        console.error("Usage: agentmem get <namespace> <key>");
        process.exit(1);
      }
      const result = await client.getKv(namespace, key);
      if (!result.found) {
        console.log(`Key "${key}" not found.`);
      } else {
        const decoded = new TextDecoder().decode(result.value);
        console.log(decoded);
      }
      break;
    }

    case "status": {
      console.log(`\n◆ AgentMem Status`);
      console.log(`  Server: ${serverUrl}`);
      console.log(`  Status: Scaffolded (gRPC wiring pending)\n`);
      break;
    }

    case "dashboard": {
      console.log("\n◆ Memory Explorer Dashboard");
      console.log("  Run: bun run dev");
      console.log("  Opens at: http://localhost:3000\n");
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
