import fs from "fs";
import path from "path";

const logFile = path.join(process.cwd(), "logs/app.log");

export function logEvent(type: string, payload: Record<string, any>) {
  const entry = {
    timestamp: new Date().toISOString(),
    type,
    ...payload,
  };

  const line = JSON.stringify(entry) + "\n";

  // Write to console
  console.log(entry);

  // Persist to file
  fs.appendFileSync(logFile, line);
}
