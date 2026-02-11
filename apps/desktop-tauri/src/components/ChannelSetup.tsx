import { useState } from "react";
import { MessageCircle, Hash, Phone, ToggleLeft, ToggleRight } from "lucide-react";
import { cn } from "../lib/utils";

interface Channel {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  enabled: boolean;
  configured: boolean;
}

interface ChannelSetupProps {
  onComplete?: () => void;
}

export default function ChannelSetup({ onComplete }: ChannelSetupProps) {
  const [channels, setChannels] = useState<Channel[]>([
    {
      id: "signal",
      name: "Signal",
      description: "End-to-end encrypted messaging via Signal Protocol",
      icon: MessageCircle,
      enabled: false,
      configured: false,
    },
    {
      id: "discord",
      name: "Discord",
      description: "Connect to Discord servers as a bot",
      icon: Hash,
      enabled: false,
      configured: false,
    },
    {
      id: "voice",
      name: "Voice",
      description: "Push-to-talk and continuous voice interaction",
      icon: Phone,
      enabled: false,
      configured: false,
    },
  ]);

  const toggleChannel = (id: string) => {
    setChannels((prev) =>
      prev.map((ch) =>
        ch.id === id ? { ...ch, enabled: !ch.enabled } : ch
      )
    );
  };

  return (
    <div className="space-y-3">
      {channels.map((channel) => (
        <div
          key={channel.id}
          className={cn(
            "card-hover flex items-center gap-4 p-4 cursor-pointer",
            channel.enabled && "border-batcave-accent/30"
          )}
          onClick={() => toggleChannel(channel.id)}
        >
          <div
            className={cn(
              "w-10 h-10 rounded-lg flex items-center justify-center",
              channel.enabled
                ? "bg-batcave-accent/20 text-batcave-accent"
                : "bg-batcave-tertiary text-batcave-text-muted"
            )}
          >
            <channel.icon className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-batcave-text">
              {channel.name}
            </p>
            <p className="text-xs text-batcave-text-muted">
              {channel.description}
            </p>
          </div>

          <button className="shrink-0" onClick={() => toggleChannel(channel.id)}>
            {channel.enabled ? (
              <ToggleRight className="w-8 h-8 text-batcave-accent" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-batcave-text-muted" />
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
