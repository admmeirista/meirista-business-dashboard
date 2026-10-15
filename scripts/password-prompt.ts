// Input password tanpa menampilkan karakter di terminal.
export function askPassword(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    let value = '';
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { done(); return; }
        if (c === '\u0003') { cleanup(); reject(new Error('Dibatalkan.')); return; }
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else value += c;
      }
    };
    const cleanup = () => { stdin.removeListener('data', onData); stdin.setRawMode?.(false); stdin.pause(); process.stdout.write('\n'); };
    const done = () => { cleanup(); resolve(value); };
    stdin.on('data', onData);
  });
}
