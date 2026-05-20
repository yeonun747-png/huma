declare module 'piexifjs' {
  const piexif: {
    load: (data: string) => Record<string, Record<number, unknown>>;
    dump: (exifObj: Record<string, unknown>) => string;
    insert: (exifBytes: string, data: string) => string;
    ImageIFD: { Make: number; Model: number };
    GPSIFD: { GPSLatitude: number; GPSLongitude: number };
  };
  export default piexif;
}

declare module 'puppeteer-extra-plugin-stealth' {
  import type { PuppeteerExtraPlugin } from 'puppeteer-extra';
  const plugin: () => PuppeteerExtraPlugin;
  export default plugin;
}
