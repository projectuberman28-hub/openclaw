import { cn } from "../lib/utils";
import { Check } from "lucide-react";

interface OnboardingWizardProps {
  steps: string[];
  currentStep: number;
  children: React.ReactNode;
}

export default function OnboardingWizard({
  steps,
  currentStep,
  children,
}: OnboardingWizardProps) {
  return (
    <div className="min-h-screen bg-batcave-primary flex flex-col">
      {/* Step indicator */}
      <div className="flex items-center justify-center pt-8 pb-6 px-8">
        {steps.map((step, index) => (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-all",
                  index < currentStep
                    ? "bg-batcave-success text-white"
                    : index === currentStep
                    ? "bg-batcave-accent text-white ring-4 ring-batcave-accent/20"
                    : "bg-batcave-tertiary text-batcave-text-muted"
                )}
              >
                {index < currentStep ? (
                  <Check className="w-5 h-5" />
                ) : (
                  index + 1
                )}
              </div>
              <span
                className={cn(
                  "text-xs mt-2 whitespace-nowrap",
                  index <= currentStep
                    ? "text-batcave-text"
                    : "text-batcave-text-muted"
                )}
              >
                {step}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "w-20 h-0.5 mx-3 mt-[-1.25rem]",
                  index < currentStep
                    ? "bg-batcave-success"
                    : "bg-batcave-border"
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-8 pb-8">
        <div className="w-full max-w-2xl animate-fade-in">{children}</div>
      </div>
    </div>
  );
}
