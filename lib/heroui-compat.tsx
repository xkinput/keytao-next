'use client'

import React, { useCallback, useContext, useMemo, useState } from 'react'
import * as Hero from '@heroui/react'

const H = Hero as Record<string, any>

type RenderChild = React.ReactNode | ((...args: any[]) => React.ReactNode)
type AnyProps = {
  children?: RenderChild
  className?: string
  classNames?: ClassNames
  [key: string]: any
}
type UnknownBaseProps = {
  children?: React.ReactNode
  className?: string
  classNames?: ClassNames
  [key: string]: any
}
type ClassNames = string | Record<string, string | undefined> | undefined
type SelectionKeys = 'all' | Set<React.Key>

const OverlayCloseContext = React.createContext<(() => void) | null>(null)
const ModalCompatContext = React.createContext<{ size?: string; hasWrapperSizing?: boolean }>({})
const TableColumnCountContext = React.createContext(1)

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

function compat(Component: any) {
  return function CompatComponent(props: AnyProps) {
    return <Component {...props} />
  }
}

function slotClass(classNames: ClassNames, slot?: string) {
  if (!classNames) return undefined
  if (typeof classNames === 'string') return slot ? undefined : classNames
  return slot ? classNames[slot] : classNames.base
}

function flatClassNames(classNames: ClassNames) {
  if (!classNames) return undefined
  if (typeof classNames === 'string') return classNames
  return Object.values(classNames).filter(Boolean).join(' ')
}

function hasClassToken(className: string | undefined, pattern: RegExp) {
  if (!className) return false
  return className.split(/\s+/).some((token) => {
    const coreToken = token.split(':').pop() ?? token
    return pattern.test(token) || pattern.test(coreToken)
  })
}

function sectionPadding(defaultX: string, defaultY: string, className: string | undefined) {
  const hasX = hasClassToken(className, /^!?-?(p|px|pl|pr)-/)
  const hasY = hasClassToken(className, /^!?-?(p|py|pt|pb)-/)
  return cn(!hasX && defaultX, !hasY && defaultY)
}

function sectionGap(defaultGap: string, className: string | undefined) {
  return hasClassToken(className, /^!?-?gap[xy]?-|^!?-?space-[xy]-/) ? undefined : defaultGap
}

function hasFieldSizingIntent(className: string | undefined) {
  if (!className) return false

  return className.split(/\s+/).some((token) => {
    const coreToken = token.split(':').pop() ?? token
    if (/^!?min-w-0$/.test(coreToken)) return false
    return /^!?(?:w|min-w|max-w|basis|grow|shrink)(?:-|$)/.test(coreToken) ||
      /^!?flex(?:$|-(?:1|auto|initial|none|\[))/.test(coreToken)
  })
}

function fieldRootClass(className: string | undefined, classNames: ClassNames) {
  const rootClass = cn(slotClass(classNames), className)
  return cn('flex min-w-0 flex-col gap-1.5', !hasFieldSizingIntent(rootClass) && 'w-full', rootClass)
}

function selectRootClass(className: string | undefined, classNames: ClassNames) {
  const rootClass = cn(slotClass(classNames), className)
  return cn('min-w-0', !hasFieldSizingIntent(rootClass) && 'w-full', rootClass)
}

function hasModalSizingIntent(className: string | undefined) {
  if (!className) return false

  return hasClassToken(className, /^!?(?:w|min-w|max-w)(?:-|$)|^\[width:|^\[max-width:/)
}

function modalDialogSizeClass(size: unknown) {
  switch (String(size || 'md')) {
    case 'xs':
      return 'w-[min(calc(100vw-2rem),20rem)] sm:w-[min(calc(100vw-5rem),20rem)] !max-w-none'
    case 'sm':
      return 'w-[min(calc(100vw-2rem),24rem)] sm:w-[min(calc(100vw-5rem),24rem)] !max-w-none'
    case 'lg':
      return 'w-[min(calc(100vw-2rem),32rem)] sm:w-[min(calc(100vw-5rem),32rem)] !max-w-none'
    case 'xl':
      return 'w-[min(calc(100vw-2rem),34rem)] sm:w-[min(calc(100vw-5rem),34rem)] !max-w-none'
    case '2xl':
      return 'w-[min(calc(100vw-2rem),38rem)] sm:w-[min(calc(100vw-5rem),38rem)] !max-w-none'
    case '3xl':
      return 'w-[min(calc(100vw-2rem),43rem)] sm:w-[min(calc(100vw-5rem),43rem)] !max-w-none'
    case '4xl':
      return 'w-[min(calc(100vw-2rem),50rem)] sm:w-[min(calc(100vw-5rem),50rem)] !max-w-none'
    case '5xl':
      return 'w-[min(calc(100vw-2rem),56rem)] sm:w-[min(calc(100vw-5rem),56rem)] !max-w-none'
    case 'cover':
    case 'full':
      return undefined
    case 'md':
    default:
      return 'w-[min(calc(100vw-2rem),28rem)] sm:w-[min(calc(100vw-5rem),28rem)] !max-w-none'
  }
}

function herouiModalSize(size: unknown) {
  return ['cover', 'full', 'lg', 'md', 'sm', 'xs'].includes(String(size)) ? size : 'md'
}

function firstSelectedKey(selectedKeys: unknown): React.Key | undefined {
  if (!selectedKeys || selectedKeys === 'all') return undefined
  if (selectedKeys instanceof Set) return Array.from(selectedKeys)[0] as React.Key | undefined
  if (Array.isArray(selectedKeys)) return selectedKeys[0] as React.Key | undefined
  if (typeof selectedKeys === 'string' || typeof selectedKeys === 'number') return selectedKeys
  return undefined
}

function emitSelection(onSelectionChange: ((keys: SelectionKeys) => void) | undefined, key: React.Key | null) {
  if (!onSelectionChange || key == null) return
  onSelectionChange(new Set([key]))
}

function mapStatusColor(color?: string) {
  if (color === 'primary') return 'accent'
  if (color === 'secondary') return 'default'
  return color
}

function mapButtonVariant(color?: string, variant?: string) {
  if (color === 'danger') return variant === 'flat' ? 'danger-soft' : 'danger'
  if (variant === 'bordered') return 'outline'
  if (variant === 'light') return 'ghost'
  if (variant === 'flat' || variant === 'faded') return color === 'primary' ? 'primary' : 'secondary'
  if (variant === 'ghost') return 'ghost'
  if (color === 'primary') return 'primary'
  return 'secondary'
}

function mapSoftVariant(variant?: string) {
  if (variant === 'flat' || variant === 'faded') return 'soft'
  if (variant === 'bordered') return 'secondary'
  if (variant === 'light') return 'tertiary'
  return variant
}

function keyedChildren(children: React.ReactNode) {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement<AnyProps>(child)) return child
    const id = child.props.id ?? child.props.value ?? (child.key == null ? undefined : String(child.key))
    return React.cloneElement(child, id == null ? undefined : ({ id } as Partial<AnyProps>))
  })
}

