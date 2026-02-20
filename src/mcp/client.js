/**
 * MCP (Model Context Protocol) client.
 * Connects to external MCP servers via stdio or SSE.
 * Allows AI providers to use external tools (GitHub, databases, etc.)
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../utils/logger.js';
import { config } from '../utils/config.js';

const MCP_CONFIG_FILE = resolve(config.paths.data, 'mcp-servers.json');

class MCPServer {
  #proc = null;
  #pending = new Map();
  #nextId = 1;
  #buffer = '';

  constructor(name, command, args = [], env = {}) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.env = env;
    this.tools = [];
    this.connected = false;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.#proc = spawn(this.command, this.args, {
        env: { ...process.env, ...this.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.#proc.stdout.on('data', (data) => this.#handleData(data));
      this.#proc.stderr.on('data', (data) => {
        log.debug(`[mcp:${this.name}] stderr: ${data.toString().trim()}`);
      });

      this.#proc.on('error', (err) => {
        log.error(`[mcp:${this.name}] Process error: ${err.message}`);
        this.connected = false;
        reject(err);
      });

      this.#proc.on('close', () => {
        this.connected = false;
        log.info(`[mcp:${this.name}] Disconnected`);
      });

      // Initialize
      this.#send({ jsonrpc: '2.0', id: this.#nextId++, method: 'initialize', params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'llm-remote', version: '1.3.0' },
      }});

      // Wait for init response then list tools
      setTimeout(async () => {
        try {
          await this.#sendInitialized();
          this.tools = await this.listTools();
          this.connected = true;
          log.info(`[mcp:${this.name}] Connected — ${this.tools.length} tools`);
          resolve();
        } catch (err) {
          reject(err);
        }
      }, 2000);
    });
  }

  async listTools() {
    const result = await this.#request('tools/list', {});
    return result?.tools || [];
  }

  async callTool(toolName, args = {}) {
    const result = await this.#request('tools/call', { name: toolName, arguments: args });
    return result;
  }

  #send(msg) {
    if (!this.#proc?.stdin?.writable) return;
    const json = JSON.stringify(msg);
    this.#proc.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }

  #sendInitialized() {
    this.#send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  #request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.#nextId++;
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`MCP timeout: ${method}`));
      }, 30000);

      this.#pending.set(id, { resolve, reject, timeout });
      this.#send({ jsonrpc: '2.0', id, method, params });
    });
  }

  #handleData(data) {
    this.#buffer += data.toString();

    // Parse JSON-RPC messages
    while (true) {
      const headerEnd = this.#buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) break;

      const header = this.#buffer.substring(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.#buffer = this.#buffer.substring(headerEnd + 4);
        continue;
      }

      const length = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.#buffer.length < bodyStart + length) break;

      const body = this.#buffer.substring(bodyStart, bodyStart + length);
      this.#buffer = this.#buffer.substring(bodyStart + length);

      try {
        const msg = JSON.parse(body);
        if (msg.id && this.#pending.has(msg.id)) {
          const { resolve, reject, timeout } = this.#pending.get(msg.id);
          clearTimeout(timeout);
          this.#pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      } catch {}
    }
  }

  disconnect() {
    if (this.#proc) {
      this.#proc.kill('SIGTERM');
      this.#proc = null;
    }
    this.connected = false;
  }
}

// Global MCP manager
const servers = new Map();

export class MCPManager {
  static async loadConfig() {
    if (!existsSync(MCP_CONFIG_FILE)) return;

    try {
      const data = JSON.parse(readFileSync(MCP_CONFIG_FILE, 'utf-8'));
      for (const [name, cfg] of Object.entries(data.servers || {})) {
        try {
          const server = new MCPServer(name, cfg.command, cfg.args || [], cfg.env || {});
          await server.connect();
          servers.set(name, server);
        } catch (err) {
          log.warn(`[mcp] Failed to connect to ${name}: ${err.message}`);
        }
      }
    } catch (err) {
      log.warn(`[mcp] Config load failed: ${err.message}`);
    }
  }

  static async addServer(name, command, args = [], env = {}) {
    if (servers.has(name)) {
      servers.get(name).disconnect();
    }

    const server = new MCPServer(name, command, args, env);
    await server.connect();
    servers.set(name, server);
    this.saveConfig();
    return server;
  }

  static removeServer(name) {
    const server = servers.get(name);
    if (!server) return false;
    server.disconnect();
    servers.delete(name);
    this.saveConfig();
    return true;
  }

  static listServers() {
    return [...servers.entries()].map(([name, server]) => ({
      name,
      connected: server.connected,
      tools: server.tools.map(t => t.name),
    }));
  }

  static getAllTools() {
    const tools = [];
    for (const [serverName, server] of servers) {
      if (!server.connected) continue;
      for (const tool of server.tools) {
        tools.push({ server: serverName, ...tool });
      }
    }
    return tools;
  }

  static async callTool(serverName, toolName, args = {}) {
    const server = servers.get(serverName);
    if (!server?.connected) throw new Error(`Servidor MCP '${serverName}' no conectado`);
    return server.callTool(toolName, args);
  }

  static getToolsDescription() {
    const tools = this.getAllTools();
    if (tools.length === 0) return '';
    return '\n\nHerramientas MCP disponibles:\n' +
      tools.map(t => `- ${t.server}/${t.name}: ${t.description || ''}`).join('\n');
  }

  static saveConfig() {
    try {
      const data = { servers: {} };
      for (const [name, server] of servers) {
        data.servers[name] = {
          command: server.command,
          args: server.args,
          env: server.env,
        };
      }
      if (!existsSync(config.paths.data)) mkdirSync(config.paths.data, { recursive: true });
      writeFileSync(MCP_CONFIG_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
      log.error(`[mcp] Save config failed: ${err.message}`);
    }
  }

  static stopAll() {
    for (const server of servers.values()) {
      server.disconnect();
    }
  }
}
