import express, { type Request, type Response } from "express";

const PORT = process.env.PORT || 3000;

const app = express();

app.get("/", (req: Request, res: Response) => {
  res.send("Hello express | typescript | postgresSQL");
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
