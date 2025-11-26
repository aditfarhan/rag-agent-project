import fs from "fs";
import path from "path";

const logDir = path.join(process.cwd(), "logs");
const logFile = path.join(logDir, "app.log");

// Ensure logs directory exists
function ensureLogDir() {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

export function logEvent(type: string, payload: Record<string, any>) {
  ensureLogDir();

  const entry = {
    timestamp: new Date().toISOString(),
    type,
    ...payload,
  };

  const line = JSON.stringify(entry) + "\n";

  // Always print to console
  console.log(entry);

  // Safely persist to file
  try {
    fs.appendFileSync(logFile, line, { encoding: "utf-8" });
  } catch (err) {
    console.error("❌ Failed to write log file:", err);
  }
}