function useControlledOpen(props: AnyProps) {
  const { isOpen, defaultOpen } = props
  const onOpenChange = typeof props.onOpenChange === 'function' ? props.onOpenChange as (open: boolean) => void : undefined
  const onClose = typeof props.onClose === 'function' ? props.onClose as () => void : undefined
  const [localOpen, setLocalOpen] = useState(Boolean(defaultOpen))
  const controlled = typeof isOpen === 'boolean'
  const open = controlled ? isOpen : localOpen
  const setOpen = useCallback((nextOpen: boolean) => {
    if (!controlled) setLocalOpen(nextOpen)
    onOpenChange?.(nextOpen)
    if (!nextOpen) onClose?.()
  }, [controlled, onClose, onOpenChange])

  return [open, setOpen] as const
}

function normalizeReactKey(key: React.Key | null, fallback: React.Key): React.Key {
  if (key == null) return fallback
  const value = String(key)
  if (value.startsWith('.$')) return value.slice(2)
  if (value.startsWith('.')) return value.slice(1)
  return key
}

function selectedClass(isSelected: boolean, selected: string, idle: string) {
  return isSelected ? selected : idle
}

function fieldAriaLabel(label: React.ReactNode, ariaLabel: unknown, placeholder: unknown, isRequired?: boolean) {
  if (typeof ariaLabel === 'string') return ariaLabel
  if (typeof label === 'string') return `${label}${isRequired ? ' *' : ''}`
  if (!label && typeof placeholder === 'string') return placeholder
  return undefined
}

const buttonBaseClass = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-sm font-medium tracking-normal transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background'
const fieldWrapperClass = 'flex min-h-10 min-w-0 items-center gap-2 rounded-md border border-default-200 bg-field px-3 text-sm text-field-foreground shadow-[0_1px_0_hsl(var(--shadow-color)/0.04)] transition-[border-color,box-shadow,background-color,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] focus-within:border-default-300 focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--foreground)_8%,transparent)]'
const fieldInputClass = 'min-w-0 flex-1 bg-transparent outline-none placeholder:text-field-placeholder disabled:opacity-60'
const cardBaseClass = 'gap-0 rounded-xl border border-default-200 bg-content1/94 p-0 shadow-[0_1px_1px_hsl(var(--shadow-color)/0.05),0_18px_42px_hsl(var(--shadow-color)/0.045)]'

export function useDisclosure(options: AnyProps = {}) {
  const [isOpen, setIsOpen] = useState(Boolean(options.defaultOpen ?? options.isOpen))
  const setOpen = useCallback((nextOpen: boolean) => {
    setIsOpen(nextOpen)
    if (typeof options.onChange === 'function') options.onChange(nextOpen)
    if (nextOpen && typeof options.onOpen === 'function') options.onOpen()
    if (!nextOpen && typeof options.onClose === 'function') options.onClose()
  }, [options])

  return {
    isOpen,
    onOpen: () => setOpen(true),
    onClose: () => setOpen(false),
    onOpenChange: (nextOpen?: boolean) => setOpen(typeof nextOpen === 'boolean' ? nextOpen : !isOpen),
    isControlled: false,
  }
}

export function HeroUIProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

type ButtonProps = Omit<UnknownBaseProps, 'children'> & {
  children?: React.ReactNode
  color?: string
  variant?: string
  isLoading?: boolean
  isDisabled?: boolean
  disabled?: boolean
  startContent?: React.ReactNode
  endContent?: React.ReactNode
  spinner?: React.ReactNode
  as?: React.ElementType
  href?: string
  target?: string
  rel?: string
  onPress?: (event?: unknown) => void
  onClick?: React.MouseEventHandler<HTMLElement>
}

