declare module 'html2canvas' {
  interface Options {
    useCORS?: boolean;
    logging?: boolean;
    scale?: number;
    backgroundColor?: string | null;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    scrollX?: number;
    scrollY?: number;
    windowWidth?: number;
    windowHeight?: number;
    foreignObjectRendering?: boolean;
    allowTaint?: boolean;
    removeContainer?: boolean;
    imageTimeout?: number;
    proxy?: string;
    onclone?: (doc: Document) => void;
    ignoreElements?: (element: Element) => boolean;
  }

  function html2canvas(element: HTMLElement, options?: Options): Promise<HTMLCanvasElement>;

  export = html2canvas;
}
