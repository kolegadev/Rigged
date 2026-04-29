export class Logger {
  private prefix: string;

  constructor(component: string) {
    this.prefix = `[${component}]`;
  }

  info(message: string): void {
    console.log(`${this.prefix} ${message}`);
  }

  debug(message: string): void {
    console.log(`${this.prefix} DEBUG: ${message}`);
  }

  warn(message: string): void {
    console.warn(`${this.prefix} WARN: ${message}`);
  }

  error(message: string): void {
    console.error(`${this.prefix} ERROR: ${message}`);
  }
}