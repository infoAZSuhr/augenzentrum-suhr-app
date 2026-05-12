// Electron webview element type declarations
declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          allowpopups?: string | boolean
          useragent?: string
          partition?: string
          disablewebsecurity?: string | boolean
          nodeintegration?: string | boolean
          preload?: string
        },
        HTMLElement
      >
    }
  }
}
