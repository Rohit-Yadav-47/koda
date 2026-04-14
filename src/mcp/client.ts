import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// --- Types ---

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: any;
  serverName: string;
}

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
  tools: McpTool[];
}

// --- State ---

const CONFIG_PATH = join(homedir(), '.koda', 'mcp.json');
const connectedServers: Map<string, ConnectedServer> = new Map();
const toolNameMap: Map<string, { serverName: string; toolName: string }> = new Map();

// --- Config ---

export function loadMcpConfig(): McpConfig {
  if (!existsSync(CONFIG_PATH)) return { mcpServers: {} };
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { mcpServers: {} };
  }
}

export function saveMcpConfig(config: McpConfig): void {
  mkdirSync(join(homedir(), '.koda'), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function addServerConfig(name: string, command: string, args: string[] = [], env: Record<string, string> = {}): void {
  const config = loadMcpConfig();
  config.mcpServers[name] = { command, args, env };
  saveMcpConfig(config);
}

export function removeServerConfig(name: string): boolean {
  const config = loadMcpConfig();
  if (!(name in config.mcpServers)) return false;
  delete config.mcpServers[name];
  saveMcpConfig(config);
  return true;
}

// --- Connection management ---

export async function connectServer(name: string, config: McpServerConfig): Promise<McpTool[]> {
  await disconnectServer(name);

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
  });

  const client = new Client({
    name: 'koda',
    version: '1.0.0',
  });

  await client.connect(transport);

  const { tools } = await client.listTools();
  const mcpTools: McpTool[] = (tools || []).map(t => ({
    name: t.name,
    description: t.description || '',
    inputSchema: t.inputSchema,
    serverName: name,
  }));

  connectedServers.set(name, { name, client, transport, tools: mcpTools });

  // Update tool name map
  for (const t of mcpTools) {
    const prefixed = `mcp__${name}__${t.name}`;
    toolNameMap.set(prefixed, { serverName: name, toolName: t.name });
  }

  return mcpTools;
}

export async function disconnectServer(name: string): Promise<void> {
  const server = connectedServers.get(name);
  if (server) {
    // Remove tool mappings for this server
    for (const t of server.tools) {
      toolNameMap.delete(`mcp__${name}__${t.name}`);
    }
    try { await server.client.close(); } catch { /* ignore */ }
    connectedServers.delete(name);
  }
}

export async function disconnectAll(): Promise<void> {
  for (const name of [...connectedServers.keys()]) {
    await disconnectServer(name);
  }
}

export async function connectAllServers(
  onStatus?: (name: string, status: 'connecting' | 'connected' | 'failed', detail?: string) => void,
): Promise<McpTool[]> {
  const config = loadMcpConfig();
  const allTools: McpTool[] = [];

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    onStatus?.(name, 'connecting');
    try {
      const tools = await connectServer(name, serverConfig);
      allTools.push(...tools);
      onStatus?.(name, 'connected', `${tools.length} tools`);
    } catch (e: any) {
      onStatus?.(name, 'failed', e.message);
    }
  }

  return allTools;
}

// --- Tool queries ---

export function getAllMcpTools(): McpTool[] {
  const tools: McpTool[] = [];
  for (const server of connectedServers.values()) {
    tools.push(...server.tools);
  }
  return tools;
}

export function isMcpTool(prefixedName: string): boolean {
  return toolNameMap.has(prefixedName);
}

export function resolveMcpTool(prefixedName: string): { serverName: string; toolName: string } | null {
  return toolNameMap.get(prefixedName) || null;
}

// --- Tool execution ---

export async function callMcpTool(serverName: string, toolName: string, args: any): Promise<string> {
  const server = connectedServers.get(serverName);
  if (!server) throw new Error(`MCP server not connected: ${serverName}`);

  const result = await server.client.callTool({ name: toolName, arguments: args });

  if (Array.isArray(result.content)) {
    return result.content
      .map((c: any) => {
        if (c.type === 'text') return c.text;
        if (c.type === 'image') return `[image: ${c.mimeType}]`;
        return JSON.stringify(c);
      })
      .join('\n');
  }

  return typeof result.content === 'string' ? result.content : JSON.stringify(result);
}

// --- Convert to OpenAI format ---

export function mcpToolsToOpenAI(): any[] {
  const tools: any[] = [];

  for (const server of connectedServers.values()) {
    for (const t of server.tools) {
      const prefixed = `mcp__${server.name}__${t.name}`;
      tools.push({
        type: 'function' as const,
        function: {
          name: prefixed,
          description: `[MCP: ${server.name}] ${t.description}`,
          parameters: t.inputSchema || { type: 'object', properties: {} },
        },
      });
    }
  }

  return tools;
}

// --- Info ---

export function getConnectedServers(): { name: string; toolCount: number; tools: string[] }[] {
  const result: { name: string; toolCount: number; tools: string[] }[] = [];
  for (const server of connectedServers.values()) {
    result.push({
      name: server.name,
      toolCount: server.tools.length,
      tools: server.tools.map(t => t.name),
    });
  }
  return result;
}

export function getMcpServerCount(): number {
  return connectedServers.size;
}
