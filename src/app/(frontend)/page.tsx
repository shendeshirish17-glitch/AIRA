import type { Viewport } from "next"
import {
  Noto_Sans_Devanagari,
  Noto_Sans_Tamil,
  Space_Mono,
} from "next/font/google"
import { AiraApp } from "./_aira/AiraApp"

const mono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-aira-mono",
  display: "swap",
})
const devanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  weight: ["400", "600"],
  variable: "--font-aira-deva",
  display: "swap",
})
const tamil = Noto_Sans_Tamil({
  subsets: ["tamil"],
  weight: ["400", "600"],
  variable: "--font-aira-tamil",
  display: "swap",
})

export const viewport: Viewport = {
  themeColor: "#000000",
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
}

export default function Page() {
  return (
    <AiraApp
      fontClass={`${mono.variable} ${devanagari.variable} ${tamil.variable}`}
    />
  )
}
