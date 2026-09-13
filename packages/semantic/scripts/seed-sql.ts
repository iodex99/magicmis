// Prints the generated head and library seed block for migration 0020.
import { seedSql } from "../src/seed-sql";

process.stdout.write(`${seedSql()}\n`);
