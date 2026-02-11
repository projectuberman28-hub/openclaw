/**
 * @alfred/tools - NodesTool
 *
 * Device/node management for the Alfred mesh network.
 *   - list()        – enumerate registered nodes
 *   - sendCommand() – send a command to a specific node
 *
 * Nodes can be other Alfred instances, IoT devices, or remote agents.
 */

import { EventEmitter } from 'node:events';
import pino from 'pino';
import { SafeExecutor, type ExecuteOptions } from './safe-executor.js';

const logger = pino({ name: 'alfred:tools:nodes' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NodeInfo {
  id: string;
  name: string;
  type: string;
  status: 'online' | 'offline' | 'unknown';
  lastSeen: number;
  address?: string;
  capabilities: string[];
  metadata: Record<string, unknown>;
}

export interface NodeCommandArgs {
  nodeId: string;
  command: string;
  data?: any;
}

/**
 * Backend interface for node management.
 */
export interface NodeBackend {
  listNodes(): Promise<NodeInfo[]>;
  sendCommand(nodeId: string, command: string, data?: any): Promise<any>;
}

// ---------------------------------------------------------------------------
// NodesTool
// ---------------------------------------------------------------------------

export class NodesTool {
  private executor: SafeExecutor;
  private backend: NodeBackend | null;
  private bus: EventEmitter;

  constructor(executor: SafeExecutor, backend?: NodeBackend, bus?: EventEmitter) {
    this.executor = executor;
    this.backend = backend ?? null;
    this.bus = bus ?? new EventEmitter();
  }

  static definition = {
    name: 'nodes',
    description:
      'Manage devices and nodes in the Alfred mesh. List nodes or send commands.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'sendCommand'],
          description: 'Node action',
        },
        nodeId: { type: 'string', description: 'Target node ID (for sendCommand)' },
        command: { type: 'string', description: 'Command to send (for sendCommand)' },
        data: { type: 'object', description: 'Command payload (optional)' },
      },
      required: ['action'],
    },
  };

  /**
   * Set the node backend.
   */
  setBackend(backend: NodeBackend): void {
    this.backend = backend;
  }

  // -----------------------------------------------------------------------
  // List nodes
  // -----------------------------------------------------------------------

  async list(execOpts?: ExecuteOptions): Promise<NodeInfo[]> {
    if (!this.backend) {
      logger.warn('No node backend configured');
      return [];
    }

    const result = await this.executor.execute(
      'nodes.list',
      async () => this.backend!.listNodes(),
      { timeout: 15_000, ...execOpts },
    );

    if (result.error) {
      logger.error({ error: result.error }, 'Failed to list nodes');
      return [];
    }

    return result.result as NodeInfo[];
  }

  // -----------------------------------------------------------------------
  // Send command
  // -----------------------------------------------------------------------

  async sendCommand(args: NodeCommandArgs, execOpts?: ExecuteOptions): Promise<any> {
    if (!args.nodeId || typeof args.nodeId !== 'string') {
      throw new Error('NodesTool.sendCommand: "nodeId" is required');
    }
    if (!args.command || typeof args.command !== 'string') {
      throw new Error('NodesTool.sendCommand: "command" is required');
    }

    if (!this.backend) {
      // Emit event for any registered handler
      this.bus.emit('node:command', {
        nodeId: args.nodeId,
        command: args.command,
        data: args.data,
        timestamp: Date.now(),
      });
      return { sent: true, note: 'No backend – event emitted' };
    }

    const result = await this.executor.execute(
      'nodes.sendCommand',
      async () => this.backend!.sendCommand(args.nodeId, args.command, args.data),
      { timeout: 30_000, ...execOpts },
    );

    if (result.error) {
      throw new Error(result.error);
    }

    return result.result;
  }
}
