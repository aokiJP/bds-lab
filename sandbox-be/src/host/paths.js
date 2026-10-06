// パッケージの中の場所。ここ以外で '..' を数えない。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const SRC_DIR = path.join(ROOT, 'src');
export const DATA_DIR = path.join(ROOT, 'data');
export const VM_DIR = path.join(SRC_DIR, 'vm');
export const CHILD_ENTRY = path.join(SRC_DIR, 'host', 'child.js');
