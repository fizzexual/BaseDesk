import net from 'node:net';

export interface FakeSmtp {
  port: number;
  received: Promise<{ to: string; data: string }>;
  close: () => void;
}

/** A tiny in-process SMTP server that speaks just enough to capture one message. */
export function fakeSmtp(): Promise<FakeSmtp> {
  let resolveReceived: (v: { to: string; data: string }) => void;
  const received = new Promise<{ to: string; data: string }>((r) => (resolveReceived = r));
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.write('220 fake ESMTP\r\n');
    let buf = '';
    let state: 'normal' | 'auth-user' | 'auth-pass' | 'data' = 'normal';
    let to = '';
    const data: string[] = [];
    sock.on('data', (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (state === 'data') {
          if (line === '.') {
            state = 'normal';
            sock.write('250 queued\r\n');
            resolveReceived({ to, data: data.join('\n') });
          } else data.push(line);
          continue;
        }
        if (state === 'auth-user') { state = 'auth-pass'; sock.write('334 UGFzc3dvcmQ6\r\n'); continue; }
        if (state === 'auth-pass') { state = 'normal'; sock.write('235 authenticated\r\n'); continue; }
        const up = line.toUpperCase();
        if (up.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (up.startsWith('AUTH LOGIN')) { state = 'auth-user'; sock.write('334 VXNlcm5hbWU6\r\n'); }
        else if (up.startsWith('RCPT TO')) { to = line.match(/<([^>]+)>/)?.[1] ?? ''; sock.write('250 ok\r\n'); }
        else if (up === 'DATA') { state = 'data'; sock.write('354 go ahead\r\n'); }
        else if (up === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 ok\r\n');
      }
    });
    sock.on('error', () => {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: (server.address() as net.AddressInfo).port, received, close: () => server.close() });
    });
  });
}