export const Button = React.forwardRef<HTMLElement, ButtonProps>(function Button(
  {
    children,
    className,
    color,
    variant,
    isLoading,
    isDisabled,
    disabled,
    startContent,
    endContent,
    spinner,
    as: Component,
    onPress,
    onClick,
    href,
    target,
    rel,
    ...props
  },
  ref,
) {
  const disabledValue = Boolean(isDisabled ?? disabled ?? isLoading)
  const resolvedClassName = cn(buttonBaseClass, className)
  const content = (
    <>
      {isLoading ? spinner ?? <H.Spinner size="sm" color="current" /> : startContent}
      {children}
      {endContent}
    </>
  )

  if (Component && Component !== H.Button) {
    const Element = Component
    return (
      <Element
        ref={ref}
        className={resolvedClassName}
        href={href}
        target={target}
        rel={rel}
        aria-disabled={disabledValue || undefined}
        onClick={disabledValue ? undefined : onClick ?? (() => onPress?.())}
        {...props}
      >
        {content}
      </Element>
    )
  }

  return (
    <H.Button
      ref={ref}
      className={resolvedClassName}
      isDisabled={disabledValue}
      disabled={disabledValue}
      variant={mapButtonVariant(color, variant)}
      onPress={onPress}
      onClick={onClick}
      href={href}
      target={target}
      rel={rel}
      {...props}
    >
      {content}
    </H.Button>
  )
})

export function Chip({ children, className, color, variant, startContent, endContent, ...props }: AnyProps) {
  return (
    <H.Chip
      className={cn('font-medium', className)}
      color={mapStatusColor(color)}
      variant={mapSoftVariant(variant)}
      {...props}
    >
      {startContent}
      {children}
      {endContent}
    </H.Chip>
  )
}

export function Spinner({ color, ...props }: AnyProps) {
  return <H.Spinner color={mapStatusColor(color)} {...props} />
}

export function Progress({ color, className, ...props }: AnyProps) {
  return (
    <H.ProgressBar color={mapStatusColor(color)} className={className} {...props}>
      <H.ProgressBar.Track>
        <H.ProgressBar.Fill />
      </H.ProgressBar.Track>
    </H.ProgressBar>
  )
}

export function Alert({ children, color, title, description, className, classNames, variant, hideIcon, ...props }: AnyProps) {
  void variant
  void hideIcon

  return (
    <H.Alert status={mapStatusColor(color)} className={cn(slotClass(classNames), className)} {...props}>
      <H.Alert.Content className={slotClass(classNames, 'mainWrapper')}>
        {title ? <H.Alert.Title>{title}</H.Alert.Title> : null}
        {description ? <H.Alert.Description>{description}</H.Alert.Description> : null}
        {children}
      </H.Alert.Content>
    </H.Alert>
  )
}

type CardProps = Omit<UnknownBaseProps, 'children'> & {
  children?: React.ReactNode
  isPressable?: boolean
  onPress?: React.MouseEventHandler<HTMLElement>
  onClick?: React.MouseEventHandler<HTMLElement>
  onPointerDown?: React.PointerEventHandler<HTMLElement>
  as?: React.ElementType
  href?: string
}

export const Card = React.forwardRef<HTMLElement, CardProps>(function Card(
  { children, className, isPressable, onPress, onClick, as: Component, href, ...props },
  ref,
) {
  const render = Component
    ? (domProps: AnyProps) => <Component {...domProps} ref={ref} href={href} />
    : undefined

  return (
    <H.Card
      className={cn(cardBaseClass, isPressable && 'cursor-pointer interactive-lift hover:border-primary/35 hover:bg-content1', className)}
      onClick={onClick ?? onPress}
      render={render}
      tabIndex={isPressable ? 0 : props.tabIndex}
      role={isPressable ? 'button' : props.role}
      {...props}
    >
      {children}
    </H.Card>
  )
})

export function CardHeader({ className, children, ...props }: AnyProps) {
  const Component = H.Card.Header ?? H.CardHeader
  return (
    <Component
      className={cn(sectionPadding('px-4 sm:px-5', 'pt-4 pb-3 sm:pt-5', className), sectionGap('gap-2', className), className)}
      {...props}
    >
      {children}
    </Component>
  )
}

export const CardBody = React.forwardRef<HTMLElement, AnyProps>(function CardBody({ className, children, ...props }, ref) {
  const Component = H.Card.Content ?? H.CardContent
  return (
    <Component
      ref={ref}
      className={cn(sectionPadding('px-4 sm:px-5', 'py-4 sm:py-5', className), sectionGap('gap-3', className), className)}
      {...props}
    >
      {children}
    </Component>
  )
})

export function CardFooter({ className, children, ...props }: AnyProps) {
  const Component = H.Card.Footer ?? H.CardFooter
  return (
    <Component
      className={cn(sectionPadding('px-4 sm:px-5', 'pt-3 pb-4 sm:pb-5', className), sectionGap('gap-2', className), className)}
      {...props}
    >
      {children}
    </Component>
  )
}
export const Divider = compat(H.Separator)
export const Skeleton = compat(H.Skeleton)
export const ScrollShadow = compat(H.ScrollShadow)

type CodeProps = Omit<UnknownBaseProps, 'children'> & {
  children?: React.ReactNode
  size?: string
}

