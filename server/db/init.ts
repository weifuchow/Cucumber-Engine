import { db, DB_PATH, applySchema } from "./index.js";

applySchema();
const count = db.prepare("SELECT COUNT(*) AS n FROM assets").get() as { n: number };
console.log(`[db:init] ready at ${DB_PATH} (assets=${count.n})`);
