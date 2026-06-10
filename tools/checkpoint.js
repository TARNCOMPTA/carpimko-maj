// Consolide le WAL dans la base principale (argv[2] = chemin du .db).
import { DatabaseSync } from 'node:sqlite';
const p = process.argv[2];
const d = new DatabaseSync(p);
const r = d.exec('PRAGMA wal_checkpoint(TRUNCATE);');
d.close();
console.log('Checkpoint OK :', p);
