import "dotenv/config";
// Explicit opt-in synthetic test preview. Normal development always uses PostgreSQL.
const portIndex = process.argv.indexOf("--port");
if (portIndex >= 0) process.env.PORT = process.argv[portIndex + 1];
if (process.env.KAIROS_TEST_PREVIEW === "true") {
  if (process.env.NODE_ENV === "production")
    throw new Error("Synthetic preview is forbidden in production.");
  await import("./test-server");
} else await import("../server/index");
