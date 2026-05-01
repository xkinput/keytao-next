import Image from 'next/image'
import Link from 'next/link'

interface LogoProps {
  className?: string
  size?: number
}

export default function Logo({ className = '', size = 40 }: LogoProps) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${className}`}>
      <Image
        src="/logo.png"
        alt="KeyTao Logo"
        width={size}
        height={size}
        className="rounded-md"
        priority
      />
      <div className="flex flex-col leading-none">
        <span className="text-xl font-extrabold text-primary tracking-tight">键道</span>
        <span className="text-[11px] font-medium text-default-400 tracking-widest uppercase">KeyTao</span>
      </div>
    </Link>
  )
}