export function Code({ children, className, size, ...props }: CodeProps) {
  return (
    <code
      className={cn(
        'inline-flex max-w-full items-center rounded bg-content2 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground',
        size === 'sm' && 'text-xs',
        className,
      )}
      {...props}
    >
      {children}
    </code>
  )
}

export function Link({ children, className, isExternal, showAnchorIcon, target, rel, ...props }: AnyProps) {
  const external = Boolean(isExternal)
  return (
    <H.Link
      className={className}
      target={target ?? (external ? '_blank' : undefined)}
      rel={rel ?? (external ? 'noopener noreferrer' : undefined)}
      {...props}
    >
      {children}
      {showAnchorIcon ? <H.ExternalLinkIcon className="ml-1 inline size-3" aria-hidden /> : null}
    </H.Link>
  )
}

type InputProps = Omit<UnknownBaseProps, 'children'> & {
  children?: React.ReactNode
  label?: React.ReactNode
  description?: React.ReactNode
  errorMessage?: React.ReactNode
  value?: string | number
  onValueChange?: (value: string) => void
  onChange?: React.ChangeEventHandler<HTMLInputElement>
  onClear?: () => void
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  startContent?: React.ReactNode
  endContent?: React.ReactNode
  isInvalid?: boolean
  isRequired?: boolean
  isDisabled?: boolean
  disabled?: boolean
  isClearable?: boolean
  size?: string
  variant?: string
  radius?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    description,
    errorMessage,
    className,
    classNames,
    value,
    onValueChange,
    onChange,
    onClear,
    startContent,
    endContent,
    isInvalid,
    isRequired,
    isDisabled,
    disabled,
    isClearable,
    size,
    variant,
    radius,
    'aria-label': ariaLabel,
    ...props
  },
  ref,
) {
  void size
  void variant
  void radius

  const stringValue = value == null ? '' : String(value)
  const resolvedAriaLabel = fieldAriaLabel(label, ariaLabel, props.placeholder, isRequired)

  return (
    <label className={fieldRootClass(className, classNames)}>
      {label ? <span className="text-sm font-medium text-foreground">{label}{isRequired ? ' *' : ''}</span> : null}
      <div className={cn(fieldWrapperClass, slotClass(classNames, 'inputWrapper'))}>
        {startContent}
        <input
          ref={ref}
          className={cn(fieldInputClass, slotClass(classNames, 'input'))}
          value={stringValue}
          aria-label={resolvedAriaLabel}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            onChange?.(event)
            onValueChange?.(event.target.value)
          }}
          disabled={Boolean(isDisabled ?? disabled)}
          aria-invalid={isInvalid}
          aria-required={isRequired}
          {...props}
        />
        {isClearable && stringValue ? (
          <button type="button" className="rounded px-1 text-muted transition-colors hover:bg-default-100 hover:text-foreground" onClick={onClear ?? (() => onValueChange?.(''))}>
            x
          </button>
        ) : null}
        {endContent}
      </div>
      {description ? <span className="text-xs text-muted">{description}</span> : null}
      {errorMessage ? <span className="text-xs text-danger">{errorMessage}</span> : null}
    </label>
  )
})

type TextareaProps = Omit<UnknownBaseProps, 'children'> & {
  children?: React.ReactNode
  label?: React.ReactNode
  description?: React.ReactNode
  errorMessage?: React.ReactNode
  value?: string
  onValueChange?: (value: string) => void
  onChange?: React.ChangeEventHandler<HTMLTextAreaElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLTextAreaElement>
  minRows?: number
  maxRows?: number
  isInvalid?: boolean
  isRequired?: boolean
  isDisabled?: boolean
  disabled?: boolean
  size?: string
  variant?: string
  radius?: string
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    description,
    errorMessage,
    className,
    classNames,
    value,
    onValueChange,
    onChange,
    minRows,
    maxRows,
    isInvalid,
    isRequired,
    isDisabled,
    disabled,
    size,
    variant,
    radius,
    style,
    'aria-label': ariaLabel,
    ...props
  },
  ref,
) {
  void size
  void variant
  void radius

  const maxHeight = typeof maxRows === 'number' ? `${maxRows * 1.5 + 1}rem` : undefined
  const resolvedAriaLabel = fieldAriaLabel(label, ariaLabel, props.placeholder, isRequired)

  return (
    <label className={fieldRootClass(className, classNames)}>
      {label ? <span className="text-sm font-medium text-foreground">{label}{isRequired ? ' *' : ''}</span> : null}
      <textarea
        ref={ref}
        className={cn('min-h-20 min-w-0 w-full resize-y rounded-md border border-default-200 bg-field px-3 py-2 text-sm text-field-foreground shadow-[0_1px_0_hsl(var(--shadow-color)/0.04)] outline-none transition-[border-color,box-shadow,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] placeholder:text-field-placeholder focus:border-default-300 focus:shadow-[0_0_0_3px_color-mix(in_oklab,var(--foreground)_8%,transparent)] disabled:opacity-60', slotClass(classNames, 'inputWrapper'), slotClass(classNames, 'input'))}
        rows={minRows}
        value={value ?? ''}
        aria-label={resolvedAriaLabel}
        onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
          onChange?.(event)
          onValueChange?.(event.target.value)
        }}
        disabled={Boolean(isDisabled ?? disabled)}
        aria-invalid={isInvalid}
        aria-required={isRequired}
        style={{ maxHeight, ...(style as React.CSSProperties | undefined) }}
        {...props}
      />
      {description ? <span className="text-xs text-muted">{description}</span> : null}
      {errorMessage ? <span className="text-xs text-danger">{errorMessage}</span> : null}
    </label>
  )
})

