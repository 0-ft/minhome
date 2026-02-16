import { marked } from "marked";
import { memo, useMemo } from "react";
import { MarkdownHooks } from "react-markdown";
import { DeviceBadge, EntityBadge, AutomationBadge } from "./DeviceBadge.js";
import { markdownRehypePlugins } from "./markdownPlugins.js";

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown);
  return tokens.map((token) => token.raw);
}

const markdownComponents = {
  device: DeviceBadge,
  entity: EntityBadge,
  automation: AutomationBadge,
} as Record<string, React.ComponentType<Record<string, unknown>>>;

const MemoizedMarkdownBlock = memo(
  ({ content }: { content: string }) => {
    return (
      <MarkdownHooks
        rehypePlugins={markdownRehypePlugins}
        components={markdownComponents}
        fallback={<pre className="whitespace-pre-wrap">{content}</pre>}
      >
        {content}
      </MarkdownHooks>
    );
  },
  (prevProps, nextProps) => prevProps.content === nextProps.content,
);

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock";

export const MemoizedMarkdown = memo(
  ({ content, id }: { content: string; id: string }) => {
    const blocks = useMemo(() => parseMarkdownIntoBlocks(content), [content]);

    return blocks.map((block, index) => (
      <MemoizedMarkdownBlock content={block} key={`${id}-block_${index}`} />
    ));
  },
);

MemoizedMarkdown.displayName = "MemoizedMarkdown";

