import { heroui } from "@heroui/react";

export default heroui({
  themes: {
    light: {
      colors: {
        background: "#FFFFFF",
        foreground: "#11181C",
        content1: "#FFFFFF",
        content2: "#F4F4F5",
        content3: "#E4E4E7",
        content4: "#D4D4D8",
        divider: "#E4E4E7",
        focus: "#006FEE",
        overlay: "#FFFFFF",
        default: {
          DEFAULT: "#F4F4F5",
          foreground: "#11181C",
        },
      },
    },
    dark: {
      colors: {
        background: "#000000",
        foreground: "#ECEDEE",
        content1: "#18181b",
        content2: "#27272a",
        content3: "#3f3f46",
        content4: "#52525b",
        divider: "#27272a",
        focus: "#006FEE",
        overlay: "#18181b",
        default: {
          DEFAULT: "#3f3f46",
          foreground: "#ECEDEE",
        },
      },
    },
  },
});