type SelectProps = Omit<UnknownBaseProps, 'children'> & {
  children?: React.ReactNode
  label?: React.ReactNode
  placeholder?: React.ReactNode
  selectedKeys?: SelectionKeys | Iterable<React.Key>
  onSelectionChange?: (keys: SelectionKeys) => void
  onChange?: React.ChangeEventHandler<HTMLSelectElement>
}

export function Select({ children, label, placeholder, className, classNames, selectedKeys, onSelectionChange, onChange, 'aria-label': ariaLabel, ...props }: SelectProps) {
  const selectedKey = firstSelectedKey(selectedKeys)
  const resolvedAriaLabel = ariaLabel ?? (!label && typeof placeholder === 'string' ? placeholder : undefined)

  return (
    <H.Select
      selectedKey={selectedKey}
      aria-label={resolvedAriaLabel}
      onSelectionChange={(key: React.Key | null) => {
        emitSelection(onSelectionChange, key)
        if (key != null && onChange) {
          onChange({ target: { value: String(key) } } as React.ChangeEvent<HTMLSelectElement>)
        }
      }}
      className={selectRootClass(className, classNames)}
      {...props}
    >
      {label ? <H.Label className="mb-1.5 block text-sm font-medium text-foreground">{label}</H.Label> : null}
      <H.Select.Trigger className={cn(fieldWrapperClass, 'select-trigger-future justify-between hover:-translate-y-px', slotClass(classNames, 'trigger'))}>
        <H.Select.Value className={cn('min-w-0 flex-1 truncate text-left', slotClass(classNames, 'value'))}>
          {({ selectedText }: AnyProps) => selectedText || placeholder}
        </H.Select.Value>
        <H.Select.Indicator className={cn('h-4 w-4 shrink-0 text-default-500 transition-[color,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-[open=true]:rotate-180 data-[open=true]:text-primary', slotClass(classNames, 'indicator'))} />
      </H.Select.Trigger>
      <H.Select.Popover className={cn('rounded-xl border border-default-200 bg-content1 p-1 shadow-[0_18px_48px_hsl(var(--shadow-color)/0.12)]', slotClass(classNames, 'popover'))}>
        <H.ListBox className={cn('max-h-80 overflow-auto p-1', slotClass(classNames, 'listbox'))}>{keyedChildren(children)}</H.ListBox>
      </H.Select.Popover>
    </H.Select>
  )
}

export function SelectItem({ children, textValue, className, ...props }: AnyProps) {
  return (
    <H.ListBoxItem
      textValue={textValue ?? (typeof children === 'string' ? children : undefined)}
      className={cn('flex min-h-10 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-foreground outline-none transition-[background-color,color,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-content2 data-[focused=true]:bg-content2 data-[selected=true]:bg-primary-50 data-[selected=true]:text-foreground', className)}
      {...props}
    >
      <span className="min-w-0 truncate">{children as React.ReactNode}</span>
      <H.ListBox.ItemIndicator className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-primary opacity-0 transition-opacity duration-200 data-[visible=true]:opacity-100" />
    </H.ListBoxItem>
  )
}

type ListboxProps = Omit<UnknownBaseProps, 'children'> & {
  children?: React.ReactNode | ((item: any) => React.ReactNode)
}

export function Listbox({ children, className, classNames, ...props }: ListboxProps) {
  const content = typeof children === 'function' ? children : keyedChildren(children)
  return <H.ListBox className={cn(flatClassNames(classNames), className)} {...props}>{content}</H.ListBox>
}

export function ListboxItem({ children, textValue, ...props }: AnyProps) {
  return (
    <H.ListBoxItem textValue={textValue ?? (typeof children === 'string' ? children : undefined)} {...props}>
      {children}
    </H.ListBoxItem>
  )
}

export function Dropdown({ children, ...props }: AnyProps) {
  return <H.Dropdown {...props}>{children}</H.Dropdown>
}

export function DropdownTrigger({ children, ...props }: AnyProps) {
  if (React.isValidElement<AnyProps>(children)) {
    const childProps = children.props
    const disabledValue = Boolean(childProps.isDisabled ?? childProps.disabled)

    return (
      <H.Dropdown.Trigger
        className={childProps.className}
        aria-label={childProps['aria-label']}
        isDisabled={disabledValue}
        disabled={disabledValue}
        onPress={childProps.onPress}
        onClick={childProps.onClick}
        {...props}
      >
        {childProps.startContent}
        {childProps.children}
        {childProps.endContent}
      </H.Dropdown.Trigger>
    )
  }

  return <H.Dropdown.Trigger {...props}>{children}</H.Dropdown.Trigger>
}

type DropdownMenuProps = Omit<UnknownBaseProps, 'children'> & {
  children?: React.ReactNode
  onAction?: (key: React.Key) => void
}

