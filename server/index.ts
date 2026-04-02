import path from "node:path";
import express from "express";
import app from "./app.js";

const port = Number(process.env.PORT ?? 8787);
const distPath = path.resolve(process.cwd(), "dist");

app.use(express.static(distPath));
app.get("*", (_request, response) => {
  response.sendFile(path.join(distPath, "index.html"));
});

app.listen(port, () => {
  console.log(`Parola Viva server listening on http://localhost:${port}`);
});
