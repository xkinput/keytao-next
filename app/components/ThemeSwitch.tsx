'use client'

import { useTheme } from 'next-themes'
import { Button } from '@heroui/react'
import { Sun, Moon, Monitor } from 'lucide-react'

export default function ThemeSwitch() {
  const { theme, setTheme } = useTheme()

  const handleToggle = () => {
    if (theme === 'light') {
      setTheme('dark')
    } else if (theme === 'dark') {
      setTheme('system')
    } else {
      setTheme('light')
    }
  }

  const getIcon = () => {
    switch (theme) {
      case 'light':
        return <Sun size={18} />
      case 'dark':
        return <Moon size={18} />
      default:
        return <Monitor size={18} />
    }
  }

  const getLabel = () => {
    switch (theme) {
      case 'light':
        return 'Light'
      case 'dark':
        return 'Dark'
      default:
        return 'Auto'
    }
  }

  return (
    <Button
      isIconOnly
      variant="light"
      size="sm"
      onPress={handleToggle}
      aria-label={`Switch to ${theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light'} theme`}
      title={`Current: ${getLabel()}`}
    >
      {getIcon()}
    </Button>
  )
}
