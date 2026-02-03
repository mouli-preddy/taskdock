/// <reference types="vite/client" />
/// <reference path="./api.d.ts" />

// Allow importing SVG files as raw strings
declare module '*.svg?raw' {
  const content: string;
  export default content;
}

declare module 'lucide-static/icons/*.svg?raw' {
  const content: string;
  export default content;
}
