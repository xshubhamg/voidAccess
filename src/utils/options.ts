export function validPort() {
  const rawPort = process.env.PORT;
  const PORT = rawPort === undefined ? 3000 : Number(rawPort);
  if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }

  return PORT;
}
