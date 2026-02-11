import { useState, useEffect } from "react";
import { ChevronDown, HardDrive, Cpu } from "lucide-react";
import { cn } from "../lib/utils";
import { tauriInvoke } from "../hooks/useTauri";

interface Model {
  name: string;
  size: number;
  size_display: string;
  family?: string;
  parameter_size?: string;
}

interface ModelPickerProps {
  value: string;
  onChange: (model: string) => void;
}

export default function ModelPicker({ value, onChange }: ModelPickerProps) {
  const [models, setModels] = useState<Model[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    setLoading(true);
    try {
      const result = await tauriInvoke<Model[]>("list_models");
      setModels(result);
    } catch {
      // Ollama may not be running
    } finally {
      setLoading(false);
    }
  };

  const selected = models.find((m) => m.name === value);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="input-field w-full flex items-center justify-between gap-2 text-sm"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Cpu className="w-4 h-4 text-batcave-text-muted shrink-0" />
          <span className="truncate">
            {selected ? selected.name : value || "Select a model..."}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-batcave-text-muted shrink-0 transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-batcave-secondary border border-batcave-border rounded-lg shadow-xl max-h-60 overflow-y-auto animate-fade-in">
          {loading && (
            <div className="px-3 py-4 text-center text-sm text-batcave-text-muted">
              Loading models...
            </div>
          )}

          {!loading && models.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-batcave-text-muted">
              No models found. Install one via Ollama.
            </div>
          )}

          {models.map((model) => (
            <button
              key={model.name}
              onClick={() => {
                onChange(model.name);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-batcave-hover transition-colors",
                value === model.name && "bg-batcave-accent/10"
              )}
            >
              <Cpu className="w-4 h-4 text-batcave-text-muted shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-batcave-text truncate">
                  {model.name}
                </p>
                <div className="flex items-center gap-2 text-xs text-batcave-text-muted">
                  <span className="flex items-center gap-1">
                    <HardDrive className="w-3 h-3" />
                    {model.size_display}
                  </span>
                  {model.parameter_size && (
                    <span>{model.parameter_size}</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