export function DropdownMenu({ children, className, classNames, onAction, ...props }: DropdownMenuProps) {
  return (
    <H.Dropdown.Popover className={cn('rounded-xl border border-default-200 bg-content1 p-1 shadow-[0_18px_48px_hsl(var(--shadow-color)/0.12)]', slotClass(classNames, 'popover'))}>
      <H.Dropdown.Menu className={cn('min-w-36 p-1', flatClassNames(classNames), className)} onAction={onAction} {...props}>
        {keyedChildren(children)}
      </H.Dropdown.Menu>
    </H.Dropdown.Popover>
  )
}

export function DropdownItem({ children, onPress, textValue, className, ...props }: AnyProps) {
  return (
    <H.Dropdown.Item
      onAction={onPress}
      textValue={textValue ?? (typeof children === 'string' ? children : undefined)}
      className={cn('flex min-h-9 cursor-pointer items-center rounded-lg px-3 py-2 text-sm text-default-700 outline-none transition-[background-color,color,transform] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-content2 hover:text-foreground data-[focused=true]:bg-content2 data-[focused=true]:text-foreground', className)}
      {...props}
    >
      {children}
    </H.Dropdown.Item>
  )
}

export function Modal({ children, className, classNames, size, scrollBehavior, placement, backdrop, ...props }: AnyProps) {
  const [isOpen, setOpen] = useControlledOpen(props)
  const close = useCallback(() => setOpen(false), [setOpen])
  const wrapperClass = cn(slotClass(classNames, 'wrapper'), className)
  const compatSize = typeof size === 'string' ? size : undefined

  return (
    <OverlayCloseContext.Provider value={close}>
      <ModalCompatContext.Provider value={{ size: compatSize, hasWrapperSizing: hasModalSizingIntent(wrapperClass) }}>
        <H.Modal isOpen={isOpen} onOpenChange={setOpen}>
          <H.Modal.Backdrop variant={backdrop === 'blur' ? 'blur' : 'opaque'} className={slotClass(classNames, 'backdrop')}>
            <H.Modal.Container
              size={herouiModalSize(size)}
              scroll={scrollBehavior}
              placement={placement}
              className={wrapperClass}
            >
              {children}
            </H.Modal.Container>
          </H.Modal.Backdrop>
        </H.Modal>
      </ModalCompatContext.Provider>
    </OverlayCloseContext.Provider>
  )
}

type OverlayContentProps = Omit<UnknownBaseProps, 'children'> & {
  children?: React.ReactNode | ((onClose: () => void) => React.ReactNode)
}

export function ModalContent({ children, className, ...props }: OverlayContentProps) {
  const close = useContext(OverlayCloseContext) ?? (() => undefined)
  const { size, hasWrapperSizing } = useContext(ModalCompatContext)
  const content = typeof children === 'function' ? children(close) : children
  const shouldUseCompatSize = !hasWrapperSizing && !hasModalSizingIntent(className)
  return (
    <H.Modal.Dialog className={cn(shouldUseCompatSize && modalDialogSizeClass(size), className)} {...props}>
      {content}
    </H.Modal.Dialog>
  )
}

export const ModalHeader = compat(H.Modal.Header ?? H.ModalHeader)
export const ModalBody = compat(H.Modal.Body ?? H.ModalBody)
export const ModalFooter = compat(H.Modal.Footer ?? H.ModalFooter)

export function Drawer({ children, classNames, placement = 'left', ...props }: AnyProps) {
  const [isOpen, setOpen] = useControlledOpen(props)
  const close = useCallback(() => setOpen(false), [setOpen])

  return (
    <OverlayCloseContext.Provider value={close}>
      <H.Drawer isOpen={isOpen} onOpenChange={setOpen}>
        <H.Drawer.Backdrop className={slotClass(classNames, 'backdrop')}>
          {React.Children.map(children as React.ReactNode, (child) => {
            if (!React.isValidElement<AnyProps>(child)) return child
            return React.cloneElement(child, { placement, classNames })
          })}
        </H.Drawer.Backdrop>
      </H.Drawer>
    </OverlayCloseContext.Provider>
  )
}

export function DrawerContent({ children, className, classNames, placement = 'left', ...props }: OverlayContentProps) {
  const close = useContext(OverlayCloseContext) ?? (() => undefined)
  const content = typeof children === 'function' ? children(close) : children
  return (
    <H.Drawer.Content placement={placement} className={cn(slotClass(classNames, 'wrapper'), className)} {...props}>
      <H.Drawer.Dialog>
        {content}
      </H.Drawer.Dialog>
    </H.Drawer.Content>
  )
}

export const DrawerHeader = compat(H.Drawer.Header ?? H.DrawerHeader)
export const DrawerBody = compat(H.Drawer.Body ?? H.DrawerBody)

export function Popover({ children, classNames, placement, ...props }: AnyProps) {
  const [isOpen, setOpen] = useControlledOpen(props)

  return (
    <H.Popover isOpen={isOpen} onOpenChange={setOpen}>
      {React.Children.map(children as React.ReactNode, (child) => {
        if (!React.isValidElement<AnyProps>(child)) return child
        return React.cloneElement(child, { placement, classNames })
      })}
    </H.Popover>
  )
}

export function PopoverTrigger({ children, ...props }: AnyProps) {
  return <H.Popover.Trigger {...props}>{children}</H.Popover.Trigger>
}

export function PopoverContent({ children, className, classNames, showArrow, placement, ...props }: AnyProps) {
  return (
    <H.Popover.Content placement={placement} className={cn(slotClass(classNames, 'content'), className)} {...props}>
      {showArrow ? <H.Popover.Arrow /> : null}
      <H.Popover.Dialog>
        {children}
      </H.Popover.Dialog>
    </H.Popover.Content>
  )
}

