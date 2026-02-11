import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import CodeBlock from "./CodeBlock";

interface StreamingTextProps {
  text: string;
}

export default function StreamingText({ text }: StreamingTextProps) {
  return (
    <div className="text-sm text-batcave-text leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-pre:my-2">
      <ReactMarkdown
        rehypePlugins={[rehypeHighlight]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match;

            if (isInline) {
              return (
                <code
                  className="bg-batcave-tertiary px-1.5 py-0.5 rounded text-batcave-accent text-xs font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <CodeBlock
                language={match?.[1] || "text"}
                code={String(children).replace(/\n$/, "")}
              />
            );
          },
          pre({ children }) {
            return <>{children}</>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
      {/* Blinking cursor */}
      <span className="inline-block w-2 h-4 bg-batcave-accent/60 animate-pulse ml-0.5 align-text-bottom" />
    </div>
  );
}
