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
      <span className="text-2xl font-bold text-primary">KeyTao</span>
    </Link>
  )
}
