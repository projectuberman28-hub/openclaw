import { useState } from "react";
import {
  Smartphone,
  Monitor,
  Tablet,
  QrCode,
  RefreshCw,
  Link2,
  Link2Off,
  Clock,
  Plus,
} from "lucide-react";
import { cn, formatRelativeTime } from "../lib/utils";
import type { DeviceInfo } from "../lib/protocol";

const sampleDevices: DeviceInfo[] = [
  {
    id: "1",
    name: "This PC",
    type: "desktop",
    lastSeen: new Date().toISOString(),
    synced: true,
    paired: true,
  },
];

export default function Devices() {
  const [devices, setDevices] = useState<DeviceInfo[]>(sampleDevices);
  const [showQR, setShowQR] = useState(false);

  const getDeviceIcon = (type: DeviceInfo["type"]) => {
    switch (type) {
      case "mobile":
        return <Smartphone className="w-5 h-5" />;
      case "tablet":
        return <Tablet className="w-5 h-5" />;
      default:
        return <Monitor className="w-5 h-5" />;
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-batcave-text">Devices</h1>
          <p className="text-sm text-batcave-text-muted mt-1">
            Pair and sync with your mobile devices
          </p>
        </div>
        <button
          onClick={() => setShowQR(!showQR)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Pair Device
        </button>
      </div>

      {/* QR Code pairing */}
      {showQR && (
        <div className="card p-8 text-center animate-slide-up">
          <h3 className="text-lg font-semibold text-batcave-text mb-2">
            Pair New Device
          </h3>
          <p className="text-sm text-batcave-text-muted mb-6">
            Scan this QR code with the Alfred mobile app to pair
          </p>

          {/* QR Code placeholder */}
          <div className="w-48 h-48 mx-auto bg-white rounded-xl p-4 mb-6">
            <div className="w-full h-full bg-batcave-primary rounded-lg flex items-center justify-center">
              <QrCode className="w-20 h-20 text-batcave-text-muted" />
            </div>
          </div>

          <p className="text-xs text-batcave-text-muted mb-4">
            Connection code:{" "}
            <code className="bg-batcave-tertiary px-2 py-0.5 rounded font-mono">
              ALFRED-{Math.random().toString(36).substring(2, 8).toUpperCase()}
            </code>
          </p>

          <button
            onClick={() => setShowQR(false)}
            className="btn-secondary"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Paired devices */}
      <div className="space-y-3">
        {devices.map((device) => (
          <div key={device.id} className="card-hover p-4">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center",
                  device.paired
                    ? "bg-batcave-success/10 text-batcave-success"
                    : "bg-batcave-tertiary text-batcave-text-muted"
                )}
              >
                {getDeviceIcon(device.type)}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-batcave-text">
                    {device.name}
                  </h3>
                  {device.synced ? (
                    <Link2 className="w-3.5 h-3.5 text-batcave-success" />
                  ) : (
                    <Link2Off className="w-3.5 h-3.5 text-batcave-text-muted" />
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-batcave-text-muted mt-0.5">
                  <span className="capitalize">{device.type}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatRelativeTime(device.lastSeen)}
                  </span>
                  <span
                    className={cn(
                      "px-2 py-0.5 rounded-full",
                      device.synced
                        ? "bg-batcave-success/10 text-batcave-success"
                        : "bg-batcave-tertiary text-batcave-text-muted"
                    )}
                  >
                    {device.synced ? "Synced" : "Not synced"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button className="btn-ghost text-xs flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" />
                  Sync
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {devices.length <= 1 && !showQR && (
        <div className="text-center py-8">
          <Smartphone className="w-12 h-12 text-batcave-text-muted mx-auto mb-4 opacity-30" />
          <p className="text-batcave-text-muted text-sm">
            Pair a mobile device to access Alfred on the go
          </p>
        </div>
      )}
    </div>
  );
}
