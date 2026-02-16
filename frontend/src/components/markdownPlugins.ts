import type { ElementContent } from "hast";
import rehypeMermaid, { type RehypeMermaidOptions } from "rehype-mermaid";
import rehypeRaw from "rehype-raw";

const mermaidOptions: RehypeMermaidOptions = {
  strategy: "inline-svg",
  errorFallback: (_element, diagram, _error): ElementContent => ({
    type: "element",
    tagName: "pre",
    properties: { className: ["mermaid-error"] },
    children: [{ type: "text", value: diagram }],
  }),
};

export const markdownRehypePlugins = [rehypeRaw, [rehypeMermaid, mermaidOptions]];
