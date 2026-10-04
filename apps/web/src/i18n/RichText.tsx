import type { ReactNode } from "react";

/**
 * Renders the inline markup used in the message catalogues: `code` spans and
 * **bold** runs.
 *
 * The catalogues are plain strings, not JSX, because a translator must be able
 * to reorder a sentence freely — "Put X in Y" often becomes "在 Y 里放 X" — and
 * that is impossible if the markup is baked into element order at the call site.
 * Keeping the markup as text means the whole sentence moves as one unit.
 *
 * Deliberately tiny: it handles exactly the two markers above and nothing else,
 * so there is no markup parser to get wrong and no way for a translation to
 * inject an element the app did not intend.
 */
export function RichText({ text }: { text: string }): ReactNode {
  return <>{parse(text)}</>;
}

const TOKEN = /(`[^`]+`|\*\*[^*]+\*\*)/g;

function parse(text: string): ReactNode[] {
  const parts = text.split(TOKEN);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/**
 * Italic marker for message bodies that use `*emphasis*` (the FAQ answers).
 * Separate from RichText so a string with a lone `*` — "2 * 3" — cannot be
 * mangled by the code/bold parser's split.
 */
export function RichTextItalic({ text }: { text: string }): ReactNode {
  const parts = text.split(/(\*[^*]+\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("*") && part.endsWith("*") && part.length > 2 ? (
          <em key={index}>{part.slice(1, -1)}</em>
        ) : (
          part
        ),
      )}
    </>
  );
}
