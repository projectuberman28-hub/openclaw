/**
 * @alfred/core - System resource monitoring
 *
 * Uses systeminformation for CPU, memory, disk.
 * Uses nvidia-smi for GPU info with a 5-second cache.
 */

import si from 'systeminformation';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryUsage {
  total: number;
  used: number;
  free: number;
  percent: number;
}

export interface GpuInfo {
  name: string;
  vramTotal: number;
  vramUsed: number;
  vramFree: number;
  utilization: number;
}

export interface DiskUsage {
  total: number;
  used: number;
  free: number;
  percent: number;
}

export interface SystemSnapshot {
  cpu: number;
  memory: MemoryUsage;
  gpu: GpuInfo | null;
  disk: DiskUsage;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// GPU cache (5 seconds)
// ---------------------------------------------------------------------------

let gpuCache: { data: GpuInfo | null; timestamp: number } | null = null;
const GPU_CACHE_TTL_MS = 5000;

// ---------------------------------------------------------------------------
// CPU
// ---------------------------------------------------------------------------

/**
 * Get current CPU utilization as a percentage (0-100).
 */
export async function getCpuUsage(): Promise<number> {
  const load = await si.currentLoad();
  return Math.round(load.currentLoad * 100) / 100;
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/**
 * Get system memory usage.
 */
export async function getMemoryUsage(): Promise<MemoryUsage> {
  const mem = await si.mem();

  const total = mem.total;
  const used = mem.active; // active = actually in use (not just cached)
  const free = mem.available;
  const percent = total > 0 ? Math.round((used / total) * 10000) / 100 : 0;

  return { total, used, free, percent };
}

// ---------------------------------------------------------------------------
// GPU (nvidia-smi with caching)
// ---------------------------------------------------------------------------

/**
 * Query nvidia-smi for GPU info.
 * Results are cached for 5 seconds to avoid hammering the driver.
 */
async function queryNvidiaSmi(): Promise<GpuInfo | null> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu',
      '--format=csv,noheader,nounits',
    ], { timeout: 5000 });

    const line = stdout.trim().split('\n')[0];
    if (!line) return null;

    const parts = line.split(',').map((s) => s.trim());
    if (parts.length < 5) return null;

    return {
      name: parts[0]!,
      vramTotal: parseFloat(parts[1]!) * 1024 * 1024, // MiB to bytes
      vramUsed: parseFloat(parts[2]!) * 1024 * 1024,
      vramFree: parseFloat(parts[3]!) * 1024 * 1024,
      utilization: parseFloat(parts[4]!),
    };
  } catch {
    // nvidia-smi not available or failed — no NVIDIA GPU
    return null;
  }
}

/**
 * Get GPU information.
 * Falls back to systeminformation if nvidia-smi is unavailable.
 * Results are cached for 5 seconds.
 */
export async function getGpuInfo(): Promise<GpuInfo | null> {
  const now = Date.now();

  // Return cached result if fresh
  if (gpuCache && now - gpuCache.timestamp < GPU_CACHE_TTL_MS) {
    return gpuCache.data;
  }

  // Try nvidia-smi first (most accurate for NVIDIA)
  let gpu = await queryNvidiaSmi();

  // Fallback to systeminformation
  if (!gpu) {
    try {
      const graphics = await si.graphics();
      const controller = graphics.controllers[0];
      if (controller && controller.model) {
        gpu = {
          name: controller.model,
          vramTotal: (controller.vram ?? 0) * 1024 * 1024, // MiB to bytes
          vramUsed: 0, // systeminformation doesn't provide used VRAM
          vramFree: (controller.vram ?? 0) * 1024 * 1024,
          utilization: controller.utilizationGpu ?? 0,
        };
      }
    } catch {
      gpu = null;
    }
  }

  gpuCache = { data: gpu, timestamp: now };
  return gpu;
}

// ---------------------------------------------------------------------------
// Disk
// ---------------------------------------------------------------------------

/**
 * Get disk usage for the primary filesystem.
 */
export async function getDiskUsage(): Promise<DiskUsage> {
  const disks = await si.fsSize();

  // Find the root/primary filesystem
  const primary =
    disks.find((d) => d.mount === '/' || d.mount === 'C:' || d.mount === 'C:\\') ??
    disks[0];

  if (!primary) {
    return { total: 0, used: 0, free: 0, percent: 0 };
  }

  return {
    total: primary.size,
    used: primary.used,
    free: primary.available,
    percent: Math.round(primary.use * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

/**
 * Collect a full system resource snapshot.
 */
export async function getSystemSnapshot(): Promise<SystemSnapshot> {
  const [cpu, memory, gpu, disk] = await Promise.all([
    getCpuUsage(),
    getMemoryUsage(),
    getGpuInfo(),
    getDiskUsage(),
  ]);

  return {
    cpu,
    memory,
    gpu,
    disk,
    timestamp: Date.now(),
  };
}
