const SPECIAL_KEY_MAP: Record<string, string> = {
  Backspace: 'BackSpace',
  Delete: 'Delete',
  Enter: 'Return',
  Escape: 'Escape',
  Tab: 'Tab',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  PageUp: 'Page_Up',
  PageDown: 'Page_Down',
  Home: 'Home',
  End: 'End',
}

export function getRimeKeyFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (event.isComposing) return null

  const specialKey = SPECIAL_KEY_MAP[event.key]
  const key = specialKey ?? (event.key.length === 1 ? event.key : null)
  if (!key) return null

  const modifiers: string[] = []
  if (event.ctrlKey) modifiers.push('Control')
  if (event.altKey) modifiers.push('Alt')
  if (event.metaKey) modifiers.push('Super')
  if (event.shiftKey && key.length > 1) modifiers.push('Shift')

  if (modifiers.length > 0) return `{${modifiers.join('+')}+${key}}`
  return specialKey ? `{${key}}` : key
}
