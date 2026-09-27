export function log(message: string): void {
  const timestamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
  console.log(`[${timestamp}] ${message}`);
}

export function error(message: string): void {
  log(`ERROR: ${message}`);
}
