import './prepare-ocr.mjs';
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['scripts/run-framework.mjs','build'], {stdio:'inherit'});
child.on('exit', code=>process.exit(code ?? 1));