export function Table({ children, className, ...props }: AnyProps) {
  const columnCount = getTableColumnCount(children as React.ReactNode)

  return (
    <TableColumnCountContext.Provider value={columnCount}>
      <H.Table className={cn('overflow-hidden rounded-xl border border-default-200 bg-content1/94 shadow-[0_1px_1px_hsl(var(--shadow-color)/0.05),0_18px_42px_hsl(var(--shadow-color)/0.04)]', className)}>
        <H.Table.ScrollContainer className="bg-transparent">
          <H.Table.Content {...props}>{children}</H.Table.Content>
        </H.Table.ScrollContainer>
      </H.Table>
    </TableColumnCountContext.Provider>
  )
}

function getTableColumnCount(children: React.ReactNode) {
  let count = 1
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement<AnyProps>(child) || child.type !== TableHeader) return
    count = Math.max(1, React.Children.count(child.props.children as React.ReactNode))
  })
  return count
}

export function TableHeader({ children, ...props }: AnyProps) {
  const columns = React.Children.map(children as React.ReactNode, (child, index) => {
    if (!React.isValidElement<AnyProps>(child)) return child
    return React.cloneElement(child, {
      isRowHeader: child.props.isRowHeader ?? index === 0,
    })
  })

  return <H.Table.Header className="bg-content2/70 text-xs font-semibold text-default-600" {...props}>{columns}</H.Table.Header>
}

export function TableColumn({ children, ...props }: AnyProps) {
  return <H.Table.Column className="px-4 py-3" {...props}>{children}</H.Table.Column>
}

export function TableBody({ emptyContent, children, ...props }: AnyProps) {
  const columnCount = useContext(TableColumnCountContext)
  const hasStaticRows =
    typeof children === 'function' || React.Children.count(children as React.ReactNode) > 0

  return (
    <H.Table.Body {...props}>
      {hasStaticRows || !emptyContent ? children : (
        <H.Table.Row>
          <H.Table.Cell colSpan={columnCount} className="py-12 text-center text-default-500">
            {emptyContent}
          </H.Table.Cell>
        </H.Table.Row>
      )}
    </H.Table.Body>
  )
}
export function TableRow({ children, className, ...props }: AnyProps) {
  return (
    <H.Table.Row className={cn('border-b border-default-100 transition-colors duration-200 hover:bg-content2/45 last:border-b-0', className)} {...props}>
      {children}
    </H.Table.Row>
  )
}

export function TableCell({ children, className, ...props }: AnyProps) {
  return (
    <H.Table.Cell className={cn('px-4 py-3 align-middle text-sm', className)} {...props}>
      {children}
    </H.Table.Cell>
  )
}

type RadioGroupProps = Omit<UnknownBaseProps, 'children'> & {
  children?: React.ReactNode
  value?: string
  onValueChange?: (value: string) => void
}

export function RadioGroup({ children, value, onValueChange, orientation, className, ...props }: RadioGroupProps) {
  return (
    <H.RadioGroup value={value} onChange={onValueChange} orientation={orientation} className={className} {...props}>
      {children}
    </H.RadioGroup>
  )
}

export function Radio({ children, className, classNames, ...props }: AnyProps) {
  return (
    <H.Radio className={cn(flatClassNames(classNames), className)} {...props}>
      <H.Radio.Control>
        <H.Radio.Indicator />
      </H.Radio.Control>
      <H.Radio.Content>{children}</H.Radio.Content>
    </H.Radio>
  )
}

type SwitchProps = Omit<UnknownBaseProps, 'children'> & {
  children?: React.ReactNode
  isSelected?: boolean
  onValueChange?: (value: boolean) => void
}

export function Switch({ children, className, classNames, isSelected, onValueChange, style, ...props }: SwitchProps) {
  return (
    <H.Switch
      isSelected={isSelected}
      onChange={onValueChange}
      className={cn('!inline-flex !flex-row !items-center !gap-2', slotClass(classNames), className)}
      style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', ...style }}
      {...props}
    >
      <H.Switch.Content
        className={cn('!inline-flex !flex-row !items-center !gap-2 whitespace-nowrap', slotClass(classNames, 'content'))}
        style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}
      >
        <H.Switch.Control className={slotClass(classNames, 'control')}>
          <H.Switch.Thumb className={slotClass(classNames, 'thumb')} />
        </H.Switch.Control>
        {children ? <span className="whitespace-nowrap leading-none">{children}</span> : null}
      </H.Switch.Content>
    </H.Switch>
  )
}

export function Tooltip({ children, content, className, ...props }: AnyProps) {
  if (!content) return <>{children}</>

  return (
    <H.Tooltip {...props}>
      <H.Tooltip.Trigger>{children}</H.Tooltip.Trigger>
      <H.Tooltip.Content className={className}>{content}</H.Tooltip.Content>
    </H.Tooltip>
  )
}

export function Avatar({ name, src, className, size, ...props }: AnyProps) {
  const fallback = typeof name === 'string' && name.length > 0 ? name.slice(0, 1).toUpperCase() : '?'

  return (
    <H.Avatar className={className} size={size} {...props}>
      {src ? <H.Avatar.Image src={src} alt={name ?? ''} /> : null}
      <H.Avatar.Fallback>{fallback}</H.Avatar.Fallback>
    </H.Avatar>
  )
}

