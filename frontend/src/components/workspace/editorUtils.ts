import type { MutableRefObject } from 'react';

export type TextFormatCommand =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikeThrough'
  | 'insertUnorderedList'
  | 'insertOrderedList';

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
    insertOrderedList: document.queryCommandState('insertOrderedList')
  };
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
