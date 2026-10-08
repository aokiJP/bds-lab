// the Discord side of app hold, in a thread of its own: Discord wants every press answered within 3 seconds, and the main
// thread spends seconds at a time in adb (a screenshot, OCR, a stick held for a walk) — here nothing waits on the device.
// Presses and messages go to the main thread as jobs ({ job: { cmds, it? } }); it answers them with the screen (REST).
import { parentPort, workerData } from 'node:worker_threads';
import { bot } from './discord.mjs';
import { discordJobs } from './live.mjs';

const b = bot({ token: workerData.token, userId: workerData.userId, log: (text) => parentPort.postMessage({ log: text }) });
parentPort.on('message', (m) => { if (m === 'close') { b.close(); parentPort.close(); } });
try {
  await discordJobs(b, (job) => parentPort.postMessage({ job }));
  parentPort.postMessage({ ready: true });
} catch (e) { parentPort.postMessage({ error: e.message }); }
