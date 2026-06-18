import type { MutableRefObject } from 'react';

export type TextFormatCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikeThrough'
  | 'insertUnorderedList'
  | 'insertOrderedList'
  | 'code';

export function toggleEditorCommand(editor: HTMLDivElement | null, command: TextFormatCommand, onChange: () => void) {
  if (!editor) {
    return;
  }

  editor.focus();
  document.execCommand(command);
  onChange();
}

export function insertTextAtSavedSelection(
  editor: HTMLDivElement,
  savedSelectionRef: MutableRefObject<Range | null>,
  text: string
) {
  const selection = window.getSelection();
  let range = savedSelectionRef.current;

  if (!selection) {
    return;
  }

  if (!range || !editor.contains(range.commonAncestorContainer)) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  selection.removeAllRanges();
  selection.addRange(range);
  range.deleteContents();

  const textNode = document.createTextNode(text);
  range.insertNode(textNode);

  const nextRange = document.createRange();
  nextRange.setStartAfter(textNode);
  nextRange.collapse(true);

  selection.removeAllRanges();
  selection.addRange(nextRange);
  savedSelectionRef.current = nextRange.cloneRange();
}

export function getActiveEditorCommands(): Record<TextFormatCommand, boolean> {
  return {
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
    underline: document.queryCommandState('underline'),
    strikeThrough: document.queryCommandState('strikeThrough'),
    insertUnorderedList: document.queryCommandState('insertUnorderedList'),
    insertOrderedList: document.queryCommandState('insertOrderedList'),
    code: isSelectionInCode()
  };
}

function isSelectionInCode(): boolean {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return false;

  let node: Node | null = selection.getRangeAt(0).commonAncestorContainer;

  while (node && node.nodeType === Node.TEXT_NODE) {
    node = node.parentNode;
  }

  while (node) {
    if (node.nodeName === 'CODE') return true;
    // Stop at the editor boundary (contentEditable root)
    if (node instanceof HTMLElement && node.contentEditable === 'true') return false;
    node = node.parentNode;
  }

  return false;
}

export function toggleInlineCode(editor: HTMLDivElement | null, onChange: () => void) {
  if (!editor) return;

  editor.focus();

  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;

  const range = selection.getRangeAt(0);

  // Determine the nearest code element in the selection path
  let checkNode: Node | null = range.commonAncestorContainer;
  while (checkNode && checkNode.nodeType === Node.TEXT_NODE) {
    checkNode = checkNode.parentNode;
  }

  let codeElement: HTMLElement | null = null;
  let codeSearch: Node | null = checkNode;
  while (codeSearch && codeSearch !== editor) {
    if (codeSearch.nodeName === 'CODE') {
      codeElement = codeSearch as HTMLElement;
      break;
    }
    codeSearch = codeSearch.parentNode;
  }

  // If inside an existing <code>, unwrap it (toggle off)
  if (codeElement) {
    const parent = codeElement.parentNode;
    if (parent) {
      while (codeElement.firstChild) {
        parent.insertBefore(codeElement.firstChild, codeElement);
      }
      parent.removeChild(codeElement);

      // Clean up any empty text nodes left by the unwrap
      normaliseTextNodes(parent);

      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    onChange();
    return;
  }

  // If nothing selected, insert an empty <code> wrapper with a zero-width
  // placeholder so the cursor appears immediately inside.
  if (range.collapsed) {
    const codeEl = document.createElement('code');
    codeEl.appendChild(document.createTextNode('\u200B'));
    range.deleteContents();
    range.insertNode(codeEl);

    const textNode = codeEl.firstChild as Text;
    range.setStart(textNode, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    onChange();
    return;
  }

  // Wrap the selected text in a <code> tag
  const selectedText = selection.toString();
  if (!selectedText) return;

  const codeEl = document.createElement('code');
  codeEl.textContent = selectedText;

  range.deleteContents();
  range.insertNode(codeEl);

  range.setStartAfter(codeEl);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  onChange();
}

/** Remove consecutive text nodes that are empty or whitespace-only. */
function normaliseTextNodes(parent: Node) {
  let child = parent.firstChild;
  while (child) {
    const next = child.nextSibling;
    if (child.nodeType === Node.TEXT_NODE && child.textContent !== null && child.textContent.trim() === '') {
      parent.removeChild(child);
    }
    child = next;
  }
}

export function insertCodeBlock(editor: HTMLDivElement | null, onChange: () => void) {
  if (!editor) return;

  editor.focus();

  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return;

  const range = selection.getRangeAt(0);

  // Create <pre><code><br></code></pre> — the <br> ensures the empty
  // code element has visible height for cursor placement.
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  const br = document.createElement('br');
  code.appendChild(br);
  pre.appendChild(code);

  range.deleteContents();
  range.insertNode(pre);

  // Place cursor at the start of the code element, BEFORE the <br>,
  // so typing begins on the first line.
  range.setStart(code, 0);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  onChange();
}

export function findClosestLink(node: Node | null, editor: HTMLDivElement) {
  let current: Node | null = node;

  while (current && current !== editor) {
    if (current instanceof HTMLAnchorElement) {
      return current;
    }

    current = current.parentNode;
  }

  return null;
}
