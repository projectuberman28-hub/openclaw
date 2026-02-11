/**
 * @alfred/channels - Channel Manager
 *
 * Auto-discovers and manages communication channels (CLI, Discord, Matrix, etc.).
 * Channels are loaded from the extensions/ directory and can be dynamically
 * enabled/disabled.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Interface that all Alfred channels must implement.
 */
export interface AlfredChannel {
  /** Channel name/identifier. */
  name: string;
  /** Initialize and connect the channel. */
  initialize(): Promise<void>;
  /** Shut down the channel. */
  shutdown(): Promise<void>;
  /** Whether the channel is currently connected. */
  isConnected(): boolean;
  /** Send a message through this channel. */
  send(target: string, content: string): Promise<void>;
  /** Register a handler for incoming messages. */
  onMessage(handler: (message: { sender: string; content: string; metadata?: Record<string, unknown> }) => void): void;
}

export interface ChannelConfig {
  name: string;
  type: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ChannelManager
// ---------------------------------------------------------------------------

export class ChannelManager {
  private channels = new Map<string, AlfredChannel>();
  private channelConfigs: ChannelConfig[] = [];
  private extensionsDir: string;

  constructor(extensionsDir: string, configs?: ChannelConfig[]) {
    this.extensionsDir = extensionsDir;
    this.channelConfigs = configs ?? [];
  }

  /**
   * Initialize all enabled channels.
   * Auto-discovers channel modules from the extensions/ directory
   * and starts those that are enabled in config.
   */
  async initialize(): Promise<void> {
    // Load channels from extensions directory
    await this.discoverChannels();

    // Initialize enabled channels
    const initPromises: Promise<void>[] = [];

    for (const [name, channel] of this.channels.entries()) {
      const config = this.channelConfigs.find((c) => c.name === name);
      if (config && !config.enabled) {
        console.log(`[ChannelManager] Channel "${name}" is disabled, skipping`);
        continue;
      }

      initPromises.push(
        channel.initialize().then(
          () => console.log(`[ChannelManager] Channel "${name}" initialized`),
          (err) => console.error(`[ChannelManager] Channel "${name}" failed to initialize:`, err),
        ),
      );
    }

    await Promise.allSettled(initPromises);
    console.log(`[ChannelManager] ${this.channels.size} channels loaded`);
  }

  /**
   * Discover channel modules from the extensions directory.
   */
  private async discoverChannels(): Promise<void> {
    if (!existsSync(this.extensionsDir)) {
      console.log(`[ChannelManager] Extensions directory not found: ${this.extensionsDir}`);
      return;
    }

    try {
      const entries = readdirSync(this.extensionsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // Look for channel-* directories
        if (!entry.name.startsWith('channel-')) continue;

        const channelDir = join(this.extensionsDir, entry.name);
        const indexPath = join(channelDir, 'dist', 'index.js');
        const srcPath = join(channelDir, 'src', 'index.ts');

        // Try loading the channel module
        const modulePath = existsSync(indexPath) ? indexPath : null;

        if (!modulePath) {
          console.log(
            `[ChannelManager] Channel "${entry.name}" found but not built (no dist/index.js). ` +
            `Source at: ${srcPath}`,
          );
          continue;
        }

        try {
          const mod = await import(modulePath);
          const ChannelClass = mod.default ?? mod[Object.keys(mod)[0] ?? ''];

          if (typeof ChannelClass === 'function') {
            const channelName = entry.name.replace('channel-', '');
            const config = this.channelConfigs.find((c) => c.name === channelName);
            const instance: AlfredChannel = new ChannelClass(config?.config ?? {});

            this.channels.set(channelName, instance);
            console.log(`[ChannelManager] Discovered channel: ${channelName}`);
          }
        } catch (err) {
          console.error(`[ChannelManager] Failed to load channel "${entry.name}":`, err);
        }
      }
    } catch (err) {
      console.error('[ChannelManager] Failed to discover channels:', err);
    }
  }

  /**
   * Get a channel by name.
   */
  getChannel(name: string): AlfredChannel | undefined {
    return this.channels.get(name);
  }

  /**
   * Get the connection status of all channels.
   */
  getStatus(): Record<string, boolean> {
    const status: Record<string, boolean> = {};

    for (const [name, channel] of this.channels.entries()) {
      try {
        status[name] = channel.isConnected();
      } catch {
        status[name] = false;
      }
    }

    return status;
  }

  /**
   * List all channel names.
   */
  listChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Register a manually-created channel instance.
   */
  registerChannel(name: string, channel: AlfredChannel): void {
    this.channels.set(name, channel);
  }

  /**
   * Shut down all channels gracefully.
   */
  async shutdown(): Promise<void> {
    const shutdownPromises: Promise<void>[] = [];

    for (const [name, channel] of this.channels.entries()) {
      shutdownPromises.push(
        channel.shutdown().then(
          () => console.log(`[ChannelManager] Channel "${name}" shut down`),
          (err) => console.error(`[ChannelManager] Channel "${name}" shutdown error:`, err),
        ),
      );
    }

    await Promise.allSettled(shutdownPromises);
    this.channels.clear();
  }
}
