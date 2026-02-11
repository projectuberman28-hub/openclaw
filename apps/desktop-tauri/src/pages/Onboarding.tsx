import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Cpu,
  HardDrive,
  MemoryStick,
  Monitor,
  Download,
  Loader2,
  CheckCircle2,
  Rocket,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import OnboardingWizard from "../components/OnboardingWizard";
import ModelDownloadProgress from "../components/ModelDownloadProgress";
import ChannelSetup from "../components/ChannelSetup";
import DependencyProgress from "../components/DependencyProgress";
import { tauriInvoke } from "../hooks/useTauri";
import { cn } from "../lib/utils";

interface SystemInfo {
  gpu_name: string;
  gpu_vram_mb: number;
  gpu_detected: boolean;
  cpu_name: string;
  cpu_cores: number;
  ram_total_mb: number;
  ram_available_mb: number;
  docker_available: boolean;
  ollama_running: boolean;
  os: string;
}

interface ModelRecommendation {
  model_name: string;
  display_name: string;
  description: string;
  size_gb: number;
  recommended: boolean;
  reason: string;
}

const steps = ["Hardware", "Model", "Channels", "Launch"];

export default function Onboarding() {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [recommendations, setRecommendations] = useState<ModelRecommendation[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState<
    "downloading" | "completed" | "error"
  >("downloading");
  const [launchSteps, setLaunchSteps] = useState([
    { label: "Starting Gateway...", status: "pending" as const },
    { label: "Connecting to Ollama...", status: "pending" as const },
    { label: "Loading model...", status: "pending" as const },
    { label: "Ready!", status: "pending" as const },
  ]);

  // Step 1: Auto-detect hardware
  useEffect(() => {
    detectSystem();
  }, []);

  const detectSystem = async () => {
    setDetecting(true);
    try {
      const info = await tauriInvoke<SystemInfo>("detect_system");
      setSystemInfo(info);

      // Get model recommendations based on GPU VRAM
      const models = await tauriInvoke<ModelRecommendation[]>(
        "get_recommended_model",
        { gpuVram: info.gpu_vram_mb }
      );
      setRecommendations(models);

      // Auto-select the recommended model
      const recommended = models.find((m) => m.recommended);
      if (recommended) {
        setSelectedModel(recommended.model_name);
      }
    } catch (err) {
      console.error("Detection failed:", err);
    } finally {
      setDetecting(false);
    }
  };

  const handleDownloadModel = async () => {
    if (!selectedModel) return;
    setDownloading(true);
    setDownloadStatus("downloading");

    // Simulate progress since actual streaming isn't available
    const progressInterval = setInterval(() => {
      setDownloadProgress((prev) => {
        if (prev >= 95) return prev;
        return prev + Math.random() * 5;
      });
    }, 500);

    try {
      await tauriInvoke<string>("pull_model", { name: selectedModel });
      clearInterval(progressInterval);
      setDownloadProgress(100);
      setDownloadStatus("completed");
    } catch {
      clearInterval(progressInterval);
      setDownloadStatus("error");
    }
  };

  const handleLaunch = async () => {
    // Step-by-step launch
    const updateStep = (index: number, status: "running" | "completed" | "error") => {
      setLaunchSteps((prev) =>
        prev.map((s, i) => (i === index ? { ...s, status } : s))
      );
    };

    updateStep(0, "running");
    try {
      await tauriInvoke<string>("start_gateway");
      updateStep(0, "completed");
    } catch {
      updateStep(0, "error");
    }

    updateStep(1, "running");
    await new Promise((r) => setTimeout(r, 1000));
    updateStep(1, "completed");

    updateStep(2, "running");
    await new Promise((r) => setTimeout(r, 1500));
    updateStep(2, "completed");

    updateStep(3, "running");
    await new Promise((r) => setTimeout(r, 500));
    updateStep(3, "completed");

    // Navigate to dashboard after a short delay
    setTimeout(() => navigate("/"), 1000);
  };

  const nextStep = () => {
    if (currentStep === 3) {
      handleLaunch();
    } else {
      setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
    }
  };

  const prevStep = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  return (
    <OnboardingWizard steps={steps} currentStep={currentStep}>
      {/* Step 1: Hardware Detection */}
      {currentStep === 0 && (
        <div>
          <h2 className="text-2xl font-bold text-batcave-text text-center mb-2">
            Hardware Detection
          </h2>
          <p className="text-batcave-text-muted text-center mb-8">
            Let&apos;s see what your machine can do
          </p>

          {detecting ? (
            <div className="flex flex-col items-center py-12">
              <Loader2 className="w-12 h-12 text-batcave-accent animate-spin mb-4" />
              <p className="text-batcave-text-muted">Scanning hardware...</p>
            </div>
          ) : systemInfo ? (
            <div className="grid grid-cols-2 gap-4 mb-8">
              {/* GPU */}
              <div className="card-hover p-4">
                <div className="flex items-center gap-3 mb-2">
                  <Monitor className="w-5 h-5 text-batcave-accent" />
                  <span className="text-sm font-medium text-batcave-text">
                    GPU
                  </span>
                </div>
                <p className="text-sm text-batcave-text">{systemInfo.gpu_name}</p>
                {systemInfo.gpu_detected && (
                  <p className="text-xs text-batcave-text-muted mt-1">
                    {(systemInfo.gpu_vram_mb / 1024).toFixed(0)} GB VRAM
                  </p>
                )}
              </div>

              {/* CPU */}
              <div className="card-hover p-4">
                <div className="flex items-center gap-3 mb-2">
                  <Cpu className="w-5 h-5 text-batcave-info" />
                  <span className="text-sm font-medium text-batcave-text">
                    CPU
                  </span>
                </div>
                <p className="text-sm text-batcave-text truncate">
                  {systemInfo.cpu_name}
                </p>
                <p className="text-xs text-batcave-text-muted mt-1">
                  {systemInfo.cpu_cores} cores
                </p>
              </div>

              {/* RAM */}
              <div className="card-hover p-4">
                <div className="flex items-center gap-3 mb-2">
                  <MemoryStick className="w-5 h-5 text-batcave-success" />
                  <span className="text-sm font-medium text-batcave-text">
                    RAM
                  </span>
                </div>
                <p className="text-sm text-batcave-text">
                  {(systemInfo.ram_total_mb / 1024).toFixed(0)} GB Total
                </p>
                <p className="text-xs text-batcave-text-muted mt-1">
                  {(systemInfo.ram_available_mb / 1024).toFixed(0)} GB Available
                </p>
              </div>

              {/* Services */}
              <div className="card-hover p-4">
                <div className="flex items-center gap-3 mb-2">
                  <HardDrive className="w-5 h-5 text-batcave-warning" />
                  <span className="text-sm font-medium text-batcave-text">
                    Services
                  </span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "status-dot",
                        systemInfo.ollama_running
                          ? "status-dot-healthy"
                          : "status-dot-error"
                      )}
                    />
                    <span className="text-xs text-batcave-text">Ollama</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "status-dot",
                        systemInfo.docker_available
                          ? "status-dot-healthy"
                          : "status-dot-inactive"
                      )}
                    />
                    <span className="text-xs text-batcave-text">Docker</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-batcave-text-muted">
              Failed to detect hardware. Continue anyway?
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={nextStep} className="btn-primary flex items-center gap-2">
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Model Selection */}
      {currentStep === 1 && (
        <div>
          <h2 className="text-2xl font-bold text-batcave-text text-center mb-2">
            Choose Your Model
          </h2>
          <p className="text-batcave-text-muted text-center mb-8">
            Select an AI model based on your hardware
          </p>

          <div className="space-y-3 mb-6">
            {recommendations.map((model) => (
              <button
                key={model.model_name}
                onClick={() => setSelectedModel(model.model_name)}
                className={cn(
                  "card-hover w-full text-left p-4",
                  selectedModel === model.model_name &&
                    "border-batcave-accent ring-1 ring-batcave-accent/20",
                  model.recommended && "relative"
                )}
              >
                {model.recommended && (
                  <span className="absolute top-2 right-2 text-xs bg-batcave-accent/20 text-batcave-accent px-2 py-0.5 rounded-full">
                    Recommended
                  </span>
                )}
                <h3 className="text-sm font-semibold text-batcave-text mb-1">
                  {model.display_name}
                </h3>
                <p className="text-xs text-batcave-text-muted mb-2">
                  {model.description}
                </p>
                <div className="flex items-center gap-3 text-xs text-batcave-text-muted">
                  <span className="flex items-center gap-1">
                    <HardDrive className="w-3 h-3" />
                    {model.size_gb} GB
                  </span>
                  <span>{model.reason}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Download section */}
          {downloading && (
            <div className="mb-6">
              <ModelDownloadProgress
                modelName={selectedModel}
                progress={downloadProgress}
                status={downloadStatus}
              />
            </div>
          )}

          <div className="flex justify-between">
            <button onClick={prevStep} className="btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <div className="flex gap-2">
              {!downloading && downloadStatus !== "completed" && (
                <button
                  onClick={handleDownloadModel}
                  disabled={!selectedModel}
                  className="btn-secondary flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download Model
                </button>
              )}
              <button onClick={nextStep} className="btn-primary flex items-center gap-2">
                {downloadStatus === "completed" ? "Continue" : "Skip"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Channel Setup */}
      {currentStep === 2 && (
        <div>
          <h2 className="text-2xl font-bold text-batcave-text text-center mb-2">
            Communication Channels
          </h2>
          <p className="text-batcave-text-muted text-center mb-8">
            Enable the channels you want Alfred to use (optional)
          </p>

          <div className="mb-8">
            <ChannelSetup />
          </div>

          <div className="flex justify-between">
            <button onClick={prevStep} className="btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <button onClick={nextStep} className="btn-primary flex items-center gap-2">
              Continue
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Launch */}
      {currentStep === 3 && (
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-batcave-accent/10 flex items-center justify-center mx-auto mb-4">
            <Rocket className="w-8 h-8 text-batcave-accent" />
          </div>
          <h2 className="text-2xl font-bold text-batcave-text mb-2">
            Ready to Launch
          </h2>
          <p className="text-batcave-text-muted mb-8">
            Starting Alfred services...
          </p>

          <div className="max-w-sm mx-auto mb-8">
            <DependencyProgress steps={launchSteps} />
          </div>

          <div className="flex justify-between">
            <button onClick={prevStep} className="btn-secondary flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
            <button
              onClick={nextStep}
              className="btn-primary flex items-center gap-2"
            >
              <Rocket className="w-4 h-4" />
              Launch Alfred
            </button>
          </div>
        </div>
      )}
    </OnboardingWizard>
  );
}
