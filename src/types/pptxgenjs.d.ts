declare namespace PptxGenJS {
  interface TextProps {
    bold?: boolean;
    italic?: boolean;
    color?: string;
    fontSize?: number;
    bullet?: boolean;
  }

  interface TextItem {
    text: string;
    options?: TextProps;
  }

  type TextInput = string | TextItem[];

  interface AddTextOptions {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    align?: 'left' | 'center' | 'right';
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    color?: string;
  }

  interface AddImageOptions {
    data?: string;
    path?: string;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
  }

  interface TableCellOptions {
    bold?: boolean;
    color?: string;
    fontSize?: number;
  }

  interface TableCell {
    text: string;
    options?: TableCellOptions;
  }

  type TableRow = TableCell[];

  interface AddTableOptions {
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    colW?: number[];
    color?: string;
    fontSize?: number;
    border?: { pt: number; color: string };
  }

  interface SlideBackground {
    color?: string;
  }

  interface Slide {
    background: SlideBackground;
    addText(text: TextInput, opts?: AddTextOptions): void;
    addImage(opts: AddImageOptions): void;
    addTable(rows: TableRow[], opts?: AddTableOptions): void;
  }

  interface WriteFileOptions {
    fileName?: string;
  }
}

declare class PptxGenJS {
  layout: string;
  addSlide(): PptxGenJS.Slide;
  writeFile(opts?: PptxGenJS.WriteFileOptions): Promise<void>;
}

declare module 'pptxgenjs' {
  export = PptxGenJS;
}
