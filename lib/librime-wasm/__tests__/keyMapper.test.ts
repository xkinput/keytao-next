import { describe, expect, it } from 'vitest'
import { getRimeKeyFromKeyboardEvent } from '../keyMapper'

function keyboardEvent(key: string, init: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key,
    metaKey: false,
    shiftKey: false,
    ...init,
  } as KeyboardEvent
}

describe('getRimeKeyFromKeyboardEvent', () => {
  it('maps printable keys directly', () => {
    expect(getRimeKeyFromKeyboardEvent(keyboardEvent('w'))).toBe('w')
    expect(getRimeKeyFromKeyboardEvent(keyboardEvent(';'))).toBe(';')
  })

  it('maps browser special keys to Rime key names', () => {
    expect(getRimeKeyFromKeyboardEvent(keyboardEvent(' '))).toBe(' ')
    expect(getRimeKeyFromKeyboardEvent(keyboardEvent('Backspace'))).toBe('{BackSpace}')
    expect(getRimeKeyFromKeyboardEvent(keyboardEvent('Enter'))).toBe('{Return}')
    expect(getRimeKeyFromKeyboardEvent(keyboardEvent('ArrowDown'))).toBe('{Down}')
  })

  it('adds modifiers for non-printable keys', () => {
    expect(getRimeKeyFromKeyboardEvent(keyboardEvent('ArrowLeft', { shiftKey: true }))).toBe('{Shift+Left}')
    expect(getRimeKeyFromKeyboardEvent(keyboardEvent('Backspace', { ctrlKey: true }))).toBe('{Control+BackSpace}')
  })
})
