import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface CodeBlockProps {
  language: string;
  code: string;
}

export default function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  };

  return (
    <div className="relative group my-2 rounded-lg overflow-hidden bg-batcave-tertiary border border-batcave-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-batcave-primary/50 border-b border-batcave-border">
        <span className="text-xs text-batcave-text-muted font-mono">
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-xs text-batcave-text-muted hover:text-batcave-text transition-colors"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-batcave-success" />
              <span className="text-batcave-success">Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code content */}
      <pre className="p-3 overflow-x-auto text-sm leading-relaxed">
        <code className={`language-${language} font-mono text-batcave-text`}>
          {code}
        </code>
      </pre>
    </div>
  );
}
