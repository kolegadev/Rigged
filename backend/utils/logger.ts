export class Logger {
  private prefix: string;

  constructor(component: string) {
    this.prefix = `[${component}]`;
  }

  info(message: string, ...args: any[]): void {
    console.log(`${this.prefix} ${message}`, ...args);
  }

  debug(message: string, ...args: any[]): void {
    console.log(`${this.prefix} DEBUG: ${message}`, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(`${this.prefix} WARN: ${message}`, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(`${this.prefix} ERROR: ${message}`, ...args);
  }
}