type PaginationProps = Omit<UnknownBaseProps, 'children'> & {
  total?: number
  page?: number
  initialPage?: number
  onChange?: (page: number) => void
  showControls?: boolean
}

function paginationItems(total: number, page: number) {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const pages = new Set<number>([1, total, page, page - 1, page + 1])
  if (page <= 3) {
    pages.add(2)
    pages.add(3)
    pages.add(4)
  }
  if (page >= total - 2) {
    pages.add(total - 1)
    pages.add(total - 2)
    pages.add(total - 3)
  }
  const sorted = Array.from(pages).filter((item) => item >= 1 && item <= total).sort((a, b) => a - b)
  return sorted.reduce<Array<number | 'ellipsis'>>((result, item) => {
    const previous = result[result.length - 1]
    if (typeof previous === 'number' && item - previous > 1) result.push('ellipsis')
    result.push(item)
    return result
  }, [])
}

export function Pagination({ total = 1, page, initialPage = 1, onChange, className, showControls = true }: PaginationProps) {
  const [localPage, setLocalPage] = useState(initialPage)
  const currentPage = Math.min(Math.max(page ?? localPage, 1), Math.max(total, 1))
  const updatePage = useCallback((nextPage: number) => {
    const normalized = Math.min(Math.max(nextPage, 1), Math.max(total, 1))
    if (page == null) setLocalPage(normalized)
    onChange?.(normalized)
  }, [onChange, page, total])

  const items = useMemo(() => paginationItems(Math.max(total, 1), currentPage), [currentPage, total])
  const buttonBase = 'inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm transition-colors disabled:pointer-events-none disabled:opacity-40'

  return (
    <nav className={cn('flex items-center gap-1', className)} aria-label="pagination">
      {showControls ? (
        <button type="button" className={cn(buttonBase, 'bg-content2 text-foreground hover:bg-content3')} disabled={currentPage <= 1} onClick={() => updatePage(currentPage - 1)}>
          Prev
        </button>
      ) : null}
      {items.map((item, index) => item === 'ellipsis' ? (
        <span key={`ellipsis-${index}`} className="px-2 text-default-400">...</span>
      ) : (
        <button
          key={item}
          type="button"
          className={cn(
            buttonBase,
            selectedClass(item === currentPage, 'bg-primary text-primary-foreground', 'bg-content2 text-foreground hover:bg-content3'),
          )}
          aria-current={item === currentPage ? 'page' : undefined}
          onClick={() => updatePage(item)}
        >
          {item}
        </button>
      ))}
      {showControls ? (
        <button type="button" className={cn(buttonBase, 'bg-content2 text-foreground hover:bg-content3')} disabled={currentPage >= total} onClick={() => updatePage(currentPage + 1)}>
          Next
        </button>
      ) : null}
    </nav>
  )
}

type TabsProps = Omit<UnknownBaseProps, 'children'> & {
  children?: React.ReactNode
  selectedKey?: React.Key
  defaultSelectedKey?: React.Key
  onSelectionChange?: (key: React.Key) => void
  orientation?: 'horizontal' | 'vertical'
}

export function Tabs({ children, selectedKey, defaultSelectedKey, onSelectionChange, className, classNames, orientation }: TabsProps) {
  const tabItems = useMemo(() => {
    const items: Array<{ key: React.Key; title: React.ReactNode; panel: React.ReactNode; disabled?: boolean }> = []
    React.Children.forEach(children, (child, index) => {
      if (!React.isValidElement<AnyProps>(child)) return
      const key = normalizeReactKey(child.key, index)
      items.push({
        key,
        title: child.props.title ?? child.props.children,
        panel: child.props.title ? child.props.children as React.ReactNode : null,
        disabled: child.props.isDisabled,
      })
    })
    return items
  }, [children])
  const firstKey = tabItems[0]?.key
  const [localKey, setLocalKey] = useState<React.Key | undefined>(defaultSelectedKey ?? firstKey)
  const activeKey = selectedKey ?? localKey ?? firstKey
  const activePanel = tabItems.find((item) => item.key === activeKey)?.panel

  const choose = useCallback((key: React.Key) => {
    setLocalKey(key)
    onSelectionChange?.(key)
  }, [onSelectionChange])

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-orientation={orientation}
        className={cn('flex flex-wrap items-center gap-2', orientation === 'vertical' && 'flex-col items-stretch', slotClass(classNames, 'tabList'))}
      >
        {tabItems.map((item) => {
          const isSelected = item.key === activeKey
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={isSelected}
              data-selected={isSelected ? 'true' : undefined}
              disabled={item.disabled}
              className={cn(
                'group relative inline-flex h-10 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
                selectedClass(isSelected, 'text-primary', 'text-default-600 hover:text-foreground'),
                slotClass(classNames, 'tab'),
              )}
              onClick={() => choose(item.key)}
            >
              <span className={slotClass(classNames, 'tabContent')}>{item.title}</span>
              {isSelected ? <span className={cn('absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-primary', slotClass(classNames, 'cursor'))} /> : null}
            </button>
          )
        })}
      </div>
      {activePanel ? <div className={slotClass(classNames, 'panel')}>{activePanel}</div> : null}
    </div>
  )
}

export function Tab({ children }: AnyProps) {
  return <>{children}</>
}
