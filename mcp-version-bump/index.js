#!/usr/bin/env node
// Chrome Extension Version Bump MCP Server
// Zero dependencies - raw JSON-RPC over stdio

import fs from "fs";
import path from "path";
import readline from "readline";

const SERVER_INFO = {
  name: "chrome-extension-version-bump",
  version: "1.0.0",
};

const TOOLS = [
  {
    name: "bump_version",
    description:
      "Bump the version of a Chrome extension manifest.json (major, minor, or patch)",
    inputSchema: {
      type: "object",
      properties: {
        extensionPath: {
          type: "string",
          description:
            "Absolute path to the Chrome extension directory containing manifest.json",
        },
        bumpType: {
          type: "string",
          enum: ["major", "minor", "patch"],
          default: "patch",
          description: "Which part of the version to bump",
        },
      },
      required: ["extensionPath"],
    },
  },
  {
    name: "get_version",
    description: "Get the current version of a Chrome extension",
    inputSchema: {
      type: "object",
      properties: {
        extensionPath: {
          type: "string",
          description:
            "Absolute path to the Chrome extension directory containing manifest.json",
        },
      },
      required: ["extensionPath"],
    },
  },
  {
    name: "set_version",
    description:
      "Set the version of a Chrome extension to an exact version string",
    inputSchema: {
      type: "object",
      properties: {
        extensionPath: {
          type: "string",
          description:
            "Absolute path to the Chrome extension directory containing manifest.json",
        },
        version: {
          type: "string",
          description: "The exact version string to set (e.g., '2.0.0')",
        },
      },
      required: ["extensionPath", "version"],
    },
  },
];

function bumpVersion(current, type) {
  const parts = current.split(".").map(Number);
  while (parts.length < 3) parts.push(0);
  switch (type) {
    case "major":
      return `${parts[0] + 1}.0.0`;
    case "minor":
      return `${parts[0]}.${parts[1] + 1}.0`;
    case "patch":
    default:
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }
}

function readManifest(extensionPath) {
  const manifestPath = path.join(extensionPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No manifest.json found at ${manifestPath}`);
  }
  return {
    manifest: JSON.parse(fs.readFileSync(manifestPath, "utf-8")),
    manifestPath,
  };
}

function handleToolCall(name, args) {
  try {
    if (name === "bump_version") {
      const { manifest, manifestPath } = readManifest(args.extensionPath);
      const oldVersion = manifest.version || "0.0.0";
      const bumpType = args.bumpType || "patch";
      const newVersion = bumpVersion(oldVersion, bumpType);
      manifest.version = newVersion;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      return {
        content: [
          {
            type: "text",
            text: `Bumped "${manifest.name}" version: ${oldVersion} → ${newVersion} (${bumpType})`,
          },
        ],
      };
    }

    if (name === "get_version") {
      const { manifest } = readManifest(args.extensionPath);
      return {
        content: [
          {
            type: "text",
            text: `"${manifest.name}" is currently at version ${manifest.version}`,
          },
        ],
      };
    }

    if (name === "set_version") {
      const { manifest, manifestPath } = readManifest(args.extensionPath);
      const oldVersion = manifest.version;
      manifest.version = args.version;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      return {
        content: [
          {
            type: "text",
            text: `Set "${manifest.name}" version: ${oldVersion} → ${args.version}`,
          },
        ],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: `Error: ${e.message}` }],
      isError: true,
    };
  }
}

function handleRequest(msg) {
  const { method, params, id } = msg;

  switch (method) {
    case "initialize":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };

    case "notifications/initialized":
      return null; // no response for notifications

    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: { tools: TOOLS },
      };

    case "tools/call":
      return {
        jsonrpc: "2.0",
        id,
        result: handleToolCall(params.name, params.arguments || {}),
      };

    default:
      if (id) {
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        };
      }
      return null;
  }
}

// Stdio transport
const rl = readline.createInterface({ input: process.stdin });
let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  // MCP uses newline-delimited JSON
  const lines = buffer.split("\n");
  buffer = lines.pop(); // keep incomplete line in buffer
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      const response = handleRequest(msg);
      if (response) {
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    } catch (e) {
      process.stderr.write(`Parse error: ${e.message}\n`);
    }
  }
});

process.stderr.write("[mcp-version-bump] Server started\n");
