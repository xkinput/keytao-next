import Image from 'next/image'
import Link from 'next/link'

interface LogoProps {
  className?: string
  size?: number
}

export default function Logo({ className = '', size = 40 }: LogoProps) {
  return (
    <Link href="/" className={`group flex shrink-0 items-center gap-2 rounded-lg transition-opacity hover:opacity-90 ${className}`}>
      <Image
        src="/logo.png"
        alt="KeyTao Logo"
        width={size}
        height={size}
        className="rounded-md"
        priority
      />
      <div className="flex flex-col gap-0.5 leading-none">
        <span className="text-[17px] font-semibold tracking-normal text-foreground">键道</span>
        <span className="text-[9px] font-semibold uppercase tracking-normal text-default-500">KeyTao</span>
      </div>
    </Link>
  )
}
