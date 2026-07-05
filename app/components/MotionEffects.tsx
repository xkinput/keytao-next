'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

gsap.registerPlugin(ScrollTrigger, useGSAP)

export default function MotionEffects() {
  useGSAP(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const items = gsap.utils.toArray<HTMLElement>('[data-motion="fade-up"]')

    items.forEach((item, index) => {
      gsap.fromTo(
        item,
        {
          y: 22,
          autoAlpha: 0,
          filter: 'blur(10px)',
        },
        {
          y: 0,
          autoAlpha: 1,
          filter: 'blur(0px)',
          duration: 0.78,
          delay: Math.min(index * 0.035, 0.18),
          ease: 'power3.out',
          scrollTrigger: {
            trigger: item,
            start: 'top 92%',
            once: true,
          },
        },
      )
    })

    const ambientLines = gsap.utils.toArray<HTMLElement>('[data-motion="ambient-line"]')
    if (ambientLines.length > 0) {
      gsap.to(ambientLines, {
        xPercent: 18,
        opacity: 0.82,
        duration: 7,
        yoyo: true,
        repeat: -1,
        ease: 'sine.inOut',
      })
    }
  })

  return null
}
